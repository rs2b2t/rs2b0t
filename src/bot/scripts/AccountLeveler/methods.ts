import { earlyMeleeStep, isMeleeSkill } from './priority.js';
import { crowdBlocked } from './crowding.js';
import { utilityMagicPlan } from './utilityMagic.js';
import { RUNES as ALTARS } from '../../data/runeCraftLocations.js';
import { RUNES, MIN_COIN_TARGET } from '../JiveRC/logic.js';
import { DUNSTAN_FINISH } from '../../api/ai/quests/defs/trollstronghold/areas.js';
import { HERBS } from '../../data/herbs.js';
import { bankedPrayerPlan } from './prayer.js';
import { DRAGON_STAGE } from '../../api/ai/quests/defs/dragonslayer/journal.js';
import { STRIKE_CASTS, strikeSpell } from '../../api/ai/quests/strike.js';
import { runesPerCast } from '../../api/combat/CombatStyleLogic.js';
import { dragonFoodLevels, dragonPlanks, dragonPrayer, dragonReady, dragonSupplyLevels, nextDragonQuest } from './dragons.js';
import { canStealChaos, RUNE_TARGETS } from './runes.js';
import Tile from '../../geometry/Tile.js';
import { combatPlan, foodFor } from './combat.js';
import { rangingGuildPlan } from './rangingGuild.js';
import { gatheringTool, meleeEquipment } from './equipment.js';
import { zanarisExitNeeds } from './dragonWeapons.js';
import { locateMethod } from './locations.js';
import { FISH, FLETCHING, WOODS, POTIONS, canSourceWood, isSupplyCatch, canCatch, consumableBatch, nextMilestone, smithProduct } from './catalog.js';
import { bankedStockOf, banksGatheredResource, stockOf, type ActivityPlan, type LevelerSnapshot, type Requirement, type SessionMemory } from './types.js';

const banked = (item: string, count = 28): Requirement => ({ item, count });
const tool = (item: string): Requirement => ({ item, count: 1, carry: 1 });
const GATHERING_STOCK = 1000;
const gatherSettings = { bank: true, toolAcquire: 'Off', bankTeleport: 'Off', tickManip: 'Off', withdrawCoins: 0, forgetfulBank: false };

function activity(objective: string, id: string, script: string, settings: Record<string, unknown>, needs: Requirement[] = []): ActivityPlan {
    return { objective, id, label: id.replaceAll('-', ' '), script, settings, needs };
}

export function questPlan(s: LevelerSnapshot, objective: string, id: string, name: string, combat = false): ActivityPlan {
    const dragon = name === 'Dragon Slayer';
    const preferredFood = foodFor(s);
    const food = preferredFood === 'Shark' ? preferredFood : dragon || combat ? 'Lobster' : preferredFood;
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
    const step = isMeleeSkill(skill) ? earlyMeleeStep(s.levels, s.target) : undefined;
    const training = step?.skill ?? skill;
    const level = step?.level ?? levels[skill];
    const plan = combatPlan(s, training, memory, random);
    return plan ? { ...plan, objective, prerequisiteLevels: { [training]: training === skill ? Math.min(level, levels[skill]) : level } } : null;
}

