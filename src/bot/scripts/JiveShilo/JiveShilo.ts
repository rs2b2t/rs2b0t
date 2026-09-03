import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import type { Npc } from '../../api/model/Npc.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Shop } from '../../api/shop/Shop.js';
import { Skills } from '../../api/skills/Skills.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import Tile from '../../geometry/Tile.js';
import { jiveFrame } from '../../paint/jive.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { CAST, FEATHER, FISH, FLY_LEVEL, KEEPER, ROD, SPOT, decide, featherAsk, nearestFishable, nextScan, sellPlan, tripLine, type PackState, type Step } from './logic.js';
import { SEARCH_AREA, SPOT_STANDS, SWEEP } from './river.js';

/** The customer side of Fernahei's counter, the tile the ShopBuyout preset stands on. */
const HUT_STAND = new Tile(2870, 2971, 0);

const CAST_START_TICKS = 10;
const CAST_HOLD_TICKS = 20;
/** Flood budget for a live stand beside a spot tile the table does not know; the far bank is 80 tiles round and never inside it. */
const LIVE_STAND_STEPS = 300;
const STAND_WALK_MS = 30_000;
const SCAN_WALK_MS = 45_000;
const HUT_WALK_MS = 60_000;

export const SETTINGS: SettingsSchema = {
    hutStand: { type: 'tile', default: HUT_STAND, label: "Fernahei's counter tile (x,z)" },
    feathersTarget: { type: 'number', default: 0, min: 0, max: 100_000, label: 'Stop at this many feathers (0 = keep going)' }
};

export default class JiveShilo extends TaskBot {
    override loopDelay = 600;

    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private caught = 0;
    private trips = 0;
    private sold = 0;
    private earned = 0;
    private feathersBought = 0;
    private spent = 0;
    private soldByName = new Map<string, number>();

    hutStand = HUT_STAND;
    feathersTarget = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.hutStand = this.settings.tile('hutStand', HUT_STAND);
        this.feathersTarget = this.settings.num('feathersTarget', 0);
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('fishing');

        const level = Skills.level('fishing');
        if (level < FLY_LEVEL) {
            ScriptRunner.stop(`[shilo] fly fishing needs Fishing ${FLY_LEVEL}, this account has ${level}`);
            return;
        }
        this.log(`[shilo] fly fishing the river from ${SEARCH_AREA.minX},${SEARCH_AREA.minZ} to ${SEARCH_AREA.maxX},${SEARCH_AREA.maxZ} (${SPOT_STANDS.length} known spot tiles, ${SWEEP.length} sweep stops), selling to ${KEEPER} at ${this.hutStand}${this.feathersTarget > 0 ? `, stopping at ${this.feathersTarget} feathers` : ''}`);
        this.add(new ContinueDialog(), new Stop(this), new Restock(this), new Fish(this));
    }

    override recoveryAnchor(): Tile | null {
        return SWEEP[0]!;
    }

    setStatus(s: string): void {
        this.status = s;
    }

    pack(): PackState {
        return {
            rod: Inventory.count(ROD) > 0,
            feathers: Inventory.count(FEATHER),
            fish: this.fishHeld(),
            coins: Inventory.count('Coins'),
            free: Inventory.free()
        };
    }

    step(): Step {
        return decide(this.pack(), this.feathersTarget);
    }

    fishHeld(): number {
        return FISH.reduce((n, name) => n + Inventory.count(name), 0);
    }

    noteCatch(n: number): void {
        this.caught += n;
    }

    noteTrip(sold: { name: string; count: number }[], earned: number, feathers: number, spent: number): void {
        this.trips++;
        this.earned += earned;
        this.feathersBought += feathers;
        this.spent += spent;
        for (const s of sold) {
            this.sold += s.count;
            this.soldByName.set(s.name, (this.soldByName.get(s.name) ?? 0) + s.count);
        }
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const { frame: p, page, section } = jiveFrame(ctx, {
            script: 'JiveShilo',
            status: this.status,
            pages: ['Statistics', 'Options'],
            sections: ['Overview', 'Haul']
        });
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = Skills.xp('fishing') - this.xpAtStart;

        if (page === 'Options') {
            p.statGrid([
                [{ text: `Hut: ${this.hutStand.x},${this.hutStand.z}` }, { text: `Target: ${this.feathersTarget > 0 ? this.feathersTarget : 'none'}` }],
                [{ text: `Spot tiles: ${SPOT_STANDS.length}` }, { text: `Sweep stops: ${SWEEP.length}` }]
            ]);
        } else if (section === 'Overview') {
            p.statGrid([
                [{ text: `Runtime: ${fmtDuration(mins)}` }, { text: `Caught: ${this.caught}` }],
                [{ text: `Xp/hr: ${mins > 0.5 ? `${((xp / mins) * 60 / 1000).toFixed(1)}k` : 'n/a'}` }, { text: `Trips: ${this.trips}` }],
                [{ text: `Feathers: ${Inventory.count(FEATHER)}` }, { text: `Coins: ${Inventory.count('Coins')}` }]
            ]);
            p.bar('Pack', Inventory.used() / 28);
        } else {
            const lines = [...this.soldByName.entries()].map(([name, n]) => ({ text: `${n}x ${name}` }));
            p.statGrid([
                [{ text: `Sold: ${this.sold} for ${this.earned}gp` }, { text: `Feathers: ${this.feathersBought} for ${this.spent}gp` }],
                ...(lines.length > 0 ? [lines] : [])
            ]);
        }

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}

class Stop implements Task {
    constructor(private bot: JiveShilo) {}

    validate(): boolean {
        return this.bot.step().kind === 'stop';
    }

