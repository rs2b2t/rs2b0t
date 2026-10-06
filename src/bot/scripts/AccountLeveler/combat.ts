import Tile from '../../geometry/Tile.js';
import { meleeEquipment, rangedBow } from './equipment.js';
import { purchaseBudget, supplyOffer } from './offers.js';
import { canCatch, consumableBatch, FISH } from './catalog.js';
import { magicEquipment } from './magic.js';
import { combatLevel, TARGET_TIERS, trainingTier } from './combatProgression.js';
import { TRAINING_CAMPS } from './trainingCamps.js';
import type { ActivityPlan, LevelerSnapshot, Requirement, SessionMemory } from './types.js';

export interface CombatCamp {
    id: string;
    region: string;
    target: string;
    x: number;
    z: number;
    hp: number;
    offence: number;
    defence: number;
    minCombat?: number;
    trainingTier?: number;
    wilderness?: boolean;
    herbs?: boolean;
    talisman?: boolean;
}

export const COMBAT_CAMPS: readonly CombatCamp[] = [
    { id: 'lumbridge-chickens', region: 'lumbridge', target: 'Chicken', x: 3230, z: 3298, hp: 10, offence: 1, defence: 1 },
    { id: 'falador-chickens', region: 'falador', target: 'Chicken', x: 3018, z: 3289, hp: 10, offence: 1, defence: 1 },
    { id: 'lumbridge-goblins', region: 'lumbridge', target: 'Goblin', x: 3252, z: 3228, hp: 10, offence: 1, defence: 1, talisman: true },
    { id: 'goblin-village', region: 'falador', target: 'Goblin', x: 2956, z: 3500, hp: 12, offence: 5, defence: 5, talisman: true },
    { id: 'lumbridge-men', region: 'lumbridge', target: 'Man', x: 3221, z: 3219, hp: 10, offence: 1, defence: 1, herbs: true },
    { id: 'edgeville-men', region: 'edgeville', target: 'Man', x: 3097, z: 3508, hp: 10, offence: 1, defence: 1, herbs: true },
    { id: 'rimmington-rats', region: 'rimmington', target: 'Rat', x: 2957, z: 3204, hp: 10, offence: 1, defence: 1 },
    { id: 'port-sarim-goblins', region: 'port-sarim', target: 'Goblin', x: 3000, z: 3207, hp: 10, offence: 1, defence: 1, talisman: true },
    { id: 'draynor-goblins', region: 'draynor', target: 'Goblin', x: 3144, z: 3230, hp: 10, offence: 1, defence: 1, talisman: true },
    { id: 'lumbridge-west-chickens', region: 'lumbridge', target: 'Chicken', x: 3188, z: 3278, hp: 10, offence: 1, defence: 1 },
    { id: 'lumbridge-cows', region: 'lumbridge', target: 'Cow', x: 3255, z: 3278, hp: 12, offence: 5, defence: 5 },
    { id: 'falador-cows', region: 'falador', target: 'Cow', x: 3030, z: 3300, hp: 12, offence: 5, defence: 5 },
    { id: 'monastery', region: 'edgeville', target: 'Monk', x: 3050, z: 3491, hp: 15, offence: 10, defence: 10 },
    { id: 'ardougne-farmer', region: 'ardougne', target: 'Farmer', x: 2645, z: 3367, hp: 15, offence: 10, defence: 10, herbs: true },
    { id: 'barbarian-village', region: 'edgeville', target: 'Barbarian', x: 3078, z: 3419, hp: 16, offence: 10, defence: 10, herbs: true },
    { id: 'taverley-druids', region: 'taverley', target: 'Chaos druid', x: 2931, z: 9846, hp: 25, offence: 20, defence: 15, herbs: true },
    { id: 'seers-men', region: 'seers', target: 'Man', x: 2695, z: 3493, hp: 25, offence: 20, defence: 20, herbs: true },
    { id: 'seers-women', region: 'seers', target: 'Woman', x: 2696, z: 3496, hp: 25, offence: 20, defence: 20, herbs: true },
    { id: 'catherby-men', region: 'catherby', target: 'Man', x: 2804, z: 3430, hp: 25, offence: 20, defence: 20, herbs: true },
    { id: 'ardougne-men', region: 'ardougne', target: 'Man', x: 2614, z: 3318, hp: 25, offence: 20, defence: 20 },
    { id: 'ardougne-cows', region: 'ardougne', target: 'Cow', x: 2664, z: 3347, hp: 25, offence: 20, defence: 20 },
    { id: 'ardougne-monks', region: 'ardougne', target: 'Monk', x: 2608, z: 3213, hp: 25, offence: 20, defence: 20 },
    { id: 'ardougne-guards', region: 'ardougne', target: 'Guard', x: 2659, z: 3308, hp: 30, offence: 25, defence: 25 },
    { id: 'ardougne-goblins', region: 'ardougne', target: 'Goblin', x: 2580, z: 3413, hp: 25, offence: 20, defence: 20, talisman: true },
    { id: 'khazard-troopers', region: 'khazard', target: 'Khazard trooper', x: 2528, z: 3241, hp: 30, offence: 25, defence: 25 },
    { id: 'yanille-men', region: 'yanille', target: 'Man', x: 2596, z: 3105, hp: 25, offence: 20, defence: 20, herbs: true },
    { id: 'yanille-cows', region: 'yanille', target: 'Cow', x: 2585, z: 3119, hp: 25, offence: 20, defence: 20 },
    { id: 'yanille-soldiers', region: 'yanille', target: 'Soldier', x: 2544, z: 3094, hp: 35, offence: 30, defence: 30 },
    { id: 'taverley-surface-druids', region: 'taverley', target: 'Druid', x: 2895, z: 3438, hp: 35, offence: 30, defence: 30, herbs: true },
    { id: 'lumbridge-swamp-giant-rats', region: 'lumbridge', target: 'Giant rat', x: 3195, z: 3205, hp: 10, offence: 1, defence: 1 },
    { id: 'lumbridge-south-giant-rats', region: 'lumbridge', target: 'Giant rat', x: 3209, z: 3177, hp: 12, offence: 5, defence: 5 },
    { id: 'port-sarim-giant-rats', region: 'port-sarim', target: 'Giant rat', x: 2997, z: 3193, hp: 12, offence: 5, defence: 5 },
    { id: 'varrock-east-giant-rats', region: 'varrock', target: 'Giant rat', x: 3265, z: 3382, hp: 12, offence: 5, defence: 5 },
    { id: 'varrock-spiders', region: 'varrock', target: 'Spider', x: 3243, z: 3395, hp: 10, offence: 1, defence: 1 },
    { id: 'lumbridge-giant-spiders', region: 'lumbridge', target: 'Giant spider', x: 3244, z: 3234, hp: 10, offence: 1, defence: 1 },
    { id: 'edgeville-giant-spiders', region: 'edgeville', target: 'Giant spider', x: 3147, z: 3481, hp: 10, offence: 1, defence: 1 },
    { id: 'al-kharid-spiders', region: 'al-kharid', target: 'Spider', x: 3322, z: 3140, hp: 10, offence: 1, defence: 1 },
    { id: 'falador-dwarves', region: 'falador', target: 'Dwarf', x: 3019, z: 3338, hp: 18, offence: 10, defence: 10 },
    { id: 'ice-mountain-dwarves', region: 'ice-mountain', target: 'Dwarf', x: 3015, z: 3428, hp: 25, offence: 20, defence: 20 },
    { id: 'ice-mountain-west-dwarves', region: 'ice-mountain', target: 'Dwarf', x: 2999, z: 3449, hp: 25, offence: 20, defence: 20 },
    { id: 'lumbridge-women', region: 'lumbridge', target: 'Woman', x: 3218, z: 3205, hp: 10, offence: 1, defence: 1, herbs: true },
    { id: 'lumbridge-east-women', region: 'lumbridge', target: 'Woman', x: 3243, z: 3211, hp: 10, offence: 1, defence: 1, herbs: true },
    { id: 'port-sarim-women', region: 'port-sarim', target: 'Woman', x: 3011, z: 3236, hp: 10, offence: 1, defence: 1, herbs: true },
    { id: 'falador-women', region: 'falador', target: 'Woman', x: 2970, z: 3389, hp: 10, offence: 1, defence: 1, herbs: true },
    { id: 'varrock-square-women', region: 'varrock', target: 'Woman', x: 3223, z: 3401, hp: 10, offence: 1, defence: 1, herbs: true },
    { id: 'varrock-northeast-women', region: 'varrock', target: 'Woman', x: 3278, z: 3499, hp: 10, offence: 1, defence: 1, herbs: true },
    { id: 'catherby-women', region: 'catherby', target: 'Woman', x: 2817, z: 3443, hp: 25, offence: 20, defence: 20, herbs: true },
    { id: 'yanille-women', region: 'yanille', target: 'Woman', x: 2566, z: 3084, hp: 25, offence: 20, defence: 20, herbs: true },
    { id: 'barbarian-women', region: 'edgeville', target: 'Barbarian woman', x: 3079, z: 3423, hp: 16, offence: 10, defence: 10, herbs: true },
    { id: 'varrock-barbarian-woman', region: 'varrock', target: 'Barbarian woman', x: 3225, z: 3395, hp: 16, offence: 10, defence: 10, herbs: true },
    { id: 'al-kharid-warriors', region: 'al-kharid', target: 'Al-Kharid warrior', x: 3287, z: 3172, hp: 18, offence: 10, defence: 10, herbs: true },
    { id: 'falador-highwaymen', region: 'falador', target: 'Highwayman', x: 3008, z: 3276, hp: 15, offence: 10, defence: 10 },
    { id: 'draynor-highwayman', region: 'draynor', target: 'Highwayman', x: 3110, z: 3295, hp: 15, offence: 10, defence: 10 },
    { id: 'varrock-unicorns', region: 'varrock', target: 'Unicorn', x: 3284, z: 3352, hp: 25, offence: 20, defence: 20 },
    { id: 'edgeville-unicorns', region: 'edgeville', target: 'Unicorn', x: 3087, z: 3452, hp: 25, offence: 20, defence: 20 },
    { id: 'al-kharid-scorpions', region: 'al-kharid', target: 'Scorpion', x: 3299, z: 3303, hp: 25, offence: 20, defence: 20 },
    { id: 'khazard-gnomes', region: 'khazard', target: 'Gnome', x: 2532, z: 3219, hp: 30, offence: 25, defence: 25 },
    { id: 'wilderness-skeletons', region: 'wilderness', target: 'Skeleton', x: 3106, z: 3548, hp: 30, offence: 20, defence: 20, wilderness: true },
    ...TRAINING_CAMPS
];

