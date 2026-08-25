// Drive an already-open partner trade through offer, accept and confirm.

// Why: it is used by GatheringBot mule modes and by FlaxRunner's Runner/Spinner handoff.
// Why: policy, the partner filter and the empty-own-offer safety, stays in {@link PartnerTrade}, and this module sequences HUD actions from those decisions plus optional script hooks.
import { Execution } from '../execution/Execution.js';
import { Inventory } from '../inventory/Inventory.js';
import { Trade } from './Trade.js';
import {
    countOfferMatching,
    decideGiverOfferScreen,
    decideReceiverOfferScreen
} from './PartnerTrade.js';

type PartnerTradeRole = 'giver' | 'receiver';

interface DrivePartnerTradeOpts {
    role: PartnerTradeRole;
    partners: readonly string[];
    /** Receiver: which of their offer slots count as product. */
    theirProductMatch: (name: string) => boolean;
    /** Giver: product stack names to Offer-All (case-sensitive display names). */
    productNamesToOffer: () => readonly string[];
    setStatus: (s: string) => void;
    log: (m: string) => void;
    /**
     * Called once when confirm completes and the modal closes.
     * `metricDelta` is after − before from {@link inventoryMetric}.
     */
    onComplete?: (metricDelta: number) => void;
    /** Called when we decline (stranger, empty haul, safety, receiver gate). */
    onDecline?: (reason: string) => void;
    /**
     * Metric for confirm delta (default {@link Inventory.used}).
     * FlaxRunner uses flax stack counts instead.
     */
    inventoryMetric?: () => number;
    /**
     * When partner header is still null. Default waits one tick.
     * Flax declines after ~8 consecutive waits.
     */
    onMissingPartner?: () => 'wait' | 'decline';
    /**
     * Receiver: after their product is present, extra gate (e.g. free pack slots).
     */
    receiverCanAccept?: (
        theirProductCount: number
    ) => boolean | { ok: true } | { ok: false; reason: string };
    /**
     * Giver: when offer is "ready" to accept (default: any own offer slot).
     * Flax uses flax units in offer.
     */
    myOfferReady?: () => boolean;
    // Why: the metric snapshot must come from handshake start, since a giver's offered stack leaves the pack at offer time and a confirm-time baseline would read every completed trade as Δ0.
    baseline?: () => number;
    /**
     * Giver: decline non-partners / wait on blank header (Flax). Default false
     * so GatheringBot gatherer keeps offering without a partner-header gate.
     */
    verifyGiverPartner?: boolean;
    /** Optional status labels. */
    labels?: {
        accepting?: string;
        offering?: string;
        confirming?: string;
        waitHeader?: string;
        waitOffer?: string;
        declining?: string;
        acceptingOffer?: string;
    };
}

// Why: partner accepts and offer sync are not tied to this client's tick rate, so {@link Execution.delayUntilTicks} is wrong here, a live harness at 300ms ticks makes 7 ticks about 2.1s, too short for a mutual Trade or confirm.
// Why: the Flax and Nature waits these replace were 3–4s wall-clock.

/** Wall-clock waits for the multiplayer trade UI. */
const TRADE_OFFER_WAIT_MS = 5_000;
const TRADE_CONFIRM_WAIT_MS = 8_000;

function tradeScreen(): string {
    if (Trade.onOfferScreen()) {
        return 'offer';
    }
    if (Trade.onConfirmScreen()) {
        return 'confirm';
    }
    return Trade.active() ? 'unknown' : 'closed';
}

/** Which trade screen is up, for scripts that log hand-back diagnostics. */
export function tradeScreenState(): string {
    return tradeScreen();
}

// Why: the offer→confirm swap reports neither screen for a stretch, so closure needs ~250ms of continuous inactivity, which also holds under uneven frame rates.
function stableClosedPoll(minMs = 250): () => boolean {
    let inactiveSince = -1;
    return () => {
        if (Trade.active()) {
            inactiveSince = -1;
            return false;
        }
        const now = performance.now();
        if (inactiveSince < 0) {
            inactiveSince = now;
        }
        return now - inactiveSince >= minMs;
    };
}

/**
 * One beat of an active trade. Call while {@link Trade.active} from a Task
 * that owns the loop (movement cancels the modal).
 */
