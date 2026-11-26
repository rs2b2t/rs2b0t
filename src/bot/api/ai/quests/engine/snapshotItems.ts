import type { QuestSnapshot } from './types.js';

interface NamedItem {
    id: number;
    name: string;
}

function itemId(item: number | NamedItem): number {
    return typeof item === 'number' ? item : item.id;
}

function countById(counts: ReadonlyMap<number, number> | undefined, item: number | NamedItem): number {
    return counts?.get(itemId(item)) ?? 0;
}

function isWorn(snap: QuestSnapshot, item: number | NamedItem): boolean {
    return snap.wornIds?.has(itemId(item)) ?? false;
}

export function heldId(snap: QuestSnapshot, id: number): number {
    return countById(snap.invIds, id);
}

export function cachedBankId(snap: QuestSnapshot, id: number): number {
    return countById(snap.bankIds, id);
}

export function inventoryAndBankCount(snap: QuestSnapshot, id: number): number {
    return heldId(snap, id) + cachedBankId(snap, id);
}

export function bankedId(snap: QuestSnapshot, id: number): number {
    return snap.bankKnown ? cachedBankId(snap, id) : 0;
}

export function wornId(snap: QuestSnapshot, id: number): boolean {
    return isWorn(snap, id);
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
    return countById(snap.invIds, item);
}

export function bankedItem(snap: QuestSnapshot, item: NamedItem): number {
    return countById(snap.bankIds, item);
}

export function wornItem(snap: QuestSnapshot, item: NamedItem): boolean {
    return isWorn(snap, item);
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
