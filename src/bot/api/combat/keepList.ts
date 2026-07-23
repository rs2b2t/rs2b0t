import { foodForms } from './food.js';
import { SPELL_DB } from './data/spelldb.js';

export interface KeepParams {
    food: string;
    style: 'melee' | 'mage' | 'range';
    spell?: string;
    ammo?: string;
    weapon?: string;
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