    async execute(): Promise<void> {
        const step = this.bot.step();
        if (step.kind === 'stop') {
            this.bot.setStatus('stopped');
            ScriptRunner.stop(`[shilo] ${step.reason}`);
        }
    }
}

// Why: the counter is the only place fish turn into feathers, so selling, the rod and the feathers are one visit; a rod bought before the fish are sold would be paid for with coins the feathers need.
class Restock implements Task {
    constructor(private bot: JiveShilo) {}

    validate(): boolean {
        const kind = this.bot.step().kind;
        return kind === 'sell' || kind === 'gear';
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        bot.setStatus(`walking to ${KEEPER}`);
        if (!(await Traversal.walkResilient(bot.hutStand, { radius: 2, attempts: 4, timeoutMs: HUT_WALK_MS, log: m => bot.log(`  ${m}`) }))) {
            bot.log('[shilo] walk to the hut failed, will retry');
            return;
        }
        if (!(await Shop.open(KEEPER))) {
            bot.log(`[shilo] could not open ${KEEPER}'s shop, will retry`);
            return;
        }

        bot.setStatus('selling the catch');
        const coinsBefore = Inventory.count('Coins');
        const sold: { name: string; count: number }[] = [];
        for (const line of sellPlan(name => Inventory.count(name))) {
            const n = await Shop.sell(line.name, line.count);
            if (n > 0) {
                sold.push({ name: line.name, count: n });
            }
        }
        const earned = Inventory.count('Coins') - coinsBefore;

        if (Inventory.count(ROD) === 0) {
            if ((await Shop.buy(ROD, 1)) > 0) {
                bot.log(`[shilo] bought a ${ROD}`);
            } else {
                bot.log(`[shilo] ${KEEPER} has no ${ROD} for ${Inventory.count('Coins')}gp`);
            }
        }

        bot.setStatus('buying feathers');
        const stock = Shop.stock().find(s => s.name === FEATHER)?.count ?? 0;
        const coinsForFeathers = Inventory.count('Coins');
        const feathers = await Shop.buy(FEATHER, featherAsk(stock, coinsForFeathers));
        const spent = coinsForFeathers - Inventory.count('Coins');
        await Shop.close();

        bot.noteTrip(sold, earned, feathers, spent);
        bot.log(`[shilo] ${tripLine(sold, earned, feathers, spent, Inventory.count(FEATHER))}`);
    }
}

/** A bank tile beside a spot the table does not know, read off the client's collision from where the player stands. */
function liveStand(spot: Npc, here: { x: number; z: number; level: number }): Tile | null {
    const t = spot.tile();
    let best: Tile | null = null;
    for (const [dx, dz] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
        const n = new Tile(t.x + dx, t.z + dz, t.level);
        if (Reachability.canReach(n, { maxSteps: LIVE_STAND_STEPS }) && (!best || n.distanceTo(here) < best.distanceTo(here))) {
            best = n;
        }
    }
    return best;
}

// Why: a spot teleports along the river every 280 to 530 ticks and is only in the client's npc list within view range, so the task casts at the nearest spot in the area it can see a bank tile for and otherwise sweeps the bank end to end until one shows.
class Fish implements Task {
    private castIndex: number | null = null;
    private lastScan: number | null = null;

    constructor(private bot: JiveShilo) {}

    validate(): boolean {
        return this.bot.step().kind === 'fish';
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        const here = Game.tile();
        if (!here) {
            await Execution.delayTicks(1);
            return;
        }
        const spots = Npcs.query().name(SPOT).action(CAST).inside(SEARCH_AREA).results();
        const pick = nearestFishable(spots, here, spot => liveStand(spot, here));
        if (!pick) {
            this.castIndex = null;
            const at = nextScan(here, this.lastScan);
            const scan = SWEEP[at]!;
            this.lastScan = at;
            bot.setStatus(`no spot in view, sweeping the river via ${scan.x},${scan.z}`);
            await Traversal.walkResilient(scan, { radius: 0, attempts: 3, timeoutMs: SCAN_WALK_MS, log: m => bot.log(`  ${m}`) });
            await Execution.delayTicks(1);
            return;
        }
        const { spot, stand } = pick;
        this.lastScan = null;
        if (stand.distanceTo(here) > 0 && this.castIndex !== spot.index) {
            bot.setStatus(`walking to the spot at ${spot.tile().x},${spot.tile().z}`);
            await Traversal.walkResilient(stand, { radius: 0, attempts: 3, timeoutMs: STAND_WALK_MS, log: m => bot.log(`  ${m}`) });
            return;
        }

        const before = bot.fishHeld();
        if (this.castIndex !== spot.index || !Game.animating()) {
            bot.setStatus(`${CAST} at ${spot.tile().x},${spot.tile().z}`);
            if (!(await spot.interact(CAST))) {
                this.castIndex = null;
                await Execution.delayTicks(2);
                return;
            }
            const started = await Execution.delayUntilTicks(() => Game.animating() || bot.fishHeld() > before || ChatDialog.canContinue(), CAST_START_TICKS);
            if (!started) {
                this.castIndex = null;
                return;
            }
            this.castIndex = spot.index;
        }

        bot.setStatus('fishing');
        // Why: one bounded hold per loop, so the supervisor and the dialogue task get the loop back between casts.
        await Execution.delayUntilTicks(
            () => !Game.animating() || Inventory.isFull() || Inventory.count(FEATHER) === 0 || !spot.valid() || EventSignal.pending() || ChatDialog.canContinue(),
            CAST_HOLD_TICKS
        );
        bot.noteCatch(Math.max(0, bot.fishHeld() - before));
    }
}
