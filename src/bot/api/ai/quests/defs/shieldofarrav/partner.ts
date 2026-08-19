import { runHandoff as runPartnerHandoff } from '../../../../trade/PartnerHandoff.js';
import type { QuestStep } from '../../engine/types.js';
import { SOA_ID, SOA_TILE } from './areas.js';
import { ArravConfig, type ArravGang } from './config.js';
import { SOA_STAGE } from './journal.js';
import { otherHalf, ownHalf } from './state.js';

export type ArravHandoff =
    | 'give-key' | 'take-key'
    | 'give-half' | 'take-half'
    | 'give-cert' | 'take-cert';

export interface HandoffInput {
    gang: ArravGang;
    stage: number;
    hasKey: boolean;
    hasOwnHalf: boolean;
    hasOtherHalf: boolean;
    certs: number;
    /** Certificates in the pack, which is the only place a trade can offer from. */
    certsHeld: number;
    certTarget: number;
    partnerConfigured: boolean;
    /** Shield halves this session has handed over. Each one buys the pair two certificates. */
    halvesGiven: number;
    /** Whether this session has already handed a certificate over. */
    gaveCert: boolean;
}

// Why: "I have not farmed my half yet" and "I gave my half away" are the same snapshot — no half, no certificate, joined — and the cupboard re-arms once the half leaves the pack, so nothing durable tells them apart.
// Why: a count rather than a flag, because a stockpile needs one half per two certificates and a flag stops the supplier after the first.
// Why: session scope is enough — a restart farms another half, which is correct work rather than a wedge.
export const ArravHandoffState = { halvesGiven: 0, gaveCert: false };

/**
 * Who owes whom. The phoenix bot is the minter by convention: it is the one that
 * can reach Straven and the curator without being given anything first.
 */
export function decideHandoff(input: HandoffInput): ArravHandoff | null {
    if (!input.partnerConfigured) {
        return null;
    }
    const target = Math.max(1, input.certTarget);

    if (input.gang === 'phoenix') {
        // Why: Straven re-issues the key whenever obj_gettotal reads zero, so giving it away costs nothing.
        if (input.stage >= SOA_STAGE.PHOENIX_JOINED && input.stage < SOA_STAGE.COMPLETE && input.hasKey) {
            return 'give-key';
        }
        if (input.hasOwnHalf && input.hasOtherHalf) {
            return null;
        }
        // Why: the count that matters is the pack — a stockpile sitting in the bank cannot be offered, and the withdraw that fixes that is the certificate step's job.
        if (!input.gaveCert && input.certsHeld >= 2 && input.certs >= target) {
            return 'give-cert';
        }
        if (input.hasOwnHalf) {
            return 'take-half';
        }
        return null;
    }

    if (input.stage === SOA_STAGE.KATRINE_TASK && !input.hasKey) {
        return 'take-key';
    }
    if (input.hasOwnHalf) {
        return 'give-half';
    }
    // Why: each half the pair mints from buys two certificates, so the supplier keeps farming until the target is covered — and asking before the cupboard leg has ever run waits for a certificate only its own half can buy.
    const covered = input.halvesGiven * 2 >= Math.max(1, input.certTarget);
    if (input.stage === SOA_STAGE.BLACKARM_JOINED && input.certs === 0 && covered) {
        return 'take-cert';
    }
    return null;
}

/** What each handoff moves, and in which direction. */
function itemFor(handoff: ArravHandoff, gang: ArravGang): { id: number; name: string; giving: boolean } {
    switch (handoff) {
        case 'give-key': return { id: SOA_ID.STORE_KEY, name: 'Key', giving: true };
        case 'take-key': return { id: SOA_ID.STORE_KEY, name: 'Key', giving: false };
        case 'give-half': return { id: ownHalf(gang), name: 'Broken shield', giving: true };
        case 'take-half': return { id: otherHalf(gang), name: 'Broken shield', giving: false };
        case 'give-cert': return { id: SOA_ID.CERTIFICATE, name: 'Certificate', giving: true };
        case 'take-cert': return { id: SOA_ID.CERTIFICATE, name: 'Certificate', giving: false };
    }
}

export { decideOpenTrade, OPEN_REQUEST_EVERY_MS, type OpenTradeAction } from '../../../../trade/PartnerHandoff.js';

export async function runHandoff(handoff: ArravHandoff, gang: ArravGang, log: (m: string) => void): Promise<boolean> {
    const want = itemFor(handoff, gang);
    const moved = await runPartnerHandoff({
        partner: ArravConfig.partner,
        rendezvous: SOA_TILE.RENDEZVOUS,
        id: want.id,
        name: want.name,
        giving: want.giving,
        label: handoff,
        log
    });
    if (!moved) {
        return false;
    }
    if (handoff === 'give-half') {
        ArravHandoffState.halvesGiven++;
    }
    if (handoff === 'give-cert') {
        ArravHandoffState.gaveCert = true;
    }
    return true;
}

export function handoffStep(handoff: ArravHandoff, gang: ArravGang): QuestStep {
    return {
        kind: 'custom',
        name: `${handoff} with ${ArravConfig.partner}`,
        run: log => runHandoff(handoff, gang, log)
    };
}
