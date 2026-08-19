import type Tile from '../../../../../geometry/Tile.js';
import { executeStep } from '../../exec/steps.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { returnToStreet } from './doors.js';
import { bankedId, heldId, wornId } from './state.js';

export interface ShopSource {
    npc: string;
    anchor: Tile;
    /** Coins to carry in, above the shop's asking price. */
    gp: number;
}

export interface Purchasable {
    id: number;
    name: string;
    qty: number;
    /** Stockists in order of preference; the first with stock wins. */
    sources: readonly ShopSource[];
}

// Why: `World.restock` skips a null slot, so a shared shop that sells its last unit never gets it back
// — two stockists is what makes an `allstock=no` item dependable.

/** Buy from the first stockist that still has one. */
export async function buyFromAny(item: Purchasable, log: (m: string) => void): Promise<boolean> {
    // Why: five of the six rooms this quest works in are pockets the navigator has no edge out of, so a
    // shop walk planned from inside one reads `unreachable` before it takes a step.
    if (!(await returnToStreet(log))) {
        return false;
    }
    for (const source of item.sources) {
        const bought = await executeStep({
            kind: 'buy',
            item: item.name,
            qty: item.qty,
            shop: { npc: source.npc, anchor: source.anchor },
            estGp: source.gp
        }, [], log);
        if (bought) {
            return true;
        }
        log(`${source.npc} had no ${item.name}`);
    }
    return false;
}

/** Wear it, withdraw it, or buy it — in that order. */
export function purchaseStep(snap: QuestSnapshot, item: Purchasable): QuestStep | null {
    if (wornId(snap, item.id)) {
        return null;
    }
    if (heldId(snap, item.id) >= item.qty) {
        return { kind: 'equip', item: item.name };
    }
    if (bankedId(snap, item.id) >= item.qty) {
        return { kind: 'withdraw', items: [{ name: item.name, qty: item.qty, id: item.id }] };
    }
    return { kind: 'custom', name: `buy ${item.qty}× ${item.name}`, run: log => buyFromAny(item, log) };
}

/** True once every piece is worn, carried or banked. */
export function kitOwned(snap: QuestSnapshot, kit: readonly Purchasable[]): boolean {
    return kit.every(item => wornId(snap, item.id)
        || heldId(snap, item.id) >= item.qty
        || bankedId(snap, item.id) >= item.qty);
}

/** The first piece that still needs work, or null once the kit is worn. */
export function kitStep(snap: QuestSnapshot, kit: readonly Purchasable[]): QuestStep | null {
    for (const item of kit) {
        const step = purchaseStep(snap, item);
        if (step) {
            return step;
        }
    }
    return null;
}
