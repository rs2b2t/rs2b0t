import { FISH_RECIPES as FISH } from '../../data/fishingMethods.js';
import { membersReady, membersTravelReady } from './locations.js';
import { CHAOS_GAUNTLETS, combatGauntlets, gatheringTool } from './equipment.js';
import { refreshPotionBatch } from './trainingPotions.js';
import { purchaseBudget, supplyOffer } from './offers.js';
import { COMBAT_STAVES, magicEquipment } from './magic.js';
import { bankTeleportSupplies } from '../../api/bank/BankTeleport.js';
import { stockOf, type ActivityPlan, type LevelerSnapshot, type Requirement } from './types.js';

export function refreshConsumables(s: LevelerSnapshot, plan: ActivityPlan): ActivityPlan {
    if (plan.script === 'Woodcutter') return { ...plan, needs: plan.needs.map(need => / axe$/i.test(need.item) ? gatheringTool(s, 'axe') : need) };
    if (plan.script === 'PotionMaker') return refreshPotionBatch(s, plan);
    if (plan.script === 'HerbCleaner' && plan.output && plan.needs.length === 1) {
        const missing = Math.max(0, plan.output.count - stockOf(s, plan.output.item));
        return { ...plan, needs: missing ? [{ ...plan.needs[0], count: missing }] : [] };
    }
    if (plan.settings.combatStyle === 'melee' && s.levels.attack >= 60 && s.quests['Lost City'] && stockOf(s, 'Dragon longsword')) {
        const weapon = plan.needs.find(need => need.equip && /^(?:(?:Bronze|Iron|Steel|Black|Mithril|Adamant|Rune) (?:scimitar|longsword|sword|mace)|Dragon dagger)$/.test(need.item));
        if (weapon && !plan.settings.prepareClueRequirements) plan = { ...plan,
            needs: plan.needs.map(need => need === weapon ? { item: 'Dragon longsword', count: 1, carry: 1, equip: true } : need),
            settings: plan.settings.weapon === weapon.item ? { ...plan.settings, weapon: 'Dragon longsword' } : plan.settings };
    }
    const style = plan.script === 'LeatherCrafter' ? 'craft' : plan.script === 'Fisher' ? 'fish' : plan.script === 'AutoFighter' ? plan.settings.combatStyle : null;
    if (style === 'melee' || style === 'range') {
        const gloves = combatGauntlets(s);
        const needs = plan.needs.filter(need => need.item !== CHAOS_GAUNTLETS && !(gloves.length && need.equip && /vambraces$/i.test(need.item)));
        plan = { ...plan, needs: [...needs, ...gloves] };
    }
    if (style === 'mage') {
        const magic = magicEquipment(s);
        const escape = plan.needs.some(need => need.item === 'Law rune') ? bankTeleportSupplies(String(plan.settings.bankTeleport ?? 'Off')) : [];
        for (const rune of escape) {
            const need = magic.needs.find(need => need.item === rune.item);
            if (need) { need.count += rune.count; need.carry = (need.carry ?? 0) + rune.count; }
            else magic.needs.push({ ...rune, carry: rune.count });
        }
        return { ...plan, needs: [...plan.needs.filter(need => !/ rune$/i.test(need.item) && need.item !== CHAOS_GAUNTLETS && !COMBAT_STAVES.includes(need.item)), ...magic.needs],
            settings: { ...plan.settings, spell: magic.spell, runesWithdraw: magic.casts } };
    }
    if (style !== 'craft' && style !== 'fish' && style !== 'range') return plan;
    const consumables = plan.needs.filter(need => (need.minimum ?? 0) > 0
        && need.item === (style === 'craft' ? 'Thread' : style === 'fish' ? 'Feather' : 'Bronze arrow'));
    if (!consumables.length) return plan;
    const target = style === 'craft' ? 100 : style === 'range' ? 300 : 200;
    const batch = consumableBatch(s, consumables.map(need => ({ item: need.item, count: need.minimum! })), target);
    const replacements = new Map(consumables.map((need, index) => [need, { ...need, ...batch[index] }]));
    const setting = style === 'craft' ? 'threadPerTrip' : style === 'fish' ? 'baitQty' : 'ammoWithdraw';
    return { ...plan, needs: plan.needs.map(need => replacements.get(need) ?? need),
        settings: { ...plan.settings, [setting]: batch[0].carry! / batch[0].minimum! } };
}

export function consumableBatch(s: LevelerSnapshot, costs: readonly Pick<Requirement, 'item' | 'count'>[], target: number, carry = target): Requirement[] {
    const banked = Math.min(target, ...costs.map(cost => Math.floor(stockOf(s, cost.item) / cost.count)));
    const uses = banked > 0 ? banked : target;
    return costs.map(cost => ({ item: cost.item, count: uses * cost.count, carry: Math.min(carry, uses) * cost.count, minimum: cost.count }));
}

