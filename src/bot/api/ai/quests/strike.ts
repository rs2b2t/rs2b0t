import Tile from '../../../geometry/Tile.js';
import { SPELL_DB, STAFF_RUNES } from '../../../data/spelldb.js';
import { castsAvailable, runesPerCast } from '../../combat/CombatStyleLogic.js';
import { Shop } from '../../shop/Shop.js';
import { Traversal } from '../../walking/Traversal.js';
import type { QuestSnapshot, QuestStep } from './engine/types.js';

export const STRIKE_CASTS = 150;
export const STRIKE_RUNES = ['mind rune', 'air rune', 'water rune', 'earth rune', 'fire rune'];
const STRIKES = ['Fire Strike', 'Earth Strike', 'Water Strike', 'Wind Strike'];
const STRIKE_MAX_HITS: Record<string, number> = { 'Fire Strike': 8, 'Earth Strike': 6, 'Water Strike': 4, 'Wind Strike': 2 };
const BETTY = { npc: 'Betty', anchor: new Tile(3012, 3259, 0) };
const ZAFF = { npc: 'Zaff', anchor: new Tile(3203, 3433, 0) };
const STAFF_GP = 2000;
export const STRIKE_STAVES = Object.keys(STAFF_RUNES).map(name => name.toLowerCase());

export function strikeSpell(magic: number, count: (rune: string) => number = () => Infinity, wielded: string[] = []): string | null {
    let best: string | null = null;
    let budget = 0;
    for (const name of STRIKES) {
        if (SPELL_DB[name]!.level > magic) continue;
        const damage = castsAvailable(name, wielded, count) * STRIKE_MAX_HITS[name]!;
        if (damage > budget) { best = name; budget = damage; }
    }
    return best;
}

function suppliedStrike(magic: number, wielded: string[]): string | null {
    return STRIKES.find(name => SPELL_DB[name]!.level <= magic
        && !runesPerCast(name, wielded)!.some(({ rune }) => rune === SPELL_DB[name]!.runes[1]!.rune)) ?? null;
}

export function prepareStrikeStaff(snap: QuestSnapshot, keep: readonly string[] = []): QuestStep | null {
    const spell = strikeSpell(snap.magic ?? 1);
    if (!spell || suppliedStrike(snap.magic ?? 1, [...snap.worn])) return null;
    const elements = STRIKES.filter(name => SPELL_DB[name]!.level <= (snap.magic ?? 1)).map(name => SPELL_DB[name]!.runes[1]!);
    const usable = Object.entries(STAFF_RUNES).filter(([name, runes]) => {
        const level = name.startsWith('Mystic') ? 40 : name.endsWith('battlestaff') ? 30 : 1;
        return elements.some(({ rune }) => runes.includes(rune)) && level <= (snap.magic ?? 1) && level <= (snap.attack ?? 1);
    }).sort((a, b) => elements.findIndex(({ rune }) => a[1].includes(rune)) - elements.findIndex(({ rune }) => b[1].includes(rune))).map(([name]) => name);
    const held = usable.find(name => (snap.inv.get(name.toLowerCase()) ?? 0) > 0);
    if (held) return { kind: 'equip', item: held };
    const element = elements[0]!;
    const rune = element.rune.toLowerCase();
    if ((snap.inv.get(rune) ?? 0) + (snap.bankKnown ? snap.bank?.get(rune) ?? 0 : 0) >= element.count * STRIKE_CASTS) return null;
    if (!snap.bankKnown) return { kind: 'scanBank' };
    const banked = usable.find(name => (snap.bank?.get(name.toLowerCase()) ?? 0) > 0);
    const short = STAFF_GP - (snap.inv.get('coins') ?? 0);
    if (!banked && short > snap.bankCoins) return null;
    if ((snap.freeSlots ?? 28) < 1) {
        const preserve = [...keep, ...STRIKE_RUNES, ...STRIKE_STAVES, 'coins'];
        return [...snap.inv.keys()].some(name => !preserve.includes(name))
            ? { kind: 'deposit', keep: preserve, exactKeep: true }
            : { kind: 'wait', reason: 'need a free inventory slot for a Strike staff' };
    }
    if (banked) return { kind: 'withdraw', items: [{ name: banked, qty: 1 }] };
    if (short > 0) return { kind: 'withdraw', items: [{ name: 'Coins', qty: short }] };
    const staves = elements.map(({ rune }) => `Staff of ${rune.split(' ')[0]!.toLowerCase()}`);
    return { kind: 'custom', name: 'buy a Strike staff from Zaff', run: async log => {
        if (!(await Traversal.walkResilient(ZAFF.anchor, { radius: 3, attempts: 3, timeoutMs: 120_000, log })) || !(await Shop.open(ZAFF.npc))) return false;
        try {
            for (const staff of staves) {
                if (!Shop.stock().some(item => item.name === staff && item.count > 0)) continue;
                if (await Shop.buy(staff, 1) > 0) return true;
            }
            log('Zaff has no usable elemental staff in stock');
            return false;
        } finally {
            await Shop.close();
        }
    } };
}

export function prepareStrikes(snap: QuestSnapshot, keep: readonly string[] = [], wielded: string[] = [...snap.worn]): QuestStep | null {
    const strongest = strikeSpell(snap.magic ?? 1);
    if (!strongest) return { kind: 'wait', reason: 'need Magic 1 for Strike spells' };
    const supplied = castsAvailable(strongest, wielded, rune => (snap.inv.get(rune.toLowerCase()) ?? 0)
        + (snap.bankKnown ? snap.bank?.get(rune.toLowerCase()) ?? 0 : 0)) >= STRIKE_CASTS;
    const spell = supplied ? strongest : suppliedStrike(snap.magic ?? 1, wielded) ?? strongest;
    const casts = Math.ceil(STRIKE_CASTS * STRIKE_MAX_HITS[strongest]! / STRIKE_MAX_HITS[spell]!);
    const missing = (runesPerCast(spell, wielded) ?? []).map(({ rune, count }) => ({
        name: rune, qty: count * casts - (snap.inv.get(rune.toLowerCase()) ?? 0)
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
