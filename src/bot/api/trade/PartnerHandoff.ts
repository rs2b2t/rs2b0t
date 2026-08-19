import { reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../execution/Execution.js';
import { Inventory } from '../inventory/Inventory.js';
import { Modals } from '../ui/widgets/Modals.js';
import { Players } from '../players/Players.js';
import { Trade } from './Trade.js';
import { DEFAULT_TRADE_RANGE, namesMatch } from './PartnerTrade.js';
import { Traversal } from '../walking/Traversal.js';
import type Tile from '../../geometry/Tile.js';

// Why: partner accepts are not tied to this client's tick rate, so these are wall-clock — a harness at
// 300ms ticks makes seven ticks about 2.1s, too short for a mutual Trade.
const MEET_MS = 90_000;
const SCREEN_MS = 8_000;
const HANDOFF_MS = 120_000;

/** How often the mutual Trade-with click is re-sent while the partner stands in range. */
export const OPEN_REQUEST_EVERY_MS = 3_000;

export type OpenTradeAction = 'done' | 'wait' | 'request' | 'give-up';

// Why: `[opplayer4,_]` opens the window on the second of the two clicks and keeps its varps with no
// expiry, so re-sending completes a handshake whose first click was dropped.
export function decideOpenTrade(input: {
    tradeActive: boolean;
    partnerNear: boolean;
    nowMs: number;
    deadlineMs: number;
    nextRequestAtMs: number;
}): OpenTradeAction {
    if (input.tradeActive) {
        return 'done';
    }
    if (input.nowMs >= input.deadlineMs) {
        return 'give-up';
    }
    if (!input.partnerNear) {
        return 'wait';
    }
    return input.nowMs >= input.nextRequestAtMs ? 'request' : 'wait';
}

function partnerNear(partner: string): boolean {
    const name = partner.trim();
    if (name.length === 0) {
        return false;
    }
    return Players.query().where(p => namesMatch(p.name ?? '', name)).within(DEFAULT_TRADE_RANGE).nearest() !== null;
}

/** Drive the mutual Trade-with until the window opens, the partner never returns, or the budget runs out. */
async function openTrade(partner: string, log: (m: string) => void): Promise<boolean> {
    const deadline = performance.now() + MEET_MS;
    let nextRequestAt = 0;
    let waitedFor = false;
    for (;;) {
        const action = decideOpenTrade({
            tradeActive: Trade.active(),
            partnerNear: partnerNear(partner),
            nowMs: performance.now(),
            deadlineMs: deadline,
            nextRequestAtMs: nextRequestAt
        });
        if (action === 'done') {
            return true;
        }
        if (action === 'give-up') {
            log(`trade with '${partner}' never opened within ${Math.round(MEET_MS / 1000)}s`);
            return false;
        }
        if (action === 'request') {
            if (!(await Trade.request(partner))) {
                log(`could not open a trade with '${partner}'`);
                return false;
            }
            nextRequestAt = performance.now() + OPEN_REQUEST_EVERY_MS;
        } else if (!waitedFor && !partnerNear(partner)) {
            // Why: the giver leaves the moment its own item lands, so the taker's partner is en route rather than gone.
            log(`waiting for '${partner}' to come back into trade range`);
            waitedFor = true;
        }
        await Execution.delayTicks(2);
    }
}

export interface HandoffSpec {
    /** Character name of the bot on the other side. */
    partner: string;
    /** Where both sides walk to meet. */
    rendezvous: Tile;
    /** Object id being moved. Ids, never names — Key, Herb and Certificate each name several objects. */
    id: number;
    /** Display name of that object, for the offer click. */
    name: string;
    giving: boolean;
    /** Log prefix, e.g. `give-key`. */
    label: string;
    log: (m: string) => void;
}

/**
 * Move one object between two bots and prove it landed.
 * @see docs/decisions/quest-pitfalls-7.md
 */
export async function runHandoff(spec: HandoffSpec): Promise<boolean> {
    const { partner, id, name, giving, label, log } = spec;
    let confirmed = false;
    // Why: an item already moved into the offer is gone from the pack view, so a give is believed only
    // once the window is shut and the pack reads back.

    // Why: the baseline is taken with no window open, because declining an open trade to grab one kills
    // the handshake the partner is in.
    const before = Trade.active() ? null : Inventory.countById(id);
    const packReadable = (): boolean => Inventory.used() > 0;
    const landed = (): boolean => {
        const now = Inventory.countById(id);
        if (!giving) {
            return before === null ? now > 0 : now > before;
        }
        if (Trade.active() || !packReadable()) {
            return false;
        }
        // Why: a giver that keeps one of two is still a giver, so "gone from the pack" is the wrong test.
        return before === null ? confirmed : now < before;
    };

    if (landed()) {
        return true;
    }
    if (giving && before === 0) {
        log(`nothing to give: no ${name} (${id}) in the pack`);
        return false;
    }

    // Why: a main modal left over from the last conversation swallows the Trade-with click, and the
    // window then never opens for either side.
    if (reader.modals().main !== -1) {
        await Modals.close();
    }
    if (!(await Traversal.walkResilient(spec.rendezvous, { radius: 2, attempts: 3, timeoutMs: MEET_MS, log }))) {
        return false;
    }
    // Why: a wait step would park the quest after fifteen identical passes, so the wait for a partner
    // lives inside the leg — openTrade owns both the wait and the clicking.

    if (!Trade.active() && !(await openTrade(partner, log))) {
        return false;
    }

    const deadline = performance.now() + HANDOFF_MS;
    let offered = false;
    let last = '';
    while (performance.now() < deadline) {
        // Why: the engine shuts the offer screen a tick before it opens the confirm, so one frame with
        // neither up is the handover, not the end of the trade.
        if (!Trade.active()) {
            await Execution.delayTicks(3);
            if (!Trade.active()) {
                break;
            }
        }
        const who = Trade.partner();
        if (who !== null && !namesMatch(who, partner)) {
            log(`declining a trade from '${who}' — not the configured partner`);
            await Trade.decline();
            return false;
        }

        const screen = Trade.onConfirmScreen() ? 'confirm' : 'offer';
        const ids = (slots: readonly { id: number; count: number }[]): string =>
            slots.map(s => `${s.id}x${s.count}`).join(',') || '-';
        const state = `${screen} modal=${reader.modals().main} want=${id}`
            + ` mine=[${ids(Trade.myOffer())}] theirs=[${ids(Trade.theirOffer())}]`;
        if (state !== last) {
            log(`${label}: ${state}`);
            last = state;
        }

        if (Trade.onConfirmScreen()) {
            await Trade.accept();
            confirmed = true;
            await Execution.delayUntil(() => !Trade.active(), SCREEN_MS);
            continue;
        }

        if (giving && !offered) {
            // Why: the slot is chosen by id, because more than one object can share the display name.
            if (!(await Trade.offer(name, 1, slot => slot.id === id))) {
                log(`could not offer ${name} (${id})`);
                await Trade.decline();
                return false;
            }
            offered = true;
            continue;
        }

        // Why: the taker must not accept an empty offer — the giver may still be walking to the window.
        if (!giving && !Trade.theirOffer().some(o => o.id === id)) {
            await Execution.delayTicks(1);
            continue;
        }

        // Why: one accept per screen — the engine sets pending on each click and opens the confirm on
        // the second player's, so hammering it adds nothing and the re-clicks race the handover.
        const clicked = await Trade.accept();
        log(`${label}: accept on ${screen} -> ${clicked}`);
        await Execution.delayUntil(() => Trade.onConfirmScreen() || !Trade.active(), SCREEN_MS);
    }

    // Why: the pack view only comes back once the window is gone, so nothing is measured before then.
    await Execution.delayUntil(() => !Trade.active(), SCREEN_MS);
    await Execution.delayTicks(2);

    if (!landed()) {
        log(`${label} did not move a ${name} (offered=${offered} confirmed=${confirmed})`);
        return false;
    }
    log(`${label} moved a ${name}`);
    return true;
}
