import { ITEM_DB } from '../../data/itemdb.js';
import { STAFF_RUNES } from '../../data/spelldb.js';

/** High Level Alchemy pays 60% of an item's shop cost; Low pays 40%. */
export const HIGH_ALCH_RATE = 0.6;
export const LOW_ALCH_RATE = 0.4;
export const HIGH_ALCH_LEVEL = 55;
export const LOW_ALCH_LEVEL = 21;
export const HIGH_ALCH_SPELL = 'High Level Alchemy';
export const LOW_ALCH_SPELL = 'Low Level Alchemy';

export const SPELL_HIGH = 'High';
export const SPELL_LOW = 'Low';
export const SPELL_OPTIONS = [SPELL_HIGH, SPELL_LOW];
export const SPELL_OPTION_LABELS: Record<string, string> = {
    [SPELL_HIGH]: HIGH_ALCH_SPELL,
    [SPELL_LOW]: LOW_ALCH_SPELL
};

export interface AlchSpell {
    key: typeof SPELL_HIGH | typeof SPELL_LOW;
    name: string;
    level: number;
    rate: number;
}

const HIGH: AlchSpell = { key: SPELL_HIGH, name: HIGH_ALCH_SPELL, level: HIGH_ALCH_LEVEL, rate: HIGH_ALCH_RATE };
const LOW: AlchSpell = { key: SPELL_LOW, name: LOW_ALCH_SPELL, level: LOW_ALCH_LEVEL, rate: LOW_ALCH_RATE };

/** High is the default, so a missing or unknown setting keeps saved High runs working. */
export function resolveAlchSpell(raw: string): AlchSpell {
    const wanted = raw.trim().toLowerCase();
    if (wanted === 'low' || wanted === 'low level alchemy' || wanted === 'lowalch') {
        return LOW;
    }
    return HIGH;
}

export function alchValueOf(cost: number, rate = HIGH_ALCH_RATE): number {
    return Math.floor(cost * rate);
}

/** Preferred fire-rune staff when several are in the bank. */
export const FIRE_STAFF = 'Staff of fire';

const FIRE_RUNE = 'fire rune';

// Why: Staff of fire stays first so a bank that still has one withdraws it ahead of a battlestaff.
export const FIRE_STAVES: readonly string[] = [
    FIRE_STAFF,
    ...Object.entries(STAFF_RUNES)
        .filter(([staff, runes]) =>
            staff.toLowerCase() !== FIRE_STAFF.toLowerCase()
            && runes.some(r => r.toLowerCase() === FIRE_RUNE)
        )
        .map(([staff]) => staff)
];

/** First fire-rune staff the predicate reports as present. */
export function pickFireStaff(has: (name: string) => boolean): string | undefined {
    return FIRE_STAVES.find(name => has(name));
}

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
        return rec ? [{ key: obj, id: rec.id, name: rec.name, label: label ?? rec.name, alchValue: alchValueOf(rec.cost) }] : [];
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
export function customAlchItem(text: string, rate = HIGH_ALCH_RATE): AlchItem | null {
    const wanted = fold(text);
    if (wanted === '') {
        return null;
    }
    const known = ALCH_ITEMS.find(i => fold(i.key) === wanted || fold(i.label) === wanted);
    if (known) {
        return revalue(known, rate);
    }
    const rec = ITEM_DB.find(r => fold(r.obj) === wanted) ?? ITEM_DB.find(r => fold(r.name) === wanted);
    if (!rec) {
        return null;
    }
    const fodder = ALCH_ITEMS.find(i => i.id === rec.id);
    if (fodder) {
        return revalue(fodder, rate);
    }
    return { key: rec.obj, id: rec.id, name: rec.name, label: rec.name, alchValue: alchValueOf(rec.cost, rate) };
}

function revalue(item: AlchItem, rate: number): AlchItem {
    if (rate === HIGH_ALCH_RATE) {
        return item;
    }
    const rec = ITEM_DB.find(r => r.id === item.id);
    return rec ? { ...item, alchValue: alchValueOf(rec.cost, rate) } : item;
}

function applyRate(items: AlchItem[], rate: number): AlchItem[] {
    return rate === HIGH_ALCH_RATE ? items : items.map(i => revalue(i, rate));
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
export function selectedAlchItems(keys: readonly string[], customText = '', rate = HIGH_ALCH_RATE): AlchItem[] {
    const wanted = new Set(keys.map(k => k.trim().toLowerCase()));
    const picked = ALCH_ITEMS.filter(i => wanted.has(i.key));
    if (!wanted.has(CUSTOM_ALCH_KEY)) {
        const rows = picked.length > 0 ? picked : ALCH_ITEMS.filter(i => DEFAULT_ALCH_ITEMS.includes(i.key));
        return applyRate(rows, rate);
    }
    const custom = customAlchItem(customText);
    if (custom && !picked.includes(custom)) {
        picked.push(custom);
        picked.sort(richestFirst);
    }
    return applyRate(picked, rate);
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
