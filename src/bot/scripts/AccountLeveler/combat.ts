import Tile from '../../geometry/Tile.js';
import { meleeEquipment, rangedBow } from './equipment.js';
import { purchaseBudget, supplyOffer } from './offers.js';
import { canCatch, consumableBatch, FISH } from './catalog.js';
import { magicEquipment } from './magic.js';
import type { ActivityPlan, LevelerSnapshot, Requirement, SessionMemory } from './types.js';

export interface CombatCamp {
    id: string;
    target: string;
    x: number;
    z: number;
    hp: number;
    offence: number;
    defence: number;
    wilderness?: boolean;
    herbs?: boolean;
    talisman?: boolean;
}

export const COMBAT_CAMPS: readonly CombatCamp[] = [
    { id: 'lumbridge-chickens', target: 'Chicken', x: 3230, z: 3298, hp: 10, offence: 1, defence: 1 },
    { id: 'falador-chickens', target: 'Chicken', x: 3018, z: 3289, hp: 10, offence: 1, defence: 1 },
    { id: 'lumbridge-goblins', target: 'Goblin', x: 3252, z: 3228, hp: 10, offence: 1, defence: 1, talisman: true },
    { id: 'goblin-village', target: 'Goblin', x: 2956, z: 3500, hp: 12, offence: 5, defence: 5, talisman: true },
    { id: 'lumbridge-men', target: 'Man', x: 3221, z: 3219, hp: 10, offence: 1, defence: 1, herbs: true },
    { id: 'edgeville-men', target: 'Man', x: 3097, z: 3508, hp: 10, offence: 1, defence: 1, herbs: true },
    { id: 'lumbridge-cows', target: 'Cow', x: 3255, z: 3278, hp: 12, offence: 5, defence: 5 },
    { id: 'falador-cows', target: 'Cow', x: 3030, z: 3300, hp: 12, offence: 5, defence: 5 },
    { id: 'monastery', target: 'Monk', x: 3050, z: 3491, hp: 15, offence: 10, defence: 10 },
    { id: 'ardougne-farmer', target: 'Farmer', x: 2645, z: 3367, hp: 15, offence: 10, defence: 10, herbs: true },
    { id: 'barbarian-village', target: 'Barbarian', x: 3078, z: 3419, hp: 20, offence: 15, defence: 15, herbs: true },
    { id: 'taverley-druids', target: 'Chaos druid', x: 2931, z: 9846, hp: 25, offence: 20, defence: 15, herbs: true },
    { id: 'wilderness-skeletons', target: 'Skeleton', x: 3106, z: 3548, hp: 30, offence: 20, defence: 20, wilderness: true }
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
    let camps = COMBAT_CAMPS.filter(c => s.levels.hitpoints >= c.hp && offence >= c.offence && s.levels.defence >= c.defence
        && (!c.wilderness || s.wilderness) && (memory.cooldowns[c.id] ?? 0) <= s.now
        && (resource !== '#199' || c.herbs) && (resource !== 'Air talisman' || c.talisman)
        && (resource !== 'Cow hide' || c.target === 'Cow'));
    const fresh = camps.filter(c => !memory.recent.slice(-3).includes(c.id));
    if (fresh.length) camps = fresh;
    if (!camps.length) return null;
    const camp = camps[Math.min(camps.length - 1, Math.floor(Math.max(0, random()) * camps.length))];
    const food = foodFor(s);
    const needs: Requirement[] = [{ item: food, count: 24, carry: 12, equip: false }];
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
        id: camp.id, label: `${camp.target} at ${camp.id.replaceAll('-', ' ')}`, objective,
        script: 'AutoFighter', needs, combat: true, wilderness: camp.wilderness, food,
        travel: new Tile(camp.x, camp.z, 0),
        output: resource ? { item: resource, count: resource === '#199' ? 14 : 1 } : undefined,
        settings: {
            target: camp.target, spot: 'Custom coordinates', coordinates: new Tile(camp.x, camp.z, 0), leashRadius: 12,
            combatStyle: style, meleeStyle, rangeStyle: 'rapid', spell: magic?.spell ?? 'Wind Strike', runesWithdraw: magic?.casts ?? 150,
            ammo: 'Bronze arrow', ammoWithdraw: ammo.carry, useSpecial: false, solveClues: false,
            banking: 'Auto', food, foodWithdraw: 12, panicHp: 15, buryBones: true,
            loot: ['Bones', 'Herb', 'Air talisman', ...(resource === 'Cow hide' ? ['Cow hide'] : [])], avoidHerbs: [], loadout: '', bankEveryMinutes: 8
        }
    };
}
