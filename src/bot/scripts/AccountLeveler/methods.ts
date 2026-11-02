import { DRAGON_STAGE } from '../../api/ai/quests/defs/dragonslayer/journal.js';
import { STRIKE_CASTS, strikeSpell } from '../../api/ai/quests/strike.js';
import { runesPerCast } from '../../api/combat/CombatStyleLogic.js';
import { dragonFoodLevels, dragonPlanks, dragonPrayer, dragonReady, dragonSupplyLevels, nextDragonQuest } from './dragons.js';
import { canStealChaos } from './runes.js';
import Tile from '../../geometry/Tile.js';
import { combatPlan, foodFor } from './combat.js';
import { gatheringTool, meleeEquipment } from './equipment.js';
import { zanarisExitNeeds } from './dragonWeapons.js';
import { locateMethod, membersReady } from './locations.js';
import { FISH, FLETCHING, WOODS, POTIONS, canSourceWood, canCatch, consumableBatch, nextMilestone, smithProduct } from './catalog.js';
import { stockOf, type ActivityPlan, type LevelerSnapshot, type Requirement, type SessionMemory } from './types.js';

const banked = (item: string, count = 28): Requirement => ({ item, count });
const tool = (item: string): Requirement => ({ item, count: 1, carry: 1 });
const gatherSettings = { bank: true, toolAcquire: 'Off', bankTeleport: 'Off', tickManip: 'Off', withdrawCoins: 0, forgetfulBank: false };

function activity(objective: string, id: string, script: string, settings: Record<string, unknown>, needs: Requirement[] = []): ActivityPlan {
    return { objective, id, label: id.replaceAll('-', ' '), script, settings, needs };
}

export function questPlan(s: LevelerSnapshot, objective: string, id: string, name: string, combat = false): ActivityPlan {
    const dragon = name === 'Dragon Slayer';
    const food = dragon || combat ? 'Lobster' : foodFor(s);
    const repaired = (s.dragonStage ?? 0) >= DRAGON_STAGE.REPAIRED_SHIP;
    const coins = !dragon ? 2000 : repaired ? 200 : s.dragonStage ? Math.max(200, Math.min(15000, stockOf(s, 'Coins'))) : 15000;
    const kit = id !== 'zanaris' && (id === 'druid' || dragon || combat) ? meleeEquipment({ ...s, stock: { ...s.stock, coins: Math.max(0, stockOf(s, 'Coins') - coins) } }) : [];
    const needs = [{ item: food, count: 24, carry: 12 }, banked('Coins', coins), ...kit, ...(id === 'zanaris' ? zanarisExitNeeds(s) ?? [] : []), ...(!s.wilderness && dragon && !repaired ? [{ item: 'Plank', count: dragonPlanks(s), carry: dragonPlanks(s) }] : [])];
    if (id === 'zanaris') {
        for (const rune of runesPerCast(strikeSpell(s.levels.magic) ?? 'Wind Strike', []) ?? []) {
            const existing = needs.find(need => need.item === rune.rune);
            if (existing) existing.count += rune.count * STRIKE_CASTS;
            else needs.push({ item: rune.rune, count: rune.count * STRIKE_CASTS });
        }
    }
    return { ...activity(objective, `quest-${id}`, 'AIOQuester', { quests: [id], food, loadout: '', gatherWildernessPlanks: s.wilderness }, needs), quest: name, food };
}

function prerequisiteCombat(s: LevelerSnapshot, objective: string, memory: SessionMemory, random: () => number, levels: Record<string, number>): ActivityPlan | null {
    const skill = Object.entries(levels).find(([name, level]) => s.levels[name] < level)?.[0];
    if (!skill) return null;
    const plan = combatPlan(s, skill, memory, random);
    return plan ? { ...plan, objective, prerequisiteLevels: { [skill]: levels[skill] } } : null;
}

