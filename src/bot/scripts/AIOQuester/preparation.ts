import type { QuestPreparationRequest } from '../../api/ai/quests/engine/preparationTypes.js';
import { questSupplyProducer } from './supplyProducers.js';
import { FISH, WOODS } from '../AccountLeveler/catalog.js';
import { membersReady } from '../AccountLeveler/locations.js';
import { methodFor, producer } from '../AccountLeveler/methods.js';
import { purchaseBudget, supplyOffer } from '../AccountLeveler/offers.js';
import { requirementKey, stockOf, type ActivityPlan, type Decision, type LevelerSnapshot, type Requirement, type SessionMemory } from '../AccountLeveler/types.js';

export function planPreparation(snapshot: LevelerSnapshot, request: QuestPreparationRequest, memory: SessionMemory, random: () => number = Math.random): Decision {
    if (!snapshot.bankReady) return { kind: 'refresh' };
    const s = { ...snapshot, allowQuests: false };
    const blocked = (reason: string): Decision => ({ kind: 'blocked', reason });
    const train = (skill: string, level: number, chain: string[]): Decision => {
        if (!Number.isFinite(s.levels[skill]) || s.levels[skill] < 1) return blocked(`Cannot train ${skill}: skill is unavailable`);
        const locked = skill === 'herblore' ? 'Druidic Ritual' : skill === 'runecraft' ? 'Rune Mysteries Quest' : undefined;
        if (locked && !s.quests[locked]) return blocked(`Complete ${locked} before training ${skill}`);
        const plan = methodFor({ ...s, target: level }, skill, memory, random);
        if (!plan || plan.quest || plan.script === 'AIOQuester') return blocked(`No supported training method for ${skill} ${level}`);
        return resolve({ ...plan, prerequisiteLevels: plan.prerequisiteLevels ?? { [skill]: level } }, chain);
    };
    const resolve = (plan: ActivityPlan, chain: string[]): Decision => {
        if (chain.includes(plan.id) || chain.length >= 20) return blocked(`Preparation dependency cycle: ${[...chain, plan.id].join(' -> ')}`);
        let budget = 0;
        for (const need of plan.needs) {
            const missing = need.count - stockOf(s, requirementKey(need));
            if (missing <= 0) continue;
            if (s.unavailableItems?.includes(need.item.toLowerCase())) return blocked(`Supplier unavailable for ${need.item}`);
            const offer = supplyOffer(need.item);
            if (offer) {
                budget += purchaseBudget(offer, missing);
                if (budget + Math.max(200, plan.needs.find(n => n.item === 'Coins')?.count ?? 0) > stockOf(s, 'Coins')) return blocked(`Not enough Coins to buy ${need.item} and keep travel funds`);
                continue;
            }
            const fish = FISH.find(f => [f.food.toLowerCase(), `raw ${f.food.toLowerCase()}`].includes(need.item.toLowerCase()));
            const wood = WOODS.find(w => w.item.toLowerCase() === need.item.toLowerCase());
            const raw = need.item.toLowerCase().startsWith('raw ');
            const levels: Record<string, number> = fish ? {
                ...(raw || stockOf(s, `Raw ${fish.food.toLowerCase()}`) === 0 ? { fishing: fish.level } : {}),
                ...(!raw ? { cooking: fish.cooking } : {})
            } : wood ? { woodcutting: wood.level } : need.item === 'Iron ore' ? { mining: 30 } : need.item === 'Iron bar' ? { smithing: 15 } : need.item.toLowerCase() === 'cake' ? { thieving: 5 }
                : need.item.toLowerCase() === 'agility potion(3)' ? { herblore: 34 } : {};
            const deficit = Object.entries(levels).find(([skill, level]) => s.levels[skill] < level);
            const dependency = deficit ? train(deficit[0], deficit[1], [...chain, plan.id]) : (() => {
                if (raw && fish && ['Lobster', 'Shark'].includes(fish.food) && !membersReady(s)) {
                    const combat = Object.entries({ attack: 20, strength: 20, defence: 20, hitpoints: 25 }).find(([skill, level]) => s.levels[skill] < level);
                    if (combat) return train(combat[0], combat[1], [...chain, plan.id]);
                    if (stockOf(s, 'Coins') < 200) return blocked('Need 200 Coins for the coastal fishing route');
                    return resolve({ id: 'fishing-travel-food', label: 'Food for coastal fishing travel', objective: plan.objective,
                        script: '', settings: {}, needs: [{ item: 'Shrimps', count: 12, carry: 0 }] }, [...chain, plan.id]);
                }
                const producerPlan = questSupplyProducer(s, need, memory, random) ?? producer(s, plan.objective, need, memory, random);
                if (producerPlan?.script === 'CookBot' && fish && !raw) {
                    const rawItem = `Raw ${fish.food.toLowerCase()}`;
                    const banked = stockOf(s, rawItem);
                    producerPlan.needs = producerPlan.needs.map(input => input.item === rawItem
                        ? { ...input, count: Math.min(input.count, missing, banked || Infinity) } : input);
                }
                return producerPlan ? resolve(producerPlan, [...chain, plan.id]) : blocked(`Cannot source ${need.count} ${need.item} for ${plan.label}`);
            })();
            return dependency.kind === 'activity' ? { ...dependency, queue: [...dependency.queue, plan] } : dependency;
        }
        return { kind: 'activity', plan, queue: [plan] };
    };
    for (const { skill, level } of request.skills ?? []) {
        if (!Number.isInteger(level) || level < 1 || level > 99) return blocked(`Invalid target ${skill} ${level}`);
        if (!(s.levels[skill] >= level)) return train(skill, level, []);
    }
    const needs: Requirement[] = [];
    for (const need of [...request.items ?? [], ...request.food ? [request.food] : []]) {
        if (!Number.isInteger(need.count) || need.count < 1) return blocked(`Invalid quantity for ${need.item}`);
        const existing = needs.find(n => requirementKey(n).toLowerCase() === requirementKey(need).toLowerCase());
        if (existing) existing.count = Math.max(existing.count, need.count);
        else needs.push({ ...need, carry: 0 });
    }
    if (needs.every(need => stockOf(s, requirementKey(need)) >= need.count)) return { kind: 'complete' };
    return resolve({ id: 'quest-supplies', label: 'Quest supplies', objective: 'supplies', script: '', settings: {}, needs }, []);
}