function selectMethod(s: LevelerSnapshot, objective: string, memory: SessionMemory, random: () => number): ActivityPlan | null {
    if (s.allowQuests !== false && ['attack', 'strength', 'defence', 'prayer'].includes(objective) && s.levels[objective] < s.target) {
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
        case 'ranged':
            return rangingGuildPlan(s, memory) ?? combatPlan(s, objective, memory, random);
        case 'magic':
            return utilityMagicPlan(s, objective) ?? combatPlan(s, objective, memory, random);
        case 'attack': case 'strength': case 'defence': case 'hitpoints': case 'prayer':
            return combatPlan(s, objective, memory, random);
        case 'fishing': {
            const coast = [...FISH].reverse().find(f => f.location === 'Catherby' && isSupplyCatch(s.levels.fishing, f) && canCatch(s, f));
            const recipe = coast ?? (canCatch(s, FISH[1]) ? FISH[1] : s.levels.fishing < 40 ? FISH[0] : undefined);
            return recipe ? fishPlan(s, objective, recipe) : null;
        }
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
            const superheat = utilityMagicPlan(s, objective);
            if (superheat) return superheat;
            if (s.levels.smithing >= 60 && (stockOf(s, 'Steel bar') >= 5 || s.levels.mining >= 30 || stockOf(s, 'Coal') >= 18 && stockOf(s, 'Iron ore') >= 9)) {
                return activity(objective, 'smith-steel-platebodies', 'SmithingBot', { bar: 'Steel', product: 'Platebody' },
                    [tool('Hammer'), { ...banked('Steel bar', 25), minimum: 5 }]);
            }
            const metal = s.levels.smithing >= 15 && (s.levels.mining >= 30 || stockOf(s, 'Iron ore') >= 28 || stockOf(s, 'Iron bar') >= 14) ? 'Iron' : 'Bronze';
            return stockOf(s, `${metal} bar`) >= 14
                ? activity(objective, `smith-${metal.toLowerCase()}`, 'SmithingBot', { bar: metal, product: smithProduct(s.levels.smithing, metal) }, [tool('Hammer'), banked(`${metal} bar`, 14)])
                : smeltPlan(objective, metal);
        }
        case 'crafting': {
            const thread = consumableBatch(s, [{ item: 'Thread', count: 1 }], 100)[0];
            const hide = s.levels.crafting >= 63 && stockOf(s, 'Green dragon leather') >= 24 ? 'Green dragon leather'
                : s.levels.crafting >= 60 && (stockOf(s, 'Hard leather') >= 26 || stockOf(s, 'Cow hide') >= 26) ? 'Hard leather' : null;
            if (hide) return activity(objective, 'craft-' + hide.toLowerCase().replaceAll(' ', '-'), 'LeatherCrafter',
                { leatherType: hide, threadPerTrip: thread.carry }, [tool('Needle'), thread, banked(hide, hide === 'Hard leather' ? 26 : 24)]);
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
                if (s.allowQuests === false) return null;
                const levels = { attack: 20, strength: 20, defence: 20, hitpoints: 25 };
                if (Object.entries(levels).some(([skill, level]) => s.levels[skill] < level)) return prerequisiteCombat(s, objective, memory, random, levels);
                return questPlan(s, objective, 'druid', 'Druidic Ritual');
            }
            {
                const recipe = [...POTIONS].reverse().find(p => s.levels.herblore >= p.level && stockOf(s, p.herb) >= 14 && stockOf(s, p.secondary) >= 14) ?? POTIONS[0];
                return activity(objective, `make-${recipe.herb.toLowerCase().replaceAll(' ', '-')}-potions`, 'PotionMaker', { herb: recipe.herb, secondary: recipe.secondary }, [banked(recipe.herb, 14), banked('Vial of water', 14), banked(recipe.secondary, 14)]);
            }
        case 'runecraft': {
            if (!s.quests['Rune Mysteries Quest'] && s.allowQuests === false) return null;
            if (!s.quests['Rune Mysteries Quest']) return questPlan(s, objective, 'runemysteries', 'Rune Mysteries Quest');
            const training = ['Law rune', 'Nature rune', 'Cosmic rune', 'Fire rune', 'Earth rune', 'Water rune', 'Air rune'];
            const short = training.filter(name => stockOf(s, name) < RUNE_TARGETS[name])
                .sort((a, b) => stockOf(s, a) / RUNE_TARGETS[a] - stockOf(s, b) / RUNE_TARGETS[b]);
            for (const name of new Set([...short, ...training])) {
                const plan = runePlan(s, objective, name, memory);
                if (plan && !crowdBlocked(plan, memory, s.now)) return plan;
            }
            return null;
        }
        default:
            return null;
    }
}

