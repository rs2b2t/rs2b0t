import { BOWS, DARTS } from '../api/combat/equipment.js';

export const ROCK_CRAB_RANGED_WEAPONS = [...BOWS, ...DARTS];

export interface RockCrabRangeLoadout {
    weapon: string;
    projectile: string;
    thrown: boolean;
}

export function rockCrabRangeLoadout(weapon: string, ammo: string): RockCrabRangeLoadout {
    const wanted = weapon.trim().toLowerCase();
    const dart = DARTS.find(name => name.toLowerCase() === wanted);
    return {
        weapon: dart ?? weapon,
        projectile: dart ?? ammo,
        thrown: dart !== undefined
    };
}

export function rangeSupplyEmpty(equipped: number, carried: number, ground: number): boolean {
    return equipped <= 0 && carried <= 0 && ground <= 0;
}
