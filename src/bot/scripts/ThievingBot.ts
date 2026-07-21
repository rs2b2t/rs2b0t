import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Reachability } from '../api/Reachability.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { SettingsStore } from '../runtime/Settings.js';
import { Skills } from '../api/hud/Skills.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs } from '../api/queries/Npcs.js';
import { walkOpening } from '../api/walkOpening.js';
import { PICKPOCKET_TARGET_NAMES } from './PickpocketTargets.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

/** Tunable parameters (panel + `?ThievingBot.<key>=...`). */
export const SETTINGS: SettingsSchema = {
    target: { type: 'string', default: 'Man', options: PICKPOCKET_TARGET_NAMES, label: 'Pickpocket target', help: 'pick by exact in-game name (level in parens): Man/Woman 1, Farmer 10, Rogue 32, Guard 40, Knight of Ardougne 55, Paladin 70, Hero 80' },
    action: { type: 'string', default: 'Pickpocket', label: 'Action', help: 'right-click op, e.g. Pickpocket / Steal-from' },
    food: { type: 'string', default: '', label: 'Food to eat (name contains)', help: 'eat this when HP drops from failed steals; blank = no eating (short runs only)' },
    eatAtHp: { type: 'number', default: 50, min: 0, max: 100, label: 'Eat below HP%' },
    dropMatch: { type: 'string', default: '', label: 'Drop when full (name contains)', help: 'drop these when the pack fills; blank = just idle when full (coins stack, so rarely fills)' },
    loot: { type: 'string', default: 'coins', label: 'Pick up from ground (name contains)', help: 'grab matching ground drops within the leash, e.g. coins; comma-separate for several; blank = pick up nothing' },
    obstacle: { type: 'string', default: 'door, gate', label: 'Openable obstacles (name contains)', help: 'when a target or the anchor is walled off, open the nearest of these that still has an Open action; comma-separate' },
    leashRadius: { type: 'number', default: 6, min: 2, max: 20, label: 'Leash radius (tiles)' }
};

/** Split a comma-separated keyword setting into lowercased, non-blank terms. */
function splitKeywords(raw: string): string[] {
    return raw
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
}

/**
 * Pickpockets an NPC in a loop: find the target by name + steal-op within a
 * leash of the start tile, steal, and (if given food) eat when a failed steal
 * knocks HP below the gate. Structurally the NPC-op cousin of GatheringBot —
 * stealing is an NPC action, not a loc action — with a combat-style HP gate
 * bolted on. Coins stack into one slot so the pack rarely fills; set dropMatch
 * to shed bulky loot for sustained runs. Picks up wanted ground drops (coins
 * by default) within the leash, and when a target or the anchor is walled off
 * it opens the door/gate in the way. Start it standing by the targets.
 */
export default class ThievingBot extends TaskBot {
    override loopDelay = 600;

    private anchor: Tile | null = null;
    private target = 'Man';
    private action = 'Pickpocket';
    private food = '';
    private eatAtHp = 0.5;
    private dropMatch = '';
    private loot: string[] = ['coins'];
    private obstacle: string[] = ['door', 'gate'];
    private leash = 6;

    private steals = 0;
    private eats = 0;
    private picked = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.target = this.settings.str('target', 'Man');
        this.action = this.settings.str('action', 'Pickpocket');
        this.food = this.settings.str('food', '').toLowerCase();
        this.eatAtHp = this.settings.num('eatAtHp', 50) / 100;
        this.dropMatch = this.settings.str('dropMatch', '').toLowerCase();
        this.loot = splitKeywords(this.settings.str('loot', 'coins'));
        this.obstacle = splitKeywords(this.settings.str('obstacle', 'door, gate'));
        this.leash = this.settings.num('leashRadius', 6);

        const here = Game.tile()!;
        this.anchor = new Tile(here.x, here.z, here.level);
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('thieving');
        this.log(`thieving '${this.target}' (${this.action}) within ${this.leash} of ${this.anchor}${this.food ? `, eating *${this.food}* below ${Math.round(this.eatAtHp * 100)}% hp` : ''}`);

        // count successful steals for the overlay (chat confirms the pick)
        this.on('chat.message', e => {
            if (/you (pick|steal|manage to steal)/i.test(e.text)) {
                this.steals++;
            }
        });

