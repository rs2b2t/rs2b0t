import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { Skills } from '../../../../skills/Skills.js';
import { EW_ITEM, PICKAXES, SEERS_BANK, type EwItem } from './areas.js';

export const COAL_NEED = 4;
const THREAD_NEED = 1;
/** Food withdrawn before entering so Sustain can work inside the workshop. */
export const FOOD_WITHDRAW = 8;

/**
 * Official quest skill gates (journal / wiki).
 * Combat is **not** a server gate — the workshop has aggressive elementals.
 */
export const EW_OFFICIAL_SKILLS = {
    mining: 20,
    smithing: 20,
    crafting: 20
} as const;

// Why: this is the lowest non-required combat profile that has completed a full headed harness, on a realistic bank seed at the official skill minimums.
// Why: headed runs so far — max combat with an inventory seed PASS (mid-quest loop); Att/Str 40, Def 25, HP 40 on a bank seed FAIL (Water elemental death); Att/Str 50, Def 40, HP 50 on a bank seed PASS (about 270s, 2026-08-01).
// Why: the polish goal is to push this down and branch tactics by power level, so update it when a headed run changes the floor.
export const EW_PROVEN_COMBAT_FLOOR = {
    attack: 50,
    strength: 50,
    defence: 40,
    hitpoints: 50
} as const;

/** Profiles known to fail a full clear (do not treat as “close enough”). */
export const EW_FAILED_COMBAT = {
    attack: 40,
    strength: 40,
    defence: 25,
    hitpoints: 40
} as const;

/**
 * Next headed probe (between failed 40 and proven 50). Not a guarantee.
 */
export const EW_PROBE_COMBAT = {
    attack: 45,
    strength: 45,
    defence: 30,
    hitpoints: 45
} as const;

/** @deprecated Prefer EW_PROVEN_COMBAT_FLOOR. */
export const EW_TESTED_COMBAT = EW_PROVEN_COMBAT_FLOOR;
/** @deprecated Prefer EW_PROVEN_COMBAT_FLOOR for “safe”; EW_PROBE_COMBAT for search. */
export const EW_RECOMMENDED_COMBAT = EW_PROVEN_COMBAT_FLOOR;

/**
 * One-shot advisory when the account is below any proven combat floor (or only
 * max is proven). Soft — does not block the queue. See docs/QUESTS.md polish goal.
 */
export function warnElementalWorkshopReadiness(): string | null {
    const have = {
        attack: Skills.level('attack'),
        strength: Skills.level('strength'),
        defence: Skills.level('defence'),
        hitpoints: Skills.level('hitpoints'),
        mining: Skills.level('mining'),
        smithing: Skills.level('smithing'),
        crafting: Skills.level('crafting')
    };

    const missingOfficial: string[] = [];
    for (const [skill, need] of Object.entries(EW_OFFICIAL_SKILLS)) {
        const n = have[skill as keyof typeof have] ?? 1;
        if (n < need) {
            missingOfficial.push(`${skill} ${n}/${need}`);
        }
    }
    if (missingOfficial.length > 0) {
        return `official skill reqs not met (${missingOfficial.join(', ')}) — bot will wait or fail gates`;
    }

    const floor = EW_PROVEN_COMBAT_FLOOR;
    const atOrBelowFailed =
        have.attack <= EW_FAILED_COMBAT.attack
        && have.strength <= EW_FAILED_COMBAT.strength
        && have.defence <= EW_FAILED_COMBAT.defence
        && have.hitpoints <= EW_FAILED_COMBAT.hitpoints;
    if (atOrBelowFailed) {
        return (
            `combat ≤ failed harness floor (Att/Str ${EW_FAILED_COMBAT.attack}, `
            + `Def ${EW_FAILED_COMBAT.defence}, HP ${EW_FAILED_COMBAT.hitpoints}) — `
            + 'died on Water elemental in headed test. Expect death risk; no low-power tactics yet.'
        );
    }

    const short: string[] = [];
    for (const skill of ['attack', 'strength', 'defence', 'hitpoints'] as const) {
        if (have[skill] < floor[skill]) {
            short.push(`${skill} ${have[skill]}/${floor[skill]}`);
        }
    }
    if (short.length === 0) {
        return null;
    }
    return (
        `combat below proven floor (${short.join(', ')}; headed PASS at `
        + `${floor.attack}/${floor.strength}/${floor.defence}/${floor.hitpoints}). `
        + `Next probe ${EW_PROBE_COMBAT.attack}/${EW_PROBE_COMBAT.strength}/`
        + `${EW_PROBE_COMBAT.defence}/${EW_PROBE_COMBAT.hitpoints}. Untested — may fail or need low-power tactics later.`
    );
}

