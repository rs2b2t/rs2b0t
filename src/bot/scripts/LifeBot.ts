import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Skills } from '../api/hud/Skills.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Locs } from '../api/queries/Locs.js';
import { Traversal } from '../api/Traversal.js';
import type { SettingsSchema } from '../runtime/Settings.js';

export const SETTINGS: SettingsSchema = {
    minMinutes: { type: 'number', default: 3, min: 1, max: 30, label: 'Min minutes per activity' },
    maxMinutes: { type: 'number', default: 8, min: 2, max: 60, label: 'Max minutes per activity' }
};

interface Spot {
    name: string;
    tile: Tile;
    kind: 'gather' | 'fight' | 'wander';
    targetType?: 'loc' | 'npc';
    target?: string;
    action?: string;
    drop?: string;
}

// A free-to-play world circuit spanning Lumbridge, Draynor, Varrock, Barbarian
// Village and Falador — all connected by F2P roads (no toll gates), so the
// web-walker can travel between them and the fleet spreads across the whole map
// instead of clustering in one place. Social-hub stops (squares, banks) are
// `wander` so the exact tile need only be walkable; gather/fight stops sit on
// their resources. A bot that can't path to a stop abandons it (see noteTravel).
const SPOTS: Spot[] = [
    // Lumbridge
    { name: 'the chicken pen', tile: new Tile(3232, 3298, 0), kind: 'fight', target: 'Chicken', action: 'Attack' },
    { name: 'the cow field', tile: new Tile(3259, 3272, 0), kind: 'fight', target: 'Cow', action: 'Attack' },
    { name: 'Lumbridge castle', tile: new Tile(3222, 3218, 0), kind: 'wander' },
    { name: 'the swamp mine', tile: new Tile(3230, 3153, 0), kind: 'gather', targetType: 'loc', target: 'Rocks', action: 'Mine', drop: 'ore' },
    // Draynor
    { name: 'Draynor village', tile: new Tile(3092, 3248, 0), kind: 'wander' },
    { name: 'the Draynor trees', tile: new Tile(3098, 3236, 0), kind: 'gather', targetType: 'loc', target: 'Tree', action: 'Chop down', drop: 'logs' },
    // Varrock
    { name: 'Varrock square', tile: new Tile(3213, 3428, 0), kind: 'wander' },
    { name: 'the Varrock west bank', tile: new Tile(3185, 3436, 0), kind: 'wander' },
    { name: 'the Varrock mine', tile: new Tile(3286, 3363, 0), kind: 'gather', targetType: 'loc', target: 'Rocks', action: 'Mine', drop: 'ore' },
    // Barbarian Village + Falador
    { name: 'Barbarian Village', tile: new Tile(3081, 3421, 0), kind: 'wander' },
    { name: 'the Falador east bank', tile: new Tile(3013, 3355, 0), kind: 'wander' },
    { name: 'Falador square', tile: new Tile(2965, 3383, 0), kind: 'wander' }
];

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const AGGRESSIVE = 1; // com_mode: train Strength while fighting

/**
 * The "life" orchestrator: instead of grinding one spot forever, the bot picks
 * a place in the world, walks there, does the local activity for a human-like
 * stretch (the clock starts on ARRIVAL, not when it sets off), then wanders off
 * somewhere else and does something different — mine, fight chickens or cows, or
 * loiter in town. A fleet reads like people going about their day rather than a
 * bank of farmers. Combat spots train Strength; low HP backs off.
 */
export default class LifeBot extends TaskBot {
    override loopDelay = 600;