function runePlan(s: LevelerSnapshot, objective: string, name: string, memory: SessionMemory): ActivityPlan | null {
    const rune = name.split(' ')[0];
    const choice = name + 's';
    const cfg = RUNES[choice];
    const level = ALTARS[name].level;
    if (s.levels.runecraft < level || !s.quests['Rune Mysteries Quest']) return null;
    const talisman = tool(rune + ' talisman');
    const needs = [talisman, banked('Rune essence', 27)];
    if (!stockOf(s, talisman.item)) {
        if (rune === 'Law') {
            if (!s.quests['Troll Stronghold'] && (s.allowQuests === false || stockOf(s, 'Coins') < 2000)) return null;
            const step = s.quests['Troll Stronghold'] ? 'quest-reclaim-law' : s.quests['Death Plateau'] ? 'quest-troll' : 'quest-death';
            if (memory.cooldowns[step] > s.now) return null;
        } else if (rune !== 'Air' && !(rune === 'Nature' && stockOf(s, 'Coins') > MIN_COIN_TARGET && s.marketItem?.(talisman) !== undefined)) return null;
    }
    if (rune === 'Cosmic') {
        const gem = stockOf(s, 'Diamond') > 0 || s.levels.crafting >= 43 && stockOf(s, 'Uncut diamond') > 0 && stockOf(s, 'Chisel') > 0;
        const exit = gem || zanarisExitNeeds(s)?.every(need => stockOf(s, need.item) >= need.count);
        if (!s.quests['Lost City'] || !stockOf(s, 'Dramen staff') || !exit) return null;
        needs.push(tool('Dramen staff'));
    }
    if (rune === 'Nature') {
        if (stockOf(s, 'Coins') < MIN_COIN_TARGET) return null;
        needs.push({ item: 'Coins', count: MIN_COIN_TARGET, carry: MIN_COIN_TARGET });
    }
    const short = !cfg || rune === 'Air';
    const plan = activity(objective, 'craft-' + rune.toLowerCase() + '-runes', short ? 'RuneCrafter' : 'JiveRC', { rune: choice, mode: 'Solo' }, needs);
    return short ? plan : { ...plan, travel: cfg.runnerBank };
}

function lawTalisman(s: LevelerSnapshot, objective: string, memory: SessionMemory, random: () => number): ActivityPlan | null {
    if (s.quests['Troll Stronghold']) return { ...activity(objective, 'quest-reclaim-law', 'ReclaimLawTalisman', {}, stockOf(s, 'Coins') >= 200 ? [{ item: 'Coins', count: 200, carry: 200 }] : []),
        label: 'Reclaim the Law talisman from Dunstan', travel: DUNSTAN_FINISH.anchor, output: tool('Law talisman') };
    if (s.allowQuests === false) return null;
    if (!s.quests['Death Plateau']) return questPlan(s, objective, 'death', 'Death Plateau');
    if (s.levels.agility < 15) {
        const plan = methodFor({ ...s, target: 15 }, 'agility', memory, random);
        return plan && { ...plan, objective, prerequisiteLevels: { agility: 15 } };
    }
    return questPlan(s, objective, 'troll', 'Troll Stronghold', true);
}

function withFood(s: LevelerSnapshot, plan: ActivityPlan): ActivityPlan {
    const food = foodFor(s);
    return { ...plan, food, needs: [...plan.needs, { item: food, count: 24, carry: 12 }] };
}

export function methodFor(s: LevelerSnapshot, objective: string, memory: SessionMemory, random: () => number): ActivityPlan | null {
    const selected = (objective === 'prayer' ? bankedPrayerPlan(s) : null) ?? selectMethod(s, objective, memory, random);
    const plan = selected && locateMethod(s, selected, memory, random);
    let next = nextMilestone(s, objective);
    if (plan?.meleeMilestone !== undefined && plan.settings.meleeStyle === objective) {
        next = Math.min(plan.meleeMilestone, next ?? plan.meleeMilestone);
    }
    return plan && next && !plan.quest && !plan.prerequisiteLevels ? { ...plan, prerequisiteLevels: { [objective]: next } } : plan;
}

function fishPlan(s: LevelerSnapshot, objective: string, recipe: typeof FISH[number]): ActivityPlan {
    const fly = recipe.tool === 'Fly fishing rod';
    const bait = fly ? consumableBatch(s, [{ item: 'Feather', count: 1 }], 200) : [];
    return activity(objective, `fish-${recipe.food.toLowerCase()}`, 'Fisher', {
        ...gatherSettings, fishMethod: recipe.method, location: recipe.location, cookMode: 'Off', baitQty: bait[0]?.carry ?? 200
    }, [tool(recipe.tool), ...bait]);
}

