import { purchaseBudget, supplyOffer } from './offers.js';
import { stockOf, type LevelerSnapshot } from './types.js';

export const WOODS = [
    { level: 1, item: 'Logs', tree: 'Tree', location: 'Draynor (trees)' },
    { level: 15, item: 'Oak logs', tree: 'Oak', location: 'Draynor Oaks' },
    { level: 30, item: 'Willow logs', tree: 'Willow', location: 'Draynor Willows' }
] as const;

export const FLETCHING = [
    { level: 1, item: 'Logs', product: 'Arrow shafts' },
    { level: 5, item: 'Logs', product: 'Short bow' },
    { level: 10, item: 'Logs', product: 'Long bow' },
    { level: 20, item: 'Oak logs', product: 'Short bow' },
    { level: 25, item: 'Oak logs', product: 'Long bow' },
    { level: 35, item: 'Willow logs', product: 'Short bow' },
    { level: 40, item: 'Willow logs', product: 'Long bow' }
] as const;

export const FISH = [
    { level: 1, cooking: 1, food: 'Shrimps', method: 'Small net — shrimp/anchovy', location: 'Draynor Village', tool: 'Small fishing net' },
    { level: 20, cooking: 15, food: 'Trout', method: 'Fly fishing — trout/salmon', location: 'Barbarian Village', tool: 'Fly fishing rod' },
    { level: 30, cooking: 25, food: 'Salmon', method: 'Fly fishing — trout/salmon', location: 'Barbarian Village', tool: 'Fly fishing rod' },
    { level: 40, cooking: 40, food: 'Lobster', method: 'Lobster cage — lobster', location: 'Catherby', tool: 'Lobster pot' }
] as const;

export const MILESTONES: Record<string, readonly number[]> = {
    thieving: [10], herblore: [5, 12, 22, 30, 38],
    mining: [6, 21, 30, 31, 41], woodcutting: [15, 30], fishing: [20, 30, 40], cooking: [15, 25, 40],
    firemaking: [15, 30], fletching: [5, 10, 20, 25, 35, 40], smithing: [15, 30],
    attack: [5, 20, 30, 40], defence: [5, 20, 30, 40], ranged: [5, 20, 30, 40], magic: [5, 9, 13, 17, 23, 29, 35]
};

export function canSourceWood(s: LevelerSnapshot, item: string): boolean {
    const wood = WOODS.find(w => w.item === item);
    return stockOf(s, item) >= 28 || !!wood && s.levels.woodcutting >= wood.level;
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
    { level: 38, herb: 'Ranarr weed', secondary: 'Snape grass' }
] as const;

export function smithProduct(level: number, metal: string): string {
    const offset = metal === 'Iron' ? 15 : 0;
    return level >= 18 + offset ? 'Platebody' : level >= 14 + offset ? '2h sword' : level >= 5 + offset ? 'Scimitar' : 'Dagger';
}

export function canCatch(s: LevelerSnapshot, fish: typeof FISH[number]): boolean {
    if (s.levels.fishing < fish.level) return false;
    const needs = [{ item: fish.tool, count: 1 }, ...(fish.tool === 'Fly fishing rod' ? [{ item: 'Feather', count: 200 }] : [])];
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
