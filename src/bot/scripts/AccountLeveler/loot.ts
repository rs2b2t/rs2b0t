import { HERBS } from '../../data/herbs.js';
import { DROP_DB } from '../../data/dropdb.js';
import { POTIONS } from './catalog.js';

export const SECONDARY_LOOT = [...new Set([
    'Herb', 'Unicorn horn',
    ...HERBS.map(herb => herb.name),
    ...POTIONS.map(potion => potion.secondary),
    ...Object.values(DROP_DB).flat().filter(item => item.endsWith(' rune'))
])];