function cookPlan(s: LevelerSnapshot, objective: string, requested?: string): ActivityPlan {
    const available = [...FISH].reverse().filter(f => s.levels.cooking >= f.cooking);
    const food = requested ?? (available.find(f => stockOf(s, `Raw ${f.food.toLowerCase()}`) >= 28)
        ?? available.find(f => isSupplyCatch(s.levels.fishing, f) && canCatch(s, f)) ?? FISH[0])!.food;
    return activity(objective, `cook-${food.toLowerCase()}`, 'CookBot', { fish: `Raw ${food.toLowerCase()}`, location: 'Draynor', surface: 'Range' }, [banked(`Raw ${food.toLowerCase()}`)]);
}

function gatherToStock(s: LevelerSnapshot, plan: ActivityPlan, item: string): ActivityPlan {
    return bankedStockOf(s, item) < GATHERING_STOCK ? { ...plan, output: banked(item, GATHERING_STOCK) } : plan;
}

function logsPlan(s: LevelerSnapshot, objective: string, requested?: string): ActivityPlan {
    const wood = requested ? WOODS.find(w => w.item.toLowerCase() === requested.toLowerCase())!
        : [...WOODS].reverse().find(w => w.level <= 30 && s.levels.woodcutting >= w.level)!;
    const plan = activity(objective, `gather-${wood.item.toLowerCase().replaceAll(' ', '-')}`, 'Woodcutter', {
        ...gatherSettings, treeName: wood.tree, location: wood.location, burnMode: 'Off'
    }, [gatheringTool(s, 'axe')]);
    return gatherToStock(s, plan, wood.item);
}

function orePlan(s: LevelerSnapshot, objective: string, ore: string): ActivityPlan {
    const location = ore === 'Coal' ? s.levels.mining >= 60 ? 'Mining Guild' : 'Barbarian Village' : 'Southeast Varrock Mine';
    const plan = activity(objective, `mine-${ore.toLowerCase()}`, 'Miner', { ...gatherSettings, rocks: [ore], location }, [gatheringTool(s, 'pickaxe')]);
    return gatherToStock(s, plan, ore === 'Coal' ? ore : ore + ' ore');
}

function smeltPlan(objective: string, metal = 'Bronze'): ActivityPlan {
    const needs = metal === 'Steel' ? [banked('Iron ore', 9), { ...banked('Coal', 18), minimum: 2 }]
        : metal === 'Iron' ? [banked('Iron ore')] : [banked('Copper ore', 14), banked('Tin ore', 14)];
    return activity(objective, `smelt-${metal.toLowerCase()}`, 'SmelterBot', { bar: metal }, needs);
}

