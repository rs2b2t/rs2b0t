import { reader, type WorldTile } from '../adapter/ClientAdapter.js';
import { LoopingBot } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { Bank } from '../api/hud/Bank.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Shop } from '../api/hud/Shop.js';
import { Locs } from '../api/queries/Locs.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { isShopRun, vialsToBuy } from './VialFillerLogic.js';

const EMPTY_VIAL = 'Vial';
const WATER_VIAL = 'Vial of water';
const COINS = 'Coins';

// The only Falador fountain sits beside the WEST bank; the east bank has no
// water source in its scene, so an east-bank trip walks ~64 tiles each way.
const FOUNTAIN = new Tile(2949, 3381, 0);
const JATIX_STAND = new Tile(2899, 3427, 0);
const JATIX = 'Jatix';

export const BANK_STANDS: Record<string, WorldTile> = {
    'Falador West': new Tile(2946, 3369, 0),
    'Falador East': new Tile(3013, 3355, 0)
};

export const VIAL_FILLER_SETTINGS: SettingsSchema = {
    bank: {
        type: 'string',
        default: 'Falador West',
        options: Object.keys(BANK_STANDS),
        label: 'Which Falador bank',
        help: 'the fountain is 12 tiles from the west bank and 64 from the east one'
    },
    buyVials: { type: 'boolean', default: false, label: 'Buy vials at Jatix?', help: "every Nth trip, restock empty vials from Jatix's herblore shop in Taverley (members area)" },
    buyEveryRuns: { type: 'number', default: 5, min: 1, max: 50, label: 'Shop run every N trips' },
    buyQty: { type: 'number', default: 27, min: 1, max: 28, label: 'Empty vials to buy', help: 'vials do not stack, so a restock is capped by free pack space' },
    coinsPerTrip: { type: 'number', default: 1000, min: 1, max: 100000, label: 'Coins to top up to', help: 'only withdrawn on a shop run' }
};

export default class VialFiller extends LoopingBot {
    override loopDelay = 600;

    private bankStand: WorldTile = BANK_STANDS['Falador West'];
    private bankLabel = 'Falador West';
    private buyVials = false;
    private buyEvery = 5;
    private buyQty = 27;
    private coinFloat = 1000;

    private runs = 0;
    private filled = 0;
    private bought = 0;
    private status = 'starting';
    private startedAt = Date.now();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.bankLabel = this.settings.str('bank', 'Falador West');
        this.bankStand = BANK_STANDS[this.bankLabel] ?? BANK_STANDS['Falador West'];
        this.buyVials = this.settings.bool('buyVials', false);
        this.buyEvery = this.settings.num('buyEveryRuns', 5);
        this.buyQty = this.settings.num('buyQty', 27);
        this.coinFloat = this.settings.num('coinsPerTrip', 1000);
        this.startedAt = Date.now();

