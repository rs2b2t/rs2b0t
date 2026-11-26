import { DROP_DB } from '../../data/dropdb.js';
import { HERBS } from '../../data/herbs.js';
import { RUNES } from '../../data/runeCraftLocations.js';
import { ITEM_DB } from '../../data/itemdb.js';
import { wildernessLevelAt } from '../../event/webwalk/wilderness.js';
import { SECONDARIES, SHIELD_NAME } from '../HerbloreSecondaries/HerbloreSecondariesLogic.js';
import { GEMS } from '../GemCutter/GemCutterLogic.js';
import { FISH, POTIONS, WOODS } from './catalog.js';
import { trainingTier } from './combatProgression.js';
import { combatPlan } from './combat.js';
import { crowdBlocked } from './crowding.js';
import { ADULT_DRAGONS, dragonPrayer } from './dragons.js';
import { economyReserve, ECONOMY_SALE_LOT, supplierStockForSale } from './economySupplies.js';
import { producer } from './methods.js';
import { bankedStockOf, requirementKey, stockOf, type ActivityPlan, type LevelerSnapshot, type Requirement, type SessionMemory } from './types.js';

const OBJECTIVE = 'economy';
const gearNames = [...new Set(ITEM_DB.filter(item => item.slot).map(item => item.name.toLowerCase()))];
const potionIds: Readonly<Record<string, number>> = {
    'Guam leaf/Eye of newt': 121, 'Marrentill/Unicorn horn dust': 175, 'Tarromin/Limpwurt root': 115,
    "Harralander/Red spiders' eggs": 127, 'Ranarr weed/White berries': 133, 'Ranarr weed/Snape grass': 139,
    'Irit leaf/Eye of newt': 145, 'Irit leaf/Unicorn horn dust': 181, 'Kwuarm/Limpwurt root': 157,
    'Cadantine/White berries': 163, 'Lantadyme/Dragon scale dust': 2454
};
const tool = (item: string): Requirement => ({ item, count: 1, carry: 1 });
const material = (item: string, count = 1): Requirement => ({ item, count });

function bankJob(script: string, item: string, settings: Record<string, unknown>, needs: Requirement[]): ActivityPlan {
    return { script, settings, needs, objective: OBJECTIVE, id: 'supply-' + item.toLowerCase().replaceAll(' ', '-'), label: 'Produce ' + item };
}

type SupplierPlan = ActivityPlan & { supplyTier: number };

function productionTier(level: number): number {
    return level >= 40 ? 2 : level >= 15 ? 1 : 0;
}