export async function driveActivePartnerTrade(opts: DrivePartnerTradeOpts): Promise<void> {
    const labels = opts.labels ?? {};
    const metric = opts.inventoryMetric ?? (() => Inventory.used());

    if (Trade.onConfirmScreen()) {
        opts.setStatus(labels.confirming ?? 'mule: confirming trade');
        const before = opts.baseline?.() ?? metric();
        opts.log(`trade: clicking Accept on the confirm screen (${tradeScreen()})`);
        await Trade.accept();
        // Both players must confirm; wait wall-clock for the modal to close.
        const closed = await Execution.delayUntil(stableClosedPoll(), TRADE_CONFIRM_WAIT_MS);
        opts.log(`trade: confirm wait ${closed ? 'satisfied' : 'TIMED OUT'} after the last click — screen now ${tradeScreen()}`);
        if (!Trade.active()) {
            // Why: this was the last click of the trade, so settle a beat after the modal reports closed; a gather click fired during teardown is swallowed and stalls the loop.
            await Execution.delayTicks(1);
            const delta = metric() - before;
            if (opts.onComplete) {
                opts.onComplete(delta);
            } else {
                opts.log(`mule: trade complete (inv Δ${delta >= 0 ? '+' : ''}${delta})`);
            }
        } else {
            opts.log('mule: confirm still open after wait — partner may not have accepted');
        }
        return;
    }

    if (!Trade.onOfferScreen()) {
        return;
    }

    if (opts.role === 'receiver') {
        const who = Trade.partner();
        if (who === null) {
            const action = opts.onMissingPartner?.() ?? 'wait';
            if (action === 'decline') {
                opts.setStatus(labels.declining ?? 'mule: declining trade');
                opts.log('trade: declining — partner name never appeared on the modal');
                await Trade.decline();
                opts.log(`trade: decline clicked — screen now ${tradeScreen()}`);
                opts.onDecline?.('partner header timeout');
                return;
            }
            opts.setStatus(labels.waitHeader ?? 'mule: reading partner');
            await Execution.delayTicks(1);
            return;
        }

        const decision = decideReceiverOfferScreen({
            partnerHeader: who,
            partners: opts.partners,
            myOfferSlots: Trade.myOffer().length,
            theirProductCount: countOfferMatching(Trade.theirOffer(), opts.theirProductMatch)
        });
        if (decision.action === 'wait-header' || decision.action === 'wait-offer') {
            opts.setStatus(
                decision.action === 'wait-header'
                    ? (labels.waitHeader ?? 'mule: reading partner')
                    : (labels.waitOffer ?? 'mule: waiting for product offer')
            );
            await Execution.delayTicks(1);
            return;
        }
        if (decision.action === 'decline') {
            opts.setStatus(labels.declining ?? 'mule: declining trade');
            opts.log(`trade: declining (${decision.reason})`);
            await Trade.decline();
            opts.log(`trade: decline clicked — screen now ${tradeScreen()}`);
            opts.onDecline?.(decision.reason);
            return;
        }

        const theirN = countOfferMatching(Trade.theirOffer(), opts.theirProductMatch);
        if (opts.receiverCanAccept) {
            const gate = opts.receiverCanAccept(theirN);
            const ok = gate === true || (typeof gate === 'object' && gate.ok === true);
            if (!ok) {
                const reason =
                    typeof gate === 'object' && 'reason' in gate
                        ? gate.reason
                        : 'receiver cannot accept offer';
                opts.setStatus(labels.declining ?? 'mule: declining trade');
                opts.log(`trade: declining (${reason})`);
                await Trade.decline();
                opts.log(`trade: decline clicked — screen now ${tradeScreen()}`);
                opts.onDecline?.(reason);
                return;
            }
        }

        opts.setStatus(labels.accepting ?? 'mule: accepting product');
        const beforeAccept = metric();
        opts.log(`trade: clicking Accept on the offer screen (${tradeScreen()})`);
        await Trade.accept();
        // Wait for confirm screen or modal close so the next beat sees confirm.
        const settled = stableClosedPoll();
        await Execution.delayUntil(
            () => Trade.onConfirmScreen() || settled(),
            TRADE_OFFER_WAIT_MS
        );
        if (Trade.onConfirmScreen()) {
            opts.log('trade: offer accepted — confirm screen is up');
        } else if (settled() && !Trade.active()) {
            const d = metric() - beforeAccept;
            opts.log(`trade: window closed after OUR offer-accept without reaching confirm — partner declined, walked or cancelled (inv Δ${d >= 0 ? '+' : ''}${d})`);
        } else {
            opts.log(`trade: offer-accept wait TIMED OUT — screen now ${tradeScreen()}`);
        }
        return;
    }

    // Giver: offer haul then accept.
    if (opts.verifyGiverPartner) {
        const who = Trade.partner();
        if (who === null) {
            const action = opts.onMissingPartner?.() ?? 'wait';
            if (action === 'decline') {
                opts.setStatus(labels.declining ?? 'mule: declining trade');
                opts.log('trade: declining — partner name never appeared on the modal');
                await Trade.decline();
                opts.log(`trade: decline clicked — screen now ${tradeScreen()}`);
                opts.onDecline?.('partner header timeout');
                return;
            }
            opts.setStatus(labels.waitHeader ?? 'mule: reading partner');
            await Execution.delayTicks(1);
            return;
        }
        const partnerGate = decideReceiverOfferScreen({
            partnerHeader: who,
            partners: opts.partners,
            myOfferSlots: 0,
            theirProductCount: 1
        });
        if (partnerGate.action === 'decline') {
            opts.setStatus(labels.declining ?? 'mule: declining trade');
            opts.log(`trade: declining (${partnerGate.reason})`);
            await Trade.decline();
            opts.log(`trade: decline clicked — screen now ${tradeScreen()}`);
            opts.onDecline?.(partnerGate.reason);
            return;
        }
    }

    const offerReady =
        opts.myOfferReady?.() ?? Trade.myOffer().length > 0;
    const step = decideGiverOfferScreen(offerReady ? 1 : 0);
    if (step === 'offer') {
        const names = opts.productNamesToOffer();
        if (names.length === 0) {
            opts.setStatus('mule: nothing to offer — declining');
            opts.log('trade: declining (nothing to offer)');
            await Trade.decline();
            opts.log(`trade: decline clicked — screen now ${tradeScreen()}`);
            opts.onDecline?.('nothing to offer');
            return;
        }
        opts.setStatus(labels.offering ?? `mule: offering ${names.join(', ')}`);
        let anyOffered = false;
        for (const name of names) {
            if (await Trade.offerAll(name)) {
                anyOffered = true;
            } else {
                opts.log(`mule: offerAll failed for ${name}`);
            }
        }
        if (!anyOffered) {
            opts.setStatus('mule: declining trade');
            opts.log('trade: declining (offerAll failed for every product)');
            await Trade.decline();
            opts.log(`trade: decline clicked — screen now ${tradeScreen()}`);
            opts.onDecline?.('offerAll failed');
            return;
        }
        // Wait until the offer side shows product (or modal dies) before accept beat.
        const settled = stableClosedPoll();
        await Execution.delayUntil(
            () =>
                (opts.myOfferReady?.() ?? Trade.myOffer().length > 0)
                || Trade.onConfirmScreen()
                || settled(),
            TRADE_OFFER_WAIT_MS
        );
        if (settled() && !Trade.active()) {
            opts.log('trade: window closed while waiting for the offer to register — partner declined, walked or cancelled');
        }
        return;
    }
    const beforeAccept = metric();
    opts.setStatus(labels.acceptingOffer ?? 'mule: accepting handoff');
    opts.log(`trade: clicking Accept on the offer screen (${tradeScreen()})`);
    await Trade.accept();
    const stable = stableClosedPoll();
    await Execution.delayUntil(
        () => Trade.onConfirmScreen() || stable(),
        TRADE_OFFER_WAIT_MS
    );
    if (Trade.onConfirmScreen()) {
        opts.log('trade: offer accepted — confirm screen is up');
    } else if (stable() && !Trade.active()) {
        const d = metric() - beforeAccept;
        opts.log(`trade: window closed after OUR offer-accept without reaching confirm — partner declined, walked or cancelled (inv Δ${d >= 0 ? '+' : ''}${d})`);
    } else {
        opts.log(`trade: offer-accept wait TIMED OUT — screen now ${tradeScreen()}`);
    }
}
