import { earlyMeleeStep, isMeleeSkill } from './priority.js';
import { LEVELER_REGULAR_BONE_LIMIT } from '../AutoFighter/AutoFighterData.js';
import { spotCrowded } from './crowding.js';
import { meleeBoosts } from './trainingPotions.js';
import Tile from '../../geometry/Tile.js';
import { equipmentPrice, meleeEquipment, rangedArmour, rangedBow } from './equipment.js';
import { dragonMeleeStyle } from '../../api/combat/dragonStyle.js';
import type { MeleeCombatStyle } from '../../api/combat/CombatStyle.js';
import { dragonTeleport } from './dragonTravel.js';
import { purchaseBudget, supplyOffer } from './offers.js';
import { canCatch, isSupplyCatch, consumableBatch, FISH } from './catalog.js';
import { magicEquipment } from './magic.js';
import { combatLevel, TARGET_TIERS, trainingTier } from './combatProgression.js';
import { TRAINING_CAMPS } from './trainingCamps.js';
import { ADVANCED_CAMPS } from './advancedCamps.js';
import { DROP_DB } from '../../data/dropdb.js';
import { SECONDARY_LOOT } from './loot.js';
import { requirementKey, stockOf, type ActivityPlan, type LevelerSnapshot, type Requirement, type SessionMemory } from './types.js';

export interface CombatCamp {
    id: string;
    region: string;
    target: string;
    x: number;
    z: number;
    level?: number;
    leashRadius?: number;
    hp: number;
    offence: number;
    defence: number;
    minCombat?: number;
    trainingTier?: number;
    wilderness?: boolean;
    herbs?: boolean;
    talisman?: boolean;
    quests?: readonly string[];
    skills?: Readonly<Record<string, number>>;
    supplies?: readonly Requirement[];
    coins?: number;
    food?: string;
    prayer?: boolean;
    styles?: readonly ('melee' | 'range' | 'mage')[];
}

const babyDragon = (target: string) => target === 'Baby blue dragon' || target === 'Baby red dragon';

export const COMBAT_CAMPS: readonly CombatCamp[] = [
    { id: 'lumbridge-chickens', region: 'lumbridge', target: 'Chicken', x: 3230, z: 3298, hp: 10, offence: 1, defence: 1 },
    { id: 'falador-chickens', region: 'falador', target: 'Chicken', x: 3018, z: 3289, hp: 10, offence: 1, defence: 1 },
    { id: 'lumbridge-goblins', region: 'lumbridge', target: 'Goblin', x: 3252, z: 3228, hp: 10, offence: 1, defence: 1, talisman: true },
    { id: 'goblin-village', region: 'falador', target: 'Goblin', x: 2956, z: 3500, hp: 12, offence: 5, defence: 5, talisman: true },
    { id: 'lumbridge-west-goblins', region: 'lumbridge', target: 'Goblin', x: 3185, z: 3245, hp: 10, offence: 1, defence: 1, talisman: true },
    { id: 'lumbridge-west-giant-spiders', region: 'lumbridge', target: 'Giant spider', x: 3202, z: 3239, hp: 10, offence: 1, defence: 1, prayer: false },
    { id: 'lumbridge-castle-rats', region: 'lumbridge', target: 'Rat', x: 3229, z: 3223, hp: 10, offence: 1, defence: 1, prayer: false },
    { id: 'lumbridge-men', region: 'lumbridge', target: 'Man', x: 3221, z: 3219, hp: 10, offence: 1, defence: 1, herbs: true },
    { id: 'edgeville-men', region: 'edgeville', target: 'Man', x: 3097, z: 3508, hp: 10, offence: 1, defence: 1, herbs: true },
    { id: 'rimmington-rats', region: 'rimmington', target: 'Rat', x: 2957, z: 3204, hp: 10, offence: 1, defence: 1, prayer: false },
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
    { id: 'varrock-spiders', region: 'varrock', target: 'Spider', x: 3243, z: 3395, hp: 10, offence: 1, defence: 1, prayer: false },
    { id: 'lumbridge-giant-spiders', region: 'lumbridge', target: 'Giant spider', x: 3244, z: 3234, hp: 10, offence: 1, defence: 1, prayer: false },
    { id: 'edgeville-giant-spiders', region: 'edgeville', target: 'Giant spider', x: 3147, z: 3481, hp: 10, offence: 1, defence: 1, prayer: false },
    { id: 'al-kharid-spiders', region: 'al-kharid', target: 'Spider', x: 3322, z: 3140, hp: 10, offence: 1, defence: 1, prayer: false },
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
    ...TRAINING_CAMPS,
    ...ADVANCED_CAMPS
];

