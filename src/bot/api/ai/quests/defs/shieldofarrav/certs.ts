import { Inventory } from '../../../../inventory/Inventory.js';
import { bankedId, heldId, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { CURATOR, ROALD, SOA_ID } from './areas.js';
import { ArravConfig, type ArravGang } from './config.js';
import { talkUntil } from './hideout.js';
import { ArravHandoffState } from './partner.js';
import { otherHalf, ownHalf } from './state.js';

// Why: both conversations run through `~mesbox` / `~objbox`, which build a main modal no chat driver can see.

/** Hand both halves over for 2 certificates. */
export async function mintCertificates(log: (m: string) => void): Promise<boolean> {
    const before = Inventory.countById(SOA_ID.CERTIFICATE);
    return talkUntil(CURATOR, [], () => Inventory.countById(SOA_ID.CERTIFICATE) > before, log);
}

/** Redeem one certificate with the king; that completes the quest. */
export async function redeemCertificate(log: (m: string) => void): Promise<boolean> {
    const before = Inventory.countById(SOA_ID.CERTIFICATE);
    return talkUntil(ROALD, [], () => Inventory.countById(SOA_ID.CERTIFICATE) < before, log);
}

/** `ownsInventory` skips the engine's food provisioning, so the module's own deposits have to spare it. */
export const SUSTAIN_KEEP: readonly string[] = ['lobster', 'swordfish', 'tuna', 'trout', 'salmon'];

/** Everything the module keeps out of a deposit while it is minting. */
export const CERT_KEEP_IDS: readonly number[] = [
    SOA_ID.CERTIFICATE,
    SOA_ID.SHIELD_PHOENIX,
    SOA_ID.SHIELD_BLACKARM,
    SOA_ID.STORE_KEY,
    SOA_ID.COINS
];

export function certsHeld(snap: QuestSnapshot): number {
    return heldId(snap, SOA_ID.CERTIFICATE);
}

export function certsBanked(snap: QuestSnapshot): number {
    return bankedId(snap, SOA_ID.CERTIFICATE);
}

/** Join both halves with the curator before any partner handoff. */
export function curatorStep(snap: QuestSnapshot, gang: ArravGang): QuestStep | null {
    const pair = [ownHalf(gang), otherHalf(gang)];
    // Why: test the total across pack and bank; a predicate that flips as the halves move makes a withdraw and a deposit undo each other every tick.
    if (pair.some(id => heldId(snap, id) + bankedId(snap, id) === 0)) {
        return null;
    }
    const short = pair.filter(id => heldId(snap, id) === 0);
    if (short.length > 0) {
        return { kind: 'withdraw', items: short.map(id => ({ name: 'Broken shield', qty: 1, id })) };
    }
    // Why: he mints 2 per pair and stops once either varp goes complete, so this is the only window.
    return { kind: 'custom', name: 'mint two certificates at the curator', run: mintCertificates };
}

// Why: this runs after the handoffs, so the partner is paid before this bot spends the last certificate it holds.

/** Redeeming, withdrawing and banking the surplus; null when nothing is due. */
export function certStep(snap: QuestSnapshot, gang: ArravGang): QuestStep | null {
    const held = certsHeld(snap);
    const banked = certsBanked(snap);
    const target = Math.max(1, ArravConfig.certTarget);
    // Why: only the phoenix bot reaches Straven and the curator unaided, so only it mints and only it is held to the stockpile target.
    // Why: Solo accounts cannot produce a second certificate, so do not wait for partner stock.
    const minting = gang === 'phoenix' && ArravConfig.partner.trim().length > 0;
    // Why: test the total across pack and bank; a predicate that flips as certificates move makes the deposit and the withdraw undo each other every tick.
    // Why: handing the partner its certificate ends minting whatever the total reads, since giving one away drops it below target again.
    const doneMinting = !minting || ArravHandoffState.gaveCert || held + banked >= target;

    if (doneMinting) {
        if (held > 0) {
            return { kind: 'custom', name: 'claim the reward from King Roald', run: redeemCertificate };
        }
        if (banked > 0) {
            // Why: withdraw 2 while a partner is owed one: redeem one, trade the other, and a trade can only offer from the pack.
            const owed = ArravConfig.partner.trim().length > 0 && !ArravHandoffState.gaveCert && gang === 'phoenix';
            const qty = owed ? Math.min(2, banked) : 1;
            return {
                kind: 'withdraw',
                items: [{ name: 'Certificate', qty, id: SOA_ID.CERTIFICATE }]
            };
        }
        return null;
    }

    // Why: a spare half can't be banked (the chest and cupboard re-check the bank), so only the certificate stockpiles.
    if (held >= 2) {
        return {
            kind: 'deposit',
            keep: [...SUSTAIN_KEEP],
            keepIds: CERT_KEEP_IDS.filter(id => id !== SOA_ID.CERTIFICATE)
        };
    }

    return null;
}
