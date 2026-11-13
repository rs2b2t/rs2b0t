import { reader } from '../../adapter/ClientAdapter.js';
import { Input } from '../../input/Input.js';
import { SM_NPC, SM_TILE } from '../../api/ai/quests/defs/mortton/areas.js';
import { Bank } from '../../api/bank/Bank.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { liveCatalog, notedId, tradeable } from '../../api/market/catalog.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Shop } from '../../api/shop/Shop.js';
import { held, type Supplies } from './supply.js';

const COIN_RESERVE = 500;
const STOCK_COMPONENT = 3900;
const PLAYER_COMPONENT = 3823;
const NONBASELINE_SUPPLIES = new Set([3448, 379, 2434, 139, 141, 143]);

function purchaseBudget(id: number): number {
    const cost = liveCatalog().byId.get(id)?.cost;
    if (cost === undefined || cost < 0) return 0;
    const price = Math.max(1, Math.ceil(cost * (NONBASELINE_SUPPLIES.has(id) ? 1.3 : 6.3)));
    return Math.max(0, Math.floor((held(995) - COIN_RESERVE) / price));
}

export function noteId(id: number): number | null {
    return tradeable(id) ? notedId(liveCatalog(), id) : null;
}

export async function withdrawNoted(id: number, count: number): Promise<boolean> {
    try {
        const note = noteId(id);
        if (!note || !Number.isSafeInteger(count) || count < 0 || Bank.countById(id) < count || EventSignal.pending()) return false;
        if (count === 0) return true;
        const before = held(note);
        await Bank.setNoteMode(true);
        await Bank.withdrawXById(id, count, note);
        await Execution.delayUntil(() => held(note) >= before + count || EventSignal.pending(), 5000);
        return held(note) === before + count;
    } finally {
        await Bank.setNoteMode(false);
    }
}

interface Buyback {
    id: number;
    note: number;
    notesBefore: number;
    looseBefore: number;
    requested: number;
    sold: number;
    purchased: number;
    buying: number | null;
}

export class MorttonShop {
    private transaction: Buyback | null = null;

    constructor(private readonly supply: Supplies, private readonly wake: () => Promise<boolean>) {}

    async open(): Promise<boolean> {
        if (EventSignal.pending()) return false;
        if (Shop.isOpen()) return true;
        if (!(await this.supply.walk(SM_TILE.RAZMIRE)) || !(await this.wake()) || EventSignal.pending()) return false;
        const keeper = Npcs.query().name(SM_NPC.RAZMIRE).action('Trade-General-Store').within(12).nearest();
        if (!keeper || !(await keeper.interact('Trade-General-Store'))) return false;
        await Execution.delayUntil(() => Shop.isOpen() || EventSignal.pending(), 5000);
        return Shop.isOpen() && !EventSignal.pending();
    }

    pending(): boolean {
        return this.transaction !== null;
    }

    async refill(id: number, target: number): Promise<boolean> {
        if (this.pending() && !(await this.resume())) return false;
        if (!Number.isSafeInteger(target) || target < 0) return false;
        for (let attempt = 0; attempt < 28; attempt++) {
            if (held(id) >= target) return true;
            const note = noteId(id);
            if (!note || EventSignal.pending()) return false;
            const budget = purchaseBudget(id);
            const available = Math.min(5, target - held(id), held(note), Inventory.free() - 2, budget);
            if (available < 1 || !(await this.open())) return false;
            const stock = reader.shopInv(STOCK_COMPONENT);
            if (!stock.some(item => item.id === id) && stock.length >= 40) return false;
            const row = reader.shopInv(PLAYER_COMPONENT).find(item => item.id === note);
            const count = available >= 5 ? 5 : 1;
            const op = row?.ops.findIndex(action => action?.toLowerCase() === `sell ${count}`) ?? -1;
            if (!row || op < 0 || EventSignal.pending()) return false;
            this.transaction = { id, note, notesBefore: held(note), looseBefore: held(id), requested: count, sold: 0, purchased: 0, buying: null };
            await Input.invButton(note, row.slot, row.comId, op + 1);
            if (!(await this.resume())) return false;
        }
        return held(id) >= target;
    }

    async resume(): Promise<boolean> {
        const tx = this.transaction;
        if (!tx) return true;
        if (EventSignal.pending()) return false;
        if (!tx.sold) {
            await Execution.delayUntil(() => held(tx.note) < tx.notesBefore || EventSignal.pending(), 5000);
            tx.sold = tx.notesBefore - held(tx.note);
            if (EventSignal.pending()) return false;
            if (tx.sold < 1 || tx.sold > tx.requested) return this.finish(false);
        }
        if (tx.buying !== null) {
            await Execution.delayUntil(() => held(tx.id) > tx.buying! || EventSignal.pending(), 5000);
            tx.purchased = Math.max(0, held(tx.id) - tx.looseBefore);
            if (EventSignal.pending()) return false;
            if (held(tx.id) <= tx.buying) return this.finish(false);
            tx.buying = null;
        }
        tx.purchased = Math.max(0, held(tx.id) - tx.looseBefore);
        if (tx.purchased === tx.sold) return this.finish(true);
        if (tx.purchased > tx.sold || !(await this.open())) return EventSignal.pending() ? false : this.finish(false);
        for (let attempt = 0; attempt < 5; attempt++) {
            if (EventSignal.pending()) return false;
            const remaining = tx.sold - tx.purchased;
            const row = reader.shopInv(STOCK_COMPONENT).find(item => item.id === tx.id && item.count > 0);
            if (!row || Inventory.free() < 1 || held(995) <= COIN_RESERVE) return this.finish(false);
            const budget = purchaseBudget(tx.id);
            if (budget < 1) return this.finish(false);
            const count = remaining >= 5 && row.count >= 5 && budget >= 5 ? 5 : 1;
            const op = row.ops.findIndex(action => action?.toLowerCase() === `buy ${count}`);
            if (op < 0) return this.finish(false);
            tx.buying = held(tx.id);
            await Input.invButton(tx.id, row.slot, row.comId, op + 1);
            await Execution.delayUntil(() => held(tx.id) > tx.buying! || EventSignal.pending(), 5000);
            tx.purchased = Math.max(0, held(tx.id) - tx.looseBefore);
            if (EventSignal.pending()) return false;
            if (held(tx.id) <= tx.buying) return this.finish(false);
            tx.buying = null;
            if (tx.purchased === tx.sold) return this.finish(true);
            if (tx.purchased > tx.sold) return this.finish(false);
        }
        return this.finish(false);
    }

    private finish(success: boolean): boolean {
        this.transaction = null;
        if (!success) this.supply.log('Razmire buyback failed; returning for supplies');
        return success;
    }
}
