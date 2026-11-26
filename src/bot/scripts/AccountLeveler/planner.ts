import { secondarySourceByName as secondaryByName } from '../../data/herbloreSecondarySources.js';
import { clientName, displayName, liveCatalog } from '../../api/market/catalog.js';
import { wildernessLevelAt } from '../../event/webwalk/wilderness.js';
import { economyReserve, ECONOMY_SALE, ECONOMY_SALE_LOT, saleQuantity, supplierSaleItems } from './economySupplies.js';
import { supplierProduction } from './economyProduction.js';
import { marketOrderQuantity } from './marketLots.js';
import { crowdBlocked } from './crowding.js';
import { trainingPotionPlans } from './trainingPotions.js';
import { hardCluePlan } from './hardClues.js';
import { earlyMeleeStep, isMeleeSkill } from './priority.js';
import JString from '../../../client/datastruct/JString.js';
import Skill from '../../../client/shell/Skill.js';
import { usesActivityCooldown } from './session.js';
import { methodFor, producer, questPlan } from './methods.js';
import { auditDragonWeapons, DRAGON_SHOP_COOLDOWN, zanarisExitNeeds } from './dragonWeapons.js';
import { questRecord } from '../../api/ai/quests/data/quests.js';
import { isRuneGearShop, purchaseBudget, supplyOffer } from './offers.js';
import { SHOPPING_RESERVE } from './shopping.js';
import { bankedStockOf, requirementKey, stockOf, type ActivityPlan, type Decision, type LevelerSnapshot, type SessionMemory } from './types.js';

export { scimitarFor } from './combat.js';
export const enabledSkills = Skill.names.filter((name, index) => Skill.used[index] && name !== '-unused-');
export const emptyMemory = (): SessionMemory => ({ objective: null, recent: [], cooldowns: {}, attempted: {}, deaths: 0 });
const LOST_CITY = questRecord('zanaris');

export function resolveActivity(s: LevelerSnapshot, plan: ActivityPlan, memory: SessionMemory, random: () => number, chain: string[] = []): Decision {
    if (crowdBlocked(plan, memory, s.now)) return { kind: 'blocked', reason: plan.label + ' is on cooldown because the area was crowded' };
    if (chain.includes(plan.id)) return { kind: 'blocked', reason: `Supply dependency cycle: ${[...chain, plan.id].join(' -> ')}` };
    if (usesActivityCooldown(plan) && (memory.cooldowns[plan.id] ?? 0) > s.now) return { kind: 'blocked', reason: `${plan.label} is cooling down after a failed attempt` };
    let budget = 0;
    let marketNeed: { item: string; id: number; count: number } | undefined;
    const reserve = Math.max(SHOPPING_RESERVE, plan.needs.find(need => need.item === 'Coins')?.count ?? 0);
    for (const need of plan.needs) {
        const owned = stockOf(s, requirementKey(need));
        const emptyVials = need.item === 'Vial of water' ? stockOf(s, 'Vial') : 0;
        const missing = need.count - owned - emptyVials;
        if (missing <= 0) continue;
        const unavailable = s.unavailableItems?.includes(need.item.toLowerCase());
        const offer = supplyOffer(need.item);
        const accessible = offer && !(isRuneGearShop(offer.keeper) && !s.quests['Dragon Slayer']);
        const alternative = need.item === 'Chaos rune' ? producer(s, plan.objective, need, memory, random) : null;
        if (accessible && !unavailable && !alternative) {
            budget += purchaseBudget(offer, missing);
            if (budget + reserve > stockOf(s, 'Coins')) return { kind: 'blocked', reason: `Not enough banked Coins to buy ${need.item} (budget ${budget + reserve}, including activity coin reserve)` };
            continue;
        }
        if (!alternative && unavailable && need.minimum && owned >= need.minimum) continue;
        const id = alternative || need.item === 'Law talisman' ? undefined : s.marketItem?.(need);
        if (id !== undefined && stockOf(s, 'Coins') > reserve + budget) {
            marketNeed ??= { item: need.item, id, count: marketOrderQuantity(need.item, missing) };
            continue;
        }
        if (unavailable && !alternative) return { kind: 'blocked', reason: `${need.item} is unavailable from its supplier this run` };
        let blockedSite: string | undefined;
        const dependency = alternative ?? producer(s, plan.objective, need, memory, random, reason => { blockedSite = reason; });
        if (!dependency) return { kind: 'blocked', reason: `Cannot source ${need.count} ${need.item} for ${plan.label}${blockedSite ? ` (${blockedSite})` : ''}` };
        const resolved = resolveActivity(s, dependency, memory, random, [...chain, plan.id]);
        return resolved.kind === 'activity' ? { ...resolved, queue: [...resolved.queue, plan] } : resolved;
    }
    if (marketNeed) {
        if (stockOf(s, 'Coins') <= reserve + budget) return { kind: 'blocked', reason: 'No coins left for Seers Market after activity supplies' };
        const market: ActivityPlan = { id: 'seers-market-' + marketNeed.id, label: 'Buy ' + marketNeed.item + ' from Seers Market',
            script: 'SeersMarket', objective: plan.objective, settings: { reserve: reserve + budget }, needs: [], output: marketNeed };
        return { kind: 'activity', plan: market, queue: [market, plan] };
    }
    return { kind: 'activity', plan, queue: [plan] };
}

