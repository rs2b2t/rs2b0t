// docs/decisions/quest-pitfalls-25.md
import { Equipment } from '../../../../equipment/Equipment.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';

// Why: 9 level-61 ice spiders on the chest circuit and 3 level-42 hobgoblins at once, both `crush_style`, and the bank is the only wardrobe; feet hold the boots of lightness and the right hand the bow, so neither slot is filled here.

/** Ranged armour the bank might already hold, best first within each slot. */
const RANGED_SLOTS: readonly (readonly string[])[] = [
    ['Coif', 'Leather cowl'],
    ['Dragonhide body', 'Studded body', 'Hardleather body', 'Leather body'],
    ['Dragonhide chaps', 'Studded chaps', 'Leather chaps'],
    ['Dragon vambraces', 'Leather vambraces', 'Leather gloves']
];

const MELEE_TIERS = ['Rune', 'Adamant', 'Mithril', 'Black', 'Steel', 'Iron', 'Bronze'] as const;

// Why: a hobgoblin carries 1 stab defence and 1 slash defence, so tier beats shape and the fastest weapon of the best tier wins, a scimitar ahead of the longsword of the same metal.
const MELEE_KINDS = ['scimitar', 'longsword', 'sword', 'battleaxe', 'mace', 'warhammer'] as const;

/** Melee weapons the bank might hold, best first. */
const MELEE_WEAPONS: readonly string[] = MELEE_TIERS.flatMap(tier => MELEE_KINDS.map(kind => `${tier} ${kind}`));

/** The armour alone, which is what the observe line counts. */
export const RANGED_ARMOUR_NAMES: readonly string[] = RANGED_SLOTS.flat().map(name => name.toLowerCase());

/** Every piece the picker will reach for; the spillover deposit reads this so a withdrawn piece is not binned. */
export const IKOV_GEAR_NAMES: readonly string[] = [...RANGED_ARMOUR_NAMES, ...MELEE_WEAPONS.map(name => name.toLowerCase())];

// Why: `equip` answers a level or quest refusal with false and no message, so a piece re-picked every pass is a run spent withdrawing the same body.

/** Pieces the server has already refused this session. */
const refused = new Set<string>();

function stocked(snap: QuestSnapshot, name: string): number {
    const key = name.toLowerCase();
    return (snap.inv.get(key) ?? 0) + (snap.bank?.get(key) ?? 0);
}

function dressed(snap: QuestSnapshot, slot: readonly string[]): boolean {
    return slot.some(name => snap.worn.has(name.toLowerCase()));
}

function bestInBank(snap: QuestSnapshot, slot: readonly string[]): string | null {
    return slot.find(name => !refused.has(name.toLowerCase()) && stocked(snap, name) > 0) ?? null;
}

// Why: a slot already carrying something is left alone, because a mid-run swap costs a bank trip to save a point of defence.

/** The best ranged piece the bank can dress each bare slot with. */
function rangedGearWanted(snap: QuestSnapshot): string[] {
    const out: string[] = [];
    for (const slot of RANGED_SLOTS) {
        if (dressed(snap, slot)) {
            continue;
        }
        const pick = bestInBank(snap, slot);
        if (pick) {
            out.push(pick);
        }
    }
    return out;
}

/**
 * Withdraw and wear the best ranged armour the bank holds, or null once it can do no better.
 * @see docs/decisions/quest-pitfalls-25.md
 */
export function rangedArmourStep(snap: QuestSnapshot): QuestStep | null {
    if (!snap.bankKnown) {
        return null;
    }
    const wanted = rangedGearWanted(snap);
    if (wanted.length === 0) {
        return null;
    }
    const missing = wanted.filter(name => (snap.inv.get(name.toLowerCase()) ?? 0) === 0);
    if (missing.length > 0) {
        return { kind: 'withdraw', items: missing.map(name => ({ name, qty: 1 })) };
    }
    return {
        kind: 'custom',
        name: `wear ${wanted.join(', ')}`,
        run: async log => {
            for (const name of wanted) {
                if (Equipment.contains(name) || (await Equipment.equip(name))) {
                    continue;
                }
                log(`ikov: the server refused ${name} — a level or quest gate; dropping it from the kit`);
                refused.add(name.toLowerCase());
            }
            return true;
        }
    };
}

// Why: the crossing kit leaves the bot bare-handed for the roots farm, so the weapon is picked like the armour, best in the bank, with the yew axe as the floor.

/** The best melee weapon the bank holds, or null when it holds none the server has not refused. */
function bestMeleeWeapon(snap: QuestSnapshot): string | null {
    if (!snap.bankKnown) {
        return null;
    }
    return bestInBank(snap, MELEE_WEAPONS);
}

/** Withdraw and wield that weapon, or null when the pack is already carrying the best there is. */
export function meleeWeaponStep(snap: QuestSnapshot): QuestStep | null {
    const want = bestMeleeWeapon(snap);
    if (!want || snap.worn.has(want.toLowerCase())) {
        return null;
    }
    if ((snap.inv.get(want.toLowerCase()) ?? 0) === 0) {
        return { kind: 'withdraw', items: [{ name: want, qty: 1 }] };
    }
    return {
        kind: 'custom',
        name: `wield ${want}`,
        run: async log => {
            if (Equipment.contains(want) || (await Equipment.equip(want))) {
                return true;
            }
            log(`ikov: the server refused ${want} — an attack-level gate; dropping it from the kit`);
            refused.add(want.toLowerCase());
            return true;
        }
    };
}