export function supplierProduction(snapshot: LevelerSnapshot, memory: SessionMemory, random: () => number): SupplierPlan[] {
    const s = { ...snapshot, marketItem: undefined, unavailableItems: [...(snapshot.unavailableItems ?? []),
        ...gearNames.filter(item => !stockOf(snapshot, item))] };
    const plans: SupplierPlan[] = [];
    function add(plan: ActivityPlan | null, item: string, supplyTier: number, id?: number): void {
        if (!plan || plan.prerequisiteLevels || memory.cooldowns[plan.id] > s.now || crowdBlocked(plan, memory, s.now)) return;
        if (plan.needs.some(need => stockOf(s, requirementKey(need)) < need.count)) return;
        const owned = bankedStockOf(s, id === undefined ? item : '#' + id);
        const firstSale = supplierStockForSale(item, ECONOMY_SALE_LOT);
        const count = owned < firstSale ? firstSale : (Math.floor(owned / ECONOMY_SALE_LOT) + 1) * ECONOMY_SALE_LOT;
        const output = { item, ...(id !== undefined ? { id } : {}), count };
        plans.push({ ...plan, objective: OBJECTIVE, output, supplyTier,
            settings: plan.script === 'PotionMaker' ? { ...plan.settings, outputCount: count } : plan.settings });
    }

    const products: Record<string, number> = { Coal: 1, 'Iron ore': 1, 'Bronze bar': 0, 'Iron bar': 1, 'Steel bar': 1 };
    for (const wood of WOODS) products[wood.item] = productionTier(wood.level);
    for (const fish of FISH) products['Raw ' + fish.food.toLowerCase()] = productionTier(fish.level);
    if (s.quests['Rune Mysteries Quest']) {
        products['Rune essence'] = 1;
        for (const rune of ['Air rune', 'Water rune', 'Earth rune', 'Fire rune', 'Cosmic rune', 'Nature rune', 'Law rune']) {
            products[rune] = Math.max(1, productionTier(RUNES[rune].level));
        }
    }
    for (const [item, tier] of Object.entries(products)) {
        const plan = producer(s, OBJECTIVE, { item, count: ECONOMY_SALE_LOT }, memory, random);
        if (plan?.output?.item === item) add(plan, item, tier);
    }

    for (const gem of GEMS) {
        if (s.levels.crafting >= gem.level) add(bankJob('GemCutter', gem.name, { gems: [gem.name] },
            [tool('Chisel'), material('Uncut ' + gem.name.toLowerCase())]), gem.name, productionTier(gem.level));
    }
    for (const [metal, level] of [['Bronze', 0], ['Iron', 15], ['Steel', 30], ['Mithril', 50], ['Adamantite', 70], ['Runite', 85]] as const) {
        const prefix = metal === 'Adamantite' ? 'Adamant' : metal === 'Runite' ? 'Rune' : metal;
        for (const [product, offset, bars] of [['Dagger', 0, 1], ['Scimitar', 5, 2], ['Platebody', 18, 5]] as const) {
            if (s.levels.smithing < Math.min(99, Math.max(1, level + offset))) continue;
            const item = prefix + ' ' + product.toLowerCase();
            add({ ...bankJob('SmithingBot', item, { bar: metal, product }, [tool('Hammer'), material(metal + ' bar', bars)]),
                travel: { x: 3185, z: 3440, level: 0 } }, item, productionTier(level + offset));
        }
    }

    const travelFood = ['Shark', 'Swordfish', 'Lobster', 'Salmon', 'Trout', 'Shrimps'].find(name => stockOf(s, name) >= 6);
    for (const secondary of SECONDARIES) {
        if (secondary.name === "Toad's legs" || secondary.mode === 'buy' || secondary.mode === 'buy_grind') continue;
        const wilderness = !!secondary.anchor && wildernessLevelAt(secondary.anchor) > 0;
        if (wilderness && !s.wilderness || secondary.takeFood && !travelFood) continue;
        const food = secondary.takeFood ? travelFood : undefined;
        const needs: Requirement[] = food ? [{ item: food, count: 6, carry: 6 }] : [];
        if (secondary.bank && secondary.bank.x < 2840) needs.push({ item: 'Coins', count: 200, carry: 200 });
        if (secondary.needShield) needs.push({ ...tool(SHIELD_NAME), equip: true });
        if (secondary.keyName) needs.push(tool(secondary.keyName));
        if (secondary.toolName) needs.push(tool(secondary.toolName));
        if (secondary.grindFrom) needs.push(material(secondary.grindFrom));
        const settings = { secondary: secondary.name, ...(food ? { food } : {}), foodWithdraw: food ? 6 : 0, loadout: '' };
        add({ ...bankJob('HerbloreSecondaries', secondary.name, settings, needs), food, wilderness, travel: secondary.bank }, secondary.name, 1);
    }

    add({ ...bankJob('VialFiller', 'Vial of water', { bank: 'Falador West', buyVials: false }, [material('Vial')]),
        travel: { x: 2946, z: 3369, level: 0 } }, 'Vial of water', 0);
    if (s.quests['Druidic Ritual']) {
        for (const herb of HERBS) {
            if (s.levels.herblore < herb.level || economyReserve(herb.name, true) === undefined) continue;
            add(bankJob('HerbCleaner', herb.name, { herbs: [herb.name] }, [material('#' + herb.unidId)]), herb.name, productionTier(herb.level));
        }
        for (const recipe of POTIONS) {
            if (s.levels.herblore < recipe.level) continue;
            const id = potionIds[recipe.herb + '/' + recipe.secondary];
            const item = ITEM_DB.find(entry => entry.id === id)?.name;
            if (item) add(bankJob('PotionMaker', item, { herb: recipe.herb, secondary: recipe.secondary, outputId: id },
                [material(recipe.herb), material(recipe.secondary), material('Vial of water')]), item, productionTier(recipe.level));
        }
    }

    function hunt(plan: ActivityPlan | null, target: string, item: string, tier: number, id?: number): void {
        if (!plan) return;
        const loot = DROP_DB[target].filter(drop => economyReserve(drop, true) !== undefined);
        const settings = { ...plan.settings, loot, solveClues: false, buryBones: false, buryBigBones: false, buryBabyDragonBones: false, bankEveryMinutes: 8 };
        if (target === 'Chicken') {
            const needs = plan.needs.filter(need => need.equip && stockOf(s, requirementKey(need)) >= need.count);
            add({ ...plan, food: undefined, needs, settings: { ...settings, foodWithdraw: 0, panicHp: 0, travelCoins: 0 } }, item, tier);
            return;
        }
        const meal = plan.needs.find(need => need.item === plan.food);
        const dragon = plan.script === 'GreenDragon' || plan.script === 'JiveDragons';
        const foods = dragon ? ['Shark', 'Lobster'] : ['Shark', 'Swordfish', 'Lobster', 'Salmon', 'Trout', 'Shrimps'];
        const food = meal && foods.find(name => stockOf(s, name) >= meal.count);
        if (meal && !food) return;
        let needs = plan.needs.map(need => need === meal && food ? { ...need, item: food } : need);
        const runes = needs.filter(need => need.item.endsWith(' rune'));
        const walk = dragon && (!runes.length || runes.some(need => stockOf(s, need.item) < need.count));
        if (walk) needs = needs.filter(need => !runes.includes(need));
        add({ ...plan, food, needs, bankTeleport: walk ? 'Off' : plan.bankTeleport,
            settings: { ...settings, ...(food ? { food } : {}), ...(walk ? { leaveVia: 'walk', escape: 'Flee to bank' } : {}) } }, item, tier, id);
    }
    const combatTier = trainingTier(s.levels);
    const camps = [
        ['Chicken', 'Feather', 0, combatTier === 0], ['Cow', 'Cow hide', 0, combatTier < 3],
        ['Giant', 'Big bones', 1, true], ['Chaos druid', 'Herb', 1, true]
    ] as const;
    for (const [target, item, tier, eligible] of camps) {
        if (!eligible) continue;
        const herb = item === 'Herb';
        hunt(combatPlan(s, OBJECTIVE, memory, random, herb ? '#199' : item, target), target, item, tier, herb ? 199 : undefined);
    }
    const dragon = dragonPrayer(s, memory, random, 'supply');
    const camp = ADULT_DRAGONS.find(site => site.id === dragon?.id);
    if (dragon && camp) {
        const { hide, target } = camp;
        const partial = (key: string) => bankedStockOf(s, key) % ECONOMY_SALE_LOT;
        const tier = dragon.wilderness ? 3 : 2;
        if (partial('#' + hide) > partial('Dragon bones')) hunt(dragon, target, 'Dragonhide', tier, hide);
        else hunt(dragon, target, 'Dragon bones', tier);
    }

    if (stockOf(s, 'Coins') >= 200) add({ ...bankJob('FlaxAIO', 'Flax', { picking: true, spinning: false }, [{ item: 'Coins', count: 200, carry: 200 }]),
        travel: { x: 2725, z: 3493, level: 0 } }, 'Flax', 0);
    return plans;
}
