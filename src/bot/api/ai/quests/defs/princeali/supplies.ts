// docs/reference/quest-engine.md#provisioning
import type Tile from '../../../../../geometry/Tile.js';
import { Inventory, type InvItem } from '../../../../inventory/Inventory.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { PA_ITEM, type PrinceItem } from './areas.js';

/** Below this the purse is topped up; above it, no purchase forces a bank trip. */
export const PURSE_FLOOR = 150;
export const PURSE_TOP = 1000;

const PICKAXE_IDS = [1265, 1267, 1269, 1271, 1273, 1275] as const;

export function held(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function banked(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

export function owned(snap: QuestSnapshot, id: number): number {
    return held(snap, id) + banked(snap, id);
}

export function heldItem(id: number): InvItem | null {
    return Inventory.items().find(item => item.id === id) ?? null;
}

export function hasAnyPickaxe(snap: QuestSnapshot): boolean {
    return PICKAXE_IDS.some(id => held(snap, id) > 0 || (snap.wornIds?.has(id) ?? false));
}

export function scanBank(): QuestStep {
    return { kind: 'scanBank' };
}

/** No `bank`, so openBankLeg uses the nearest branch to wherever the route has reached. */
export function withdrawFrom(items: { name: string; id: number; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items };
}

/** Pack, then bank, then nothing — for anything the caller makes itself. */
export function fromBank(snap: QuestSnapshot, item: PrinceItem, qty = 1): QuestStep | null {
    const short = qty - held(snap, item.id);
    if (short <= 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const inBank = banked(snap, item.id);
    return inBank > 0 ? withdrawFrom([{ name: item.name, id: item.id, qty: Math.min(short, inBank) }]) : null;
}

export function buyItem(
    snap: QuestSnapshot,
    item: PrinceItem,
    qty: number,
    shop: { npc: string; anchor: Tile },
    unitGp: number
): QuestStep | null {
    const short = qty - held(snap, item.id);
    if (short <= 0) {
        return null;
    }
    return fromBank(snap, item, qty) ?? { kind: 'buy', item: item.name, qty: short, shop, estGp: short * unitGp };
}

export function grabItem(snap: QuestSnapshot, item: PrinceItem, anchor: Tile): QuestStep | null {
    if (held(snap, item.id) > 0) {
        return null;
    }
    return fromBank(snap, item, 1) ?? { kind: 'grabGround', item: item.name, anchor, waitIfMissing: true };
}

export function sourceCoins(snap: QuestSnapshot, floor: number, top: number): QuestStep | null {
    const purse = held(snap, PA_ITEM.COINS.id);
    if (purse >= floor) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const available = banked(snap, PA_ITEM.COINS.id);
    if (available <= 0) {
        return { kind: 'wait', reason: 'no coins in the bank for shops, dialogue purchases and the toll gate' };
    }
    return withdrawFrom([{ name: PA_ITEM.COINS.name, id: PA_ITEM.COINS.id, qty: Math.min(top - purse, available) }]);
}
