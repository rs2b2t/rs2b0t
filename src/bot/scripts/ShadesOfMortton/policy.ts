export type Stock = ReadonlyMap<number, number>;
export const OIL = [3430, 3432, 3434, 3436] as const;
export const OLIVE = [3422, 3424, 3426, 3428] as const;
export const FOOD = 379;
export const FOOD_LOAD = 12;
export const BATCH = 8;
export const COIN_LOW = 3000;
export const COIN_TARGET = 10000;

export function oilDoses(stock: Stock, ids: readonly number[] = OIL): number {
    return ids.reduce((total, id, i) => total + (stock.get(id) ?? 0) * (4 - i), 0);
}

export function combinePair(items: readonly { id: number; slot: number }[], ids: readonly number[] = OIL): [number, number] | null {
    const partial = items.filter(item => ids.slice(1).includes(item.id));
    return partial.length >= 2 ? [partial[0].slot, partial[1].slot] : null;
}

export function shouldStartWall(current: string | null, next: string, animating: boolean, inCombat: boolean, idle: number): boolean {
    return !inCombat && (current !== next || (!animating && idle >= 3));
}
