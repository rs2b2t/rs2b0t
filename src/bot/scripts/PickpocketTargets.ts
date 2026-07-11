/**
 * Canonical pickpocket targets, by exact in-game display name (what
 * `Npcs.query().name(...)` matches) paired with the Thieving level to steal
 * from them. Transcribed from the content's pickpocket table
 * (`skill_thieving/configs/pickpocking/pickpocket.dbrow`); every one exposes a
 * `Pickpocket` op. Used to populate the strict target dropdowns on the thieving
 * bots so a target like "Knight of Ardougne" is picked by its exact name rather
 * than free-typed (an exact-match name query finds nothing on a typo).
 */
export interface PickpocketTarget {
    name: string;
    level: number;
}

export const PICKPOCKET_TARGETS: PickpocketTarget[] = [
    { name: 'Man', level: 1 },
    { name: 'Woman', level: 1 },
    { name: 'Farmer', level: 10 },
    { name: 'Warrior woman', level: 25 },
    { name: 'Al-Kharid warrior', level: 25 },
    { name: 'Rogue', level: 32 },
    { name: 'Guard', level: 40 },
    { name: 'Knight of Ardougne', level: 55 },
    { name: 'Watchman', level: 65 },
    { name: 'Paladin', level: 70 },
    { name: 'Hero', level: 80 }
];

/** Just the display names, in level order — the dropdown `options` list. */
export const PICKPOCKET_TARGET_NAMES: string[] = PICKPOCKET_TARGETS.map(t => t.name);

/** Ardougne-market subset for ArdyThiever (Baker's-stall food + flee-combat fit
 *  the guards/knights/paladins/heroes that roam the East Ardougne market). */
export const ARDOUGNE_PICKPOCKET_TARGETS: string[] = ['Guard', 'Knight of Ardougne', 'Paladin', 'Hero'];