        this.add(new ContinueDialog(), new EatFood(this), new DropJunk(this), new Loot(this), new Steal(this), new ReturnToAnchor(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#9be05b' });
        p.title(`ThievingBot — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('thieving') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Target: ${this.target}`, `XP/hr: ${xph}`);
        p.row(`Steals: ${this.steals}`, `Ate: ${this.eats}`, `Picked: ${this.picked}`);
        p.bar('HP', Skills.hpFraction());

        p.gap();
        // live target switch — Steal/Loot re-read the target each loop, and each
        // steal is atomic (no multi-step transaction to corrupt), so it's safe
        const picked = p.select('target', 'target', PICKPOCKET_TARGET_NAMES, this.target);
        if (picked && picked !== this.target) {
            this.switchTarget(picked);
        }
        const clicked = p.buttons([
            { id: 'pause', label: ScriptRunner.state === 'paused' ? 'Resume' : 'Pause' },
            { id: 'stop', label: 'Stop' }
        ]);
        if (clicked === 'pause') {
            if (ScriptRunner.state === 'paused') {
                ScriptRunner.resume();
            } else {
                ScriptRunner.pause();
            }
        } else if (clicked === 'stop') {
            ScriptRunner.stop();
        }
        p.end();
    }

    /** Live target switch from the paint — the Steal/Loot tasks re-read the
     *  target name each loop, so the new target takes over immediately. The
     *  leash anchor stays put (generic targets carry no location data). */
    private switchTarget(target: string): void {
        this.target = target;
        SettingsStore.save('Thiever', 'target', target);
        this.log(`pickpocket target switched to ${target} (from the paint)`);
    }

    setStatus(s: string): void {
        this.status = s;
    }
    getAnchor(): Tile {
        return this.anchor!;
    }
    leashRadius(): number {
        return this.leash;
    }
    targetName(): string {
        return this.target;
    }
    actionName(): string {
        return this.action;
    }
    foodKeyword(): string {
        return this.food;
    }
    eatGate(): number {
        return this.eatAtHp;
    }
    dropKeyword(): string {
        return this.dropMatch;
    }
    lootKeywords(): string[] {
        return this.loot;
    }
    obstacleList(): string[] {
        return this.obstacle;
    }
    countEat(): void {
        this.eats++;
    }
    countLoot(): void {
        this.picked++;
    }
}

/** HP dropped from a failed steal: eat, if we're carrying food. */
class EatFood implements Task {
    constructor(private bot: ThievingBot) {}
    private food() {
        const kw = this.bot.foodKeyword();
        return kw ? Inventory.items().find(i => i.name?.toLowerCase().includes(kw)) ?? null : null;
    }
    validate(): boolean {
        return Skills.hpFraction() < this.bot.eatGate() && this.food() !== null;
    }
    async execute(): Promise<void> {
        const food = this.food();
        if (!food) {
            return;
        }
        this.bot.setStatus('eating');
        const before = Skills.effective('hitpoints');
        await food.interact('Eat');
        await Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
        this.bot.countEat();
    }
}

/** Shed bulky loot when the pack fills (coins stack, so this is rare). */
class DropJunk implements Task {
    constructor(private bot: ThievingBot) {}
    private junk() {
        const kw = this.bot.dropKeyword();
        return kw ? Inventory.items().filter(i => i.name?.toLowerCase().includes(kw)) : [];
    }
    validate(): boolean {
        return Inventory.isFull() && this.junk().length > 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('dropping junk');
        for (let guard = 0; guard < 28; guard++) {
            const item = this.junk()[0];
            if (!item) {
                break;
            }
            const before = Inventory.used();
            await item.interact('Drop');
            await Execution.delayUntil(() => Inventory.used() < before, 3000);
        }
    }
}

/** Grab wanted drops off the ground (coins by default) within the leash —
 *  only piles we can currently path to, so a walled-off drop can't wedge us. */
class Loot implements Task {
    constructor(private bot: ThievingBot) {}

    private find() {
        const want = this.bot.lootKeywords();
        if (want.length === 0) {
            return null;
        }
        const anchor = this.bot.getAnchor();
        const within = this.bot.leashRadius();
        return GroundItems.query()
            .where(g => {
                const n = g.name?.toLowerCase();
                return n !== undefined && want.some(k => n.includes(k));
            })
            .where(g => g.tile().distanceTo(anchor) <= within && Reachability.canReach(g.tile()))
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
        const name = drop.name ?? '';
        this.bot.setStatus(`picking up ${name}`);
        // coins (and other stackables) merge into an existing slot, so the slot
        // count needn't change — confirm the take by the item's total quantity.
        const before = Inventory.count(name);
        if (!(await drop.interact('Take'))) {
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => Inventory.count(name) > before, 3000)) {
            this.bot.countLoot();
        }
    }
}

/** Steal from the nearest target, then wait out the attempt (success or stun). */
class Steal implements Task {
    constructor(private bot: ThievingBot) {}

    private find() {
        const anchor = this.bot.getAnchor();
        const within = this.bot.leashRadius();
        return Npcs.query()
            .name(this.bot.targetName())
            .action(this.bot.actionName())
            .where(n => n.tile().distanceTo(anchor) <= within)
            .nearest();
    }

    validate(): boolean {
        // a stuffed pack with no droppable junk = idle (handled by DropJunk otherwise)
        return !Inventory.isFull() && this.find() !== null;
    }

    async execute(): Promise<void> {
        const npc = this.find();
        if (!npc) {
            return;
        }
        // The steal op paths the engine's own way and won't open a shut door to
        // reach a walled-off target — clear the way first, then steal next loop.
        if (!Reachability.canReach(npc.tile(), { adjacentOk: true })) {
            this.bot.setStatus(`clearing path to ${this.bot.targetName()}`);
            await walkOpening(npc.tile(), 1, this.bot.obstacleList(), m => this.bot.log(m));
            return;
        }
        this.bot.setStatus(`${this.bot.actionName()} ${this.bot.targetName()} at ${npc.tile()}`);
        const xpBefore = Skills.xp('thieving');
        const usedBefore = Inventory.used();
        if (!(await npc.interact(this.bot.actionName()))) {
            await Execution.delayTicks(2);
            return;
        }
        // A SUCCESS awards thieving xp (and usually loot) within a tick or two —
        // break the moment it lands so the next loop steals again, instead of
        // idling out the full timeout on every pick. A FAILURE gives neither and
        // stuns us for a few ticks: wait it out (yielding to EatFood if the hit
        // dropped us) rather than hammering inputs the stun ignores.
        await Execution.delayUntil(
            () => Skills.xp('thieving') > xpBefore || Inventory.used() > usedBefore || ChatDialog.canContinue() || Skills.hpFraction() < this.bot.eatGate(),
            3000
        );
    }
}

class ReturnToAnchor implements Task {
    constructor(private bot: ThievingBot) {}
    validate(): boolean {
        const here = Game.tile();
        return here !== null && this.bot.getAnchor().distanceTo(here) > this.bot.leashRadius() + 4;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('returning to anchor');
        await walkOpening(this.bot.getAnchor(), 2, this.bot.obstacleList(), m => this.bot.log(m));
    }
}
