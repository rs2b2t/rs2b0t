import { actions, reader } from '../../adapter/ClientAdapter.js';
import { ActionRouter } from '../../input/ActionRouter.js';
import { Execution } from '../Execution.js';
import { Npcs } from '../queries/Npcs.js';
import { Inventory } from './Inventory.js';

const SHOP_ROOT = 3824;
const SHOP_STOCK_COM = 3900;
const SHOP_PLAYER_COM = 3823;

export const Shop = {
    isOpen(): boolean {
        return reader.modals().main === SHOP_ROOT;
    },

    async open(npcName: string): Promise<boolean> {
        if (Shop.isOpen()) {
            return true;
        }

        for (let attempt = 0; attempt < 3; attempt++) {
            const npc = Npcs.query().name(npcName).action('Trade').nearest();
            if (!npc) {
                return false;
            }

            await npc.interact('Trade');
            if (await Execution.delayUntil(() => Shop.isOpen(), 3000)) {
                return true;
            }
        }

        return false;
    },

    stock(): { name: string; count: number; slot: number }[] {
        if (!Shop.isOpen()) {
            return [];
        }

        const out: { name: string; count: number; slot: number }[] = [];
        for (const s of reader.shopInv(SHOP_STOCK_COM)) {
            if (s.name !== null) {
                out.push({ name: s.name, count: s.count, slot: s.slot });
            }
        }

        return out;
    },

    async buy(name: string, n: number): Promise<number> {
        let bought = 0;
        while (bought < n && Shop.isOpen()) {
            const it = reader.shopInv(SHOP_STOCK_COM).find(s => s.name?.toLowerCase() === name.toLowerCase());
            if (!it || it.count === 0) {
                break;
            }

            const opIndex = stepOpIndex(it.ops, 'Buy', n - bought);
            if (opIndex === -1) {
                break;
            }

            const before = countHeld(name);
            await ActionRouter.driver.invButton(it.id, it.slot, it.comId, opIndex + 1);
            await Execution.delayUntil(() => countHeld(name) !== before, 3000);
            const got = countHeld(name) - before;
            if (got <= 0) {
                break;
            }

            bought += got;
        }

        return bought;
    },

    async sell(name: string, n: number): Promise<number> {
        let sold = 0;
        while (sold < n && Shop.isOpen()) {
            const it = reader.shopInv(SHOP_PLAYER_COM).find(s => s.name?.toLowerCase() === name.toLowerCase());
            if (!it) {
                break;
            }

            const opIndex = stepOpIndex(it.ops, 'Sell', n - sold);
            if (opIndex === -1) {
                break;
            }

            const before = countHeld(name);
            await ActionRouter.driver.invButton(it.id, it.slot, it.comId, opIndex + 1);
            await Execution.delayUntil(() => countHeld(name) !== before, 3000);
            const gone = before - countHeld(name);
            if (gone <= 0) {
                break;
            }

            sold += gone;
        }

        return sold;
    },

    async close(): Promise<void> {
        if (!Shop.isOpen()) {
            return;
        }

        actions.closeModal();
        await Execution.delayUntil(() => !Shop.isOpen(), 3000);
    }
};

function countHeld(name: string): number {
    return Inventory.count(name);
}

function stepOpIndex(ops: (string | null)[], verb: 'Buy' | 'Sell', remaining: number): number {
    const step = remaining >= 10 ? `${verb} 10` : remaining >= 5 ? `${verb} 5` : `${verb} 1`;
    return ops.findIndex(o => o?.toLowerCase() === step.toLowerCase());
}