function selectMethod(s: LevelerSnapshot, objective: string, memory: SessionMemory, random: () => number): ActivityPlan | null {
    if (['attack', 'strength', 'defence', 'prayer'].includes(objective) && s.levels[objective] < s.target) {
        const quest = nextDragonQuest(s, memory);
        if (quest || objective === 'prayer' && dragonReady(s) && stockOf(s, 'Dragonfire shield') > 0) {
            const levels = { ...dragonFoodLevels(s),
                ...(quest?.id === 'dragon' ? dragonSupplyLevels(s) : {}) };
            for (const req of quest?.requirements.skills ?? []) levels[req.skill] = Math.max(levels[req.skill] ?? 0, req.level);
            const missing = Object.entries(levels).find(([skill, level]) => s.levels[skill] < level);
            if (missing) {
                const [skill, level] = missing;
                const plan = selectMethod(s, skill, memory, random);
                if (plan) return { ...plan, objective, prerequisiteLevels: { [skill]: level } };
            } else if (quest) return questPlan(s, objective, quest.id, quest.name, true);
        }
        if (objective === 'prayer') {
            const plan = dragonPrayer(s, memory, random);
            if (plan) return plan;
        }
    }
    switch (objective) {
        case 'attack': case 'strength': case 'defence': case 'hitpoints': case 'ranged': case 'magic': case 'prayer':
            return combatPlan(s, objective, memory, random);
        case 'fishing':
            return fishPlan(s, objective);
        case 'cooking':
            return cookPlan(s, objective);
        case 'woodcutting':
            return logsPlan(s, objective);
        case 'firemaking': {
            const wood = [...WOODS].reverse().find(w => s.levels.firemaking >= w.level && canSourceWood(s, w.item))!;
            return activity(objective, `burn-${wood.item.toLowerCase().replaceAll(' ', '-')}`, 'Firemaker', { logType: wood.item, location: 'Varrock East' }, [tool('Tinderbox'), banked(wood.item)]);
        }
        case 'fletching': {
            const recipe = [...FLETCHING].reverse().find(r => s.levels.fletching >= r.level && canSourceWood(s, r.item))!;
            return activity(objective, `fletch-${recipe.item.toLowerCase().replaceAll(' ', '-')}`, 'BankFletcher', { mode: 'cut', material: recipe.item, product: recipe.product }, [tool('Knife'), banked(recipe.item)]);
        }
        case 'mining':
            return orePlan(s, objective, s.levels.mining >= 30 ? 'Iron' : stockOf(s, 'Copper ore') <= stockOf(s, 'Tin ore') ? 'Copper' : 'Tin');
        case 'smithing': {
            const metal = s.levels.smithing >= 15 && (s.levels.mining >= 30 || stockOf(s, 'Iron ore') >= 28 || stockOf(s, 'Iron bar') >= 14) ? 'Iron' : 'Bronze';
            return stockOf(s, `${metal} bar`) >= 14
                ? activity(objective, `smith-${metal.toLowerCase()}`, 'SmithingBot', { bar: metal, product: smithProduct(s.levels.smithing, metal) }, [tool('Hammer'), banked(`${metal} bar`, 14)])
                : smeltPlan(objective, metal);
        }
        case 'crafting': {
            const thread = consumableBatch(s, [{ item: 'Thread', count: 1 }], 100)[0];
            if (s.levels.crafting < 10 || stockOf(s, 'Leather') >= 26) return { ...activity(objective, 'craft-soft-leather', 'LeatherCrafter', { leatherType: 'Leather', threadPerTrip: thread.carry }, [tool('Needle'), thread, banked('Leather', 26)]), ...(s.levels.crafting < 10 ? { prerequisiteLevels: { crafting: Math.min(10, s.target) } } : {}) };
            return withFood(s, activity(objective, 'pick-and-spin-flax', 'FlaxAIO', { picking: true, spinning: true }));
        }
        case 'agility':
            if (s.levels.agility >= 15 && s.wilderness) {
                const food = foodFor(s);
                return { ...withFood(s, activity(objective, 'edgeville-monkey-bars', 'EdgevilleMonkeyBars', {
                    food, foodAmount: 12, minFood: 1, restockMode: 'Dungeon ladder (out of food)', loadout: ''
                })), wilderness: true };
            }
            return withFood(s, activity(objective, 'gnome-course', 'GnomeCourse', {}));
        case 'thieving': {
            const food = foodFor(s);
            const farmer = s.levels.thieving >= 10;
            return { ...activity(objective, farmer ? 'pickpocket-farmers' : 'pickpocket-men', 'Thiever', { target: farmer ? 'Farmer' : 'Man', action: 'Pickpocket', banking: 'Auto', food, foodWithdraw: 12, suicide: false, loadout: '' }, [{ item: food, count: 24, carry: 12 }]), travel: farmer ? new Tile(2645, 3367, 0) : new Tile(3221, 3219, 0), food };
        }
        case 'herblore':
            if (!s.quests['Druidic Ritual']) {
                const levels = { attack: 20, strength: 20, defence: 20, hitpoints: 25 };
                if (Object.entries(levels).some(([skill, level]) => s.levels[skill] < level)) return prerequisiteCombat(s, objective, memory, random, levels);
                return questPlan(s, objective, 'druid', 'Druidic Ritual');
            }
            {
                const recipe = [...POTIONS].reverse().find(p => s.levels.herblore >= p.level && stockOf(s, p.herb) >= 14 && stockOf(s, p.secondary) >= 14) ?? POTIONS[0];
                return activity(objective, `make-${recipe.herb.toLowerCase().replaceAll(' ', '-')}-potions`, 'PotionMaker', { herb: recipe.herb, secondary: recipe.secondary }, [banked(recipe.herb, 14), banked('Vial of water', 14), banked(recipe.secondary, 14)]);
            }
        case 'runecraft':
            if (!s.quests['Rune Mysteries Quest']) return questPlan(s, objective, 'runemysteries', 'Rune Mysteries Quest');
            return activity(objective, 'craft-air-runes', 'RuneCrafter', { rune: 'Air runes', mode: 'Solo' }, [tool('Air talisman'), banked('Rune essence', 27)]);
        default:
            return null;
    }
}

