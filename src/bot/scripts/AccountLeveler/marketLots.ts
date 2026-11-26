import { categoryOf } from '../../api/market/categories.js';
import { HERBS } from '../../data/herbs.js';
import { ITEM_DB } from '../../data/itemdb.js';
import { POTION_SECONDARIES } from '../../data/potionSecondaries.js';

const supplies = new Set([
    ...ITEM_DB.filter(item => item.consumable || item.slot === 'quiver').map(item => item.name.toLowerCase()),
    ...HERBS.flatMap(herb => [herb.name.toLowerCase(), '#' + herb.unidId]),
    ...POTION_SECONDARIES.map(item => item.name.toLowerCase()),
    'herb', 'unfinished potion', 'coal', 'clay', 'soft clay', 'limestone', 'limestone brick', 'plank',
    'thread', 'feather', 'fishing bait', 'flax', 'bow string', 'wool', 'ball of wool', 'arrow shaft', 'headless arrow',
    'cannonball', 'cow hide', 'leather', 'hard leather', 'dragonhide', 'vial', 'vial of water', 'unicorn horn',
    'blue dragon scale', 'chocolate dust', 'swamp tar', 'swamp paste', 'ashes', 'soda ash', 'seaweed',
    'bucket of sand', 'molten glass', 'pot of flour', 'nails', 'silver dust', 'pure essence', 'rune essence'
]);
const bulkShelves = new Set(['Runes', 'Ores', 'Bars', 'Logs', 'Gems', 'Bones']);

export function marketLotSize(item: string, quantity: number): number {
    const name = item.trim().toLowerCase();
    if (quantity === 1 && (name === 'diamond' || name === 'uncut diamond')) return 1;
    if (supplies.has(name) || /^(raw |uncooked |unbaked )/.test(name)
        || / (?:dragonhide|dragon leather|planks?|seeds?|arrowtips|dart tip|bolt tips|javelin|throwing axe|knife|dart)(?:\(p\))?$/.test(name)) return 1000;
    return bulkShelves.has(categoryOf({ name, equippable: false })) ? 1000 : 1;
}

export function marketOrderQuantity(item: string, shortage: number): number {
    const lot = marketLotSize(item, shortage);
    return Math.ceil(shortage / lot) * lot;
}