export function producer(s: LevelerSnapshot, objective: string, need: Requirement, memory: SessionMemory, random: () => number, onBlocked?: (reason: string) => void): ActivityPlan | null {
    let plan: ActivityPlan | null;
    const herb = HERBS.find(herb => herb.name.toLowerCase() === need.item.toLowerCase() && herb.unidId < 300 && herb.level <= s.levels.herblore);
    if (herb) return { ...activity(objective, `clean-${herb.key}`, 'HerbCleaner', { herbs: [herb.name] }, [banked(`#${herb.unidId}`, Math.max(1, need.count - stockOf(s, herb.name)))]), output: { item: need.item, count: need.count } };
    if (HERBS.some(herb => `#${herb.unidId}` === need.item && herb.unidId < 300)) {
        const druids = ['#209', '#213'].includes(need.item) ? combatPlan(s, objective, memory, random, need.item, 'Chaos druid') : null;
        const hunt = druids ?? combatPlan(s, objective, memory, random, need.item);
        return hunt ? { ...hunt, output: { item: need.item, count: need.count } } : null;
    }
    switch (need.item.toLowerCase()) {
        case 'law talisman': return lawTalisman(s, objective, memory, random);
        case 'law rune': case 'nature rune': case 'cosmic rune': case 'fire rune': case 'earth rune': case 'water rune': case 'air rune':
            plan = runePlan(s, objective, need.item[0].toUpperCase() + need.item.slice(1).toLowerCase(), memory);
            break;
        case 'chaos rune': {
            if (!canStealChaos(s)) return null;
            const food = foodFor(s);
            plan = { ...activity(objective, 'pickpocket-paladins', 'Thiever', {
                target: 'Paladin', action: 'Pickpocket', banking: 'Auto', food, foodWithdraw: 12, suicide: false, loadout: ''
            }, [{ item: food, count: 24, carry: 12 }]), food };
            break;
        }
        case 'shrimps': case 'trout': case 'salmon': case 'lobster': case 'swordfish': case 'shark':
            plan = s.levels.cooking >= FISH.find(f => f.food.toLowerCase() === need.item.toLowerCase())!.cooking ? cookPlan(s, objective, need.item) : null;
            break;
        case 'raw shrimps': case 'raw trout': case 'raw salmon': case 'raw lobster': case 'raw swordfish': case 'raw shark': {
            const fish = FISH.find(f => `raw ${f.food.toLowerCase()}` === need.item.toLowerCase())!;
            const eligible = objective === 'supplies' ? s.levels.fishing >= fish.level : isSupplyCatch(s.levels.fishing, fish);
            plan = eligible ? fishPlan(s, objective, fish) : null;
            break;
        }
        case 'logs': case 'oak logs': case 'willow logs': case 'maple logs': case 'yew logs':
            plan = s.levels.woodcutting >= WOODS.find(w => w.item.toLowerCase() === need.item.toLowerCase())!.level ? logsPlan(s, objective, need.item) : null;
            break;
        case 'copper ore': plan = orePlan(s, objective, 'Copper'); break;
        case 'tin ore': plan = orePlan(s, objective, 'Tin'); break;
        case 'iron ore': plan = s.levels.mining >= 30 ? orePlan(s, objective, 'Iron') : null; break;
        case 'coal': plan = s.levels.mining >= 30 ? orePlan(s, objective, 'Coal') : null; break;
        case 'iron bar': plan = s.levels.smithing >= 15 ? smeltPlan(objective, 'Iron') : null; break;
        case 'steel bar': plan = s.levels.smithing >= 30 ? smeltPlan(objective, 'Steel') : null; break;
        case 'bronze bar': plan = smeltPlan(objective); break;
        case 'diamond':
            plan = s.levels.crafting >= 43 ? activity(objective, 'cut-diamond', 'GemCutter', { gems: ['Diamond'] }, [tool('Chisel'), banked('Uncut diamond', 1)]) : null;
            break;
        case 'uncut diamond':
            plan = combatPlan(s, objective, memory, random, 'Uncut diamond');
            break;
        case 'limpwurt root':
            plan = combatPlan(s, objective, memory, random, need.item, 'Hobgoblin') ?? combatPlan(s, objective, memory, random, need.item, 'Giant');
            break;
        case 'unicorn horn':
            plan = combatPlan(s, objective, memory, random, 'Unicorn horn');
            break;
        case 'unicorn horn dust':
            plan = activity(objective, 'grind-unicorn-horns', 'HerbloreSecondaries', { secondary: 'Unicorn horn dust', foodWithdraw: 0, loadout: '' }, [tool('Pestle and mortar'), banked('Unicorn horn', 27)]);
            break;
        case 'superantipoison(3)':
            plan = s.levels.herblore >= 48 ? activity(objective, 'make-superantipoison', 'PotionMaker', { herb: 'Irit leaf', secondary: 'Unicorn horn dust' },
                [banked('Irit leaf', 14), banked('Unicorn horn dust', 14), banked('Vial of water', 14)]) : null;
            break;
        case 'hard leather':
            plan = activity(objective, 'tan-hard-leather', 'TannerBot', { hideType: 'Hard leather', buyThread: false, coinsPerTrip: 100 }, [banked('Cow hide', 26), { item: 'Coins', count: 100, carry: 100 }]);
            break;
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
    plan = plan ? locateMethod(s, plan, memory, random, onBlocked) : null;
    if (!plan || plan.prerequisiteLevels) return plan;
    const count = banksGatheredResource(plan) ? Math.max(GATHERING_STOCK, need.count) : need.count;
    return { ...plan, output: { item: need.item, count } };
}
