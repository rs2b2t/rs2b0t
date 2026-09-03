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
import Tile from '../../geometry/Tile.js';
import { jiveFrame } from '../../paint/jive.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { CAST, FEATHER, FISH, FLY_LEVEL, KEEPER, ROD, SPOT, decide, featherAsk, sellPlan, tripLine, type PackState, type Step } from './logic.js';

/** The village bank of the Shilo river, the tile south of the fly spot at (2855,2973); (2856,2973) is the other near spot and (2855,2977) sits across five tiles of water. */
const RIVER_STAND = new Tile(2855, 2972, 0);
/** The customer side of Fernahei's counter, the tile the ShopBuyout preset stands on. */
const HUT_STAND = new Tile(2870, 2971, 0);

const CAST_START_TICKS = 10;
const CAST_HOLD_TICKS = 20;
const SPOT_WALK_MS = 20_000;
const HUT_WALK_MS = 60_000;

export const SETTINGS: SettingsSchema = {
    riverStand: { type: 'tile', default: RIVER_STAND, label: 'River stand tile (x,z)', help: 'row 2972 is the village bank; rows 2973 to 2977 are the river and the far bank is an 81-cost walk round' },
    hutStand: { type: 'tile', default: HUT_STAND, label: "Fernahei's counter tile (x,z)" },
    spotRadius: { type: 'number', default: 2, min: 1, max: 20, label: 'Spot search radius (tiles)', help: 'measured from the river stand; 2 keeps the two spots on the village bank and leaves the third, across the water, alone' },
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

    riverStand = RIVER_STAND;
    hutStand = HUT_STAND;
    spotRadius = 2;
    feathersTarget = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.riverStand = this.settings.tile('riverStand', RIVER_STAND);
        this.hutStand = this.settings.tile('hutStand', HUT_STAND);
        this.spotRadius = this.settings.num('spotRadius', 2);
        this.feathersTarget = this.settings.num('feathersTarget', 0);
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('fishing');

        const level = Skills.level('fishing');
        if (level < FLY_LEVEL) {
            ScriptRunner.stop(`[shilo] fly fishing needs Fishing ${FLY_LEVEL}, this account has ${level}`);
            return;
        }
        this.log(`[shilo] fly fishing from ${this.riverStand}, selling to ${KEEPER} at ${this.hutStand}${this.feathersTarget > 0 ? `, stopping at ${this.feathersTarget} feathers` : ''}`);
        this.add(new ContinueDialog(), new Stop(this), new Restock(this), new Fish(this));
    }

    override recoveryAnchor(): Tile | null {
        return this.riverStand;
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
                [{ text: `River: ${this.riverStand.x},${this.riverStand.z}` }, { text: `Hut: ${this.hutStand.x},${this.hutStand.z}` }],
                [{ text: `Spot radius: ${this.spotRadius}` }, { text: `Target: ${this.feathersTarget > 0 ? this.feathersTarget : 'none'}` }]
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

class Fish implements Task {
    private castIndex: number | null = null;

    constructor(private bot: JiveShilo) {}

    validate(): boolean {
        return this.bot.step().kind === 'fish';
    }

    private spot(): Npc | null {
        return Npcs.query().name(SPOT).action(CAST).withinOf(this.bot.riverStand, this.bot.spotRadius).nearest();
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        const here = Game.tile();
        const spot = this.spot();
        if (!spot) {
            this.castIndex = null;
            if (here && bot.riverStand.distanceTo(here) > 1) {
                bot.setStatus('walking to the river');
                await Traversal.walkResilient(bot.riverStand, { radius: 1, attempts: 3, timeoutMs: SPOT_WALK_MS, log: m => bot.log(`  ${m}`) });
                return;
            }
            bot.setStatus('waiting for a spot');
            await Execution.delayTicks(2);
            return;
        }
        if (here && spot.tile().distanceTo(here) > 3) {
            bot.setStatus('walking to the spot');
            await Traversal.walkTo(spot.tile(), { radius: 1, timeoutMs: SPOT_WALK_MS });
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
