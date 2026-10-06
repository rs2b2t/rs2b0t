export function combatLevel(levels: Record<string, number>): number {
    const base = (levels.defence ?? 1) + (levels.hitpoints ?? 10) + Math.floor((levels.prayer ?? 1) / 2);
    const offence = Math.max((levels.attack ?? 1) + (levels.strength ?? 1), Math.floor((levels.ranged ?? 1) * 3 / 2), Math.floor((levels.magic ?? 1) * 3 / 2));
    return Math.floor((10 * base + 13 * offence) / 40);
}

export function trainingTier(levels: Record<string, number>): number {
    const level = combatLevel(levels);
    return level >= 35 ? 3 : level >= 25 ? 2 : level >= 15 ? 1 : 0;
}

export const TARGET_TIERS: Readonly<Record<string, number>> = {
    Monk: 1, Barbarian: 1, 'Barbarian woman': 1, Dwarf: 1, 'Al-Kharid warrior': 1,
    Guard: 2, 'Chaos druid': 2, Unicorn: 2, Scorpion: 2, Skeleton: 2, 'Khazard trooper': 2, Soldier: 2, Druid: 3
};
