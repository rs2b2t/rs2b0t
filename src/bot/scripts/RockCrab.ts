import { TaskBot, type Task } from '../api/Bot.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Skills } from '../api/hud/Skills.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import { DirectNavigator } from '../nav/DirectNavigator.js';
import { Traversal } from '../api/Traversal.js';
import type { SettingsSchema } from '../runtime/Settings.js';

// The rock crab field east of Rellekka, on the northern shoreline (verified
// live: dormant "Rocks" NPCs at x 2694-2719, z 3714-3729; walking adjacent
// wakes them into attacking "Rock Crab" lvl 13). Two clusters share one
// scene, so the whole spot is reachable with scene-local walking.
const DEFAULT_FIELD = new Tile(2710, 3720, 0);
// Inland reset tile, ~21 tiles south of the field — far enough that the crabs
// de-aggro and revert, so walking back in wakes them again (the "run out and
// back" reset).
const DEFAULT_RESET = new Tile(2712, 3699, 0);
const MAX_FAILED_WAKES = 3; // consecutive dud wakes => area is de-aggro'd

// Valuables to grab off the ground. Both crystal-key halves share the item
// name "Half of a key"; the rest are the notable rock-crab drops.
const DEFAULT_LOOT = 'half of a key, casket, clue scroll, small oyster pearls, oyster pearls, uncut sapphire, uncut emerald, uncut ruby, uncut diamond';

/** Tunable parameters (panel + `?RockCrab.<key>=...`). The field/reset tiles
 *  let you point it at a different rock-crab spot entirely. */
export const SETTINGS: SettingsSchema = {
    field: { type: 'tile', default: DEFAULT_FIELD, label: 'Field centre (x,z)' },
    resetTile: { type: 'tile', default: DEFAULT_RESET, label: 'Run-out reset tile (x,z)' },
    fieldRadius: { type: 'number', default: 15, min: 5, max: 30, label: 'Field radius (tiles)' },
    stack: { type: 'number', default: 3, min: 1, max: 8, label: 'Crabs to stack before clearing' },
    fightHpGate: { type: 'number', default: 40, min: 0, max: 100, label: 'Retreat below HP%' },
    restUntilHp: { type: 'number', default: 75, min: 0, max: 100, label: 'Rest until HP%' },
    loot: { type: 'string[]', default: DEFAULT_LOOT.split(',').map(s => s.trim()), label: 'Loot item names' }
};

// Active run config — set from settings in onStart. Safe as module state
// because exactly one script runs at a time (ADR-0006).
let FIELD = DEFAULT_FIELD;
let RESET_TILE = DEFAULT_RESET;
let FIELD_RADIUS = 15;
let DESIRED_STACK = 3;
let FIGHT_HP_GATE = 0.4;
let REST_HP = 0.75;
let LOOT_NAMES = DEFAULT_LOOT.split(',').map(s => s.trim());

/**
 * Rock crab trainer for the Rellekka shoreline. Walks among the dormant
 * "Rocks" to aggro them, stacks a few Rock Crabs, kills the pile, re-gathers,
 * and runs out-and-back to reset aggression when the rocks stop waking. Loots
 * key halves and other valuables. Start it anywhere — it web-walks to the
 * field first. Handles every random event via the shared handler.
 */
export default class RockCrab extends TaskBot {
    override loopDelay = 600;

    private kills = 0;
    private looted = 0;
    private deaths = 0;
    private resets = 0;
    private failedWakes = 0;
    private status = 'starting';
    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        FIELD = this.settings.tile('field', DEFAULT_FIELD);
        RESET_TILE = this.settings.tile('resetTile', DEFAULT_RESET);
        FIELD_RADIUS = this.settings.num('fieldRadius', 15);
        DESIRED_STACK = this.settings.num('stack', 3);
        FIGHT_HP_GATE = this.settings.num('fightHpGate', 40) / 100;
        REST_HP = this.settings.num('restUntilHp', 75) / 100;
        LOOT_NAMES = this.settings.list('loot', LOOT_NAMES).map(s => s.toLowerCase());

