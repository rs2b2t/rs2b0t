export function countMatching(items: readonly { name: string | null }[], pred: (n: string | null) => boolean): number {
    return items.filter(i => pred(i.name)).length;
}

export function lastMatchingIndex(items: readonly { name: string | null }[], pred: (n: string | null) => boolean): number {
    for (let i = items.length - 1; i >= 0; i--) {
        if (pred(items[i].name)) {
            return i;
        }
    }
    return -1;
}
