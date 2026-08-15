import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Bank } from '../../api/bank/Bank.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { openBankLeg } from '../../api/ai/quests/exec/steps.js';
import { BARCRAWL_CARD, BARCRAWL_GP, BARS, COINS } from '../../api/ai/quests/barcrawl/BarcrawlLogic.js';
import { ensureBarcrawl, readCard } from '../../api/ai/quests/barcrawl/RunBarcrawl.js';
import { Modals } from '../../api/ui/widgets/Modals.js';

// Why: the tour is a miniquest of its own — it opens the Barbarian Outpost gate and gates Barbarian Training.
// Why: it is runnable on its own as well as from Horror from the Deep, which calls the same driver in {@link ../quests/barcrawl/RunBarcrawl.js}.

/** Alfred Grimhand's Barcrawl, standalone. */
export default class Barcrawl extends LoopingBot {
    override loopDelay = 600;

    private status = 'starting';
    private signed = 0;
    private failures = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.log(`Barcrawl — ${BARS.length} bars, about ${BARCRAWL_GP}gp of drinks`);
    }

    override async loop(): Promise<number | void> {
        if (!Game.ingame()) {
            return 1200;
        }
        await this.refreshSigned();

        // Why: the tour crosses the map and the priciest bars are furthest from a booth, so the coins come before the walk.
        if (Inventory.count(COINS) < BARCRAWL_GP && !(await this.topUpCoins())) {
            this.status = 'out of coins';
            ScriptRunner.stop('not enough coins for the tour and none in the bank');
            return;
        }

        this.status = 'touring';
        if (await ensureBarcrawl(m => this.log(m), signed => { this.signed = signed; })) {
            this.status = 'complete';
            ScriptRunner.stop('barcrawl complete — the outpost gate will open');
            return;
        }

        // Why: `ensureBarcrawl` returns false for a cut-short conversation as well as a broken tour, and a random event is enough to cause the first.
        if (++this.failures >= 3) {
            this.status = 'gave up';
            ScriptRunner.stop('the barcrawl made no progress in three passes');
            return;
        }
        this.log(`barcrawl pass failed (${this.failures}/3) — retrying`);
        return 3000;
    }

    /** How many lines are green, for the paint. Silent when there is no card. */
    private async refreshSigned(): Promise<void> {
        if (Inventory.count(BARCRAWL_CARD) === 0) {
            return;
        }
        const progress = await readCard();
        if (progress) {
            this.signed = BARS.length - progress.remaining.length;
        }
    }

    private async topUpCoins(): Promise<boolean> {
        this.status = 'banking';
        if (!(await openBankLeg('barcrawl: no known bank', undefined, m => this.log(m)))) {
            return false;
        }
        await Bank.setNoteMode(false);
        // Four tours' worth: the walk back to a booth costs more than the coins.
        await Bank.withdrawX(COINS, BARCRAWL_GP * 4);
        await Modals.close();
        return Inventory.count(COINS) >= BARCRAWL_GP;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: this.status === 'complete' ? '#9be05b' : '#6cb6ff' });
        p.title(`Barcrawl — ${this.status}`);
        p.bar('Bars signed', this.signed / BARS.length, '#6cb6ff');
        p.row(`Signed: ${this.signed}/${BARS.length}`, `Coins: ${Inventory.count(COINS)}`);
        ScriptRunner.paintControls(p);
        p.end();
    }
}
