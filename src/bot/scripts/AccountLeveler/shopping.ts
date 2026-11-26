import Skill from '../../../client/shell/Skill.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { magicEquipment } from './magic.js';
import { gatheringTool, meleeEquipment, rangedBow } from './equipment.js';
import { purchaseBudget, SHOPPING_RESERVE, shoppingReserve, supplyOffer, supplyOffers } from './offers.js';
import { requirementKey, type LevelerSnapshot, type Requirement } from './types.js';

import { utilityMagicPlan } from './utilityMagic.js';

export { SHOPPING_RESERVE };
export interface SupplyAudit { needs: Requirement[]; budget: number; reserve: number; skipped: string[] }
export interface ShoppingStop { keeper: string; tile: WorldTile; needs: Requirement[] }

export function auditSupplies(s: LevelerSnapshot, runeGearOnly = false): SupplyAudit {
    const gold = Math.max(0, s.stock.coins ?? 0);
    const result: SupplyAudit = { needs: [], budget: 0, reserve: shoppingReserve(gold), skipped: [] };
    if (!s.bankReady) return { ...result, skipped: ['Bank contents have not loaded'] };
    const unfinished = new Set(Skill.names.filter((skill, index) => Skill.used[index] && s.levels[skill] > 0 && s.levels[skill] < s.target));
    const any = (...skills: string[]) => skills.some(skill => unfinished.has(skill));
    const flyFishing = s.levels.fishing >= 20 && any('fishing');
    const netFishing = (any('fishing') && s.levels.fishing < 20) || (any('cooking') && s.levels.fishing < 40);
    const available = (): LevelerSnapshot => ({ ...s, stock: { ...s.stock, coins: gold - result.reserve - result.budget + SHOPPING_RESERVE } });
    const add = (item: string, count = 1, id?: number) => {
        const need = { item, count, ...(id === undefined ? {} : { id }) };
        const owned = s.stock[requirementKey(need).toLowerCase()] ?? 0;
        if (owned >= need.count) return;
        if (s.unavailableItems?.some(item => item.toLowerCase() === need.item.toLowerCase() || item.toLowerCase() === requirementKey(need).toLowerCase())) {
            result.skipped.push(`Unavailable: ${need.item}`);
            return;
        }
        const offer = supplyOffer(need.item);
        if (!offer) { result.skipped.push(`No shop for ${need.item}`); return; }
        const budget = purchaseBudget(offer, need.count - owned);
        if (result.budget + budget > gold - result.reserve) {
            result.skipped.push(`Cannot budget ${need.count - owned} ${need.item} (${budget} coins)`);
            return;
        }
        result.needs.push(need);
        result.budget += budget;
    };
    const gear = (need: Requirement) => add(need.item, need.count, need.id);
    const melee = !runeGearOnly && (any('attack', 'strength', 'defence', 'hitpoints', 'prayer') || (any('herblore') && !s.quests['Druidic Ritual']) || (any('crafting') && s.levels.crafting < 10));
    if (melee || s.quests['Dragon Slayer']) {
        for (const need of meleeEquipment(available())) {
            if (melee || need.item.startsWith('Rune ')) gear(need);
        }
    }
    if (runeGearOnly) return result;
    if (any('ranged')) gear(rangedBow(available()));
    if (any('magic')) {
        const spell = utilityMagicPlan(s, 'magic');
        if (spell) spell.needs.filter(need => need.equip).forEach(gear);
        else magicEquipment(available()).needs.forEach(gear);
    }
    if (any('woodcutting', 'firemaking', 'fletching')) gear(gatheringTool(available(), 'axe'));
    if (any('mining', 'smithing', 'runecraft')) {
        const pickaxe = gatheringTool(available(), 'pickaxe');
        if ((s.levels.hitpoints < 25 || s.levels.defence < 20) && !s.stock[pickaxe.item.toLowerCase()] && supplyOffer(pickaxe.item)?.keeper === 'Nurmof') {
            result.skipped.push('Defer Nurmof until Hitpoints 25 and Defence 20; buy the pickaxe when mining starts');
        } else gear(pickaxe);
    }
    if (any('firemaking')) add('Tinderbox');
    if (any('fletching')) add('Knife');
    if (any('smithing')) add('Hammer');
    if (netFishing) add('Small fishing net');
    if (flyFishing) add('Fly fishing rod');
    if (any('crafting') && s.levels.crafting < 10) add('Needle');
    if (any('ranged') && s.levels.ranged < 40) add('Bronze arrow', 1000);
    if (flyFishing) add('Feather', 1000);
    if (any('crafting') && s.levels.crafting < 10) add('Thread', 100);
    if (any('herblore') && s.quests['Druidic Ritual']) {
        add('Vial of water', 27);
        add('Eye of newt', 27);
    }
    return result;
}

export function shoppingStops(needs: readonly Requirement[], stock: Record<string, number>): ShoppingStop[] {
    const stops = new Map<string, ShoppingStop>();
    for (const need of needs) {
        if ((stock[requirementKey(need).toLowerCase()] ?? 0) >= need.count) continue;
        for (const offer of supplyOffers(need.item)) {
            const stop = stops.get(offer.keeper) ?? { keeper: offer.keeper, tile: offer.tile, needs: [] };
            stop.needs.push(need);
            stops.set(offer.keeper, stop);
        }
    }
    return [...stops.values()];
}