export function scimitarFor(attack: number): string {
    return attack >= 20 ? 'Mithril scimitar' : attack >= 5 ? 'Steel scimitar' : 'Iron scimitar';
}

export function foodFor(s: LevelerSnapshot, count = 24): string {
    const canPrepare = (fish: typeof FISH[number]) => s.levels.cooking >= fish.cooking
        && (stockOf(s, 'Raw ' + fish.food) >= 28 || (isSupplyCatch(s.levels.fishing, fish) && canCatch(s, fish)));
    const shark = FISH.find(fish => fish.food === 'Shark')!;
    if (stockOf(s, 'Shark') >= count || canPrepare(shark)) return 'Shark';
    for (const food of ['Swordfish', 'Lobster', 'Salmon', 'Trout', 'Shrimps']) if (stockOf(s, food) >= count) return food;
    const lobster = FISH.find(fish => fish.food === 'Lobster')!;
    if (canPrepare(lobster)) return 'Lobster';
    return canPrepare(FISH[1]) ? 'Trout' : 'Shrimps';
}

function supplyCost(s: LevelerSnapshot, camp: CombatCamp): number {
    let cost = 0;
    for (const need of camp.supplies ?? []) {
        const missing = need.count - stockOf(s, requirementKey(need));
        if (missing <= 0) continue;
        if (s.unavailableItems?.includes(need.item.toLowerCase())) return Infinity;
        const offer = supplyOffer(need.item);
        if (!offer) return Infinity;
        cost += purchaseBudget(offer, missing);
    }
    return cost;
}

function canSupplyFood(s: LevelerSnapshot, food?: string): boolean {
    if (!food || foodFor(s) === 'Shark' || stockOf(s, food) >= 24) return true;
    const fish = FISH.find(fish => fish.food === food);
    return !!fish && s.levels.cooking >= fish.cooking && (stockOf(s, `Raw ${food}`) >= 28 || isSupplyCatch(s.levels.fishing, fish) && canCatch(s, fish));
}

function combatStyle(objective: string) {
    return objective === 'magic' ? 'mage' : objective === 'ranged' ? 'range' : 'melee';
}

function pick<T>(choices: T[], random: () => number): T {
    return choices[Math.min(choices.length - 1, Math.floor(Math.max(0, random()) * choices.length))];
}

function selectCamp(s: LevelerSnapshot, objective: string, memory: SessionMemory, random: () => number, candidates: readonly CombatCamp[], rotateTarget: boolean, resource?: string, preferredTarget?: string): CombatCamp | null {
    const style = combatStyle(objective);
    const offence = style === 'mage' ? s.levels.magic : style === 'range' ? s.levels.ranged : Math.min(s.levels.attack, s.levels.strength);
    const level = combatLevel(s.levels);
    const deathWalk = style === 'melee' && level < 15;
    const tier = (camp: CombatCamp) => camp.trainingTier ?? TARGET_TIERS[camp.target] ?? 0;
    let camps = candidates.filter(c => s.levels.hitpoints >= c.hp && offence >= c.offence && s.levels.defence >= c.defence
        && level >= (c.minCombat ?? 0)
        && (!c.styles || c.styles.includes(style))
        && (style !== 'range' || tier(c) <= 2 || c.target === preferredTarget)
        && (c.quests ?? []).every(quest => s.quests[quest])
        && Object.entries(c.skills ?? {}).every(([skill, required]) => (s.levels[skill] ?? 1) >= required)
        && stockOf(s, 'Coins') >= (c.coins ?? (c.x < 2840 ? 200 : 0)) + supplyCost(s, c)
        && canSupplyFood(s, c.food) && (objective !== 'prayer' || c.prayer !== false)
        && (objective !== 'prayer' || resource || s.levels.prayer < LEVELER_REGULAR_BONE_LIMIT
            || babyDragon(c.target) || DROP_DB[c.target]?.includes('Big bones'))
        && (!deathWalk || c.offence <= 15 && c.defence <= 15 && c.x >= 2840 && c.z < 3520 && !c.wilderness)
        && (!c.wilderness || s.wilderness) && (memory.cooldowns[c.id] ?? 0) <= s.now && !spotCrowded(c, memory, s.now)
        && (!resource?.startsWith('#') || c.herbs) && (resource !== 'Air talisman' || c.talisman)
        && (resource !== 'Cow hide' || c.target === 'Cow') && (resource !== 'Unicorn horn' || c.target === 'Unicorn')
        && (resource !== 'Uncut diamond' || DROP_DB[c.target]?.includes('Uncut diamond')));
    const preferred = camps.filter(camp => camp.target === preferredTarget);
    if (preferredTarget && !preferred.length) return null;
    if (preferred.length) camps = preferred;
    if (level >= 15 && !resource && !preferredTarget && camps.length) {
        camps = camps.filter(camp => tier(camp) <= trainingTier(s.levels));
        const best = Math.max(...camps.map(tier));
        camps = camps.filter(camp => tier(camp) === best || camp.target === 'Guard');
    }
    if (!camps.length) return null;
    const recentCamps = memory.recent.flatMap(id => COMBAT_CAMPS.filter(camp => camp.id === id));
    if (rotateTarget) {
        const targets = [...new Set(camps.map(camp => camp.target))];
        const recentTargets = recentCamps.slice(-3).map(camp => camp.target);
        const oldest = Math.min(...targets.map(target => recentTargets.lastIndexOf(target)));
        const target = pick(targets.filter(target => recentTargets.lastIndexOf(target) === oldest), random);
        camps = camps.filter(camp => camp.target === target);
    }
    const fresh = camps.filter(c => !memory.recent.slice(-3).includes(c.id));
    if (fresh.length) camps = fresh;
    const regions = [...new Set(camps.map(camp => camp.region))];
    const recentRegions = recentCamps.map(camp => camp.region);
    const visits = (region: string) => recentRegions.filter(recent => recent === region).length;
    const leastVisited = Math.min(...regions.map(visits));
    const freshRegions = regions.filter(region => visits(region) === leastVisited);
    const region = pick(freshRegions, random);
    camps = camps.filter(camp => camp.region === region);
    return pick(camps, random);
}

