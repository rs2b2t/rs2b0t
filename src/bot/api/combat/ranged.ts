import { BOWS, DARTS } from './equipment.js';

/** Bows + darts — shared by RockCrab, MossGiant, and any ranged fighter. */
export const RANGED_WEAPONS = [...BOWS, ...DARTS];
/** @deprecated use RANGED_WEAPONS */
export const ROCK_CRAB_RANGED_WEAPONS = RANGED_WEAPONS;

interface RangeLoadout {
    weapon: string;
    projectile: string;
    thrown: boolean;
}

/** @deprecated use RangeLoadout */

/**
 * When `weapon` is a dart, it is both the wielded weapon and the projectile stack.
 * Bows still use the separate `ammo` setting.
 */
export function rangeLoadoutOf(weapon: string, ammo: string): RangeLoadout {
    const wanted = weapon.trim().toLowerCase();
    const dart = DARTS.find(name => name.toLowerCase() === wanted);
    return {
        weapon: dart ?? weapon,
        projectile: dart ?? ammo,
        thrown: dart !== undefined
    };
}

/** @deprecated use rangeLoadoutOf */
export function rockCrabRangeLoadout(weapon: string, ammo: string): RangeLoadout {
    return rangeLoadoutOf(weapon, ammo);
}

export function rangeSupplyEmpty(equipped: number, carried: number, ground: number): boolean {
    return equipped <= 0 && carried <= 0 && ground <= 0;
}
