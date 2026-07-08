import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Skills } from '../api/hud/Skills.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Traversal } from '../api/Traversal.js';
import { EventSignal } from '../api/EventSignal.js';
import { Locs } from '../api/queries/Locs.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { countMatching, matchesAny, shouldEat, shouldRestock, slotsMatching } from './ArdyFighterLogic.js';

// Grounded from the 274 content tree (~/code/rs2b2t-content, 2026-07-07):
// - [ardougne_guard] name=Guard, vislevel 20, 22 hp, respawn 100 ticks; seven
//   spawns in the market square (trio at z3309 just north of the anchor).
// - Two Baker's stalls: (2667,3310) and (2655,3311). Loc name "Baker's stall",
//   op "Steal from" (no hyphen). Thieving 5, members world, 8-tick respawn.
//   Stealing is blocked within 10 ticks of combat, and an Ardougne guard with
//   line of sight inside 5 tiles blocks the attempt and attacks instead —
//   which is this bot's guard-pull mechanism, not a failure.
// - South bank booths at (2656,3283) and (2656,3286); stand west of the booth.
// - guard.rs2 drops: bones + 1/128 medium clue tertiary; notable mains: iron
//   dagger, body talisman, steel arrows, blood/chaos/nature runes, iron ore.
const DEFAULT_ANCHOR = new Tile(2661, 3306, 0);
const DEFAULT_STALL = new Tile(2667, 3310, 0);
const DEFAULT_BANK_STAND = new Tile(2655, 3286, 0);
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const STALL_OP = 'Steal from';
const DEFAULT_FOOD = 'cake, bread, chocolate slice';
const DEFAULT_LOOT = 'clue scroll, blood rune, nature rune, chaos rune, body talisman, steel arrow, iron ore';

/** Tunable parameters (panel + `?ArdyFighter.<key>=...`). */
export const SETTINGS: SettingsSchema = {
    anchor: { type: 'tile', default: DEFAULT_ANCHOR, label: 'Market anchor (x,z)' },
    leashRadius: { type: 'number', default: 12, min: 5, max: 25, label: 'Leash radius (tiles)' },
    target: { type: 'string', default: 'Guard', label: 'NPC to fight (name)' },
    stallTile: { type: 'tile', default: DEFAULT_STALL, label: 'Baker\'s stall (x,z)', help: 'second stall sits at 2655,3311' },
    stallName: { type: 'string', default: 'Baker\'s stall', label: 'Stall loc name' },
    bankStand: { type: 'tile', default: DEFAULT_BANK_STAND, label: 'Bank stand tile (x,z)' },
    food: { type: 'string[]', default: DEFAULT_FOOD.split(',').map(s => s.trim()), label: 'Food names (contains)' },
    eatAtHp: { type: 'number', default: 50, min: 0, max: 100, label: 'Eat below HP%' },
    panicHp: { type: 'number', default: 25, min: 0, max: 100, label: 'Panic below HP% (no food)' },
    restUntilHp: { type: 'number', default: 60, min: 0, max: 100, label: 'Regen to HP% when bank empty' },
    foodFloor: { type: 'number', default: 2, min: 0, max: 27, label: 'Restock below (count)' },
    foodTarget: { type: 'number', default: 8, min: 1, max: 27, label: 'Restock until (count)' },
    bankAtLootSlots: { type: 'number', default: 12, min: 1, max: 27, label: 'Bank at loot slots' },
    loot: { type: 'string[]', default: DEFAULT_LOOT.split(',').map(s => s.trim()), label: 'Loot item names (contains)' }
};

// Active run config — set from settings in onStart. Safe as module state
// because exactly one script runs at a time (ADR-0006).
let ANCHOR = DEFAULT_ANCHOR;
let LEASH = 12;
let TARGET = 'Guard';
let STALL_TILE = DEFAULT_STALL;
let STALL_NAME = 'Baker\'s stall';
let BANK_STAND = DEFAULT_BANK_STAND;
let FOOD = DEFAULT_FOOD.split(',').map(s => s.trim().toLowerCase());
let LOOT = DEFAULT_LOOT.split(',').map(s => s.trim().toLowerCase());
let EAT_AT = 0.5;
let PANIC_AT = 0.25;
let REST_UNTIL = 0.6;
let FOOD_FLOOR = 2;
let FOOD_TARGET = 8;
let BANK_AT = 12;