export function combatPlan(s: LevelerSnapshot, objective: string, memory: SessionMemory, random: () => number, resource?: string, preferredTarget?: string): ActivityPlan | null {
    const rotateTarget = !resource && !preferredTarget && combatLevel(s.levels) < 15
        && ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer'].includes(objective);
    const camp = selectCamp(s, objective, memory, random, COMBAT_CAMPS, rotateTarget, resource, preferredTarget);
    if (!camp) return null;
    const style = combatStyle(objective);
    const deathWalk = style === 'melee' && combatLevel(s.levels) < 15;
    const preferredFood = foodFor(s);
    const food = deathWalk ? undefined : preferredFood === 'Shark' ? preferredFood : camp.food ?? preferredFood;
    const needs: Requirement[] = food ? [{ item: food, count: 24, carry: 12, equip: false }] : [];
    const coins = Math.max(camp.coins ?? 0, stockOf(s, 'Coins') >= 200 ? 200 : 0);
    if (coins) needs.push({ item: 'Coins', count: coins, carry: coins });
    needs.push(...(camp.supplies ?? []).map(need => ({ ...need })));
    const gearSnapshot = { ...s, stock: { ...s.stock, coins: Math.max(0, stockOf(s, 'Coins') - Math.max(0, coins - 200) - supplyCost(s, camp)) } };
    const magic = style === 'mage' ? magicEquipment(gearSnapshot) : null;
    const ammo = consumableBatch(gearSnapshot, [{ item: 'Bronze arrow', count: 1 }], 300)[0];
    let weapon: string | undefined;
    if (style === 'melee') {
        const gear = meleeEquipment(gearSnapshot);
        weapon = gear[0]?.item;
        needs.push(...gear);
    } else if (style === 'range') {
        const missingAmmo = Math.max(0, ammo.count - (s.stock['bronze arrow'] ?? 0));
        const ammoBudget = missingAmmo ? purchaseBudget(supplyOffer('Bronze arrow')!, missingAmmo) : 0;
        const ranged = { ...gearSnapshot, stock: { ...gearSnapshot.stock, coins: gearSnapshot.stock.coins - ammoBudget } };
        const bow = rangedBow(ranged);
        needs.push(bow);
        const bowPrice = equipmentPrice(ranged, bow);
        if (Number.isFinite(bowPrice)) ranged.stock.coins -= bowPrice;
        needs.push(...rangedArmour(ranged));
        needs.push({ ...ammo, equip: true });
    } else {
        needs.push(...magic!.needs);
    }
    const step = style === 'melee' && !s.supplierOnly ? earlyMeleeStep(s.levels, s.target) : undefined;
    const meleeStyle = isMeleeSkill(objective) ? objective : step?.skill ?? ['attack', 'strength', 'defence'].sort((a, b) => s.levels[a] - s.levels[b])[0];
    const escape = camp.target === 'Baby blue dragon' ? dragonTeleport(s, 'blue') : camp.target === 'Baby red dragon' ? dragonTeleport(s, 'red') : null;
    for (const need of escape?.needs ?? []) {
        const existing = needs.find(item => item.item === need.item);
        if (existing) { existing.count += need.count; existing.carry = (existing.carry ?? 0) + need.carry!; }
        else needs.push(need);
    }
    const boosts = style === 'melee' && !deathWalk ? meleeBoosts(s, needs) : {};
    return {
        id: camp.id, label: `${camp.target} at ${camp.id.replaceAll('-', ' ')}${deathWalk ? ' (death walk)' : ''}`, objective,
        ...(step && step.skill === meleeStyle ? { meleeMilestone: step.level } : {}),
        script: 'AutoFighter', needs, combat: true, starterCombatSkill: rotateTarget ? objective : undefined, deathWalk, wilderness: camp.wilderness, food,
        travel: new Tile(camp.x, camp.z, camp.level ?? 0),
        output: resource ? { item: resource, count: resource === '#199' ? 14 : 1 } : undefined,
        settings: {
            ...boosts,
            target: camp.target, spot: 'Custom coordinates', coordinates: new Tile(camp.x, camp.z, camp.level ?? 0), leashRadius: camp.leashRadius ?? 12,
            travelCoins: coins, travelItems: (camp.supplies ?? []).filter(need => !need.equip).map(need => need.item),
            combatStyle: style, meleeStyle: dragonMeleeStyle(meleeStyle as MeleeCombatStyle, weapon, [camp.target]), rangeStyle: 'rapid', spell: magic?.spell ?? 'Wind Strike', runesWithdraw: magic?.casts ?? 150,
            ...(escape ? { bankTeleport: escape.name } : {}),
            ammo: 'Bronze arrow', ammoWithdraw: ammo.carry, useSpecial: style !== 'mage', solveClues: camp.target === 'Guard',
            banking: 'Auto', food: food ?? 'Shrimps', foodWithdraw: deathWalk ? 0 : 12, panicHp: deathWalk ? 0 : 15, buryBones: s.levels.prayer < LEVELER_REGULAR_BONE_LIMIT, buryBigBones: true,
            buryBabyDragonBones: babyDragon(camp.target),
            loot: ['Air talisman', ...SECONDARY_LOOT, ...(camp.target === 'Guard' ? ['Clue scroll'] : []), ...(resource && !resource.startsWith('#') ? [resource] : [])], avoidHerbs: [], loadout: '', bankAtLootSlots: 27
        }
    };
}

