// Why: Radimus offers 12 skills across four pages and grants four training choices.
// Why: Prayer is the default because 3 Nezikchened fights and 3 aggressive guardians are survived on Protect from Melee, and the reward is the largest prayer lump in the 2004 game.

/** The 12 skills `radimus_menu1` through `radimus_menu4` offer, in menu order. */
export const LEGENDS_REWARD_OPTIONS = [
    'Attack', 'Defence', 'Strength',
    'Hitpoints', 'Prayer', 'Magic',
    'Woodcutting', 'Crafting', 'Smithing',
    'Herblore', 'Agility', 'Thieving'
] as const;

export type LegendsReward = (typeof LEGENDS_REWARD_OPTIONS)[number];

export const LegendsConfig: { reward: LegendsReward } = { reward: 'Prayer' };