/** Melee weapons usable for the Earth elemental (and for slashing the book). */
export const WEAPONS: readonly EwItem[] = [
    { id: 1333, name: 'Rune scimitar' },
    { id: 1331, name: 'Adamant scimitar' },
    { id: 1329, name: 'Mithril scimitar' },
    { id: 1325, name: 'Steel scimitar' },
    { id: 1323, name: 'Iron scimitar' },
    { id: 1321, name: 'Bronze scimitar' }
];

export function held(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function banked(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

export function owned(snap: QuestSnapshot, id: number): number {
    return held(snap, id) + banked(snap, id);
}

export function heldName(snap: QuestSnapshot, name: string): number {
    return snap.inv.get(name.toLowerCase()) ?? 0;
}

export function hasPickaxe(snap: QuestSnapshot): boolean {
    return PICKAXES.some(p => held(snap, p.id) > 0 || (snap.wornIds?.has(p.id) ?? false));
}

function isSlashName(name: string): boolean {
    const n = name.toLowerCase();
    return n === 'knife'
        || n.includes('scimitar')
        || n.includes('sword')
        || n.includes('longsword')
        || n.includes('dagger')
        || n.includes('battleaxe');
}

/** Melee weapons for the Earth elemental — knife is not enough (ensureMeleeWeapon ignores it). */
function isCombatWeaponName(name: string): boolean {
    const n = name.toLowerCase();
    return n.includes('scimitar')
        || n.includes('sword')
        || n.includes('longsword')
        || n.includes('dagger')
        || n.includes('battleaxe')
        || n.includes('mace')
        || n.includes('warhammer');
}

// Why: the book spine accepts a knife or any slash weapon, as the server checks slashattack_anim.
// Why: this is inventory-only, since `useOn` needs a pack item — worn blades have to be removed first (see slashBookForKey) or a knife is withdrawn.

/** True when the pack holds something that can slash the book open. */
export function hasHeldSlashTool(snap: QuestSnapshot): boolean {
    if (held(snap, EW_ITEM.KNIFE.id) > 0) {
        return true;
    }
    if (WEAPONS.some(w => held(snap, w.id) > 0)) {
        return true;
    }
    for (const name of snap.inv.keys()) {
        if (isSlashName(name)) {
            return true;
        }
    }
    return false;
}

/**
 * Pack or worn slash tool. Used for “do we own something that can cut the book”
 * after unequip — not as a gate that skips bank withdraw while still worn-only.
 */
export function hasSlashTool(snap: QuestSnapshot): boolean {
    if (hasHeldSlashTool(snap)) {
        return true;
    }
    if (WEAPONS.some(w => snap.wornIds?.has(w.id) ?? false)) {
        return true;
    }
    for (const name of snap.worn) {
        if (isSlashName(name)) {
            return true;
        }
    }
    return false;
}

export function hasWeapon(snap: QuestSnapshot): boolean {
    if (WEAPONS.some(w => held(snap, w.id) > 0 || (snap.wornIds?.has(w.id) ?? false))) {
        return true;
    }
    return [...snap.inv.keys(), ...snap.worn].some(isCombatWeaponName);
}

export function bestHeldPickaxe(snap: QuestSnapshot): EwItem | null {
    return PICKAXES.find(p => held(snap, p.id) > 0 || (snap.wornIds?.has(p.id) ?? false)) ?? null;
}

export function bestBankPickaxe(snap: QuestSnapshot): EwItem | null {
    return PICKAXES.find(p => banked(snap, p.id) > 0) ?? null;
}

export function bestBankWeapon(snap: QuestSnapshot): EwItem | null {
    return WEAPONS.find(w => banked(snap, w.id) > 0) ?? null;
}

export function scanBank(): QuestStep {
    return { kind: 'scanBank', bank: SEERS_BANK };
}

export function withdraw(items: { name: string; qty: number; id?: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: SEERS_BANK };
}

export function fromBank(snap: QuestSnapshot, item: EwItem, qty = 1): QuestStep | null {
    const short = qty - held(snap, item.id);
    if (short <= 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const inBank = banked(snap, item.id);
    return inBank > 0
        ? withdraw([{ name: item.name, id: item.id, qty: Math.min(short, inBank) }])
        : null;
}

function keepNamesForEntry(): string[] {
    return [
        'battered book', 'battered key', 'knife', 'hammer', 'needle', 'thread', 'leather',
        'coal', 'bronze pickaxe', 'iron pickaxe', 'steel pickaxe', 'mithril pickaxe',
        'adamant pickaxe', 'rune pickaxe', 'elemental ore', 'elemental metal', 'elemental shield',
        'a stone bowl', 'coins', 'lobster', 'swordfish', 'salmon', 'trout',
        'rune scimitar', 'adamant scimitar', 'mithril scimitar', 'steel scimitar',
        'iron scimitar', 'bronze scimitar'
    ];
}

function bankCountByName(snap: QuestSnapshot, name: string): number {
    return snap.bank?.get(name.toLowerCase()) ?? 0;
}

/**
 * Tools and materials needed before committing to the spiral stairs.
 * Bank-first: scan → deposit junk → withdraw missing kit (including food + weapon).
 */
export function surfaceLoadout(snap: QuestSnapshot, needBellowsFix: boolean, needSmelt: boolean): QuestStep | null {
    if (!snap.bankKnown) {
        return scanBank();
    }

    // Drop junk before packing so a full pack of misc loot cannot block withdraws.
    // Entry kit can need ~12 free slots (tools + coal + food).
    const keep = keepNamesForEntry();
    const hasJunk = [...snap.inv.keys()].some(n => !keep.includes(n.toLowerCase()));
    const free = snap.freeSlots ?? 28;
    if (hasJunk && free < 12) {
        return {
            kind: 'deposit',
            keep,
            keepIds: workshopKeepIds(snap),
            bank: SEERS_BANK,
            exactKeep: true
        };
    }

    const needed: { name: string; qty: number; id?: number }[] = [];

    const pushMissing = (item: EwItem, qty: number): void => {
        const short = qty - held(snap, item.id);
        if (short <= 0) {
            return;
        }
        const inBank = banked(snap, item.id);
        if (inBank > 0) {
            needed.push({ name: item.name, id: item.id, qty: Math.min(short, inBank) });
        }
    };

    // Quest keys/book if re-entering mid-run.
    pushMissing(EW_ITEM.BATTERED_BOOK, 1);
    pushMissing(EW_ITEM.BATTERED_KEY, 1);

    // Prefer a knife for the book; any slash weapon in the pack also works.
    if (!hasHeldSlashTool(snap)) {
        const knife = banked(snap, EW_ITEM.KNIFE.id);
        if (knife > 0) {
            needed.push({ name: EW_ITEM.KNIFE.name, id: EW_ITEM.KNIFE.id, qty: 1 });
        } else {
            const w = bestBankWeapon(snap);
            if (w) {
                needed.push({ name: w.name, id: w.id, qty: 1 });
            }
        }
    }

    if (needSmelt && !hasPickaxe(snap)) {
        const pick = bestBankPickaxe(snap);
        if (pick) {
            needed.push({ name: pick.name, id: pick.id, qty: 1 });
        }
    }

    if (held(snap, EW_ITEM.HAMMER.id) === 0) {
        pushMissing(EW_ITEM.HAMMER, 1);
    }

    if (needSmelt && held(snap, EW_ITEM.COAL.id) < COAL_NEED) {
        const short = COAL_NEED - held(snap, EW_ITEM.COAL.id);
        const inBank = banked(snap, EW_ITEM.COAL.id);
        if (inBank > 0) {
            needed.push({ name: EW_ITEM.COAL.name, id: EW_ITEM.COAL.id, qty: Math.min(short, inBank) });
        }
    }

    if (needBellowsFix) {
        if (held(snap, EW_ITEM.THREAD.id) < THREAD_NEED) {
            pushMissing(EW_ITEM.THREAD, THREAD_NEED);
        }
        // Leather/needle: bank preferred; crates inside workshop are the fallback in decide().
        pushMissing(EW_ITEM.LEATHER, 1);
        pushMissing(EW_ITEM.NEEDLE, 1);
    }

    // Combat food for the Earth elemental + traversal sustain.
    const foodHeld = heldName(snap, 'lobster') + heldName(snap, 'swordfish')
        + heldName(snap, 'salmon') + heldName(snap, 'trout');
    if (foodHeld < 3) {
        const foods: { name: string; bankKey: string }[] = [
            { name: 'Lobster', bankKey: 'lobster' },
            { name: 'Swordfish', bankKey: 'swordfish' },
            { name: 'Salmon', bankKey: 'salmon' },
            { name: 'Trout', bankKey: 'trout' }
        ];
        for (const f of foods) {
            const n = bankCountByName(snap, f.bankKey);
            if (n > 0) {
                needed.push({ name: f.name, qty: Math.min(FOOD_WITHDRAW, n) });
                break;
            }
        }
    }

    // Weapon for the elemental if we only have a knife for the book.
    if (needSmelt && !hasWeapon(snap)) {
        const w = bestBankWeapon(snap);
        if (w && !needed.some(n => n.id === w.id)) {
            needed.push({ name: w.name, id: w.id, qty: 1 });
        }
    }

    if (needed.length > 0) {
        // If the batch cannot fit, deposit junk first even when freeSlots looked "ok".
        if (hasJunk && free < needed.length) {
            return {
                kind: 'deposit',
                keep,
                keepIds: workshopKeepIds(snap),
                bank: SEERS_BANK,
                exactKeep: true
            };
        }
        return withdraw(needed);
    }

    // Hard waits when bank is known empty of critical tools.
    if (needSmelt && !hasPickaxe(snap) && !bestBankPickaxe(snap)) {
        return { kind: 'wait', reason: 'need a pickaxe in the bank for Elemental ore' };
    }
    if (held(snap, EW_ITEM.HAMMER.id) === 0 && banked(snap, EW_ITEM.HAMMER.id) === 0) {
        return { kind: 'wait', reason: 'need a Hammer in the bank to smith the Elemental shield' };
    }
    if (needSmelt && held(snap, EW_ITEM.COAL.id) < COAL_NEED && banked(snap, EW_ITEM.COAL.id) === 0) {
        return { kind: 'wait', reason: `need ${COAL_NEED - held(snap, EW_ITEM.COAL.id)} Coal in the bank to smelt Elemental ore` };
    }
    if (needBellowsFix && held(snap, EW_ITEM.THREAD.id) < THREAD_NEED && banked(snap, EW_ITEM.THREAD.id) === 0) {
        return { kind: 'wait', reason: 'need Thread in the bank to fix the bellows' };
    }
    if (needSmelt && !hasWeapon(snap) && !bestBankWeapon(snap)) {
        return { kind: 'wait', reason: 'need a melee weapon in the bank for the Earth elemental' };
    }
    if (!hasHeldSlashTool(snap) && !hasSlashTool(snap)
        && banked(snap, EW_ITEM.KNIFE.id) === 0 && !bestBankWeapon(snap)) {
        // Ground knife spawn is the last resort in sourceKnife — not a wait.
        return null;
    }

    return null;
}

function workshopKeepIds(snap: QuestSnapshot): number[] {
    const ids = [
        EW_ITEM.BATTERED_BOOK.id,
        EW_ITEM.BATTERED_KEY.id,
        EW_ITEM.STONE_BOWL.id,
        EW_ITEM.STONE_BOWL_FULL.id,
        EW_ITEM.ELEMENTAL_ORE.id,
        EW_ITEM.ELEMENTAL_METAL.id,
        EW_ITEM.ELEMENTAL_SHIELD.id,
        EW_ITEM.KNIFE.id,
        EW_ITEM.NEEDLE.id,
        EW_ITEM.THREAD.id,
        EW_ITEM.LEATHER.id,
        EW_ITEM.COAL.id,
        EW_ITEM.HAMMER.id,
        EW_ITEM.COINS.id,
        ...PICKAXES.map(p => p.id),
        ...WEAPONS.map(w => w.id)
    ];
    void snap;
    return ids;
}