function hpFraction(): number {
    const base = Skills.level('hitpoints');
    return base > 0 ? Skills.effective('hitpoints') / base : 1;
}

/** Total carried food (sums the cake bite-stages too — they all contain 'cake'). */
function foodCount(): number {
    return countMatching(Inventory.items(), FOOD);
}

/** Pack slots currently occupied by loot-list items. */
function lootSlots(): number {
    return slotsMatching(Inventory.items(), LOOT);
}

/**
 * East Ardougne market fighter. Fights Guards for combat XP, keeps itself fed
 * from the Baker's stall (a steal with a guard in line-of-sight pulls that
 * guard — free target), eats below a threshold (mid-combat too), loots the
 * rare guard drops, and banks them at the south bank when they fill enough
 * slots. Start it anywhere — it walks to the market first.
 */
export default class ArdyFighter extends TaskBot {
    override loopDelay = 600;

    private kills = 0;
    private steals = 0;
    private eats = 0;
    private looted = 0;
    private trips = 0;
    private deaths = 0;
    private status = 'starting';
    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        ANCHOR = this.settings.tile('anchor', DEFAULT_ANCHOR);
        LEASH = this.settings.num('leashRadius', 12);
        TARGET = this.settings.str('target', 'Guard');
        STALL_TILE = this.settings.tile('stallTile', DEFAULT_STALL);
        STALL_NAME = this.settings.str('stallName', 'Baker\'s stall');
        BANK_STAND = this.settings.tile('bankStand', DEFAULT_BANK_STAND);
        FOOD = this.settings.list('food', FOOD).map(s => s.toLowerCase());
        LOOT = this.settings.list('loot', LOOT).map(s => s.toLowerCase());
        EAT_AT = this.settings.num('eatAtHp', 50) / 100;
        PANIC_AT = this.settings.num('panicHp', 25) / 100;
        REST_UNTIL = this.settings.num('restUntilHp', 60) / 100;
        FOOD_FLOOR = this.settings.num('foodFloor', 2);
        FOOD_TARGET = this.settings.num('foodTarget', 8);
        BANK_AT = this.settings.num('bankAtLootSlots', 12);

        // The Baker's stall needs Thieving 5 — without it this bot cannot feed
        // itself, so refuse to run rather than starve mid-fight.
        if (Skills.level('thieving') < 5) {
            this.log(`ArdyFighter needs Thieving 5 for the Baker's stall (have ${Skills.level('thieving')}) — stopping.`);
            throw new Error('ArdyFighter: Thieving 5 required');
        }

        this.log(`ArdyFighter starting — anchor ${ANCHOR} r${LEASH}, target '${TARGET}', stall ${STALL_TILE}, bank ${BANK_STAND}`);

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
        });

        this.add(
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: ANCHOR,
                radius: 6,
                onDeath: () => {
                    this.setStatus('died — recovering');
                    this.countDeath();
                    this.log('died! waiting for respawn, then walking back to the market');
                },
                onRecovered: () => {
                    this.died = false;
                }
            }),
            new EatFood(this),
            new RestockCakes(this),
            new ReturnToAnchor(this)
        );
    }

    override grindTargets(): string[] {
        return [TARGET.toLowerCase()];
    }

    override recoveryAnchor(): Tile | null {
        return ANCHOR;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [
            `ArdyFighter — ${this.status}`,
            `kills ${this.kills}  steals ${this.steals}  ate ${this.eats}  loot ${this.looted}`,
            `bank trips ${this.trips}${this.deaths ? `  deaths ${this.deaths}` : ''}  food ${foodCount()}  lootslots ${lootSlots()}`,
            `hp ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}  tick ${Game.tick()}`
        ];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#ffb86c';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void {
        this.status = s;
    }
    countKill(): void {
        this.kills++;
    }
    countSteal(): void {
        this.steals++;
    }
    countEat(): void {
        this.eats++;
    }
    countLoot(): void {
        this.looted++;
    }
    countTrip(): void {
        this.trips++;
    }
    tripsTotal(): number {
        return this.trips;
    }
    countDeath(): void {
        this.deaths++;
    }
}

