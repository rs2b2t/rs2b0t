import Tile from '../../../geometry/Tile.js';
import { SPELL_DB } from '../../../data/spelldb.js';
import { castsAvailable } from '../../combat/CombatStyleLogic.js';
import type { QuestSnapshot, QuestStep } from './engine/types.js';

export const STRIKE_CASTS = 150;
export const STRIKE_RUNES = ['mind rune', 'air rune', 'water rune', 'earth rune', 'fire rune'];
const STRIKES = ['Fire Strike', 'Earth Strike', 'Water Strike', 'Wind Strike'];
const BETTY = { npc: 'Betty', anchor: new Tile(3012, 3259, 0) };

export function strikeSpell(magic: number, count: (rune: string) => number = () => Infinity): string | null {
    return STRIKES.find(name => SPELL_DB[name]!.level <= magic && castsAvailable(name, [], count) > 0) ?? null;
}

export function prepareStrikes(snap: QuestSnapshot, keep: readonly string[] = []): QuestStep | null {
    const spell = strikeSpell(snap.magic ?? 1);
    if (!spell) return { kind: 'wait', reason: 'need Magic 1 for Strike spells' };
    const missing = SPELL_DB[spell]!.runes.map(({ rune, count }) => ({
        name: rune, qty: count * STRIKE_CASTS - (snap.inv.get(rune.toLowerCase()) ?? 0)
    })).filter(item => item.qty > 0);
    if (!missing.length) return null;
    if (!snap.bankKnown) return { kind: 'scanBank' };
    const slots = missing.filter(item => !snap.inv.has(item.name.toLowerCase())).length;
    if ((snap.freeSlots ?? 28) < slots) {
        const preserve = [...keep, ...STRIKE_RUNES, 'coins'];
        return [...snap.inv.keys()].some(name => !preserve.includes(name))
            ? { kind: 'deposit', keep: preserve, exactKeep: true }
            : { kind: 'wait', reason: `need ${slots} free inventory slots for Strike runes` };
    }
    const draw = missing.map(item => ({ ...item, qty: Math.min(item.qty, snap.bank?.get(item.name.toLowerCase()) ?? 0) })).filter(item => item.qty > 0);
    if (draw.length) return { kind: 'withdraw', items: draw };
    const item = missing[0]!;
    return { kind: 'buy', item: item.name, qty: item.qty, shop: BETTY, estGp: Math.min(1000, item.qty * 24) };
}
