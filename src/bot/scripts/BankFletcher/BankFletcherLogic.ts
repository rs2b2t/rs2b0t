export const LOG_OPTIONS = ['Logs', 'Oak logs', 'Willow logs', 'Maple logs', 'Yew logs', 'Magic logs'];

export const PRODUCT_OPTIONS = [
    'Arrow shafts', 'Short bow', 'Long bow',
    'String short bow', 'String long bow',
    'Headless arrows', 'Bronze arrows', 'Iron arrows', 'Steel arrows',
    'Mithril arrows', 'Adamant arrows', 'Rune arrows'
];

export const EMPTY_READ_LIMIT = 3;

/** RS make-x count dialog cap — BankFletcher #177 drains a pack in one click. */
export const MAKE_X_CAP = 30;

// Engine cap: five USER_EVENT packets per player per tick (DartFletcher).
export const INSTANT_ACTIONS_PER_TICK = 5;

/** Arrow attach consumes up to 15 of each stack per click (`arrows.rs2`). */
export const ARROW_PER_ACTION = 15;

/** Content `pack/obj.pack` `1777=bow_string` / `crafting.obj` `name=Bow string`. */
export const BOW_STRING = 'Bow string';
export const BOW_STRING_ID = 1777;

export type WorkKind = 'knife' | 'attach' | 'string';
export type WoodKey = 'normal' | 'oak' | 'willow' | 'maple' | 'yew' | 'magic';
export type BowShape = 'short' | 'long';

/** Quantity to type into Make-X: the current pack, capped at the dialog max. */
export function makeBatchCount(logCount: number, cap = MAKE_X_CAP): number {
    return Math.max(1, Math.min(logCount, cap));
}

/** Ride the batch until this many logs remain (Make-X consumes `count`; Make-10 rides to idle). */
export function batchRideFloor(start: number, count: number, usedMakeX: boolean): number {
    return usedMakeX ? Math.max(0, start - count) : 0;
}

export function logNameMatches(itemName: string | null | undefined, material: string): boolean {
    if (itemName === null || itemName === undefined) {
        return false;
    }
    return itemName.trim().toLowerCase() === material.trim().toLowerCase();
}

/** Find a content item by its exact display name. */
export function exactName<T extends { name: string | null }>(items: readonly T[], query: string): T | null {
    const wanted = query.trim().toLowerCase();
    if (!wanted) {
        return null;
    }
    const normalized = (item: T): string | null => item.name?.trim().toLowerCase() ?? null;
    return items.find(item => normalized(item) === wanted) ?? null;
}

export function productNeedsDifferentLog(product: string, material: string): boolean {
    return product.trim().toLowerCase() === 'arrow shafts' && material.trim().toLowerCase() !== 'logs';
}

const PRODUCT_KEYWORDS: Record<string, string[]> = {
    'arrow shafts': ['shaft', 'arrow'],
    'short bow': ['short'],
    'long bow': ['long']
};

export function productKeywords(product: string): string[] {
    const key = product.trim().toLowerCase();
    return PRODUCT_KEYWORDS[key] ?? (key.length > 0 ? [key] : []);
}

export function matchProduct(options: readonly string[], product: string): string | null {
    const keys = productKeywords(product);
    if (keys.length === 0) {
        return null;
    }
    for (const opt of options) {
        const lc = (opt ?? '').toLowerCase();
        if (keys.some(k => lc.includes(k))) {
            return opt;
        }
    }
    return null;
}

export interface AttachPlan {
    inputs: [string, string];
    product: string;
    level: number;
    perAction: number;
}

const ATTACH_PRODUCTS: Record<string, AttachPlan> = {
    'headless arrows': { inputs: ['Feather', 'Arrow shaft'], product: 'Headless arrow', level: 1, perAction: ARROW_PER_ACTION },
    'bronze arrows': { inputs: ['Bronze arrowtips', 'Headless arrow'], product: 'Bronze arrow', level: 1, perAction: ARROW_PER_ACTION },
    'iron arrows': { inputs: ['Iron arrowtips', 'Headless arrow'], product: 'Iron arrow', level: 15, perAction: ARROW_PER_ACTION },
    'steel arrows': { inputs: ['Steel arrowtips', 'Headless arrow'], product: 'Steel arrow', level: 30, perAction: ARROW_PER_ACTION },
    'mithril arrows': { inputs: ['Mithril arrowtips', 'Headless arrow'], product: 'Mithril arrow', level: 45, perAction: ARROW_PER_ACTION },
    'adamant arrows': { inputs: ['Adamant arrowtips', 'Headless arrow'], product: 'Adamant arrow', level: 60, perAction: ARROW_PER_ACTION },
    'rune arrows': { inputs: ['Rune arrowtips', 'Headless arrow'], product: 'Rune arrow', level: 75, perAction: ARROW_PER_ACTION }
};