        this.log(`RockCrab starting — field ${FIELD} r${FIELD_RADIUS}, stack ${DESIRED_STACK}, attack lvl ${Skills.level('attack')}`);

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
        });

        this.add(
            new DeathRecovery(this, {
                anchor: FIELD,
                radius: 4,
                onDeath: () => {
                    this.setStatus('died — recovering');
                    this.countDeath();
                    this.log('died! waiting for respawn, then web-walking back to the field');
                },
                onRecovered: () => {
                    this.died = false;
                }
            }),
            new GoToField(this),
            new LootValuables(this),
            new Fight(this),
            new Aggro(this),
            new ResetAggro(this)
        );
    }

    override grindTargets(): string[] {
        return ['rock crab', 'rocks'];
    }

    override recoveryAnchor(): Tile | null {
        return FIELD;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [`RockCrab — ${this.status}`, `kills ${this.kills}  loot ${this.looted}  resets ${this.resets}${this.deaths ? `  deaths ${this.deaths}` : ''}`, `hp ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}  tick ${Game.tick()}`];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#7ad0ff';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void {
        this.status = s;
    }
    countKill(): void {
        this.kills++;
    }
    killsTotal(): number {
        return this.kills;
    }
    countLoot(): void {
        this.looted++;
    }
    countDeath(): void {
        this.deaths++;
    }
    countReset(): void {
        this.resets++;
    }
    noteWake(success: boolean): void {
        this.failedWakes = success ? 0 : this.failedWakes + 1;
    }
    deAggroed(): boolean {
        return this.failedWakes >= MAX_FAILED_WAKES;
    }
    clearWakes(): void {
        this.failedWakes = 0;
    }
}

function hpFraction(): number {
    const base = Skills.level('hitpoints');
    return base > 0 ? Skills.effective('hitpoints') / base : 1;
}

function inField(tile: Tile): boolean {
    return FIELD.distanceTo(tile) <= FIELD_RADIUS;
}

/** Active, attackable crabs inside the field. */
function activeCrabs(): Npc[] {
    return Npcs.query()
        .name('Rock Crab')
        .where(n => inField(n.tile()))
        .results();
}

/** Dormant "Rocks" NPCs (not the mining loc of the same name) inside the field. */
function dormantRocks(): Npc[] {
    return Npcs.query()
        .name('Rocks')
        .where(n => inField(n.tile()))
        .results();
}

/** Web-walk to the field when we're not in it (start, post-death, post-reset). */
class GoToField implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        const here = Game.tile();
        return here !== null && !inField(Tile.from(here));
    }

    async execute(): Promise<void> {
        this.bot.setStatus('walking to the field');
        const ok = await Traversal.walkResilient(FIELD, { radius: 4, attempts: 6, timeoutMs: 240_000, log: m => this.bot.log(`  ${m}`) });
        if (ok) {
            this.bot.clearWakes();
        }
    }
}

class LootValuables implements Task {
    constructor(private bot: RockCrab) {}

    private find() {
        return GroundItems.query()
            .where(g => LOOT_NAMES.includes((g.name ?? '').toLowerCase()))
            .within(FIELD_RADIUS)
            .nearest();
    }

    validate(): boolean {
        return !Inventory.isFull() && this.find() !== null;
    }

    async execute(): Promise<void> {
        const drop = this.find();
        if (!drop) {
            return;
        }

        this.bot.setStatus(`looting ${drop.name} at ${drop.tile()}`);
        const before = Inventory.used();
        await drop.interact('Take');
        if (await Execution.delayUntil(() => Inventory.used() > before, 5000)) {
            this.bot.countLoot();
            this.bot.log(`looted ${drop.name}`);
        }
    }
}

