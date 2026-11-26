import { SUPER_ATTACK, SUPER_STRENGTH, type BoostPotion } from '../../api/combat/boostPotions.js';
import { stockOf, type ActivityPlan, type LevelerSnapshot, type Requirement } from './types.js';

const RECIPES = [
    { potion: SUPER_ATTACK, level: 45, herb: 'Irit leaf', unid: 209, unfinished: 101, secondary: 'Eye of newt', outputId: 145 },
    { potion: SUPER_STRENGTH, level: 55, herb: 'Kwuarm', unid: 213, unfinished: 105, secondary: 'Limpwurt root', outputId: 157 }
];
const TARGET_DOSES = 300;
const REFILL_DOSES = 30;

function doses(s: LevelerSnapshot, potion: BoostPotion): number {
    return potion.doses.reduce((total, name, index) => total + stockOf(s, name) * (4 - index), 0);
}

function brew(s: LevelerSnapshot, objective: string, recipe: typeof RECIPES[number]) {
    const missing = Math.max(0, Math.ceil((TARGET_DOSES - doses(s, recipe.potion)) / 3));
    const herbs = Math.max(0, missing - stockOf(s, '#' + recipe.unfinished));
    const output = { item: recipe.potion.flask, count: stockOf(s, recipe.potion.flask) + missing };
    const needs: Requirement[] = [];
    if (herbs) needs.push({ item: 'Vial of water', count: herbs });
    if (missing) needs.push({ item: recipe.secondary, count: missing });
    if (herbs) needs.push({ item: recipe.herb, count: herbs });
    return {
        id: 'stock-super-' + recipe.potion.skill, label: 'Stock super ' + recipe.potion.skill + ' potions', objective,
        script: 'PotionMaker', settings: { herb: recipe.herb, secondary: recipe.secondary, outputId: recipe.outputId, outputCount: output.count },
        needs, output
    };
}

export function trainingPotionPlans(s: LevelerSnapshot, objective: string): ActivityPlan[] {
    if (!s.quests['Druidic Ritual']) return [];
    const batches = RECIPES.filter(recipe => s.levels.herblore >= recipe.level).map(recipe => {
        const plan = brew(s, objective, recipe);
        const ownedHerbs = stockOf(s, recipe.herb) + stockOf(s, '#' + recipe.unid);
        const unfinished = stockOf(s, '#' + recipe.unfinished);
        const water = stockOf(s, 'Vial of water') + stockOf(s, 'Vial');
        const ready = Math.min(stockOf(s, recipe.secondary), unfinished + Math.min(ownedHerbs, water));
        const missing = plan.output.count - stockOf(s, recipe.potion.flask);
        return { plan, ready, herbs: Math.min(100, ownedHerbs + unfinished),
            restock: doses(s, recipe.potion) < REFILL_DOSES || (missing >= 14 && ready >= missing) };
    });
    return batches.filter(batch => batch.restock)
        .sort((a, b) => b.ready - a.ready || b.herbs - a.herbs)
        .map(batch => batch.plan);
}

export function refreshPotionBatch(s: LevelerSnapshot, plan: ActivityPlan): ActivityPlan {
    const recipe = RECIPES.find(recipe => plan.id === 'stock-super-' + recipe.potion.skill);
    return recipe ? brew(s, plan.objective, recipe) : plan;
}

export function meleeBoosts(s: LevelerSnapshot, needs: Requirement[]): Record<string, boolean> {
    const settings: Record<string, boolean> = {};
    for (const [potion, setting] of [[SUPER_ATTACK, 'useSuperAttack'], [SUPER_STRENGTH, 'useSuperStrength']] as const) {
        const item = potion.doses.find(name => stockOf(s, name) > 0);
        if (item) {
            needs.push({ item, count: 1, carry: 1 });
            settings[setting] = true;
        }
    }
    return settings;
}
