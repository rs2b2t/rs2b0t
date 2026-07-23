export interface PackItem {
    readonly name: string | null;
    readonly count: number;
}

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

export function countMatching(items: readonly PackItem[], patterns: string[]): number {
    return items.filter(i => matchesAny(i.name, patterns)).reduce((sum, i) => sum + i.count, 0);
}

export function slotsMatching(items: readonly PackItem[], patterns: string[]): number {
    return items.filter(i => matchesAny(i.name, patterns)).length;
}

export function shouldBank(lootSlots: number, bankAt: number, invFull: boolean): boolean {
    return lootSlots >= bankAt || (invFull && lootSlots > 0);
}

export function shouldRestock(foodCount: number, threshold: number): boolean {
    return foodCount < threshold;
}

export function shouldEat(hpFrac: number, gate: number, foodCount: number): boolean {
    return hpFrac < gate && foodCount > 0;
}

export function shouldPanic(hpFrac: number, gate: number, foodCount: number): boolean {
    return hpFrac < gate && foodCount === 0;
}
