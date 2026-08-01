import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { EW_ITEM, PICKAXES, SEERS_BANK, type EwItem } from './areas.js';

export const COAL_NEED = 4;
export const THREAD_NEED = 1;

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

/**
 * Book spine accepts a knife *or* any slash weapon (server checks slashattack_anim).
 * Name-based too: ~item seeding is unreliable, and bank_f2p stocks scimitars/swords.
 */
export function hasSlashTool(snap: QuestSnapshot): boolean {
    if (held(snap, EW_ITEM.KNIFE.id) > 0) {
        return true;
    }
    if (heldName(snap, 'knife') > 0) {
        return true;
    }
    for (const name of snap.inv.keys()) {
        const n = name.toLowerCase();
        if (n.includes('scimitar') || n.includes('sword') || n.includes('longsword') || n.includes('dagger')) {
            return true;
        }
    }
    return false;
}

export function bestHeldPickaxe(snap: QuestSnapshot): EwItem | null {
    return PICKAXES.find(p => held(snap, p.id) > 0 || (snap.wornIds?.has(p.id) ?? false)) ?? null;
}

export function bestBankPickaxe(snap: QuestSnapshot): EwItem | null {
    return PICKAXES.find(p => banked(snap, p.id) > 0) ?? null;
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

/** Tools and materials needed before committing to the spiral stairs. */
export function surfaceLoadout(snap: QuestSnapshot, needBellowsFix: boolean, needSmelt: boolean): QuestStep | null {
    if (!snap.bankKnown) {
        return scanBank();
    }

    const book = fromBank(snap, EW_ITEM.BATTERED_BOOK, 1);
    if (book) {
        return book;
    }

    const key = fromBank(snap, EW_ITEM.BATTERED_KEY, 1);
    if (key) {
        return key;
    }

    if (held(snap, EW_ITEM.BATTERED_KEY.id) === 0 && !hasSlashTool(snap)) {
        const knife = fromBank(snap, EW_ITEM.KNIFE, 1)
            ?? fromBank(snap, { id: 1333, name: 'Rune scimitar' }, 1);
        if (knife) {
            return knife;
        }
    }

    if (!hasPickaxe(snap) && needSmelt) {
        const pick = bestBankPickaxe(snap);
        if (pick) {
            return withdraw([{ name: pick.name, id: pick.id, qty: 1 }]);
        }
        return { kind: 'wait', reason: 'need a pickaxe in the bank for Elemental ore' };
    }

    if (held(snap, EW_ITEM.HAMMER.id) === 0) {
        const hammer = fromBank(snap, EW_ITEM.HAMMER, 1);
        if (hammer) {
            return hammer;
        }
        return { kind: 'wait', reason: 'need a Hammer in the bank to smith the Elemental shield' };
    }

    if (needSmelt && held(snap, EW_ITEM.COAL.id) < COAL_NEED) {
        const short = COAL_NEED - held(snap, EW_ITEM.COAL.id);
        if (banked(snap, EW_ITEM.COAL.id) > 0) {
            return withdraw([{ name: EW_ITEM.COAL.name, id: EW_ITEM.COAL.id, qty: Math.min(short, banked(snap, EW_ITEM.COAL.id)) }]);
        }
        return { kind: 'wait', reason: `need ${short} Coal in the bank to smelt Elemental ore` };
    }

    if (needBellowsFix) {
        if (held(snap, EW_ITEM.THREAD.id) < THREAD_NEED) {
            const thread = fromBank(snap, EW_ITEM.THREAD, THREAD_NEED);
            if (thread) {
                return thread;
            }
            // Thread is not crate-loot in the workshop — bank it before entry.
            return { kind: 'wait', reason: 'need Thread in the bank to fix the bellows' };
        }
        // Leather and needle can come from workshop crates; prefer bank first.
        if (held(snap, EW_ITEM.LEATHER.id) === 0) {
            const leather = fromBank(snap, EW_ITEM.LEATHER, 1);
            if (leather) {
                return leather;
            }
        }
        if (held(snap, EW_ITEM.NEEDLE.id) === 0) {
            const needle = fromBank(snap, EW_ITEM.NEEDLE, 1);
            if (needle) {
                return needle;
            }
        }
    }

    return null;
}

export function workshopKeepIds(snap: QuestSnapshot): number[] {
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
        ...PICKAXES.map(p => p.id)
    ];
    // Keep food by name is handled separately via exactKeep name list when needed.
    void snap;
    return ids;
}
