import { reader } from '../../../../../adapter/ClientAdapter.js';
import { Inventory, type InvItem } from '../../../../inventory/Inventory.js';
import { QuestFood } from '../../food.js';
import type { QuestSnapshot } from '../../engine/types.js';

// Why: Key, Herb, Chest and Door each name more than one object, so a name lookup silently accepts the wrong one.

export function heldId(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

// Why: an unread bank is not an empty bank, and a bare count sends the bot to a booth for something it never saw.
export function bankedId(snap: QuestSnapshot, id: number): number {
    return snap.bankKnown ? (snap.bankIds?.get(id) ?? 0) : 0;
}

export function anywhere(snap: QuestSnapshot, id: number): number {
    return heldId(snap, id) + bankedId(snap, id) + (snap.wornIds?.has(id) ? 1 : 0);
}

export function wornId(snap: QuestSnapshot, id: number): boolean {
    return snap.wornIds?.has(id) ?? false;
}

export function liveItem(id: number): InvItem | null {
    return Inventory.items().find(item => item.id === id) ?? null;
}

// Why: `~objbox` and `~mesbox` build a main modal, not a chat line, so their text never reaches `GameMessages`.

/** Whether the open main modal says something. */
export function modalSaid(pattern: RegExp): boolean {
    return reader.mainModalTexts().some(line => pattern.test(line));
}

// Why: `QuestFood.name` is the host's setting and is only correct at decide time, never at import.

/** The food the host chose, or the lobsters this quest defaults to. */
export function foodName(): string {
    return QuestFood.name ?? 'Lobster';
}

/** How much of it is carried. `snap.inv` is keyed by lower-cased display name. */
export function heldFood(snap: QuestSnapshot): number {
    return snap.inv.get(foodName().toLowerCase()) ?? 0;
}
