/** Pure raw-fish pack helpers for CookBot (no client imports → plain bun test). */

export interface PackItem {
    readonly name: string | null;
}

function matches(name: string | null, pattern: string): boolean {
    return name !== null && name.toLowerCase().includes(pattern.trim().toLowerCase());
}

/** Count pack items whose name contains `pattern` (case-insensitive). */
export function countRaw(items: readonly PackItem[], pattern: string): number {
    return items.filter(i => matches(i.name, pattern)).length;
}

/** Index of the LAST pack item matching `pattern`, or -1. Cooking targets the
 *  last raw fish so, as slots turn into cooked/burnt, we keep hitting a raw one. */
export function lastRawIndex(items: readonly PackItem[], pattern: string): number {
    for (let i = items.length - 1; i >= 0; i--) {
        if (matches(items[i].name, pattern)) {
            return i;
        }
    }
    return -1;
}
