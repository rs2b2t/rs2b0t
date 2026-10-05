import Tile from '../../geometry/Tile.js';
import { combatPlan, foodFor } from './combat.js';
import { gatheringTool, meleeEquipment } from './equipment.js';
import { FISH, FLETCHING, WOODS, POTIONS, canSourceWood, canCatch, nextMilestone, smithProduct } from './catalog.js';
import { stockOf, type ActivityPlan, type LevelerSnapshot, type Requirement, type SessionMemory } from './types.js';

const banked = (item: string, count = 28): Requirement => ({ item, count });
const tool = (item: string): Requirement => ({ item, count: 1, carry: 1 });
const gatherSettings = { bank: true, toolAcquire: 'Off', bankTeleport: 'Off', tickManip: 'Off', withdrawCoins: 0, forgetfulBank: false };

function activity(objective: string, id: string, script: string, settings: Record<string, unknown>, needs: Requirement[] = []): ActivityPlan {
    return { objective, id, label: id.replaceAll('-', ' '), script, settings, needs };
}

export function questPlan(s: LevelerSnapshot, objective: string, id: string, name: string): ActivityPlan {
    const food = foodFor(s);
    const kit = id === 'druid' ? meleeEquipment(s) : [];
    return { ...activity(objective, `quest-${id}`, 'AIOQuester', { quests: [id], food, loadout: '' }, [{ item: food, count: 24, carry: 12 }, banked('Coins', 2000), ...kit]), quest: name, food };
}

function prerequisiteCombat(s: LevelerSnapshot, objective: string, memory: SessionMemory, random: () => number, levels: Record<string, number>): ActivityPlan | null {
    const skill = Object.entries(levels).find(([name, level]) => s.levels[name] < level)?.[0];
    if (!skill) return null;
    const plan = combatPlan(s, skill, memory, random);
    return plan ? { ...plan, objective, prerequisiteLevels: { [skill]: levels[skill] } } : null;
}

function selectMethod(s: LevelerSnapshot, objective: string, memory: SessionMemory, random: () => number): ActivityPlan | null {
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
        case 'crafting':
            if (s.levels.crafting < 10 || stockOf(s, 'Leather') >= 26) return { ...activity(objective, 'craft-soft-leather', 'LeatherCrafter', { leatherType: 'Leather', threadPerTrip: 100 }, [tool('Needle'), { item: 'Thread', count: 100, carry: 100 }, banked('Leather', 26)]), ...(s.levels.crafting < 10 ? { prerequisiteLevels: { crafting: Math.min(10, s.target) } } : {}) };
            return withFood(s, activity(objective, 'pick-and-spin-flax', 'FlaxAIO', { picking: true, spinning: true }));
        case 'agility':
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
    const plan = selectMethod(s, objective, memory, random);
    const next = nextMilestone(s, objective);
    return plan && next && !plan.quest && !plan.prerequisiteLevels ? { ...plan, prerequisiteLevels: { [objective]: next } } : plan;
}

function fishPlan(s: LevelerSnapshot, objective: string, raw?: string): ActivityPlan {
    const flyReady = canCatch(s, FISH[1]);
    const recipe = raw ? FISH.find(f => `raw ${f.food.toLowerCase()}` === raw.toLowerCase())!
        : FISH[s.levels.fishing >= 20 && (s.levels.fishing >= 40 || flyReady) ? 1 : 0];
    const fly = recipe.tool === 'Fly fishing rod';
    return activity(objective, `fish-${recipe.food.toLowerCase()}`, 'Fisher', {
        ...gatherSettings, fishMethod: recipe.method, location: recipe.location, cookMode: 'Off', baitQty: 200
    }, [tool(recipe.tool), ...(fly ? [{ item: 'Feather', count: 200, carry: 200 }] : [])]);
}

function cookPlan(s: LevelerSnapshot, objective: string, requested?: string): ActivityPlan {
    const available = [...FISH].reverse().filter(f => s.levels.cooking >= f.cooking);
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
    return plan ? plan.prerequisiteLevels ? plan : { ...plan, output: { item: need.item, count: need.count } } : null;
}