export function dragonSwordSupply(s: LevelerSnapshot, memory: SessionMemory, random: () => number): ActivityPlan | null {
    if (memory.cooldowns[DRAGON_SHOP_COOLDOWN] > s.now) return null;
    const reserve = auditDragonWeapons(s).diamondReserve;
    if (!reserve) return null;
    const funds = stockOf(s, 'Coins') - reserve;
    const available = { ...s, stock: { ...s.stock, coins: funds } };
    const objective = memory.objective ?? 'attack';
    const hasChisel = stockOf(s, 'Chisel') > 0;
    const chiselCost = hasChisel ? 0 : purchaseBudget(supplyOffer('Chisel')!, 1);
    const canCut = s.levels.crafting >= 43 && (hasChisel || !s.unavailableItems?.includes('chisel') && funds >= chiselCost);
    for (const item of canCut ? ['Diamond', 'Uncut diamond'] : ['Diamond']) {
        const id = s.marketItem?.({ item, count: 1 });
        const keep = reserve + (item === 'Uncut diamond' ? chiselCost : 0);
        if (id !== undefined && stockOf(s, 'Coins') > keep) return {
            id: 'seers-market-' + id, label: 'Buy ' + item + ' for the Zanaris gate', script: 'SeersMarket',
            objective, settings: { reserve: keep }, needs: [], output: { item, id, count: 1 }
        };
    }
    let plan: ActivityPlan | null;
    if (s.levels.crafting < 43) {
        plan = methodFor({ ...available, target: 43 }, 'crafting', memory, random);
        if (plan) plan = { ...plan, prerequisiteLevels: { crafting: 43 } };
    } else {
        if (!canCut) return null;
        available.stock.coins -= chiselCost;
        plan = producer(available, 'attack', { item: 'Uncut diamond', count: 1 }, memory, random);
    }
    if (!plan) return null;
    const decision = resolveActivity(available, { ...plan, objective }, memory, random);
    if (decision.kind !== 'activity') return null;
    const step = decision.plan;
    return step.script === 'SeersMarket' ? { ...step, settings: { ...step.settings, reserve: stockOf(s, 'Coins') - available.stock.coins + Number(step.settings.reserve) } } : step;
}