export const WOODS = [
    { level: 1, item: 'Logs', tree: 'Tree', location: 'Draynor (trees)' },
    { level: 15, item: 'Oak logs', tree: 'Oak', location: 'Draynor Oaks' },
    { level: 30, item: 'Willow logs', tree: 'Willow', location: 'Draynor Willows' },
    { level: 45, item: 'Maple logs', tree: 'Maple tree', location: 'Seers Maples' },
    { level: 60, item: 'Yew logs', tree: 'Yew', location: 'Edgeville Yews' }
] as const;

export const FLETCHING = [
    { level: 1, item: 'Logs', product: 'Arrow shafts' },
    { level: 5, item: 'Logs', product: 'Short bow' },
    { level: 10, item: 'Logs', product: 'Long bow' },
    { level: 20, item: 'Oak logs', product: 'Short bow' },
    { level: 25, item: 'Oak logs', product: 'Long bow' },
    { level: 35, item: 'Willow logs', product: 'Short bow' },
    { level: 40, item: 'Willow logs', product: 'Long bow' },
    { level: 50, item: 'Maple logs', product: 'Short bow' },
    { level: 55, item: 'Maple logs', product: 'Long bow' },
    { level: 65, item: 'Yew logs', product: 'Short bow' },
    { level: 70, item: 'Yew logs', product: 'Long bow' }
] as const;

export { FISH };

export const MILESTONES: Record<string, readonly number[]> = {
    runecraft: [5, 9, 14, 27, 44, 54],
    agility: [15, 60], thieving: [10, 25, 60], herblore: [5, 12, 22, 30, 38, 45, 48, 55, 66, 69],
    mining: [6, 21, 30, 31, 41], woodcutting: [15, 30, 60], fishing: [20, 30, 40, 60, 76], cooking: [15, 25, 40, 60, 80],
    firemaking: [15, 30, 45, 60], fletching: [5, 10, 20, 25, 35, 40, 50, 55, 65, 70], crafting: [10, 60, 63], smithing: [15, 20, 30, 40, 50, 60, 70, 85],
    attack: [5, 20, 30, 40], defence: [5, 20, 30, 40], ranged: [5, 20, 30, 40], magic: [5, 9, 13, 17, 23, 29, 35, 43, 55]
};

export function canSourceWood(s: LevelerSnapshot, item: string): boolean {
    const wood = WOODS.find(w => w.item === item);
    return stockOf(s, item) >= 28 || !!wood && s.levels.woodcutting >= wood.level && (wood.item !== 'Maple logs' || membersReady(s));
}

export function nextMilestone(s: LevelerSnapshot, skill: string): number | undefined {
    return MILESTONES[skill]?.find(level => level > s.levels[skill] && level < s.target);
}

export const POTIONS = [
    { level: 3, herb: 'Guam leaf', secondary: 'Eye of newt' },
    { level: 5, herb: 'Marrentill', secondary: 'Unicorn horn dust' },
    { level: 12, herb: 'Tarromin', secondary: 'Limpwurt root' },
    { level: 22, herb: 'Harralander', secondary: "Red spiders' eggs" },
    { level: 30, herb: 'Ranarr weed', secondary: 'White berries' },
    { level: 38, herb: 'Ranarr weed', secondary: 'Snape grass' },
    { level: 45, herb: 'Irit leaf', secondary: 'Eye of newt' },
    { level: 48, herb: 'Irit leaf', secondary: 'Unicorn horn dust' },
    { level: 55, herb: 'Kwuarm', secondary: 'Limpwurt root' },
    { level: 66, herb: 'Cadantine', secondary: 'White berries' },
    { level: 69, herb: 'Lantadyme', secondary: 'Dragon scale dust' }
] as const;

export function smithProduct(level: number, metal: string): string {
    const offset = metal === 'Iron' ? 15 : 0;
    return level >= 18 + offset ? 'Platebody' : level >= 14 + offset ? '2h sword' : level >= 5 + offset ? 'Scimitar' : 'Dagger';
}

export function isSupplyCatch(level: number, fish: typeof FISH[number]): boolean {
    return level >= fish.level && (level < 40 ? fish.food === 'Shrimps' : fish.food === 'Lobster' || fish.food === 'Shark');
}

export function canCatch(s: LevelerSnapshot, fish: typeof FISH[number]): boolean {
    if (s.levels.fishing < fish.level || fish.location === 'Catherby' && !membersTravelReady(s)) return false;
    const needs = [{ item: fish.tool, count: 1 }, ...(fish.tool === 'Fly fishing rod' ? consumableBatch(s, [{ item: 'Feather', count: 1 }], 200) : [])];
    let budget = 0;
    for (const need of needs) {
        const missing = Math.max(0, need.count - stockOf(s, need.item));
        if (!missing) continue;
        if (s.unavailableItems?.includes(need.item.toLowerCase())) return false;
        const offer = supplyOffer(need.item);
        if (!offer) return false;
        budget += purchaseBudget(offer, missing);
    }
    return budget === 0 || budget + 200 <= stockOf(s, 'Coins');
}
