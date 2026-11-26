import type { QuestSnapshot } from './types.js';

interface NamedItem {
    id: number;
    name: string;
}

export function heldId(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function cachedBankId(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

export function inventoryAndBankCount(snap: QuestSnapshot, id: number): number {
    return heldId(snap, id) + cachedBankId(snap, id);
}

export function bankedId(snap: QuestSnapshot, id: number): number {
    return snap.bankKnown ? cachedBankId(snap, id) : 0;
}

export function wornId(snap: QuestSnapshot, id: number): boolean {
    return snap.wornIds?.has(id) ?? false;
}

export function heldName(snap: QuestSnapshot, name: string): number {
    return snap.inv.get(name.toLowerCase()) ?? 0;
}

export function hasName(snap: QuestSnapshot, name: string): boolean {
    return heldName(snap, name) > 0;
}

export function bankedName(snap: QuestSnapshot, name: string): number {
    return snap.bank?.get(name.toLowerCase()) ?? 0;
}

export function wornName(snap: QuestSnapshot, name: string): boolean {
    return snap.worn.has(name.toLowerCase());
}

export function heldItem(snap: QuestSnapshot, item: NamedItem): number {
    return heldId(snap, item.id);
}

export function bankedItem(snap: QuestSnapshot, item: NamedItem): number {
    return cachedBankId(snap, item.id);
}

export function wornItem(snap: QuestSnapshot, item: NamedItem): boolean {
    return wornId(snap, item.id);
}

export function heldOrBankedItem(snap: QuestSnapshot, item: NamedItem): number {
    return heldItem(snap, item) + bankedItem(snap, item);
}

export function heldOrWornItem(snap: QuestSnapshot, item: NamedItem): number {
    return heldItem(snap, item) + (wornItem(snap, item) ? 1 : 0);
}

export function countHeldItems(snap: QuestSnapshot, items: readonly NamedItem[]): number {
    return items.filter(item => heldItem(snap, item) > 0).length;
}