export function scimitarFor(attack: number): string {
    return attack >= 20 ? 'Mithril scimitar' : attack >= 5 ? 'Steel scimitar' : 'Iron scimitar';
}

export function foodFor(s: LevelerSnapshot): string {
    for (const food of ['Lobster', 'Salmon', 'Trout']) if ((s.stock[food.toLowerCase()] ?? 0) >= 24) return food;
    if ((s.stock.shrimps ?? 0) >= 24) return 'Shrimps';
    return s.levels.cooking >= 15 && ((s.stock['raw trout'] ?? 0) >= 28 || canCatch(s, FISH[1])) ? 'Trout' : 'Shrimps';
}

export function combatPlan(s: LevelerSnapshot, objective: string, memory: SessionMemory, random: () => number, resource?: string): ActivityPlan | null {
    const style = objective === 'magic' ? 'mage' : objective === 'ranged' ? 'range' : 'melee';
    const offence = style === 'mage' ? s.levels.magic : style === 'range' ? s.levels.ranged : Math.min(s.levels.attack, s.levels.strength);
    const level = combatLevel(s.levels);
    const deathWalk = style === 'melee' && level < 15;
    let camps = COMBAT_CAMPS.filter(c => s.levels.hitpoints >= c.hp && offence >= c.offence && s.levels.defence >= c.defence
        && level >= (c.minCombat ?? 0)
        && (!deathWalk || c.offence <= 15 && c.defence <= 15 && c.x >= 2840 && c.z < 3520 && !c.wilderness)
        && (c.x >= 2840 || (s.stock.coins ?? 0) >= 200)
        && (!c.wilderness || s.wilderness) && (memory.cooldowns[c.id] ?? 0) <= s.now
        && (resource !== '#199' || c.herbs) && (resource !== 'Air talisman' || c.talisman)
        && (resource !== 'Cow hide' || c.target === 'Cow'));
    if (level >= 15 && !resource && camps.length) {
        const tier = (camp: CombatCamp) => camp.trainingTier ?? TARGET_TIERS[camp.target] ?? 0;
        camps = camps.filter(camp => tier(camp) <= trainingTier(s.levels));
        const best = Math.max(...camps.map(tier));
        camps = camps.filter(camp => tier(camp) === best);
    }
    const fresh = camps.filter(c => !memory.recent.slice(-3).includes(c.id));
    if (fresh.length) camps = fresh;
    if (!camps.length) return null;
    const regions = [...new Set(camps.map(camp => camp.region))];
    const recentRegions = memory.recent.flatMap(id => COMBAT_CAMPS.filter(camp => camp.id === id).map(camp => camp.region));
    const visits = (region: string) => recentRegions.filter(recent => recent === region).length;
    const leastVisited = Math.min(...regions.map(visits));
    const freshRegions = regions.filter(region => visits(region) === leastVisited);
    const region = freshRegions[Math.min(freshRegions.length - 1, Math.floor(Math.max(0, random()) * freshRegions.length))];
    camps = camps.filter(camp => camp.region === region);
    const camp = camps[Math.min(camps.length - 1, Math.floor(Math.max(0, random()) * camps.length))];
    const food = deathWalk ? undefined : foodFor(s);
    const needs: Requirement[] = food ? [{ item: food, count: 24, carry: 12, equip: false }] : [];
    if ((s.stock.coins ?? 0) >= 200) needs.push({ item: 'Coins', count: 200, carry: 200 });
    const magic = style === 'mage' ? magicEquipment(s) : null;
    const ammo = consumableBatch(s, [{ item: 'Bronze arrow', count: 1 }], 300)[0];
    if (style === 'melee') {
        needs.push(...meleeEquipment(s));
    } else if (style === 'range') {
        const missingAmmo = Math.max(0, ammo.count - (s.stock['bronze arrow'] ?? 0));
        const ammoBudget = missingAmmo ? purchaseBudget(supplyOffer('Bronze arrow')!, missingAmmo) : 0;
        needs.push(rangedBow({ ...s, stock: { ...s.stock, coins: (s.stock.coins ?? 0) - ammoBudget } }));
        needs.push({ ...ammo, equip: true });
    } else {
        needs.push(...magic!.needs);
    }
    const meleeStyle = ['attack', 'strength', 'defence'].includes(objective) ? objective
        : ['attack', 'strength', 'defence'].sort((a, b) => s.levels[a] - s.levels[b])[0];
    return {
        id: camp.id, label: `${camp.target} at ${camp.id.replaceAll('-', ' ')}${deathWalk ? ' (death walk)' : ''}`, objective,
        script: 'AutoFighter', needs, combat: true, deathWalk, wilderness: camp.wilderness, food,
        travel: new Tile(camp.x, camp.z, 0),
        output: resource ? { item: resource, count: resource === '#199' ? 14 : 1 } : undefined,
        settings: {
            target: camp.target, spot: 'Custom coordinates', coordinates: new Tile(camp.x, camp.z, 0), leashRadius: 12,
            combatStyle: style, meleeStyle, rangeStyle: 'rapid', spell: magic?.spell ?? 'Wind Strike', runesWithdraw: magic?.casts ?? 150,
            ammo: 'Bronze arrow', ammoWithdraw: ammo.carry, useSpecial: false, solveClues: false,
            banking: 'Auto', food: food ?? 'Shrimps', foodWithdraw: deathWalk ? 0 : 12, panicHp: deathWalk ? 0 : 15, buryBones: true, buryBigBones: true,
            loot: ['Bones', 'Herb', 'Air talisman', ...(resource === 'Cow hide' ? ['Cow hide'] : [])], avoidHerbs: [], loadout: '', bankEveryMinutes: 8
        }
    };
}
