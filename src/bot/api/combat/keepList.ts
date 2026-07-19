// The keep-set for a combat bot's keep-list banking: the items it must NOT bank
// because it needs them to keep fighting — food (every bite form), the spell's
// runes (mage), ammo (range), and the wielded weapon. Pair with
// Banking.depositAllExcept(combatKeepNames(...)) to bank all loot + random loot.

import { foodForms } from './food.js';
import { SPELL_DB } from './data/spelldb.js';

export interface KeepParams {
    food: string;
    style: 'melee' | 'mage' | 'range';
    spell?: string;
    ammo?: string;
    weapon?: string;
    /** Anything else to keep (e.g. 'Coins' for tolls). */
    extra?: string[];
}

export function combatKeepNames(o: KeepParams): string[] {
    const keep = [...foodForms(o.food), ...(o.extra ?? [])];
    if (o.style === 'mage' && o.spell) {
        for (const r of SPELL_DB[o.spell]?.runes ?? []) {
            keep.push(r.rune);
        }
    }
    if (o.style === 'range' && o.ammo) {
        keep.push(o.ammo);
    }
    if (o.weapon && o.weapon !== '') {
        keep.push(o.weapon);
    }
    return keep;
}
