import { ITEM_DB } from '../../data/itemdb.js';

/** High Level Alchemy pays 60% of an item's shop cost. */
const ALCH_RATE = 0.6;

export interface AlchItem {
    /** Stable settings key, the obj name from the item database. */
    key: string;
    id: number;
    /** The name the client shows, which several dragonhide variants share. */
    name: string;
    /** Chip and paint label, unique even where {@link name} is not. */
    label: string;
    alchValue: number;
}

// Why: green, blue, red and black dragonhide all read as "Dragonhide body" in the client, so a
// Why: by-name withdraw takes whichever sits earliest in the bank. Every item is chosen by id, and
// Why: the label is what the chip and the paint show.
const FODDER: { obj: string; label?: string }[] = [
    { obj: 'maple_longbow' },
    { obj: 'yew_longbow' },
    { obj: 'magic_longbow' },

    { obj: 'steel_platebody' },
    { obj: 'steel_platelegs' },
    { obj: 'steel_2h_sword' },
    { obj: 'black_platebody' },
    { obj: 'mithril_platebody' },
    { obj: 'mithril_platelegs' },
    { obj: 'mithril_kiteshield' },
    { obj: 'mithril_2h_sword' },
    { obj: 'adamant_platebody' },
    { obj: 'adamant_platelegs' },
    { obj: 'adamant_kiteshield' },
    { obj: 'adamant_2h_sword' },
    { obj: 'rune_platebody' },
    { obj: 'rune_platelegs' },
    { obj: 'rune_kiteshield' },
    { obj: 'rune_chainbody' },
    { obj: 'rune_full_helm' },
    { obj: 'rune_sq_shield' },
    { obj: 'rune_scimitar' },
    { obj: 'rune_2h_sword' },

    { obj: 'dragonhide_body', label: "Green d'hide body" },
    { obj: 'blue_dragonhide_body', label: "Blue d'hide body" },
    { obj: 'red_dragonhide_body', label: "Red d'hide body" },
    { obj: 'black_dragonhide_body', label: "Black d'hide body" },
    { obj: 'dragonhide_chaps', label: "Green d'hide chaps" },
    { obj: 'blue_dragonhide_chaps', label: "Blue d'hide chaps" },
    { obj: 'red_dragonhide_chaps', label: "Red d'hide chaps" },
    { obj: 'black_dragonhide_chaps', label: "Black d'hide chaps" },

    { obj: 'battlestaff' },
    { obj: 'air_battlestaff' },
    { obj: 'water_battlestaff' },
    { obj: 'earth_battlestaff' },
    { obj: 'fire_battlestaff' }
];

export const ALCH_FODDER_OBJS: readonly string[] = FODDER.map(f => f.obj);

/** The chip that pulls in whatever the custom field names. */
export const CUSTOM_ALCH_KEY = 'custom';

const richestFirst = (a: AlchItem, b: AlchItem): number => b.alchValue - a.alchValue || a.label.localeCompare(b.label);

export const ALCH_ITEMS: readonly AlchItem[] = FODDER
    .flatMap(({ obj, label }) => {
        const rec = ITEM_DB.find(r => r.obj === obj);
        return rec ? [{ key: obj, id: rec.id, name: rec.name, label: label ?? rec.name, alchValue: Math.floor(rec.cost * ALCH_RATE) }] : [];
    })
    .sort(richestFirst);

export const ALCH_OPTIONS: string[] = [CUSTOM_ALCH_KEY, ...ALCH_ITEMS.map(i => i.key)];

export const ALCH_OPTION_LABELS: Record<string, string> = {
    [CUSTOM_ALCH_KEY]: 'Custom item (named below)',
    ...Object.fromEntries(ALCH_ITEMS.map(i => [i.key, `${i.label} (${i.alchValue.toLocaleString()})`]))
};

function fold(s: string): string {
    return s.trim().toLowerCase().replace(/[\s_]+/g, ' ');
}

// Why: the field takes the obj name or the client name, and several items share a client name, so the obj name is the precise form and the first database match settles the rest.
/** The item the custom field names, or null when the database has no such item. */
export function customAlchItem(text: string): AlchItem | null {
    const wanted = fold(text);
    if (wanted === '') {
        return null;
    }
    const known = ALCH_ITEMS.find(i => fold(i.key) === wanted || fold(i.label) === wanted);
    if (known) {
        return known;
    }
    const rec = ITEM_DB.find(r => fold(r.obj) === wanted) ?? ITEM_DB.find(r => fold(r.name) === wanted);
    if (!rec) {
        return null;
    }
    return ALCH_ITEMS.find(i => i.id === rec.id)
        ?? { key: rec.obj, id: rec.id, name: rec.name, label: rec.name, alchValue: Math.floor(rec.cost * ALCH_RATE) };
}

/** Yew and magic longbows, steel platebodies and the dragonhide armour. */
export const DEFAULT_ALCH_ITEMS: string[] = [
    'black_dragonhide_body',
    'red_dragonhide_body',
    'blue_dragonhide_body',
    'dragonhide_body',
    'black_dragonhide_chaps',
    'red_dragonhide_chaps',
    'blue_dragonhide_chaps',
    'dragonhide_chaps',
    'magic_longbow',
    'steel_platebody',
    'yew_longbow'
];

export function alchItem(key: string): AlchItem | null {
    const wanted = key.trim().toLowerCase();
    return ALCH_ITEMS.find(i => i.key === wanted) ?? null;
}

// Why: the chip control emits option order rather than click order, so table order is the drain priority; with the custom chip ticked an unresolved name selects nothing, so a typo stops the run instead of alching the defaults.
/** The ticked items plus the custom one, richest first. */
export function selectedAlchItems(keys: readonly string[], customText = ''): AlchItem[] {
    const wanted = new Set(keys.map(k => k.trim().toLowerCase()));
    const picked = ALCH_ITEMS.filter(i => wanted.has(i.key));
    if (!wanted.has(CUSTOM_ALCH_KEY)) {
        return picked.length > 0 ? picked : ALCH_ITEMS.filter(i => DEFAULT_ALCH_ITEMS.includes(i.key));
    }
    const custom = customAlchItem(customText);
    if (custom && !picked.includes(custom)) {
        picked.push(custom);
        picked.sort(richestFirst);
    }
    return picked;
}

/** The richest selected item the bank has not run out of. */
export function nextAlchTarget(selected: readonly AlchItem[], empty: ReadonlySet<string>): AlchItem | null {
    return selected.find(i => !empty.has(i.key)) ?? null;
}

export function fmtGp(n: number): string {
    const v = Math.round(n);
    const mag = Math.abs(v);
    if (mag >= 1_000_000) {
        return `${(v / 1_000_000).toFixed(1)}m`;
    }
    if (mag >= 10_000) {
        return `${Math.round(v / 1000)}k`;
    }
    if (mag >= 1000) {
        return `${(v / 1000).toFixed(1)}k`;
    }
    return String(v);
}
