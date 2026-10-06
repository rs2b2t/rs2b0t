import { cookLocation } from '../../api/cooking/CookLocations.js';
import { FIRE_SPOTS } from '../../api/firemaking/Firemaking.js';
import { FISHING_LOCATIONS } from '../../data/fishingLocations.js';
import type { GatheringLocation } from '../../data/gatheringLocations.js';
import { MINING_LOCATIONS } from '../../data/miningLocations.js';
import { WOODCUTTING_LOCATIONS } from '../../data/woodcuttingLocations.js';
import Tile from '../../geometry/Tile.js';
import { stockOf, type ActivityPlan, type LevelerSnapshot, type SessionMemory } from './types.js';

interface Site { name: string; settings: Record<string, unknown>; travel: Tile; members?: boolean }

function travelFood(s: LevelerSnapshot): string | undefined {
    return ['Lobster', 'Salmon', 'Trout', 'Shrimps'].find(food => stockOf(s, food) >= 12);
}

export function membersReady(s: LevelerSnapshot): boolean {
    return ['attack', 'strength', 'defence'].every(skill => s.levels[skill] >= 20)
        && s.levels.hitpoints >= 25 && stockOf(s, 'Coins') >= 200 && travelFood(s) !== undefined;
}

function gather(name: string, locations: readonly GatheringLocation[], members = false): Site {
    const location = locations.find(location => location.name === name)!;
    return { name, settings: { location: name }, travel: location.bankStand, members };
}

function sites(plan: ActivityPlan): Site[] {
    switch (plan.script) {
        case 'Woodcutter': {
            const suffix = ({ Tree: '(trees)', Oak: 'Oaks', Willow: 'Willows' } as Record<string, string>)[String(plan.settings.treeName)];
            return suffix ? [gather(`Seers ${suffix}`, WOODCUTTING_LOCATIONS, true), gather(`Draynor ${suffix}`, WOODCUTTING_LOCATIONS)] : [];
        }
        case 'Fisher':
            if (String(plan.settings.fishMethod).startsWith('Fly fishing')) return [gather('Seers (fly fishing)', FISHING_LOCATIONS, true), gather('Barbarian Village', FISHING_LOCATIONS)];
            if (String(plan.settings.fishMethod).startsWith('Lobster cage')) return [gather('Catherby', FISHING_LOCATIONS, true)];
            return [gather('Draynor Village', FISHING_LOCATIONS)];
        case 'Miner':
            return [...(Array.isArray(plan.settings.rocks) && plan.settings.rocks.includes('Iron') ? [gather('Fight Arena Mine', MINING_LOCATIONS, true)] : []),
                gather('Southeast Varrock Mine', MINING_LOCATIONS), gather('Rimmington Mine', MINING_LOCATIONS)];
        case 'CookBot':
            return ['Catherby', 'Seers', 'Draynor'].map(name => ({ name, settings: { location: name }, travel: cookLocation(name)!.bank.tile, members: name !== 'Draynor' }));
        case 'Firemaker':
            return ['Seers', 'Varrock East', 'Varrock West', 'Draynor'].map(name => ({ name, settings: { location: name }, travel: Tile.from(FIRE_SPOTS[name].bank), members: name === 'Seers' }));
        case 'SmelterBot':
            return [
                { name: 'Ardougne', settings: { bankStand: new Tile(2655, 3283, 0), furnaceStand: new Tile(2600, 3310, 0) }, travel: new Tile(2655, 3283, 0), members: true },
                { name: 'Al Kharid', settings: { bankStand: new Tile(3269, 3167, 0), furnaceStand: new Tile(3275, 3185, 0) }, travel: new Tile(3269, 3167, 0) }
            ];
        case 'Thiever':
            if (plan.settings.target === 'Warrior woman') return [{ name: 'Ardougne warrior women', settings: {}, travel: new Tile(2629, 3295, 0), members: true }];
            if (plan.settings.target === 'Farmer') return [
                { name: 'Ardougne farm', settings: {}, travel: new Tile(2645, 3367, 0), members: true },
                { name: 'Lumbridge farm', settings: {}, travel: new Tile(3227, 3290, 0) }
            ];
            return [{ name: 'Seers village', settings: {}, travel: new Tile(2694, 3497, 0), members: true },
                { name: 'Lumbridge', settings: {}, travel: new Tile(3221, 3219, 0) }];
        case 'SmithingBot': return [{ name: 'Varrock West', settings: {}, travel: new Tile(3185, 3440, 0) }];
        case 'TannerBot': return [{ name: 'Al Kharid', settings: {}, travel: new Tile(3269, 3167, 0) }];
        case 'RuneCrafter': return [{ name: 'Falador East', settings: {}, travel: new Tile(3013, 3355, 0) }];
        case 'EssMiner': return [{ name: 'Varrock East', settings: {}, travel: new Tile(3251, 3420, 0) }];
        case 'AIOQuester': return [{ name: 'Varrock East', settings: {}, travel: new Tile(3253, 3420, 0) }];
        default: return [];
    }
}

