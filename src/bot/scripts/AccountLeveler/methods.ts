import Tile from '../../geometry/Tile.js';
import { combatPlan, foodFor, scimitarFor } from './combat.js';
import { stockOf, type ActivityPlan, type LevelerSnapshot, type Requirement, type SessionMemory } from './types.js';

const banked = (item: string, count = 28): Requirement => ({ item, count });
const tool = (item: string): Requirement => ({ item, count: 1, carry: 1 });
const gatherSettings = { bank: true, toolAcquire: 'Off', bankTeleport: 'Off', tickManip: 'Off', withdrawCoins: 0, forgetfulBank: false };

function activity(objective: string, id: string, script: string, settings: Record<string, unknown>, needs: Requirement[] = []): ActivityPlan {
    return { objective, id, label: id.replaceAll('-', ' '), script, settings, needs };
}

export function questPlan(s: LevelerSnapshot, objective: string, id: string, name: string): ActivityPlan {
    const food = foodFor(s);
    const kit: Requirement[] = id === 'druid' ? [
        { item: scimitarFor(s.levels.attack), count: 1, carry: 1, equip: true },
        { item: 'Iron chainbody', count: 1, carry: 1, equip: true },
        { item: 'Iron platelegs', count: 1, carry: 1, equip: true }
    ] : [];
    return { ...activity(objective, `quest-${id}`, 'AIOQuester', { quests: [id], food, loadout: '' }, [{ item: food, count: 24, carry: 12 }, banked('Coins', 2000), ...kit]), quest: name, food };
}

function prerequisiteCombat(s: LevelerSnapshot, objective: string, memory: SessionMemory, random: () => number, levels: Record<string, number>): ActivityPlan | null {
    const skill = Object.entries(levels).find(([name, level]) => s.levels[name] < level)?.[0];
    if (!skill) return null;
    const plan = combatPlan(s, skill, memory, random);
    return plan ? { ...plan, objective, prerequisiteLevels: { [skill]: levels[skill] } } : null;
}

