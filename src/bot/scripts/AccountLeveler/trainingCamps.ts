import type { CombatCamp } from './combat.js';

export const TRAINING_CAMPS: readonly CombatCamp[] = [
    { id: 'varrock-west-guards', region: 'varrock', target: 'Guard', x: 3175, z: 3427, hp: 22, offence: 15, defence: 15, minCombat: 25, trainingTier: 2 },
    { id: 'varrock-east-guards', region: 'varrock', target: 'Guard', x: 3273, z: 3427, hp: 22, offence: 15, defence: 15, minCombat: 25, trainingTier: 2 },
    { id: 'varrock-palace-guards', region: 'varrock', target: 'Guard', x: 3212, z: 3464, hp: 22, offence: 15, defence: 15, minCombat: 25, trainingTier: 2 },
    { id: 'falador-north-guards', region: 'falador', target: 'Guard', x: 2966, z: 3397, hp: 22, offence: 15, defence: 15, minCombat: 25, trainingTier: 2 },
    { id: 'falador-south-guards', region: 'falador', target: 'Guard', x: 3006, z: 3322, hp: 22, offence: 15, defence: 15, minCombat: 25, trainingTier: 2 },
    { id: 'lumbridge-bears', region: 'lumbridge', target: 'Bear', x: 3169, z: 3227, hp: 22, offence: 15, defence: 15, minCombat: 25, trainingTier: 2 },
    { id: 'varrock-east-bears', region: 'varrock', target: 'Bear', x: 3296, z: 3347, hp: 22, offence: 15, defence: 15, minCombat: 25, trainingTier: 2 },
    { id: 'ice-mountain-bears', region: 'ice-mountain', target: 'Bear', x: 2966, z: 3474, hp: 22, offence: 15, defence: 15, minCombat: 25, trainingTier: 2 },
    { id: 'varrock-sewer-zombies', region: 'varrock', target: 'Zombie', x: 3259, z: 9891, hp: 22, offence: 15, defence: 15, minCombat: 25, trainingTier: 2 },
    { id: 'edgeville-dungeon-skeletons', region: 'edgeville', target: 'Skeleton', x: 3095, z: 9889, hp: 22, offence: 15, defence: 15, minCombat: 25, trainingTier: 2 },
    { id: 'varrock-warrior-women', region: 'varrock', target: 'Warrior woman', x: 3203, z: 3487, hp: 25, offence: 20, defence: 20, minCombat: 25, trainingTier: 2 },
    { id: 'rimmington-hobgoblins', region: 'rimmington', target: 'Hobgoblin', x: 2917, z: 3268, hp: 27, offence: 20, defence: 20, minCombat: 35, trainingTier: 3 },
    { id: 'yanille-giants', region: 'yanille', target: 'Giant', x: 2547, z: 3146, hp: 28, offence: 20, defence: 20, minCombat: 35, trainingTier: 3 },
    { id: 'edgeville-dungeon-giants', region: 'edgeville', target: 'Giant', x: 3110, z: 9837, hp: 28, offence: 20, defence: 20, minCombat: 35, trainingTier: 3 },
    { id: 'wilderness-east-giants', region: 'wilderness', target: 'Giant', x: 3304, z: 3655, hp: 28, offence: 20, defence: 20, minCombat: 35, trainingTier: 3, wilderness: true },
    { id: 'wilderness-hobgoblins', region: 'wilderness', target: 'Hobgoblin', x: 3093, z: 3760, hp: 28, offence: 20, defence: 20, minCombat: 35, trainingTier: 3, wilderness: true },
    { id: 'ardougne-moss-giants', region: 'ardougne', target: 'Moss giant', x: 2553, z: 3405, hp: 35, offence: 30, defence: 30, minCombat: 40, trainingTier: 3 },
    { id: 'burthorpe-guards', region: 'burthorpe', target: 'Guard', x: 2898, z: 3559, hp: 30, offence: 25, defence: 25, minCombat: 40, trainingTier: 3 }
];
