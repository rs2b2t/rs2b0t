import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { Quests } from '../../api/ui/questlog/Quests.js';
import { Reach } from '../../api/walking/Reach.js';
import { MURDER_LOC, MURDER_NAME, MURDER_OBJ, MURDER_TILE } from '../../api/ai/quests/defs/murder/areas.js';
import { Paint } from '../../paint/Paint.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';

export default class FlourCollector extends LoopingBot {
    private filled = 0;
    private status = 'starting';

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        if (!(await Execution.delayUntil(() => Quests.status(MURDER_NAME) !== 'unknown', 10_000))) {
            ScriptRunner.stop('could not read Murder Mystery status');
            return;
        }
        if (Quests.status(MURDER_NAME) === 'notStarted') {
            ScriptRunner.stop('start Murder Mystery to get permission to use the flour barrel');
        }
    }

    override async loop(): Promise<void> {
        if (Inventory.countById(MURDER_OBJ.POT) === 0) {
            await this.restock();
            return;
        }
        if (Bank.isOpen() && !(await Bank.close())) {
            return;
        }
        this.status = 'filling pots at Sinclair Mansion';
        const before = Inventory.countById(MURDER_OBJ.POT_FLOUR);
        await Reach.locOp({
            name: 'Barrel of flour',
            id: MURDER_LOC.FLOUR_BARREL,
            op: 'Take From',
            near: MURDER_TILE.FLOUR_BARREL,
            within: 6,
            expect: () => Inventory.countById(MURDER_OBJ.POT_FLOUR) > before,
            refused: /guards' permission|something to put the flour in/i,
            log: message => this.log(message)
        });
        this.filled += Math.max(0, Inventory.countById(MURDER_OBJ.POT_FLOUR) - before);
    }

    private async restock(): Promise<void> {
        this.status = 'banking at Seers';
        if (!(await Banking.open({ stand: MURDER_TILE.BANK, log: message => this.log(message) }))) {
            return;
        }
        try {
            if (!(await Execution.delayUntil(() => Bank.ready(), 5000))) {
                return;
            }
            await Bank.depositAllMatching((_name, id) => id !== MURDER_OBJ.POT);
            const count = Bank.countById(MURDER_OBJ.POT);
            if (count === 0) {
                this.status = 'out of empty pots';
                ScriptRunner.stop('bank is out of empty pots');
                return;
            }
            await Bank.setNoteMode(false);
            if (!(await Bank.withdrawXById(MURDER_OBJ.POT, Math.min(count, Inventory.free())))) {
                this.log('empty pots did not withdraw; retrying');
            }
        } finally {
            await Bank.close();
        }
    }

    override recoveryAnchor() {
        return MURDER_TILE.FLOUR_BARREL;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#e8d7a3' });
        p.title(`FlourCollector: ${this.status}`);
        p.row(`Filled: ${this.filled}`, `Pots left: ${Inventory.countById(MURDER_OBJ.POT)}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
