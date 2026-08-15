// Why: the journal is blank for a dual-gang character, so every field here is an item count or a door's own refusal.

/** What the supplier can see. */
export interface SupplierState {
    inBlackArm: boolean;
    inPhoenix: boolean;
    hasKey: boolean;
    hasReport: boolean;
    crossbows: number;
    phoenixHalf: number;
    blackarmHalf: number;
    certsBanked: number;
    certTarget: number;
}

export type SupplierPhase =
    | 'await-key'
    | 'raid-store'
    | 'join-blackarm'
    | 'kill-jonny'
    | 'join-phoenix'
    | 'take-phoenix-half'
    | 'take-blackarm-half'
    | 'mint'
    | 'done';

// Why: it must never redeem — the king sets %phoenixgang complete, which seals the chest and stops the curator for good.

/** The supplier's one decision. */
export function supplierPhase(s: SupplierState): SupplierPhase {
    if (s.inBlackArm && s.inPhoenix) {
        if (s.certsBanked >= s.certTarget) {
            return 'done';
        }
        if (s.phoenixHalf > 0 && s.blackarmHalf > 0) {
            return 'mint';
        }
        return s.phoenixHalf > 0 ? 'take-blackarm-half' : 'take-phoenix-half';
    }
    if (s.inBlackArm) {
        // Why: [opnpcu,straven] is missing the black-arm guard that [opnpc1,straven] and the hideout door both carry, so using the report joins the second gang.
        return s.hasReport ? 'join-phoenix' : 'kill-jonny';
    }
    if (s.crossbows >= 2) {
        return 'join-blackarm';
    }
    if (s.hasKey) {
        return 'raid-store';
    }
    // Why: only Straven issues the store key, so the bootstrap key has to be traded in.
    return 'await-key';
}
