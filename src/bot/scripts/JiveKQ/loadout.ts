export const MACE = 1434;
export const BOW = 861;
export const ARROWS = 892;
export const RECOIL = 2550;
export const FOOD = 385;
export const PASS = 1854;
export const AIR = 556;
export const LAW = 563;
export const DUELING_RINGS = [2552, 2554, 2556, 2558, 2560, 2562, 2564, 2566];
export const GEAR = [MACE, 1163, 2503, 2497, 2491, 1731, 1061, RECOIL, ARROWS];

export function tripPack(slot: number): readonly (readonly [number, number])[] {
    return [[BOW, 1], ...(slot === 0 ? [[954, 2] as const] : []), [2434, 2], [2448, 1], [2436, 1], [2440, 1], [2442, 1], [RECOIL, 1], [DUELING_RINGS[0], 1], [AIR, 5], [LAW, 1], [PASS, 1], [FOOD, slot === 0 ? 14 : 16]];
}
