import { DRAGONHIDE_SLOTS, DRAGONHIDE_TIERS } from '../../data/dragonhide.js';

export interface MarketSet {
    name: string;
    itemIds: readonly number[];
}

const SETS: Readonly<Record<string, MarketSet>> = {
    rune: { name: 'Rune set', itemIds: [1163, 1127, 1079] },
    adamant: { name: 'Adamant set', itemIds: [1161, 1123, 1073] },
    mithril: { name: 'Mithril set', itemIds: [1159, 1121, 1071] },
    black: { name: 'Black set', itemIds: [1165, 1125, 1077] },
    steel: { name: 'Steel set', itemIds: [1157, 1119, 1069] },
    ...Object.fromEntries<MarketSet>(DRAGONHIDE_TIERS.map(tier => [
        `${tier.colour.toLowerCase()} dragonhide`,
        { name: `${tier.colour} dragonhide set`, itemIds: DRAGONHIDE_SLOTS.map(slot => tier[slot]) }
    ])),
    leather: { name: 'Leather set', itemIds: [1129, 1095, 1063] },
    super: { name: 'Super set', itemIds: [157, 145, 163] }
};

export function resolveSet(query: string): MarketSet | null {
    const key = query.toLowerCase().trim().replace(/\s+/g, ' ')
        .replace(/^addy\b/, 'adamant')
        .replace(/^mith\b/, 'mithril')
        .replace(/\bd[' -]?hide\b/, 'dragonhide');
    const match = /^(.+) sets?$/.exec(key);
    return match && Object.hasOwn(SETS, match[1]) ? SETS[match[1]] : null;
}

export function setVariants(set: MarketSet): readonly MarketSet[] {
    return set === SETS.rune ? [set, { name: 'Rune set (plateskirt)', itemIds: [1163, 1127, 1093] }] : [set];
}