function economyPlan(s: LevelerSnapshot, memory: SessionMemory, random: () => number): Decision {
    if (!(memory.cooldowns[ECONOMY_SALE] > s.now) && Object.entries(s.bankStock ?? s.stock).some(([item, count]) => saleQuantity(item, count) > 0)) {
        const plan: ActivityPlan = { id: ECONOMY_SALE, objective: 'economy', label: 'Sell surplus supplies to Seers Market', script: 'MarketSeller',
            settings: {}, needs: [], travel: { x: 2725, z: 3491, level: 0 } };
        return { kind: 'activity', plan, queue: [plan] };
    }
    const products = ['Coal', 'Iron ore', 'Nature rune', 'Law rune', 'Air rune', 'Water rune', 'Earth rune', 'Fire rune', 'Snape grass', "Red spiders' eggs"];
    const start = Math.floor(random() * products.length);
    for (const item of [...products.slice(start), ...products.slice(0, start)]) {
        const output = { item, count: Math.max(stockOf(s, item), economyReserve(item)!) + 100 };
        let plan: ActivityPlan | null;
        const secondary = secondaryByName(item);
        if (secondary) {
            if (!s.wilderness && secondary.anchor && wildernessLevelAt(secondary.anchor) > 0) continue;
            const needsFood = secondary.takeFood;
            const food = ['Shark', 'Swordfish', 'Lobster', 'Salmon', 'Trout', 'Shrimps'].find(name => stockOf(s, name) >= 6);
            if (needsFood && !food) continue;
            plan = { id: 'gather-' + item, label: 'Gather ' + item, script: 'HerbloreSecondaries', objective: 'economy',
                settings: { secondary: item, food, foodWithdraw: needsFood ? 6 : 0, loadout: '' },
                needs: needsFood && food ? [{ item: food, count: 6, carry: 6 }] : [], travel: secondary.bank, output };
        } else {
            plan = producer(s, 'economy', output, memory, random);
        }
        if (plan?.output?.item !== item) continue;
        const missing = (need: ActivityPlan['needs'][number]) => stockOf(s, requirementKey(need)) < (need.minimum ?? need.count);
        const shortages = plan.needs.filter(missing);
        if (shortages.length === 1 && shortages[0].item === 'Rune essence') {
            plan = producer(s, 'economy', shortages[0], memory, random);
            if (!plan || plan.needs.some(missing)) continue;
        } else if (shortages.length) continue;
        const decision = resolveActivity(s, plan, memory, random);
        if (decision.kind === 'activity' && decision.plan === plan) return decision;
    }
    return { kind: 'blocked', reason: 'Waiting for a Seers supply run to become available' };
}

function supplierSaleId(item: string): string {
    return ECONOMY_SALE + ':' + item.toLowerCase();
}

export function readySupplierSaleItems(s: LevelerSnapshot, memory: SessionMemory): string[] {
    if (!s.bankReady || !s.seersWorld) return [];
    return supplierSaleItems(s.bankStock ?? s.stock).filter(item => !(memory.cooldowns[supplierSaleId(item)] > s.now));
}

function supplierSale(s: LevelerSnapshot, memory: SessionMemory, random: () => number): Decision | undefined {
    if (!s.seersWorld) return { kind: 'blocked', reason: 'Seers Market supply runs require World 1' };
    const saleItems = readySupplierSaleItems(s, memory);
    if (!saleItems.length) return;
    const item = saleItems[Math.min(saleItems.length - 1, Math.floor(random() * saleItems.length))];
    const id = item.startsWith('#') ? Number(item.slice(1)) : undefined;
    const name = id === undefined ? item : displayName(liveCatalog(), id);
    const quantity = saleQuantity(id === undefined ? item : clientName(liveCatalog(), id) ?? item, bankedStockOf(s, item), true);
    const plan: ActivityPlan = { id: supplierSaleId(item), objective: 'economy', label: `Sell ${quantity.toLocaleString()} ${name} to Seers Market`,
        script: 'MarketSeller', settings: { supplierOnly: true, item, quantity }, needs: [], travel: { x: 2725, z: 3491, level: 0 } };
    return { kind: 'activity', plan, queue: [plan] };
}

