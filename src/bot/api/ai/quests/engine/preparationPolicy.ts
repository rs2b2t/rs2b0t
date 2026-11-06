import { FOOD_FLOAT } from '../food.js';
import { TOURIST_TRAP_FOOD_TARGET } from '../defs/touristtrapSupplies.js';
import { ITEM_DB } from '../../../../data/itemdb.js';
import { UNTRADEABLE_IDS } from '../../../../data/untradeable.js';
import type { QuestPreparationRequest } from './preparationTypes.js';
import type { QuestModule, QuestSnapshot } from './types.js';

type Supply = { item: string; count: number };
const supplies = (...items: (string | [string, number])[]): Supply[] => items.map(item =>
    typeof item === 'string' ? { item, count: 1 } : { item: item[0], count: item[1] });

const SUPPLIES: Readonly<Record<string, readonly Supply[]>> = {
    elemental_workshop: supplies('Hammer', 'Thread'),
    priestperil: supplies('Bronze pickaxe'),
    death: supplies(['Bread', 10], ['Trout', 10], 'Iron bar'),
    itwatchtower: supplies('Guam leaf', 'Bat bones', 'Gold bar'),
    tbwt: supplies('Small fishing net', 'Seaweed', 'Agility potion(4)'),
    upass: supplies(['Bronze arrow', 50], 'Tinderbox', 'Spade', 'Bucket'),
    regicide: supplies('Spade'),
    legends: supplies('Rune axe', 'Lockpick', 'Unpowered orb', ['Cosmic rune', 3], ['Prayer potion(4)', 3])
};
const FOOD_COUNTS: Readonly<Record<string, number>> = {
    squire: 8, haunted: 8, hunt: 8, blackarmgang: 8, gobdip: 8, demon: 8,
    blackknight: 8, druid: 8, zanaris: 8, itwatchtower: 8, junglepotion: 8,
    tbwt: 8, zombiequeen: 8, elemental_workshop: 8, troll: 8, eadgar: 8,
    biohazard: 8, crest: 10, horror: 8, chompybird: 6, upass: 8,
    regicide: 8, viking: 8, hero: 8, legends: 9
};
const FIXED_FOOD: Readonly<Record<string, string>> = {
    upass: 'Lobster', regicide: 'Shark'
};
const FOOD_CHOICES: Readonly<Record<string, readonly string[]>> = {
    crest: ['Lobster', 'Shark', 'Trout', 'Herring'],
    legends: ['Lobster', 'Shark', 'Swordfish', 'Tuna'],
    ikov: ['Lobster', 'Swordfish', 'Tuna'],
    elemental_workshop: ['Lobster', 'Swordfish', 'Salmon', 'Trout']
};
const MATERIAL_FOOD: Readonly<Record<string, readonly string[]>> = {
    death: ['bread', 'trout'], crest: ['tuna', 'bass', 'salmon', 'shrimps', 'swordfish'],
    tbwt: ['banana', 'sliced banana', 'raw karambwan', 'karambwan', 'poorly cooked karambwan'],
    regicide: ['cooked rabbit']
};
const FISH = [
    ['Swordfish', 50, 45], ['Bass', 46, 43], ['Tuna', 35, 30], ['Salmon', 30, 25], ['Shrimps', 1, 1]
] as const;
const PROTECT = { melee: 43, missiles: 40, magic: 37 };
const ORDINARY_SUPPLIES = new Set(['coins', ...Object.values(SUPPLIES).flat().map(item => item.item.toLowerCase())]);

function ordinaryItem(name: string): boolean {
    if (ORDINARY_SUPPLIES.has(name.toLowerCase())) return true;
    const matches = ITEM_DB.filter(item => item.name.toLowerCase() === name.toLowerCase());
    return matches.length === 1 && !UNTRADEABLE_IDS.includes(matches[0]!.id);
}

export function questFoodRequest(module: QuestModule, configured: string | null): QuestPreparationRequest['food'] {
    const id = module.record.id;
    if (id === 'waterfall') return undefined;
    if (id === 'desertrescue') return configured?.trim() ? { item: configured.trim(), count: TOURIST_TRAP_FOOD_TARGET } : undefined;
    const count = FOOD_COUNTS[id] ?? module.food ?? (module.sustain ? FOOD_FLOAT : 0);
    if (count <= 0) return undefined;
    const choices = FOOD_CHOICES[id];
    const forbidden = MATERIAL_FOOD[id] ?? [];
    const preferred = configured?.trim();
    const accepted = preferred && !forbidden.includes(preferred.toLowerCase())
        && (!choices || choices.some(item => item.toLowerCase() === preferred.toLowerCase()));
    const item = FIXED_FOOD[id] ?? (accepted ? preferred : choices?.[0] ?? module.sustain?.foods
        .find(name => !forbidden.includes(name.toLowerCase())) ?? 'Trout');
    return { item, count };
}