function withFood(s: LevelerSnapshot, plan: ActivityPlan): ActivityPlan {
    const food = foodFor(s);
    return { ...plan, food, needs: [...plan.needs, { item: food, count: 24, carry: 12 }] };
}

export function methodFor(s: LevelerSnapshot, objective: string, memory: SessionMemory, random: () => number): ActivityPlan | null {
    const selected = selectMethod(s, objective, memory, random);
    const plan = selected ? locateMethod(s, selected, memory, random) : null;
    const next = nextMilestone(s, objective);
    return plan && next && !plan.quest && !plan.prerequisiteLevels ? { ...plan, prerequisiteLevels: { [objective]: next } } : plan;
}

function fishPlan(s: LevelerSnapshot, objective: string, raw?: string): ActivityPlan {
    const flyReady = canCatch(s, FISH[1]);
    const recipe = raw ? FISH.find(f => `raw ${f.food.toLowerCase()}` === raw.toLowerCase())!
        : membersReady(s) && canCatch(s, FISH[3]) ? FISH[3]
            : FISH[s.levels.fishing >= 20 && (s.levels.fishing >= 40 || flyReady) ? 1 : 0];
    const fly = recipe.tool === 'Fly fishing rod';
    const bait = fly ? consumableBatch(s, [{ item: 'Feather', count: 1 }], 200) : [];
    return activity(objective, `fish-${recipe.food.toLowerCase()}`, 'Fisher', {
        ...gatherSettings, fishMethod: recipe.method, location: recipe.location, cookMode: 'Off', baitQty: bait[0]?.carry ?? 200
    }, [tool(recipe.tool), ...bait]);
}

function cookPlan(s: LevelerSnapshot, objective: string, requested?: string): ActivityPlan {
    const available = [...FISH].reverse().filter(f => s.levels.cooking >= f.cooking
        && (f.food !== 'Lobster' || membersReady(s) || stockOf(s, 'Raw lobster') >= 28));
    const food = requested ?? (available.find(f => stockOf(s, `Raw ${f.food.toLowerCase()}`) >= 28)
        ?? available.find(f => canCatch(s, f)) ?? FISH[0])!.food;
    return activity(objective, `cook-${food.toLowerCase()}`, 'CookBot', { fish: `Raw ${food.toLowerCase()}`, location: 'Draynor', surface: 'Range' }, [banked(`Raw ${food.toLowerCase()}`)]);
}

function logsPlan(s: LevelerSnapshot, objective: string, requested?: string): ActivityPlan {
    const wood = requested ? WOODS.find(w => w.item.toLowerCase() === requested.toLowerCase())!
        : [...WOODS].reverse().find(w => s.levels.woodcutting >= w.level)!;
    return activity(objective, `gather-${wood.item.toLowerCase().replaceAll(' ', '-')}`, 'Woodcutter', {
        ...gatherSettings, treeName: wood.tree, location: wood.location, burnMode: 'Off'
    }, [gatheringTool(s, 'axe')]);
}