export function attachPlanFor(product: string): AttachPlan | null {
    return ATTACH_PRODUCTS[product.trim().toLowerCase()] ?? null;
}

interface BowRow {
    display: string;
    unstrungId: number;
    strungId: number;
    level: number;
}

// Why: unstrung and strung share the display name on rev 274, so counts and withdraws must use id.
const WOOD_BOWS: Record<WoodKey, Record<BowShape, BowRow>> = {
    normal: {
        short: { display: 'Shortbow', unstrungId: 50, strungId: 841, level: 5 },
        long: { display: 'Longbow', unstrungId: 48, strungId: 839, level: 10 }
    },
    oak: {
        short: { display: 'Oak shortbow', unstrungId: 54, strungId: 843, level: 20 },
        long: { display: 'Oak longbow', unstrungId: 56, strungId: 845, level: 25 }
    },
    willow: {
        short: { display: 'Willow shortbow', unstrungId: 60, strungId: 849, level: 35 },
        long: { display: 'Willow longbow', unstrungId: 58, strungId: 847, level: 40 }
    },
    maple: {
        short: { display: 'Maple shortbow', unstrungId: 64, strungId: 853, level: 50 },
        long: { display: 'Maple longbow', unstrungId: 62, strungId: 851, level: 55 }
    },
    yew: {
        short: { display: 'Yew shortbow', unstrungId: 68, strungId: 857, level: 65 },
        long: { display: 'Yew longbow', unstrungId: 66, strungId: 855, level: 70 }
    },
    magic: {
        short: { display: 'Magic shortbow', unstrungId: 72, strungId: 861, level: 80 },
        long: { display: 'Magic longbow', unstrungId: 70, strungId: 859, level: 85 }
    }
};

const WOOD_FROM_MATERIAL: Record<string, WoodKey> = {
    logs: 'normal',
    'oak logs': 'oak',
    'willow logs': 'willow',
    'maple logs': 'maple',
    'yew logs': 'yew',
    'magic logs': 'magic'
};

export function woodKeyFor(material: string): WoodKey | null {
    return WOOD_FROM_MATERIAL[material.trim().toLowerCase()] ?? null;
}

export function knifeProductLevel(product: string, material: string): number | null {
    const p = product.trim().toLowerCase();
    if (p === 'arrow shafts') {
        return 1;
    }
    const wood = woodKeyFor(material);
    if (!wood) {
        return null;
    }
    if (p === 'short bow') {
        return WOOD_BOWS[wood].short.level;
    }
    if (p === 'long bow') {
        return WOOD_BOWS[wood].long.level;
    }
    return null;
}

export function isStringProduct(product: string): boolean {
    const p = product.trim().toLowerCase();
    return p === 'string short bow' || p === 'string long bow';
}

export function stringShape(product: string): BowShape | null {
    const p = product.trim().toLowerCase();
    if (p === 'string short bow') {
        return 'short';
    }
    if (p === 'string long bow') {
        return 'long';
    }
    return null;
}

export interface StringPlan {
    stringName: string;
    stringId: number;
    unstrungId: number;
    strungId: number;
    displayName: string;
    level: number;
    perAction: 1;
}

export function stringPlanFor(product: string, material: string): StringPlan | null {
    const shape = stringShape(product);
    if (!shape) {
        return null;
    }
    const wood = woodKeyFor(material);
    if (!wood) {
        return null;
    }
    const row = WOOD_BOWS[wood][shape];
    return {
        stringName: BOW_STRING,
        stringId: BOW_STRING_ID,
        unstrungId: row.unstrungId,
        strungId: row.strungId,
        displayName: row.display,
        level: row.level,
        perAction: 1
    };
}

export function workKind(product: string): WorkKind {
    if (attachPlanFor(product)) {
        return 'attach';
    }
    if (isStringProduct(product)) {
        return 'string';
    }
    return 'knife';
}

/** Same 2-tick cut: long pays more XP/h. Do not auto-switch the operator's pick. */
export function shortBowXpHint(product: string, material: string, level: number): string | null {
    if (product.trim().toLowerCase() !== 'short bow') {
        return null;
    }
    const longLevel = knifeProductLevel('Long bow', material);
    if (longLevel === null || level < longLevel) {
        return null;
    }
    return 'long pays more XP/h';
}

export function countById(items: readonly { id: number; count: number }[], id: number): number {
    return items.filter(i => i.id === id).reduce((n, i) => n + Math.max(1, i.count), 0);
}

export function lastItemById<T extends { id: number }>(items: readonly T[], id: number): T | null {
    for (let i = items.length - 1; i >= 0; i--) {
        if (items[i]!.id === id) {
            return items[i]!;
        }
    }
    return null;
}