        this.log(`VialFiller — ${this.bankLabel} bank -> Falador fountain${this.buyVials ? `, Jatix restock every ${this.buyEvery} trips` : ''}`);
    }

    // A restock buys the vials the fill leg is about to fill, so it runs while
    // the pack is still empty — vials do not stack and would have nowhere to go
    // once the pack is full of water vials.
    async loop(): Promise<void> {
        const shopRun = isShopRun(this.runs, this.buyVials, this.buyEvery);

        if (!(await this.bankLeg(shopRun))) {
            return;
        }
        if (shopRun && !(await this.shopLeg())) {
            return;
        }
        if (!(await this.fillLeg())) {
            return;
        }
        this.runs++;
    }

    private freeSlots(): number {
        return Inventory.free();
    }

    private async walkTo(dest: WorldTile, what: string): Promise<boolean> {
        const here = Game.tile();
        if (here && Math.max(Math.abs(here.x - dest.x), Math.abs(here.z - dest.z)) <= 4) {
            return true;
        }
        this.setStatus(`walking to ${what}`);
        return Traversal.walkResilient(dest, { radius: 3, attempts: 2, timeoutMs: 60_000, log: m => this.log(`  ${m}`) });
    }

    private async bankLeg(shopRun: boolean): Promise<boolean> {
        if (!(await this.walkTo(this.bankStand, `the ${this.bankLabel} bank`))) {
            return false;
        }
        this.setStatus('banking');
        if (!(await Bank.openNearest('Bank booth', 'Use-quickly', m => this.log(`  ${m}`)))) {
            this.log('could not open the bank — retrying');
            return false;
        }

        await Bank.depositAllMatching(name => name.toLowerCase() !== COINS.toLowerCase());

        if (shopRun) {
            if (Inventory.count(COINS) < this.coinFloat / 2 && Bank.count(COINS) > 0) {
                await Bank.withdrawX(COINS, this.coinFloat);
            }
            if (Inventory.count(COINS) === 0) {
                this.log('no coins to restock vials with. Stopping.');
                ScriptRunner.stop();
                return false;
            }
        } else if (Bank.count(EMPTY_VIAL) === 0) {
            this.log(this.buyVials
                ? `no ${EMPTY_VIAL}s in the bank — the Jatix restock will refill on trip ${this.buyEvery}, or bank some vials.`
                : `no ${EMPTY_VIAL}s left in the bank. Stopping.`);
            if (!this.buyVials) {
                ScriptRunner.stop();
            }
            return false;
        } else {
            await Bank.withdrawX(EMPTY_VIAL, this.freeSlots());
        }

        await Bank.close();
        return shopRun || Inventory.count(EMPTY_VIAL) > 0;
    }

    private async shopLeg(): Promise<boolean> {
        if (!(await this.walkTo(JATIX_STAND, JATIX))) {
            return false;
        }
        this.setStatus('buying vials');
        if (!(await Shop.open(JATIX))) {
            this.log(`could not open ${JATIX}'s shop — retrying`);
            return false;
        }
        const want = vialsToBuy(this.freeSlots(), this.buyQty);
        const bought = await Shop.buy(EMPTY_VIAL, want);
        this.bought += bought;
        await Shop.close();
        this.log(`bought ${bought} ${EMPTY_VIAL}s`);
        if (bought === 0) {
            this.log(`${JATIX} had no ${EMPTY_VIAL}s in stock — waiting for a restock`);
            return false;
        }
        return true;
    }

    private async fillLeg(): Promise<boolean> {
        if (!(await this.walkTo(FOUNTAIN, 'the fountain'))) {
            return false;
        }

        // the engine fills ONE container per use, so this repeats once per vial
        let guard = reader.inventorySize() + 2;
        while (Inventory.count(EMPTY_VIAL) > 0 && guard-- > 0) {
            const fountain = Locs.query().name('Fountain').within(6).nearest();
            if (!fountain) {
                this.log('no Fountain in reach — repathing');
                return false;
            }
            const vial = Inventory.first(EMPTY_VIAL);
            if (!vial) {
                break;
            }
            const before = Inventory.count(EMPTY_VIAL);
            this.setStatus(`filling ${before} vials`);
            if (!(await vial.useOn(fountain))) {
                this.log('use-on-fountain was rejected — retrying');
                return false;
            }
            if (!(await Execution.delayUntil(() => Inventory.count(EMPTY_VIAL) < before, 4000))) {
                this.log('a vial did not fill — repathing');
                return false;
            }
            this.filled++;
            // the fill is a protected op, so the player is still busy this tick;
            // sending the next use immediately gets it dropped
            await Execution.delayTicks(1);
        }

        const water = Inventory.count(WATER_VIAL);
        this.log(`filled ${water} ${WATER_VIAL}`);
        return water > 0;
    }

    private setStatus(s: string): void {
        this.status = s;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#4aa3df' });
        p.title(`VialFiller — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const perHr = mins > 0.5 ? Math.round((this.filled / mins) * 60) : 0;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Trips: ${this.runs}`, `Vials/hr: ${perHr}`);
        p.row(`Filled: ${this.filled}`, `Bought: ${this.bought}`, `Coins: ${Inventory.count(COINS)}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
