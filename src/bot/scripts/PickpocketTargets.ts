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

export const PICKPOCKET_TARGET_NAMES: string[] = PICKPOCKET_TARGETS.map(t => t.name);

export const ARDOUGNE_PICKPOCKET_TARGETS: string[] = ['Guard', 'Knight of Ardougne', 'Paladin', 'Hero'];
