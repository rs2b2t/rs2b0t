import type { ItemRecord } from '../api/loadout/types.js';
import { ITEM_DB } from './itemdb.js';

const byId = new Map<number, ItemRecord>();
const byObj = new Map<string, ItemRecord>();
const byName = new Map<string, ItemRecord[]>();

for (const item of ITEM_DB) {
    byId.set(item.id, item);
    byObj.set(item.obj, item);
    const name = item.name.toLowerCase();
    const matches = byName.get(name);
    if (matches) matches.push(item);
    else byName.set(name, [item]);
}

export const ITEMS_BY_ID: ReadonlyMap<number, ItemRecord> = byId;
export const ITEMS_BY_OBJ: ReadonlyMap<string, ItemRecord> = byObj;
export const ITEMS_BY_NAME: ReadonlyMap<string, readonly ItemRecord[]> = byName;
