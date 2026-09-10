import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { EC_ID, EC_NAME, EC_TILE } from './areas.js';

export function heldId(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function bankedId(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

// Why: `ownsInventory` opts the module out of the engine's food withdrawal, and nothing in the manor is aggressive, so the trip carries the spade and nothing else.

/** The module's own spade withdrawal, or null when the pack is ready. */
export function kit(snap: QuestSnapshot): QuestStep | null {
    if (heldId(snap, EC_ID.SPADE) > 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank' };
    }

    if (bankedId(snap, EC_ID.SPADE) > 0) {
        return { kind: 'withdraw', items: [{ name: EC_NAME.SPADE, qty: 1, id: EC_ID.SPADE }] };
    }
    // No banked spade. The only free source is the manor ground spawn.
    return { kind: 'grabGround', item: EC_NAME.SPADE, anchor: EC_TILE.SPADE_SPAWN, waitIfMissing: true };
}
