import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Input } from '../../input/Input.js';
import { Execution } from '../execution/Execution.js';
import { Npcs } from '../npcs/Npcs.js';
import { Inventory } from '../inventory/Inventory.js';

const SHOP_ROOT = 3824;
const SHOP_STOCK_COM = 3900;
const SHOP_PLAYER_COM = 3823;

/**
 * A shop interface. Nothing here walks; be near the keeper first.
 * @see docs/reference/api-items.md#item-acquisition
 */
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

            const batch = buyBatch(it.ops, n - bought);
            if (batch.length === 0) {
                break;
            }

            const before = countHeld(name);
            for (const opIndex of batch) {
                await Input.invButton(it.id, it.slot, it.comId, opIndex + 1);
            }
            await Execution.delayUntil(() => countHeld(name) !== before, 3000);
            // the batch lands in one server tick — settle so the recount sees all of it
            await Execution.delayTicks(1);
            const got = countHeld(name) - before;
            if (got <= 0) {
                break;
            }

            bought += got;
        }

        return bought;
    },

    // Why: a shop can stock two objects that render the same name — Thessalia's two priest-gown
    // halves are 426 and 428 — and buying by name takes the first slot twice.

    /** Buy by exact object id, for stock whose display name is shared. */
    async buyById(id: number, n: number): Promise<number> {
        let bought = 0;
        while (bought < n && Shop.isOpen()) {
            const it = reader.shopInv(SHOP_STOCK_COM).find(s => s.id === id);
            if (!it || it.count === 0) {
                break;
            }

            const batch = buyBatch(it.ops, n - bought);
            if (batch.length === 0) {
                break;
            }

            const before = heldById(id);
            for (const opIndex of batch) {
                await Input.invButton(it.id, it.slot, it.comId, opIndex + 1);
            }
            await Execution.delayUntil(() => heldById(id) !== before, 3000);
            await Execution.delayTicks(1);
            const got = heldById(id) - before;
            if (got <= 0) {
                break;
            }

            bought += got;
        }

        return bought;
    },

    // pick chooses among same-name pack slots (e.g. sell the noted stack, not unnoted singles)
    async sell(name: string, n: number, pick?: (i: { id: number; count: number; slot: number }) => boolean): Promise<number> {
        let sold = 0;
        while (sold < n && Shop.isOpen()) {
            const matches = reader.shopInv(SHOP_PLAYER_COM).filter(s => s.name?.toLowerCase() === name.toLowerCase());
            const it = pick ? matches.find(pick) : matches[0];
            if (!it) {
                break;
            }

            const opIndex = stepOpIndex(it.ops, 'Sell', n - sold);
            if (opIndex === -1) {
                break;
            }

            const before = countHeld(name);
            await Input.invButton(it.id, it.slot, it.comId, opIndex + 1);
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

function heldById(id: number): number {
    return Inventory.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

// The engine processes at most this many user-event packets per player tick
// (ClientGameProtCategory USER_EVENT) — extra ops in a tick are dropped.
const USER_OPS_PER_TICK = 5;
const BUY_STEPS = [10, 5, 1] as const;

/**
 * One tick's worth of buy ops: up to USER_OPS_PER_TICK op indexes whose step sizes sum to at most `remaining`, largest steps first.
 * Why: a full batch then moves 50 items per tick instead of one op per tick.
 */
function buyBatch(ops: (string | null)[], remaining: number): number[] {
    const batch: number[] = [];
    let left = remaining;
    while (batch.length < USER_OPS_PER_TICK && left > 0) {
        const step = BUY_STEPS.find(size => size <= left
            && ops.some(o => o?.toLowerCase() === `buy ${size}`));
        if (step === undefined) {
            break;
        }
        batch.push(ops.findIndex(o => o?.toLowerCase() === `buy ${step}`));
        left -= step;
    }
    return batch;
}

function stepOpIndex(ops: (string | null)[], verb: 'Buy' | 'Sell', remaining: number): number {
    const step = remaining >= 10 ? `${verb} 10` : remaining >= 5 ? `${verb} 5` : `${verb} 1`;
    return ops.findIndex(o => o?.toLowerCase() === step.toLowerCase());
}
