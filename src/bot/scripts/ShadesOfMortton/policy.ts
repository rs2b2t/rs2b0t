export type Stock = ReadonlyMap<number, number>;
export type Activity = { kind: 'food' | 'funds' | 'logs' | 'oil' | 'chests' }
    | { kind: 'make'; count: number }
    | { kind: 'hunt' | 'burn'; tier: number; count: number };

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

export function chooseActivity(stock: Stock): Activity {
    const count = (id: number) => stock.get(id) ?? 0;
    if (count(FOOD) < FOOD_LOAD) return { kind: 'food' };
    const keys = Array.from({ length: 20 }, (_, i) => 3450 + i).filter(id => count(id) > 0);
    if (keys.reduce((total, id) => total + count(id), 0) > 1) return { kind: 'chests' };
    if (count(995) < COIN_LOW) return { kind: 'funds' };
    const access = keys.length ? Math.max(...keys.map(id => Math.floor((id - 3450) / 5))) : -1;
    const remains = [3396, 3398, 3400, 3402, 3404];
    const pending = remains.findLastIndex(id => count(id) > 0);
    const pyres = count(3448);
    if (pending >= 0 && pyres > 0) return { kind: 'burn', tier: pending, count: Math.min(BATCH, pyres, count(remains[pending])) };
    if (pending < 0 && pyres > 0) return { kind: 'hunt', tier: Math.min(4, access + 1), count: Math.min(BATCH, pyres) };
    if (count(1513) === 0) return { kind: 'logs' };
    const oils = Math.floor(oilDoses(stock) / 4);
    if (oils > 0) return { kind: 'make', count: Math.min(BATCH, oils, count(1513)) };
    return { kind: 'oil' };
}

export function shouldStartWall(current: string | null, next: string, animating: boolean, inCombat: boolean, idle: number): boolean {
    return !inCombat && (current !== next || (!animating && idle >= 3));
}