export function countByName(items: readonly { name: string | null; count: number }[], name: string): number {
    const wanted = name.trim().toLowerCase();
    return items
        .filter(i => i.name?.trim().toLowerCase() === wanted)
        .reduce((n, i) => n + Math.max(1, i.count), 0);
}

/** True when every bank/inv stack with this display name is the wanted id. */
export function canWithdrawByName(
    items: readonly { id: number; name: string | null }[],
    id: number
): boolean {
    const hit = items.find(i => i.id === id);
    if (!hit?.name) {
        return false;
    }
    const wanted = hit.name.trim().toLowerCase();
    const sameName = items.filter(i => i.name?.trim().toLowerCase() === wanted);
    return sameName.length > 0 && sameName.every(i => i.id === id);
}

export function instantActionsFor(input0: number, input1: number, perAction = 1): number {
    const available = Math.max(0, Math.min(Math.floor(input0), Math.floor(input1)));
    if (available === 0 || perAction <= 0) {
        return 0;
    }
    return Math.min(INSTANT_ACTIONS_PER_TICK, Math.ceil(available / perAction));
}

/** Inventory is 28 slots. Unstackable pair loadout is half and half. */
export const PACK_SLOTS = 28;
/** Rev 274 `bow_string` has no `stackable=yes` — a Withdraw-All fills the pack. */
export const UNSTACKED_STRING_SLOTS = 14;

export function stringIsStacked(stringCount: number, stringSlots: number): boolean {
    return stringSlots > 0 && stringCount > stringSlots;
}

/** Extra bow-string slots to withdraw after a deposit that kept existing strings. */
export function extraStringSlotsWanted(stringSlots: number, stacked: boolean): number {
    if (stacked) {
        return stringSlots > 0 ? 0 : 1;
    }
    return Math.max(0, UNSTACKED_STRING_SLOTS - stringSlots);
}

export function unstrungSlotsWanted(stringSlotsAfter: number, capacity = PACK_SLOTS): number {
    return Math.max(0, capacity - stringSlotsAfter);
}

export interface StringWithdrawPlan {
    stringExact: number;
    unstrungAll: boolean;
}

export type FixedWithdrawAmount = 10 | 1;

/** Bank clicks that sum to `n` without opening the Withdraw-X count dialog. */
export function fixedWithdrawClicks(n: number): FixedWithdrawAmount[] {
    const clicks: FixedWithdrawAmount[] = [];
    let left = Math.max(0, Math.floor(n));
    while (left >= 10) {
        clicks.push(10);
        left -= 10;
    }
    while (left > 0) {
        clicks.push(1);
        left -= 1;
    }
    return clicks;
}

export function stringWithdrawPlan(stringSlots: number, stacked: boolean): StringWithdrawPlan {
    return {
        stringExact: extraStringSlotsWanted(stringSlots, stacked),
        unstrungAll: true
    };
}

export function keepNames(kind: WorkKind, knife: string): string[] {
    if (kind === 'string') {
        return [BOW_STRING];
    }
    if (kind === 'knife') {
        return [knife];
    }
    return [];
}

export function needsRestock(opts: {
    kind: WorkKind;
    logCount: number;
    input0: number;
    input1: number;
}): boolean {
    if (opts.kind !== 'knife') {
        return opts.input0 === 0 || opts.input1 === 0;
    }
    return opts.logCount === 0;
}

export function hasFletchWork(opts: {
    kind: WorkKind;
    logCount: number;
    knifeCount: number;
    input0: number;
    input1: number;
}): boolean {
    if (opts.kind !== 'knife') {
        return opts.input0 > 0 && opts.input1 > 0;
    }
    return opts.logCount > 0 && opts.knifeCount > 0;
}

export type BankListState = 'closed' | 'unready' | 'ready';

export function bankListState(open: boolean, loaded: boolean): BankListState {
    if (!open) {
        return 'closed';
    }
    return loaded ? 'ready' : 'unready';
}

export type StockAction = 'ok' | 'retry-closed' | 'retry-unready' | 'empty-confirmed' | 'empty-unready';

export function stockAction(opts: {
    state: BankListState;
    hasItem: boolean;
    waitTimedOut: boolean;
}): StockAction {
    if (opts.hasItem) {
        return 'ok';
    }
    if (opts.state === 'closed') {
        return 'retry-closed';
    }
    if (opts.state === 'ready') {
        return 'empty-confirmed';
    }
    return opts.waitTimedOut ? 'empty-unready' : 'retry-unready';
}

export function nextEmptyReads(current: number, action: StockAction): number {
    if (action === 'ok') {
        return 0;
    }
    // A ready list can still be the pre-deposit snapshot — one miss is not enough.
    if (action === 'empty-confirmed' || action === 'empty-unready') {
        return current + 1;
    }
    return current;
}

export function shouldStopEmpty(reads: number): boolean {
    return reads >= EMPTY_READ_LIMIT;
}