    private spot: Spot = SPOTS[0];
    private arrived = false;
    private leaveAt = 0;
    private minTicks = 300;
    private maxTicks = 800;
    private status = 'starting';
    private stuckCount = 0;
    private lastDist = 99999;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.minTicks = Math.round((this.settings.num('minMinutes', 3) * 60000) / 600);
        this.maxTicks = Math.max(this.minTicks + 60, Math.round((this.settings.num('maxMinutes', 8) * 60000) / 600));
        this.spot = pick(SPOTS);
        this.arrived = false; // travel to the first spot, then the clock starts
        this.log('starting a day out in the world');
        this.add(new ContinueDialog(), new NextActivity(this), new Travel(this), new DoActivity(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const left = this.arrived ? Math.max(0, this.leaveAt - Game.tick()) : 0;
        const where = this.arrived ? `at ${this.spot.name} (~${Math.round((left * 600) / 60000)}m left)` : `heading to ${this.spot.name}`;
        const lines = [`LifeBot — ${this.status}`, where, `hp ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}  tick ${Game.tick()}`];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#7bd0ff';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void {
        this.status = s;
    }
    current(): Spot {
        return this.spot;
    }
    bored(): boolean {
        return this.arrived && Game.tick() >= this.leaveAt;
    }
    atSpot(): boolean {
        const t = Game.tile();
        return t !== null && this.spot.tile.distanceTo(t) <= 9;
    }
    /** Start the activity clock the moment we reach the spot (not before). */
    ensureArrived(): void {
        if (!this.arrived) {
            this.arrived = true;
            this.stuckCount = 0;
            this.leaveAt = Game.tick() + this.minTicks + Math.floor(Math.random() * (this.maxTicks - this.minTicks));
            this.log(`made it to ${this.spot.name}`);
        }
    }

    /** After a travel leg, true if we've stopped making progress toward the spot
     *  (blocked / unreachable) and should abandon it rather than loop forever. */
    noteTravel(): boolean {
        const here = Game.tile();
        const d = here ? this.spot.tile.distanceTo(here) : 99999;
        this.stuckCount = d >= this.lastDist - 2 ? this.stuckCount + 1 : 0;
        this.lastDist = d;
        return this.stuckCount >= 3;
    }
    hpOk(): boolean {
        const base = Skills.level('hitpoints');
        return base <= 0 || Skills.effective('hitpoints') / base >= 0.35;
    }
    pickNext(): void {
        let next = pick(SPOTS);
        for (let i = 0; i < 5 && next.name === this.spot.name; i++) {
            next = pick(SPOTS);
        }
        this.spot = next;
        this.arrived = false;
        this.stuckCount = 0;
        this.lastDist = 99999;
        this.log(`think I'll head to ${this.spot.name} for a bit`);
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

/** Finished an activity → choose the next place to go. */
class NextActivity implements Task {
    constructor(private bot: LifeBot) {}
    validate(): boolean {
        return this.bot.bored();
    }
    async execute(): Promise<void> {
        this.bot.setStatus('deciding what to do next');
        this.bot.pickNext();
        await Execution.delayTicks(1);
    }
}

/** Not at the current spot yet → walk there (the visible "roaming the world"). */
class Travel implements Task {
    constructor(private bot: LifeBot) {}
    validate(): boolean {
        return !this.bot.bored() && !this.bot.atSpot();
    }
    async execute(): Promise<void> {
        const spot = this.bot.current();
        this.bot.setStatus(`walking to ${spot.name}`);
        await Traversal.walkTo(spot.tile, { radius: 4, timeoutMs: 90000, log: m => this.bot.log(`  ${m}`) });
        if (!this.bot.atSpot() && this.bot.noteTravel()) {
            this.bot.log(`can't seem to reach ${spot.name} — heading elsewhere`);
            this.bot.pickNext();
        }
    }
}

/** At the spot and not bored → start the clock (once) and do a unit of activity. */
class DoActivity implements Task {
    constructor(private bot: LifeBot) {}

    validate(): boolean {
        return !this.bot.bored() && this.bot.atSpot();
    }

    async execute(): Promise<void> {
        this.bot.ensureArrived();
        const spot = this.bot.current();
        if (spot.kind === 'fight') {
            await this.fight(spot);
        } else if (spot.kind === 'gather') {
            await this.gather(spot);
        } else {
            await this.wander();
        }
    }

    private async fight(spot: Spot): Promise<void> {
        if (!this.bot.hpOk()) {
            this.bot.setStatus('taking a breather (low hp)');
            await Execution.delayUntil(() => this.bot.hpOk() || Game.inCombat(), 30000);
            return;
        }
        if (Game.inCombat()) {
            await Execution.delayTicks(2);
            return;
        }
        Game.setCombatStyle(AGGRESSIVE); // train Strength
        const anchor = spot.tile;
        const mob = Npcs.query()
            .name(spot.target!)
            .action('Attack')
            .where(n => !n.inCombat && n.tile().distanceTo(anchor) <= 10)
            .nearest();
        if (!mob) {
            await this.wander();
            return;
        }
        this.bot.setStatus(`fighting a ${spot.target}`);
        if (await mob.interact('Attack')) {
            await Execution.delayUntil(() => Game.inCombat() || ChatDialog.canContinue(), 5000);
            await Execution.delayUntil(() => !Game.inCombat() || ChatDialog.canContinue(), 45000);
        } else {
            await Execution.delayTicks(2);
        }
    }

    private async gather(spot: Spot): Promise<void> {
        if (Inventory.isFull()) {
            const kw = (spot.drop ?? '').toLowerCase();
            const item = Inventory.items().find(i => kw !== '' && i.name?.toLowerCase().includes(kw));
            if (item) {
                await item.interact('Drop');
                await Execution.delayTicks(1);
            } else {
                await this.wander();
            }
            return;
        }
        const anchor = spot.tile;
        const target = spot.targetType === 'npc'
            ? Npcs.query().name(spot.target!).action(spot.action!).where(n => n.tile().distanceTo(anchor) <= 10).nearest()
            : Locs.query().name(spot.target!).action(spot.action!).where(l => l.distance() >= 1 && l.tile().distanceTo(anchor) <= 10).nearest();
        if (!target) {
            await this.wander();
            return;
        }
        this.bot.setStatus(`${spot.action} ${spot.target}`);
        const before = Inventory.used();
        if (await target.interact(spot.action!)) {
            await Execution.delayUntil(() => Inventory.used() > before || Game.animating() || ChatDialog.canContinue(), 8000);
            for (let i = 0; i < 20 && !Inventory.isFull() && Game.animating(); i++) {
                const mark = Inventory.used();
                await Execution.delayUntil(() => Inventory.used() > mark || !Game.animating(), 6000);
            }
        } else {
            await Execution.delayTicks(2);
        }
    }

    /** Amble a few tiles around the spot and pause, like someone milling about. */
    private async wander(): Promise<void> {
        this.bot.setStatus('wandering about');
        const c = this.bot.current().tile;
        const dx = Math.floor(Math.random() * 9) - 4;
        const dz = Math.floor(Math.random() * 9) - 4;
        await Traversal.walkTo(new Tile(c.x + dx, c.z + dz, c.level), { radius: 1, timeoutMs: 20000 });
        await Execution.delayTicks(3 + Math.floor(Math.random() * 6));
    }
}
