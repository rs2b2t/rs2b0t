import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Input } from '../../input/Input.js';
import { Execution } from '../execution/Execution.js';
import { Players } from '../players/Players.js';

const TRADE_OP = 4; // OP_PLAYER4 = "Trade with" (login.rs2: set_player_op("Trade with", 4))
const OFFER_INV = 3322; // tradeside:inv, your pack while trading; option4 = "Offer All"
const OFFER_ALL = 4;
const OFFER_X = 5; // tradeside option5 = "Offer X" -> count dialog
const MY_OFFER_INV = 3415; // trademain:inv, your side of the offer
const REMOVE_ALL = 4; // inv_button4 = @removefromtrade(slot, max)
const ACCEPT_OFFER = 3420; // trademain:accept (first screen)
const ACCEPT_CONFIRM = 3546; // tradeconfirm:accept (second screen)
const DECLINE = 3422; // trademain:decline
/** Short, since on content without the trigger this wait is pure latency before the close. */
const DECLINE_BUTTON_WAIT_MS = 1200;

export interface TradeItem {
    id: number;
    name: string | null;
    count: number;
}

function toItem(s: { id: number; name: string | null; count: number }): TradeItem {
    return { id: s.id, name: s.name, count: s.count };
}

/** Strip `Trading With:` (and similar) to a bare display name. Exported for unit tests. */
export function parseTradePartnerHeader(header: string): string | null {
    let name = header.trim();
    if (name.length === 0) {
        return null;
    }
    const colon = name.indexOf(':');
    if (colon !== -1) {
        name = name.slice(colon + 1).trim();
    } else {
        name = name.replace(/^trading with\s+/i, '').trim();
    }
    return name.length > 0 ? name : null;
}

// Why: both players must "Trade with" each other to open the screen, then both accept the offer and confirm.
// Why: any movement or combat closes the modal, so a trade needs a dedicated task to own the loop while it is open.

/**
 * Player-to-player trading.
 * @see docs/reference/api-items.md#item-acquisition
 */
export const Trade = {
    onOfferScreen(): boolean {
        return reader.tradeOfferOpen();
    },

    onConfirmScreen(): boolean {
        return reader.tradeConfirmOpen();
    },

    active(): boolean {
        return reader.tradeOfferOpen() || reader.tradeConfirmOpen();
    },

    /**
     * Other player's display name from the offer-screen header
     * (`Trading With: <name>`). Returns null while the label has not filled.
     */
    partner(): string | null {
        const header = reader.tradePartner();
        if (!header) {
            return null;
        }
        return parseTradePartnerHeader(header);
    },

    myOffer(): TradeItem[] {
        return reader.tradeMyOffer().map(toItem);
    },

    theirOffer(): TradeItem[] {
        return reader.tradeTheirOffer().map(toItem);
    },

    async request(playerName: string): Promise<boolean> {
        const target = Players.query().name(playerName).nearest();
        if (!target) {
            return false;
        }

        return Input.interactPlayer(target.index, TRADE_OP);
    },

    // pick chooses among same-name slots (e.g. offer only unnoted essence, not the noted stack)
    async offerAll(itemName: string, pick?: (i: { count: number; id: number; slot: number }) => boolean): Promise<boolean> {
        if (!reader.tradeOfferOpen()) {
            return false;
        }

        const matches = reader.tradeSidePack().filter(i => i.name?.toLowerCase() === itemName.toLowerCase());
        const it = pick ? matches.find(pick) : matches[0];
        if (!it) {
            return false;
        }

        return Input.invButton(it.id, it.slot, OFFER_INV, OFFER_ALL);
    },

    // offer n (never more): Offer-X + count dialog; pick chooses among same-name slots
    async offer(itemName: string, n: number, pick?: (i: { count: number; id: number; slot: number }) => boolean): Promise<boolean> {
        if (n <= 0 || !reader.tradeOfferOpen()) {
            return false;
        }

        const matches = reader.tradeSidePack().filter(i => i.name?.toLowerCase() === itemName.toLowerCase());
        const it = pick ? matches.find(pick) : matches[0];
        if (!it) {
            return false;
        }

        if (!(await Input.invButton(it.id, it.slot, OFFER_INV, OFFER_X))) {
            return false;
        }

        if (!(await Execution.delayUntil(() => reader.countDialogOpen(), 3000))) {
            return false;
        }

        actions.answerCountDialog(n);
        return Execution.delayUntil(() => Trade.myOffer().reduce((s, o) => s + Math.max(1, o.count), 0) >= n, 4000);
    },

    /** Take everything back off your own side. */
    // Why: re-deriving an offer from scratch is two operations and cannot drift, where nudging it item by item has to reason about what is already up.
    async removeAll(): Promise<boolean> {
        if (!reader.tradeOfferOpen()) {
            return false;
        }
        for (let guard = 0; guard < 28; guard++) {
            const mine = reader.tradeMyOffer();
            if (mine.length === 0) {
                return true;
            }
            const it = mine[0];
            await Input.invButton(it.id, it.slot, MY_OFFER_INV, REMOVE_ALL);
            await Execution.delayTicks(1);
        }
        return reader.tradeMyOffer().length === 0;
    },

    async accept(): Promise<boolean> {
        if (reader.tradeConfirmOpen()) {
            return actions.ifButton(ACCEPT_CONFIRM);
        }

        if (reader.tradeOfferOpen()) {
            return actions.ifButton(ACCEPT_OFFER);
        }

        return false;
    },

    // Why: rs2b2t content wires declining to [if_close,trademain] / [if_close,tradeconfirm], which is what returns the offered items and tells the partner. `trademain:decline` (3422) carries no if_button trigger there, so clicking it alone answers "No trigger for [if_button,trademain:decline]" and leaves the window open with the goods in it.
    async decline(): Promise<void> {
        if (!Trade.active()) {
            return;
        }

        actions.ifButton(DECLINE);
        if (await Execution.delayUntil(() => !Trade.active(), DECLINE_BUTTON_WAIT_MS)) {
            return;
        }

        actions.closeModal();
        await Execution.delayUntil(() => !Trade.active(), 3000);
    }
};