export function methodFor(s: LevelerSnapshot, objective: string, memory: SessionMemory, random: () => number): ActivityPlan | null {
    switch (objective) {
        case 'attack': case 'strength': case 'defence': case 'hitpoints': case 'ranged': case 'magic': case 'prayer':
            return combatPlan(s, objective, memory, random);
        case 'fishing':
            return fishPlan(s, objective);
        case 'cooking':
            return cookPlan(s, objective);
        case 'woodcutting':
            return logsPlan(objective);
        case 'firemaking':
            return activity(objective, 'burn-logs', 'Firemaker', { logType: 'Logs', location: 'Varrock East' }, [tool('Tinderbox'), banked('Logs')]);
        case 'fletching':
            return activity(objective, 'fletch-logs', 'BankFletcher', { mode: 'cut', material: 'Logs', product: s.levels.fletching >= 5 ? 'Short bow' : 'Arrow shafts' }, [tool('Knife'), banked('Logs')]);
        case 'mining':
            return orePlan(objective, stockOf(s, 'Copper ore') <= stockOf(s, 'Tin ore') ? 'Copper' : 'Tin');
        case 'smithing':
            return stockOf(s, 'Bronze bar') >= 14
                ? activity(objective, 'smith-bronze', 'SmithingBot', { bar: 'Bronze', product: 'Dagger' }, [tool('Hammer'), banked('Bronze bar', 14)])
                : smeltPlan(objective);
        case 'crafting':
            if (s.levels.crafting < 10) return { ...activity(objective, 'craft-soft-leather', 'LeatherCrafter', { leatherType: 'Leather', threadPerTrip: 100 }, [tool('Needle'), { item: 'Thread', count: 100, carry: 100 }, banked('Leather', 26)]), prerequisiteLevels: { crafting: Math.min(10, s.target) } };
            return withFood(s, activity(objective, 'pick-and-spin-flax', 'FlaxAIO', { picking: true, spinning: true }));
        case 'agility':
            return withFood(s, activity(objective, 'gnome-course', 'GnomeCourse', {}));
        case 'thieving': {
            const food = foodFor(s);
            return { ...activity(objective, 'pickpocket-men', 'Thiever', { target: 'Man', action: 'Pickpocket', banking: 'Auto', food, foodWithdraw: 12, suicide: false, loadout: '' }, [{ item: food, count: 24, carry: 12 }]), travel: new Tile(3221, 3219, 0), food };
        }
        case 'herblore':
            if (!s.quests['Druidic Ritual']) {
                const levels = { attack: 20, strength: 20, defence: 20, hitpoints: 25 };
                if (Object.entries(levels).some(([skill, level]) => s.levels[skill] < level)) return prerequisiteCombat(s, objective, memory, random, levels);
                return questPlan(s, objective, 'druid', 'Druidic Ritual');
            }
            return activity(objective, 'make-attack-potions', 'PotionMaker', { herb: 'Guam leaf', secondary: 'Eye of newt' }, [banked('Guam leaf', 14), banked('Vial of water', 14), banked('Eye of newt', 14)]);
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

function fishPlan(s: LevelerSnapshot, objective: string, raw?: string): ActivityPlan {
    const fly = raw === 'Raw trout' || (!raw && s.levels.fishing >= 20);
    return activity(objective, fly ? 'fish-trout' : 'fish-shrimps', 'Fisher', {
        ...gatherSettings, fishMethod: fly ? 'Fly fishing — trout/salmon' : 'Small net — shrimp/anchovy',
        location: fly ? 'Barbarian Village' : 'Draynor Village', cookMode: 'Off', baitQty: 200
    }, fly ? [tool('Fly fishing rod'), { item: 'Feather', count: 200, carry: 200 }] : [tool('Small fishing net')]);
}

function cookPlan(s: LevelerSnapshot, objective: string, food = s.levels.cooking >= 15 && s.levels.fishing >= 20 ? 'Trout' : 'Shrimps'): ActivityPlan {
    return activity(objective, `cook-${food.toLowerCase()}`, 'CookBot', { fish: `Raw ${food.toLowerCase()}`, location: 'Draynor', surface: 'Range' }, [banked(`Raw ${food.toLowerCase()}`)]);
}

function logsPlan(objective: string): ActivityPlan {
    return activity(objective, 'gather-logs', 'Woodcutter', { ...gatherSettings, treeName: 'Tree', location: 'Draynor (trees)', burnMode: 'Off' }, [tool('Bronze axe')]);
}

function orePlan(objective: string, ore: string): ActivityPlan {
    return activity(objective, `mine-${ore.toLowerCase()}`, 'Miner', { ...gatherSettings, rocks: [ore], location: 'Southeast Varrock Mine' }, [tool('Bronze pickaxe')]);
}

function smeltPlan(objective: string): ActivityPlan {
    return activity(objective, 'smelt-bronze', 'SmelterBot', { bar: 'Bronze' }, [banked('Copper ore', 14), banked('Tin ore', 14)]);
}

export function producer(s: LevelerSnapshot, objective: string, need: Requirement, memory: SessionMemory, random: () => number): ActivityPlan | null {
    let plan: ActivityPlan | null;
    switch (need.item.toLowerCase()) {
        case 'shrimps': case 'trout': plan = cookPlan(s, objective, need.item); break;
        case 'raw shrimps': plan = fishPlan(s, objective, need.item); break;
        case 'raw trout': plan = s.levels.fishing >= 20 ? fishPlan(s, objective, need.item) : null; break;
        case 'logs': plan = logsPlan(objective); break;
        case 'copper ore': plan = orePlan(objective, 'Copper'); break;
        case 'tin ore': plan = orePlan(objective, 'Tin'); break;
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
            plan = activity(objective, 'mine-essence', 'EssMiner', {}, [tool('Bronze pickaxe')]);
            break;
        default: return null;
    }
    return plan ? plan.prerequisiteLevels ? plan : { ...plan, output: { item: need.item, count: need.count } } : null;
}
