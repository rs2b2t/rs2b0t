import { AXES, PICKAXES } from '../../api/acquisition/Tools.js';
import { purchaseBudget, supplyOffer } from './offers.js';
import { requirementKey, type LevelerSnapshot, type Requirement } from './types.js';

interface Choice { item: string; level: number; id?: number; quest?: string }
const metals = [{ item: 'Rune', level: 40 }, { item: 'Adamant', level: 30 }, { item: 'Mithril', level: 20 },
    { item: 'Black', level: 10 }, { item: 'Steel', level: 5 }, { item: 'Iron', level: 1 }, { item: 'Bronze', level: 1 }];
const bows: Choice[] = [
    { item: 'Magic shortbow', id: 861, level: 50 }, { item: 'Magic longbow', id: 859, level: 50 },
    { item: 'Yew shortbow', id: 857, level: 40 }, { item: 'Yew longbow', id: 855, level: 40 },
    { item: 'Maple shortbow', id: 853, level: 30 }, { item: 'Maple longbow', id: 851, level: 30 },
    { item: 'Willow shortbow', id: 849, level: 20 }, { item: 'Willow longbow', id: 847, level: 20 },
    { item: 'Oak shortbow', id: 843, level: 5 }, { item: 'Oak longbow', id: 845, level: 5 },
    { item: 'Shortbow', id: 841, level: 1 }, { item: 'Longbow', id: 839, level: 1 }
];

function cost(s: LevelerSnapshot, level: number, choice: Choice): number {
    if (level < choice.level || (choice.quest && !s.quests[choice.quest])) return Infinity;
    const key = requirementKey({ ...choice, count: 1 }).toLowerCase();
    if ((s.stock[key] ?? 0) > 0) return 0;
    if (s.unavailableItems?.some(item => item.toLowerCase() === key || item.toLowerCase() === choice.item.toLowerCase())) return Infinity;
    const offer = supplyOffer(choice.item);
    return offer ? purchaseBudget(offer, 1) : Infinity;
}

function choose(s: LevelerSnapshot, level: number, choices: readonly Choice[], fallback: Choice, coins: number): Requirement {
    const selected = choices.find(choice => {
        const price = cost(s, level, choice);
        return price === 0 || price <= coins - 200;
    }) ?? fallback;
    return { item: selected.item, ...(selected.id === undefined ? {} : { id: selected.id }), count: 1, carry: 1 };
}

export function gatheringTool(s: LevelerSnapshot, kind: 'axe' | 'pickaxe'): Requirement {
    const tiers = (kind === 'axe' ? AXES : PICKAXES).map(tier => ({ item: tier.name, level: tier.level }));
    return choose(s, s.levels[kind === 'axe' ? 'woodcutting' : 'mining'], tiers, tiers[tiers.length - 1], s.stock.coins ?? 0);
}

export function meleeEquipment(s: LevelerSnapshot): Requirement[] {
    let coins = s.stock.coins ?? 0;
    const slots: { level: number; choices: Choice[]; fallback: Choice }[] = [
        { level: s.levels.attack, choices: metals.map(metal => ({ ...metal, item: `${metal.item} scimitar` })), fallback: { item: 'Iron scimitar', level: 1 } },
        { level: s.levels.defence, choices: metals.flatMap(metal => [
            { ...metal, item: `${metal.item} platebody`, ...(metal.item === 'Rune' ? { quest: 'Dragon Slayer' } : {}) },
            { ...metal, item: `${metal.item} chainbody` }
        ]), fallback: { item: 'Iron chainbody', level: 1 } },
        { level: s.levels.defence, choices: metals.flatMap(metal => [
            { ...metal, item: `${metal.item} platelegs` }, { ...metal, item: `${metal.item} plateskirt` }
        ]), fallback: { item: 'Iron platelegs', level: 1 } }
    ];
    const kit = slots.map((slot, index) => {
        const remaining = slots.slice(index + 1).reduce((sum, next) => {
            const minimum = Math.min(...next.choices.map(choice => cost(s, next.level, choice)));
            return sum + (Number.isFinite(minimum) ? minimum : 0);
        }, 0);
        const need = choose(s, slot.level, slot.choices, slot.fallback, coins - remaining);
        if (!(s.stock[requirementKey(need).toLowerCase()] > 0)) {
            const offer = supplyOffer(need.item);
            if (offer) coins -= purchaseBudget(offer, 1);
        }
        return { ...need, equip: true };
    });
    const helmet = metals.flatMap(metal => [
        { ...metal, item: `${metal.item} full helm` }, { ...metal, item: `${metal.item} med helm` }
    ]).find(choice => {
        const price = cost(s, s.levels.defence, choice);
        return price === 0 || price <= coins - 200;
    });
    if (helmet) kit.push({ item: helmet.item, count: 1, carry: 1, equip: true });
    return kit;
}

export function rangedBow(s: LevelerSnapshot): Requirement {
    return { ...choose(s, s.levels.ranged, bows, { item: 'Shortbow', id: 841, level: 1 }, s.stock.coins ?? 0), equip: true };
}
