import type { CombatCamp } from './combat.js';

export const ADVANCED_CAMPS: readonly CombatCamp[] = [
    { id: 'brimhaven-pirates', region: 'brimhaven', target: 'Pirate', x: 2795, z: 3163, hp: 25, offence: 20, defence: 20, minCombat: 25, trainingTier: 2 },
    { id: 'brimhaven-thieves', region: 'brimhaven', target: 'Thief', x: 2813, z: 3159, leashRadius: 8, hp: 22, offence: 15, defence: 15, minCombat: 25, trainingTier: 2 },
    { id: 'falador-west-guards', region: 'falador', target: 'Guard', x: 2955, z: 3381, hp: 22, offence: 15, defence: 15, minCombat: 25, trainingTier: 2 },
    { id: 'edgeville-guards', region: 'edgeville', target: 'Guard', x: 3112, z: 3515, hp: 22, offence: 15, defence: 15, minCombat: 25, trainingTier: 2 },
    { id: 'varrock-south-guards', region: 'varrock', target: 'Guard', x: 3209, z: 3379, hp: 22, offence: 15, defence: 15, minCombat: 25, trainingTier: 2 },
    { id: 'varrock-palace-upper-guards', region: 'varrock', target: 'Guard', x: 3204, z: 3495, level: 1, hp: 25, offence: 20, defence: 20, minCombat: 25, trainingTier: 2 },
    { id: 'ardougne-north-guards', region: 'ardougne', target: 'Guard', x: 2636, z: 3343, leashRadius: 6, hp: 30, offence: 25, defence: 25, minCombat: 25, trainingTier: 2 },
    { id: 'khazard-west-troopers', region: 'khazard', target: 'Khazard trooper', x: 2512, z: 3237, leashRadius: 8, hp: 30, offence: 25, defence: 25, minCombat: 25, trainingTier: 2 },
    { id: 'crandor-moss-giants', region: 'crandor', target: 'Moss giant', x: 2831, z: 3244, hp: 40, offence: 35, defence: 35, minCombat: 50, trainingTier: 3, quests: ['Dragon Slayer'] },
    { id: 'canifis-south-ghouls', region: 'canifis', target: 'Ghoul', x: 3431, z: 3466, leashRadius: 5, hp: 35, offence: 30, defence: 30, minCombat: 40, trainingTier: 3, quests: ['Priest in Peril'] },
    { id: 'edgeville-dungeon-deadly-red-spiders', region: 'edgeville', target: 'Deadly red spider', x: 3123, z: 9951, leashRadius: 5, hp: 35, offence: 30, defence: 30, minCombat: 40, trainingTier: 3, wilderness: true, prayer: false },
    { id: 'edgeville-dungeon-earth-warriors', region: 'edgeville', target: 'Earth warrior', x: 3121, z: 9991, leashRadius: 7, hp: 40, offence: 35, defence: 35, minCombat: 50, trainingTier: 3, wilderness: true, prayer: false, herbs: true, skills: { agility: 15 } },
    { id: 'gu-tanoth-ogres', region: 'gu-tanoth', target: 'Ogre', x: 2531, z: 3030, leashRadius: 2, hp: 40, offence: 35, defence: 35, minCombat: 50, trainingTier: 3, quests: ['Watch Tower'], skills: { agility: 25 } },
    { id: 'taverley-baby-blue-dragons', region: 'taverley', target: 'Baby blue dragon', x: 2897, z: 9765, leashRadius: 4, hp: 50, offence: 40, defence: 40, minCombat: 55, trainingTier: 3, styles: ['melee', 'mage'], food: 'Lobster', supplies: [{ item: 'Dusty key', count: 1, carry: 1 }, { item: 'Dragonfire shield', count: 1, carry: 1, equip: true }] },
    { id: 'karamja-lesser-demons', region: 'karamja', target: 'Lesser demon', x: 2838, z: 9558, hp: 50, offence: 45, defence: 45, minCombat: 60, trainingTier: 4, food: 'Lobster', prayer: false },
    { id: 'crandor-lesser-demons', region: 'crandor', target: 'Lesser demon', x: 2834, z: 3279, hp: 50, offence: 45, defence: 45, minCombat: 60, trainingTier: 4, food: 'Lobster', prayer: false, quests: ['Dragon Slayer'] },
    { id: 'troll-stronghold-trolls', region: 'troll-stronghold', target: 'Mountain Troll', x: 2848, z: 3679, hp: 55, offence: 50, defence: 50, minCombat: 65, trainingTier: 4, food: 'Lobster', quests: ['Troll Stronghold'], skills: { agility: 15 }, supplies: [{ item: 'Climbing boots', count: 1, carry: 1, equip: true }] },
    { id: 'gu-tanoth-city-guards', region: 'gu-tanoth', target: 'City guard', x: 2542, z: 3032, leashRadius: 8, hp: 55, offence: 50, defence: 50, minCombat: 65, trainingTier: 4, food: 'Lobster', quests: ['Watch Tower'], skills: { agility: 25 } },
    { id: 'lighthouse-dagannoths', region: 'lighthouse', target: 'Dagannoth', x: 2522, z: 10023, hp: 65, offence: 60, defence: 60, minCombat: 80, trainingTier: 5, food: 'Lobster', quests: ['Horror from the Deep'] },
    { id: 'brimhaven-dungeon-moss-giants', region: 'brimhaven', target: 'Moss giant', x: 2680, z: 9593, leashRadius: 5, hp: 55, offence: 45, defence: 50, minCombat: 65, trainingTier: 4, food: 'Lobster', coins: 1200, skills: { woodcutting: 27 }, supplies: [{ item: 'Bronze axe', count: 1, carry: 1 }] },
    { id: 'brimhaven-dungeon-fire-giants', region: 'brimhaven', target: 'Fire giant', x: 2659, z: 9483, leashRadius: 6, hp: 60, offence: 55, defence: 55, minCombat: 75, trainingTier: 4, food: 'Lobster', coins: 1200, skills: { woodcutting: 10, agility: 12 }, supplies: [{ item: 'Bronze axe', count: 1, carry: 1 }] }
];