function supplierWork(s: LevelerSnapshot, memory: SessionMemory, random: () => number): Decision {
    const candidates = supplierProduction(s, memory, random).flatMap(plan => {
        if (!plan.output) return [];
        const item = requirementKey(plan.output);
        const sale = supplierSaleId(item);
        if (memory.cooldowns[sale] > s.now) return [];
        const remaining = Math.min(ECONOMY_SALE_LOT, plan.output.count - bankedStockOf(s, item));
        return [{ plan, recentlySold: memory.recent.includes(sale), remaining, tie: random() }];
    });
    candidates.sort((a, b) => Number(a.recentlySold) - Number(b.recentlySold) || b.plan.supplyTier - a.plan.supplyTier || a.remaining - b.remaining || a.tie - b.tie);
    const account = JString.toUserhash(s.accountName ?? '');
    const prefersDragons = account % 5n === 3n;
    const otherWork = prefersDragons ? undefined : candidates.find(({ plan }) => plan.script !== 'GreenDragon' && plan.script !== 'JiveDragons');
    const plan = (otherWork ?? candidates[0])?.plan;
    return plan ? { kind: 'activity', plan, queue: [plan] } : { kind: 'blocked', reason: 'Waiting for a Seers supply run to become available' };
}

export function planNext(s: LevelerSnapshot, memory: SessionMemory, random: () => number = Math.random): Decision {
    if (!s.bankReady) return { kind: 'refresh' };
    if (s.supplierOnly) {
        const sale = supplierSale(s, memory, random);
        if (sale) return sale;
    }
    if (enabledSkills.some(skill => !Number.isFinite(s.levels[skill]) || s.levels[skill] <= 0)) return { kind: 'blocked', reason: 'Skill levels have not loaded' };
    if (s.supplierOnly) return supplierWork(s, memory, random);
    if (s.mode === 'Hard clue farming') {
        const plan = hardCluePlan(s, memory, random);
        return 'script' in plan ? resolveActivity(s, plan, memory, random) : { kind: 'blocked', reason: plan.reason };
    }
    const unfinished = enabledSkills.filter(skill => s.levels[skill] < s.target);
    if (!unfinished.length) return s.supplySeers ? economyPlan(s, memory, random) : { kind: 'complete' };
    const choices: (string | null)[] = [...unfinished];
    if (s.allowQuests !== false && !s.quests[LOST_CITY.name] && zanarisExitNeeds(s)
        && LOST_CITY.requirements.skills?.every(req => s.levels[req.skill] >= req.level)
        && (memory.cooldowns['quest-zanaris'] ?? 0) <= s.now) choices.unshift(null);

    for (let i = 0; i < choices.length - 1; i++) {
        const j = i + Math.min(choices.length - i - 1, Math.floor(random() * (choices.length - i)));
        [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    const resume = memory.objective;
    if (resume && choices.includes(resume)) choices.unshift(...choices.splice(choices.indexOf(resume), 1));
    else {
        const previous = unfinished.filter(skill => memory.attempted[skill] > 0)
            .sort((a, b) => memory.attempted[b] - memory.attempted[a])[0];
        if (previous) choices.push(...choices.splice(choices.indexOf(previous), 1));
    }
    const reasons: string[] = [];
    const melee = earlyMeleeStep(s.levels, s.target);
    const ordered = new Set(choices.map(skill => skill && melee && isMeleeSkill(skill) ? melee.skill : skill));
    for (const objective of ordered) {
        if (objective === null) {
            const quest = questPlan(s, unfinished[0], LOST_CITY.id, LOST_CITY.name, true);
            const decision = resolveActivity(s, quest, memory, random);
            if (decision.kind === 'activity') return decision;
            continue;
        }
        const method = methodFor(s, objective, memory, random);
        if (!method) { reasons.push(`No eligible method for ${objective}`); continue; }
        if (objective === 'herblore' && method.script === 'PotionMaker'
            || method.script === 'AutoFighter' && method.settings.combatStyle === 'melee' && !method.deathWalk && !method.output) {
            for (const batch of trainingPotionPlans(s, objective)) {
                const supplies = resolveActivity(s, batch, memory, random);
                if (supplies.kind === 'activity') return supplies;
            }
        }
        const decision = resolveActivity(s, method, memory, random, []);
        if (decision.kind === 'activity') return decision;
        if (decision.kind === 'blocked') reasons.push(decision.reason);
    }
    return { kind: 'blocked', reason: `Train skills to ${s.target}: ${[...new Set(reasons)].join('; ')}` };
}
