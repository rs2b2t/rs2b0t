import type { ObjRecord } from '../../adapter/ClientAdapter.js';
import { ITEM_DB } from '../../data/itemdb.js';
import type { Catalog } from './catalog.js';

/** The shelves an order book is browsed by. Order is the order they are offered in. */
export const CATEGORIES = [
    'Popular',
    'Runes',
    'Ores',
    'Bars',
    'Logs',
    'Bows',
    'Arrows',
    'Weapons',
    'Armour',
    'Jewellery',
    'Gems',
    'Herbs',
    'Potions',
    'Herblore',
    'Food',
    'Tools',
    'Hides',
    'Bones',
    'Seeds',
    'Other'
] as const;

export type Category = (typeof CATEGORIES)[number];

const HERBS = [
    'guam', 'marrentill', 'tarromin', 'harralander', 'ranarr', 'irit',
    'avantoe', 'kwuarm', 'cadantine', 'lantadyme', 'dwarf weed', 'torstol'
];

const SECONDARIES = [
    'vial', 'eye of newt', 'unicorn horn', 'red spiders', 'limpwurt', 'snape grass',
    'white berries', 'dragon scale', 'wine of zamorak', 'potato cactus', 'jangerberries',
    'chocolate dust', 'pestle and mortar', 'ashes'
];

// Why: matching the stone anywhere in the name swept up every ring and amulet cut from it, which belong with the jewellery.
const GEM = /^(uncut )?(sapphire|emerald|ruby|diamond|dragonstone|opal|jade|red topaz)$/;

const TOOLS = [
    'fishing rod', 'fishing net', 'lobster pot', 'harpoon', 'fishing bait', 'karambwan vessel',
    'tinderbox', 'chisel', 'shears', 'needle', 'spade', 'rake', 'seed dibber', 'watering can'
];

const has = (name: string, needles: readonly string[]): boolean => needles.some(n => name.includes(n));

/** What the loadout data already knows about an item, where it knows anything. */
export interface Known {
    slot?: string;
    consumable?: string;
}

/** Which shelf an item belongs on. What the loadout data knows is passed in, so the rules stay decidable alone. */
// Why: the client's obj data carries no category of any kind, so the shelf has to be read back out of the name.
export function categoryOf(rec: Pick<ObjRecord, 'name' | 'equippable'>, known: Known = {}): Category {
    const name = rec.name.toLowerCase();
    const { slot, consumable } = known;

    // Why: "Chocolate bar" is the one bar you eat, and it would otherwise shelve with the smithing bars.
    if (name.includes('chocolate bar')) {
        return 'Food';
    }
    if (/\brunes?$/.test(name) || name.includes('essence')) {
        return 'Runes';
    }
    if (/\bore$/.test(name)) {
        return 'Ores';
    }
    if (/\bbar$/.test(name)) {
        return 'Bars';
    }
    if (/\blogs?$/.test(name)) {
        return 'Logs';
    }
    if (name.includes('arrow') || name.includes('bolt') || name.includes('dart')) {
        return 'Arrows';
    }
    // Why: a bow string is stock for fletching, not a bow, and "bowl" only shares the letters.
    if (name.includes('bow') && !name.includes('bow string') && !name.includes('bowl')) {
        return 'Bows';
    }
    if (name.includes('bones')) {
        return 'Bones';
    }
    if (name.includes('seed')) {
        return 'Seeds';
    }
    if (name.includes('hide') || name.includes('leather')) {
        return 'Hides';
    }
    if (/\(\d\)$/.test(name) || name.includes('potion')) {
        return 'Potions';
    }
    if (has(name, HERBS)) {
        return 'Herbs';
    }
    if (has(name, SECONDARIES)) {
        return 'Herblore';
    }
    if (GEM.test(name)) {
        return 'Gems';
    }
    // Why: most of what you eat is named for the thing rather than the eating, so the loadout data decides it.
    if (consumable === 'eat' || consumable === 'drink' || /^raw /.test(name) || name.includes('burnt')) {
        return 'Food';
    }
    if (has(name, TOOLS)) {
        return 'Tools';
    }

    if (slot === 'righthand') {
        return 'Weapons';
    }
    if (slot === 'ring' || slot === 'front') {
        return 'Jewellery';
    }
    if (slot !== undefined) {
        return 'Armour';
    }
    return 'Other';
}

/** Shelves that are popular stock wholesale. */
// Why: the Arrows shelf also holds bolts, javelins, tips and shafts, which are not what people stock by the load.
const POPULAR_SHELVES: readonly Category[] = ['Runes', 'Ores', 'Bars', 'Herbs', 'Gems'];

/** Named stock people ask for by the shelf-load, on top of the shelves above. */
// Why: potions are the 3-dose, which is what gets traded; the other doses are still addable one at a time.
const POPULAR_NAMES: readonly string[] = [
    'Bronze arrow', 'Iron arrow', 'Steel arrow', 'Mithril arrow', 'Adamant arrow', 'Rune arrow',
    'Rune full helm', 'Rune platebody', 'Rune chainbody', 'Rune platelegs', 'Rune kiteshield',
    'Rune scimitar', 'Rune longsword',
    'Super attack(3)', 'Super strength(3)', 'Super defence(3)', 'Superantipoison(3)', 'Prayer potion(3)',
    'Amulet of glory(4)',
    'Half of a key', 'Crystal key',
    'Raw lobster', 'Lobster', 'Raw shark', 'Shark',
    'Feather', 'Vial', 'Vial of water', 'Rune essence', 'Flax', 'Bow string'
];

const POPULAR_SET = new Set(POPULAR_NAMES.map(n => n.toLowerCase()));

/** Whether an item is on the Popular shelf, which overlaps the others: a nature rune is on Runes and Popular. */
// Why: it answers what a shop would stock on day one, which cuts across the shelves rather than sitting beside them.
export function isPopular(rec: Pick<ObjRecord, 'name' | 'equippable'>, known: Known = {}): boolean {
    return POPULAR_SET.has(rec.name.trim().toLowerCase()) || POPULAR_SHELVES.includes(categoryOf(rec, known));
}

let slots: Map<number, Known> | null = null;

function knownOf(id: number): Known {
    if (slots === null) {
        slots = new Map();
        for (const r of ITEM_DB) {
            slots.set(r.id, { slot: r.slot, consumable: r.consumable });
        }
    }
    return slots.get(id) ?? {};
}

/** Every unnoted item the catalog knows, on its shelf, each shelf name-sorted. */
export function shelves(cat: Catalog): Map<Category, ObjRecord[]> {
    const out = new Map<Category, ObjRecord[]>();
    for (const name of CATEGORIES) {
        out.set(name, []);
    }
    for (const rec of cat.items) {
        const known = knownOf(rec.id);
        out.get(categoryOf(rec, known))!.push(rec);
        // Why: Popular is an overlay, so an item sits on it as well as on the shelf it naturally belongs to.
        if (isPopular(rec, known)) {
            out.get('Popular')!.push(rec);
        }
    }
    return out;
}

/** The shelf one item sits on, using the loadout data where it knows the item. */
export function shelfOf(rec: ObjRecord): Category {
    return categoryOf(rec, knownOf(rec.id));
}
