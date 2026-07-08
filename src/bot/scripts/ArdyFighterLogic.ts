/**
 * Pure predicates for ArdyFighter — no client imports so they run under plain
 * `bun test`. The bot passes `Inventory.items()` (whose InvItem getters
 * structurally satisfy PackItem) and its resolved settings.
 */

export interface PackItem {
    readonly name: string | null;
    readonly count: number;
}

/** Case-insensitive name-contains match against a pattern list. Blank patterns are ignored. */
export function matchesAny(name: string | null, patterns: string[]): boolean {
    if (name === null) {
        return false;
    }
    const n = name.toLowerCase();
    return patterns.some(p => {
        const pat = p.trim().toLowerCase();
        return pat.length > 0 && n.includes(pat);
    });
}

/** Total quantity across matching slots (sums stacks). */
export function countMatching(items: readonly PackItem[], patterns: string[]): number {
    return items.filter(i => matchesAny(i.name, patterns)).reduce((sum, i) => sum + i.count, 0);
}

/** Occupied slots holding a matching item (a stack is one slot, like the real backpack). */
export function slotsMatching(items: readonly PackItem[], patterns: string[]): number {
    return items.filter(i => matchesAny(i.name, patterns)).length;
}

/** Bank once loot fills the threshold — or the pack is full and any loot exists to shed. */
export function shouldBank(lootSlots: number, bankAt: number, invFull: boolean): boolean {
    return lootSlots >= bankAt || (invFull && lootSlots > 0);
}

/** Restock strictly below the target — at/above it, keep fighting. */
export function shouldRestock(foodCount: number, threshold: number): boolean {
    return foodCount < threshold;
}

/** Eat strictly below the gate, and only when food is actually carried. */
export function shouldEat(hpFrac: number, gate: number, foodCount: number): boolean {
    return hpFrac < gate && foodCount > 0;
}

/** Panic (retreat to the bank) only when out of food AND strictly below the panic gate. */
export function shouldPanic(hpFrac: number, gate: number, foodCount: number): boolean {
    return hpFrac < gate && foodCount === 0;
}