function transit(plan: ActivityPlan, food?: string): ActivityPlan {
    const coins = plan.needs.find(need => need.item === 'Coins');
    const meals = plan.needs.find(need => need.item === food || need.item === plan.food);
    const needs = plan.needs.filter(need => need.item !== 'Coins' && (!food || (need.item !== food && need.item !== plan.food)));
    const carriedFood = food ? [{ item: food, count: Math.max(12, meals?.count ?? 0), carry: Math.max(12, meals?.carry ?? 0) }] : [];
    const fare = { item: 'Coins', count: Math.max(200, coins?.count ?? 0), carry: Math.max(200, coins?.carry ?? 0) };
    return { ...plan, ...(food ? { food } : {}), needs: [...needs, ...carriedFood, fare],
        settings: { ...plan.settings, ...(food && typeof plan.settings.food === 'string' ? { food } : {}) } };
}

export function locateMethod(s: LevelerSnapshot, input: ActivityPlan, memory: SessionMemory, random: () => number): ActivityPlan | null {
    if (input.script === 'GnomeCourse' || input.script === 'FlaxAIO') return {
        ...input, travel: input.script === 'GnomeCourse' ? new Tile(2474, 3436, 0) : new Tile(2725, 3493, 0),
        needs: [...input.needs, { item: 'Coins', count: 200, carry: 200 }]
    };
    const ready = membersReady(s);
    const plan = input.script === 'Thiever' && s.levels.thieving >= 25 && ready
        ? { ...input, id: 'pickpocket-warrior-women', label: 'pickpocket warrior women', settings: { ...input.settings, target: 'Warrior woman' } } : input;
    const options = sites(plan);
    if (!options.length) return plan;
    const candidates = options.filter(site => !site.members || ready).map(site => {
        const original = !site.members && (site.settings.location === plan.settings.location || plan.script === 'SmelterBot');
        return { site, id: original ? plan.id : `${plan.id}-${site.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/-$/, '')}` };
    });
    if (!candidates.length) return null;
    const active = candidates.filter(candidate => (memory.cooldowns[candidate.id] ?? 0) <= s.now);
    const available = active.length ? active : candidates;
    const fresh = available.filter(candidate => !memory.recent.slice(-3).includes(candidate.id));
    const choices = fresh.length ? fresh : available;
    const chosen = choices[Math.min(choices.length - 1, Math.floor(Math.max(0, random()) * choices.length))];
    const located = { ...plan, id: chosen.id, label: `${plan.label} at ${chosen.site.name}`, travel: chosen.site.travel,
        settings: { ...plan.settings, ...chosen.site.settings } };
    return stockOf(s, 'Coins') >= 200 ? transit(located, travelFood(s)) : located;
}