export function alternateCombatCamp(s: LevelerSnapshot, plan: ActivityPlan, memory: SessionMemory, random: () => number,
    held: (item: string) => number, worn: (item: string) => number): ActivityPlan | null {
    const original = COMBAT_CAMPS.find(camp => camp.id === plan.id);
    if (!original || !plan.travel || !plan.combat || plan.food && !held(plan.food)) return null;
    if (plan.needs.some(need => need.equip && !worn(requirementKey(need)))) return null;
    const coins = held('Coins');
    const rotateTarget = !!plan.starterCombatSkill && !plan.output && combatLevel(s.levels) < 15;
    const candidates = COMBAT_CAMPS.filter(camp => camp.id !== original.id
        && !!camp.wilderness === !!original.wilderness && (!camp.food || camp.food === plan.food || plan.food === 'Shark')
        && coins >= Math.max(camp.coins ?? 0, (camp.x < 2840) !== (original.x < 2840) ? 60 : 0)
        && (camp.supplies ?? []).every(need => (need.equip ? worn : held)(requirementKey(need)) >= (need.carry ?? need.count)));
    const skill = plan.settings.combatStyle === 'mage' ? 'magic' : plan.settings.combatStyle === 'range' ? 'ranged' : plan.starterCombatSkill ?? plan.objective;
    const history = rotateTarget ? { ...memory, recent: [...memory.recent, original.id] } : memory;
    const camp = selectCamp(s, skill, history, random, candidates, rotateTarget, plan.output?.item, rotateTarget ? undefined : original.target);
    if (!camp) return null;
    const travel = new Tile(camp.x, camp.z, camp.level ?? 0);
    const travelCoins = Math.max(camp.coins ?? 0, Number(plan.settings.travelCoins) > 0 ? 200 : 0);
    const needs = plan.needs.filter(need => need.item !== 'Coins' && !original.supplies?.some(item => item.item === need.item));
    if (travelCoins) needs.push({ item: 'Coins', count: travelCoins, carry: travelCoins });
    needs.push(...(camp.supplies ?? []));
    return { ...plan, id: camp.id, label: `${camp.target} at ${camp.id.replaceAll('-', ' ')}${plan.deathWalk ? ' (death walk)' : ''}`, travel, needs,
        settings: { ...plan.settings, target: camp.target, coordinates: travel, leashRadius: camp.leashRadius ?? 12, travelCoins,
            travelItems: (camp.supplies ?? []).filter(need => !need.equip).map(need => need.item) } };
}