function orePlan(s: LevelerSnapshot, objective: string, ore: string): ActivityPlan {
    return activity(objective, `mine-${ore.toLowerCase()}`, 'Miner', { ...gatherSettings, rocks: [ore], location: 'Southeast Varrock Mine' }, [gatheringTool(s, 'pickaxe')]);
}

function smeltPlan(objective: string, metal = 'Bronze'): ActivityPlan {
    return activity(objective, `smelt-${metal.toLowerCase()}`, 'SmelterBot', { bar: metal }, metal === 'Iron' ? [banked('Iron ore')] : [banked('Copper ore', 14), banked('Tin ore', 14)]);
}

export function producer(s: LevelerSnapshot, objective: string, need: Requirement, memory: SessionMemory, random: () => number): ActivityPlan | null {
    let plan: ActivityPlan | null;
    switch (need.item.toLowerCase()) {
        case 'chaos rune': {
            if (!canStealChaos(s)) return null;
            const food = foodFor(s);
            plan = { ...activity(objective, 'pickpocket-paladins', 'Thiever', {
                target: 'Paladin', action: 'Pickpocket', banking: 'Auto', food, foodWithdraw: 12, suicide: false, loadout: ''
            }, [{ item: food, count: 24, carry: 12 }]), food };
            break;
        }
        case 'shrimps': case 'trout': case 'salmon': case 'lobster':
            plan = s.levels.cooking >= FISH.find(f => f.food.toLowerCase() === need.item.toLowerCase())!.cooking ? cookPlan(s, objective, need.item) : null;
            break;
        case 'raw shrimps': case 'raw trout': case 'raw salmon': case 'raw lobster': {
            const fish = FISH.find(f => `raw ${f.food.toLowerCase()}` === need.item.toLowerCase())!;
            plan = s.levels.fishing >= fish.level ? fishPlan(s, objective, need.item) : null;
            break;
        }
        case 'logs': case 'oak logs': case 'willow logs':
            plan = s.levels.woodcutting >= WOODS.find(w => w.item.toLowerCase() === need.item.toLowerCase())!.level ? logsPlan(s, objective, need.item) : null;
            break;
        case 'copper ore': plan = orePlan(s, objective, 'Copper'); break;
        case 'tin ore': plan = orePlan(s, objective, 'Tin'); break;
        case 'iron ore': plan = s.levels.mining >= 30 ? orePlan(s, objective, 'Iron') : null; break;
        case 'iron bar': plan = s.levels.smithing >= 15 ? smeltPlan(objective, 'Iron') : null; break;
        case 'bronze bar': plan = smeltPlan(objective); break;
        case 'leather':
            plan = activity(objective, 'tan-cow-hides', 'TannerBot', { hideType: 'Soft leather', buyThread: false, coinsPerTrip: 100 }, [banked('Cow hide', 26), { item: 'Coins', count: 100, carry: 100 }]);
            break;
        case 'cow hide': {
            const levels = { attack: 5, strength: 5, defence: 5, hitpoints: 12 };
            plan = Object.entries(levels).some(([skill, level]) => s.levels[skill] < level)
                ? prerequisiteCombat(s, objective, memory, random, levels)
                : combatPlan(s, objective, memory, random, 'Cow hide');
            break;
        }
        case 'guam leaf':
            plan = activity(objective, 'clean-guam', 'HerbCleaner', { herbs: ['Guam leaf'] }, [banked('#199', 14)]);
            break;
        case '#199': case 'air talisman': plan = combatPlan(s, objective, memory, random, need.item); break;
        case 'rune essence':
            plan = activity(objective, 'mine-essence', 'EssMiner', {}, [gatheringTool(s, 'pickaxe')]);
            break;
        default: return null;
    }
    plan = plan ? locateMethod(s, plan, memory, random) : null;
    return plan ? plan.prerequisiteLevels ? plan : { ...plan, output: { item: need.item, count: plan.script === 'EssMiner' ? Math.max(1000, need.count) : need.count } } : null;
}