export function questPreparationRequest(
    module: QuestModule,
    foodName: string | null,
    status: QuestSnapshot['journal'],
    stock: ReadonlyMap<string, number> = new Map(),
    stockIds?: ReadonlyMap<number, number>
): QuestPreparationRequest | null {
    if (status === 'unknown' || status === 'complete') return null;
    const id = module.record.id;
    if (id === 'desertrescue' && status === 'inProgress') return null;
    const levels = new Map<string, number>();
    const skill = (name: string, level: number): void => { levels.set(name, Math.max(levels.get(name) ?? 0, level)); };
    const count = (name: string): number => stock.get(name.toLowerCase()) ?? 0;
    const has = (...names: string[]): boolean => names.some(name => count(name) > 0);
    for (const requirement of module.record.requirements.skills ?? []) skill(requirement.skill, requirement.level);
    if (module.pray && id !== 'troll') skill('prayer', PROTECT[module.pray.protect]);
    if (id === 'upass') skill('ranged', 25);
    const items: Supply[] = [];
    if (status === 'notStarted') {
        const required = module.record.items.filter(item => item.kind === 'mustHave' && ordinaryItem(item.name))
            .map(item => ({ item: item.name, count: item.qty }));
        for (const supply of [...SUPPLIES[id] ?? [], ...required]) {
            if (supply.item === 'Bronze pickaxe' && [...stock].some(([name, qty]) => qty > 0 && name.endsWith('pickaxe'))) continue;
            if (supply.item.endsWith('potion(4)')) {
                const base = supply.item.slice(0, -3);
                const doses = [1, 2, 3, 4].reduce((total, dose) => total + count(`${base}(${dose})`) * dose, 0);
                if (doses >= supply.count * 4) continue;
            }
            const existing = items.find(item => item.item.toLowerCase() === supply.item.toLowerCase());
            if (existing) existing.count = Math.max(existing.count, supply.count);
            else items.push({ ...supply });
        }
        if (id === 'squire' && count('Iron bar') < 2) {
            skill('smithing', 15);
            if (count('Iron ore') < 2 - count('Iron bar')) skill('mining', 15);
        }
        if (id === 'elemental_workshop' && count('Coal') < 4) skill('mining', 30);
        if (id === 'druidspirit' && !has('Silver sickle', 'Silver sickle(b)', 'Silver bar')) {
            skill('smithing', 20);
            if (!has('Silver ore')) skill('mining', 20);
        }
        if (id === 'chompybird') skill('crafting', 5);
        if (id === 'tbwt') skill('firemaking', 30);
        if (id === 'regicide' && count('Coal') < 12) skill('mining', 30);
        if (id === 'dragon') {
            if (!has('Unfired bowl')) skill('crafting', 8);
            if (count('Nails') < 12) {
                skill('smithing', 34);
                const bars = Math.max(0, Math.ceil((12 - count('Nails')) / 2) - count('Steel bar'));
                if (count('Iron ore') < bars) skill('mining', 15);
                if (count('Coal') < bars * 2) skill('mining', 30);
            }
        }
        if (id === 'crest') {
            for (const [fish, fishing, cooking] of FISH) {
                if (has(fish)) continue;
                skill('cooking', cooking);
                if (!has(`Raw ${fish}`)) skill('fishing', fishing);
            }
        }
        const bowReady = stockIds ? (stockIds.get(857) ?? 0) > 0 : has('Yew shortbow');
        if (id === 'ikov' && !bowReady) {
            skill('fletching', 65);
            const stave = stockIds ? (stockIds.get(68) ?? 0) > 0 : has('Yew shortbow (u)');
            if (!stave && !has('Yew logs')) skill('woodcutting', 60);
            if (!has('Bow string')) skill('crafting', 10);
        }
        if (id === 'hero') {
            if (!has('Ice gloves', 'Fire feather')) skill('mining', 50);
            if (!has('Lava eel')) skill('cooking', 53);
            if (!has('Lava eel', 'Raw lava eel')) {
                skill('fishing', 53);
                if (!has('Oily fishing rod', 'Blamish oil')) skill('herblore', 25);
            }
        }
    }
    const food = questFoodRequest(module, foodName);
    const skills = [...levels].map(([name, level]) => ({ skill: name, level }));
    return {
        ...(skills.length ? { skills } : {}),
        ...(items.length ? { items } : {}),
        ...(food ? { food } : {})
    };
}
