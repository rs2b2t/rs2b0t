/**
 * Drive an already-open partner trade through offer / accept / confirm.
 * Used by GatheringBot mule modes and FlaxRunner (Runner/Spinner handoff).
 *
 * Policy (partner filter, empty-own-offer safety) stays in {@link PartnerTrade};
 * this module sequences HUD actions from those decisions plus optional script hooks.
 */
import { Execution } from '../Execution.js';
import { Inventory } from '../hud/Inventory.js';
import { Trade } from '../hud/Trade.js';
import {
    countOfferMatching,
    decideGiverOfferScreen,
    decideReceiverOfferScreen
} from './PartnerTrade.js';

export type PartnerTradeRole = 'giver' | 'receiver';

export interface DrivePartnerTradeOpts {
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

/**
 * One beat of an active trade. Call while {@link Trade.active} from a Task
 * that owns the loop (movement cancels the modal).
 */
export async function driveActivePartnerTrade(opts: DrivePartnerTradeOpts): Promise<void> {
    const labels = opts.labels ?? {};
    const metric = opts.inventoryMetric ?? (() => Inventory.used());

    if (Trade.onConfirmScreen()) {
        opts.setStatus(labels.confirming ?? 'mule: confirming trade');
        const before = metric();
        await Trade.accept();
        if (await Execution.delayUntilTicks(() => !Trade.active(), 7)) {
            const delta = metric() - before;
            if (opts.onComplete) {
                opts.onComplete(delta);
            } else {
                opts.log(`mule: trade complete (inv Δ${delta >= 0 ? '+' : ''}${delta})`);
            }
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
                opts.log('trade partner name never appeared — declining stuck modal');
                await Trade.decline();
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
            opts.log(`mule: ${decision.reason}`);
            await Trade.decline();
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
                opts.log(reason);
                await Trade.decline();
                opts.onDecline?.(reason);
                return;
            }
        }

        opts.setStatus(labels.accepting ?? 'mule: accepting product');
        await Trade.accept();
        return;
    }

    // Giver: offer haul then accept.
    if (opts.verifyGiverPartner) {
        const who = Trade.partner();
        if (who === null) {
            const action = opts.onMissingPartner?.() ?? 'wait';
            if (action === 'decline') {
                opts.setStatus(labels.declining ?? 'mule: declining trade');
                opts.log('trade partner name never appeared — declining stuck modal');
                await Trade.decline();
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
            opts.log(`mule: ${partnerGate.reason}`);
            await Trade.decline();
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
            await Trade.decline();
            opts.onDecline?.('nothing to offer');
            return;
        }
        opts.setStatus(labels.offering ?? `mule: offering ${names.join(', ')}`);
        for (const name of names) {
            await Trade.offerAll(name);
        }
        await Execution.delayUntilTicks(
            () =>
                (opts.myOfferReady?.() ?? Trade.myOffer().length > 0) ||
                Trade.onConfirmScreen() ||
                !Trade.active(),
            7
        );
        return;
    }
    opts.setStatus(labels.acceptingOffer ?? 'mule: accepting handoff');
    await Trade.accept();
    await Execution.delayUntilTicks(() => Trade.onConfirmScreen() || !Trade.active(), 7);
}