/** Rest out of the field when low; doubles as an aggression reset. */
class Fight implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        if (hpFraction() < FIGHT_HP_GATE) {
            return false; // too low to keep fighting — ResetAggro will retreat
        }
        const crabs = activeCrabs();
        // Clear the pile only once it's stacked to size, or when there are no
        // more dormant rocks left to gather. While gathering (1-2 crabs and
        // rocks still to wake) Aggro keeps priority so they pile up first —
        // auto-retaliate still chips at whatever is hitting us meanwhile.
        const noMoreToGather = dormantRocks().length === 0;
        return crabs.length >= DESIRED_STACK || (crabs.length >= 1 && noMoreToGather);
    }

    async execute(): Promise<void> {
        this.bot.setStatus('fighting the stack');

        const deadline = performance.now() + 120000;
        while (performance.now() < deadline) {
            if (EventSignal.pending()) {
                return; // runtime event guard takes over next loop
            }
            if (this.bot.died || ChatDialog.canContinue()) {
                return;
            }
            if (hpFraction() < FIGHT_HP_GATE) {
                return;
            }

            const crab = activeCrabs().sort((a, b) => a.distance() - b.distance())[0];
            if (!crab) {
                return; // stack cleared
            }

            if (!Game.inCombat()) {
                await crab.interact('Attack');
                await Execution.delayUntil(() => Game.inCombat() || activeCrabs().length === 0, 4000);
            } else {
                await Execution.delayTicks(2);
            }

            // count kills by watching the active-crab population fall
            const remaining = activeCrabs().length;
            if (remaining < this.lastCount) {
                for (let i = 0; i < this.lastCount - remaining; i++) {
                    this.bot.countKill();
                }
                this.bot.log(`rock crab down — ${this.bot.killsTotal()} kills total`);
            }
            this.lastCount = remaining;
        }
    }

    private lastCount = 0;
}

/** Walk adjacent to a dormant Rocks to wake it into an attacking Rock Crab. */
class Aggro implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        if (hpFraction() < FIGHT_HP_GATE || this.bot.deAggroed()) {
            return false;
        }
        return activeCrabs().length < DESIRED_STACK && dormantRocks().length > 0;
    }

    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return; // runtime event guard takes over next loop
        }
        const rocks = dormantRocks().sort((a, b) => a.distance() - b.distance())[0];
        if (!rocks) {
            return;
        }

        this.bot.setStatus(`waking rocks at ${rocks.tile()}`);
        const before = activeCrabs().length;
        const rockTile = rocks.tile();

        // walk adjacent (radius 1) — proximity fires the crab's approach AI
        await DirectNavigator.walkTo(rockTile, 1, 15000);
        // give the engine a couple ticks to flip it active
        const woke = await Execution.delayUntil(() => activeCrabs().length > before || !dormantRocks().some(r => r.tile().equals(rockTile)), 4000);

        this.bot.noteWake(woke);
        if (woke) {
            this.bot.log(`woke a rock crab — stack now ${activeCrabs().length}`);
        } else {
            this.bot.log(`rocks at ${rockTile} did not wake (${this.failsLabel()})`);
        }
    }

    private failsLabel(): string {
        return this.bot.deAggroed() ? 'area de-aggroed — will reset' : 'retrying';
    }
}

/** Run out of the field and back to reset aggression (or to regen HP). */
class ResetAggro implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        // reset when the rocks stopped waking, or when we're too low and need
        // to drop aggro and regen
        return this.bot.deAggroed() || (hpFraction() < FIGHT_HP_GATE && !Game.inCombat());
    }

    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return; // runtime event guard takes over next loop
        }
        const low = hpFraction() < FIGHT_HP_GATE;
        this.bot.setStatus(low ? 'low HP — retreating to reset/regen' : 'running out to reset aggression');
        this.bot.countReset();

        await DirectNavigator.walkTo(RESET_TILE, 1, 60000);

        if (low) {
            this.bot.log(`resting at the reset tile (${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp)`);
            await Execution.delayUntil(() => hpFraction() >= REST_HP, 120000);
        } else {
            // brief pause so the crabs fully revert before we walk back in
            await Execution.delayTicks(3);
        }

        await DirectNavigator.walkTo(FIELD, 3, 60000);
        this.bot.clearWakes();
        this.bot.log('back in the field');
    }
}