class ContinueDialog implements Task {
    validate(): boolean {
        return ChatDialog.canContinue();
    }
    async execute(): Promise<void> {
        await ChatDialog.continue();
    }
}

/** Walk back when outside the leash (start-anywhere travel + displacement recovery). */
class ReturnToAnchor implements Task {
    constructor(private bot: ArdyFighter) {}
    validate(): boolean {
        const here = Game.tile();
        return here !== null && ANCHOR.distanceTo(here) > LEASH + 6;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('walking to the market');
        await Traversal.walkResilient(ANCHOR, { radius: 3, attempts: 6, timeoutMs: 240_000, log: m => this.bot.log(`  ${m}`) });
    }
}

/** Eat below the gate — highest active priority, so it also fires mid-restock
 *  and mid-walk, and Fight's inner loop yields to it below the same gate. */
class EatFood implements Task {
    constructor(private bot: ArdyFighter) {}

    validate(): boolean {
        return shouldEat(hpFraction(), EAT_AT, foodCount());
    }

    async execute(): Promise<void> {
        const food = Inventory.items().find(i => matchesAny(i.name, FOOD));
        if (!food) {
            return;
        }
        this.bot.setStatus(`eating ${food.name}`);
        const before = Skills.effective('hitpoints');
        await food.interact('Eat');
        await Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
        this.bot.countEat();
    }
}

/**
 * Steal food from the Baker's stall until stocked. The engine blocks stall
 * theft for 10 ticks after combat, and a guard with line-of-sight within 5
 * tiles blocks the attempt and attacks ("Hey! Get your hands off there!") —
 * that pull is welcome: combat invalidates this task, Fight kills the guard,
 * and the 60s respawn window steals free. Owner-blocked attempts and the
 * looted-bare stall (8-tick respawn) just retry.
 */
class RestockCakes implements Task {
    constructor(private bot: ArdyFighter) {}

    validate(): boolean {
        return !Game.inCombat() && !Inventory.isFull() && shouldRestock(foodCount(), FOOD_FLOOR);
    }

    async execute(): Promise<void> {
        this.bot.setStatus('restocking at the Baker\'s stall');
        const here = Game.tile();
        if (!here || STALL_TILE.distanceTo(here) > 3) {
            await Traversal.walkTo(STALL_TILE, { radius: 2, timeoutMs: 60000, log: m => this.bot.log(`  ${m}`) });
        }

        const deadline = performance.now() + 60000;
        while (performance.now() < deadline) {
            if (EventSignal.pending() || this.bot.died || ChatDialog.canContinue() || Game.inCombat()) {
                return; // higher-priority tasks take over next loop
            }
            if (Inventory.isFull() || foodCount() >= FOOD_TARGET) {
                this.bot.log(`stocked ${foodCount()} food`);
                return;
            }
            if (shouldEat(hpFraction(), EAT_AT, foodCount())) {
                return; // EatFood outranks us next loop
            }

            // the looted stall swaps to an op-less variant while it respawns,
            // so requiring the op naturally waits out the 8-tick gap
            const stall = Locs.query()
                .name(STALL_NAME)
                .action(STALL_OP)
                .where(l => l.tile().distanceTo(STALL_TILE) <= 3)
                .nearest();
            if (!stall) {
                await Execution.delayTicks(2);
                continue;
            }

            const before = foodCount();
            if (!(await stall.interact(STALL_OP))) {
                await Execution.delayTicks(2);
                continue;
            }
            const got = await Execution.delayUntil(() => foodCount() > before || Game.inCombat(), 4000);
            if (got && foodCount() > before) {
                this.bot.countSteal();
            }
        }
    }
}
