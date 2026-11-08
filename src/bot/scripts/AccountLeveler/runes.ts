import type { LevelerSnapshot } from './types.js';

export function canStealChaos(s: LevelerSnapshot): boolean {
    return s.levels.thieving >= 70 && s.levels.hitpoints >= 30
        && ['attack', 'strength', 'defence'].every(skill => s.levels[skill] >= 20)
        && (s.stock.coins ?? 0) >= 200;
}
