export interface PackItem {
    readonly name: string | null;
}

function matches(name: string | null, pattern: string): boolean {
    return name !== null && name.toLowerCase().includes(pattern.trim().toLowerCase());
}

export function countRaw(items: readonly PackItem[], pattern: string): number {
    return items.filter(i => matches(i.name, pattern)).length;
}

export function lastRawIndex(items: readonly PackItem[], pattern: string): number {
    for (let i = items.length - 1; i >= 0; i--) {
        if (matches(items[i].name, pattern)) {
            return i;
        }
    }
    return -1;
}
