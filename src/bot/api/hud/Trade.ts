import { actions, reader } from '../../adapter/ClientAdapter.js';
import { ActionRouter } from '../../input/ActionRouter.js';
import { Execution } from '../Execution.js';
import { Players } from '../queries/Players.js';

const TRADE_OP = 4; // OP_PLAYER4 = "Trade with" (login.rs2: set_player_op("Trade with", 4))
const OFFER_INV = 3322; // tradeside:inv — your pack while trading; option4 = "Offer All"
const OFFER_ALL = 4;
const ACCEPT_OFFER = 3420; // trademain:accept (first screen)
const ACCEPT_CONFIRM = 3546; // tradeconfirm:accept (second screen)
const DECLINE = 3422; // trademain:decline

export interface TradeItem {
    id: number;
    name: string | null;
    count: number;
}

function toItem(s: { id: number; name: string | null; count: number }): TradeItem {
    return { id: s.id, name: s.name, count: s.count };
}

// Two-party trade. Both players "Trade with" each other; the first request notifies,
// the second opens the offer screen for both. Offer screen -> accept -> confirm screen
// -> accept -> items change hands. See interface_trade + login.rs2.
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

    // The other player's name, parsed from the "Trading With: <name>" header.
    partner(): string | null {
        const header = reader.tradePartner();
        if (!header) {
            return null;
        }

        const colon = header.indexOf(':');
        const name = (colon === -1 ? header : header.slice(colon + 1)).trim();
        return name || null;
    },

    myOffer(): TradeItem[] {
        return reader.tradeMyOffer().map(toItem);
    },

    theirOffer(): TradeItem[] {
        return reader.tradeTheirOffer().map(toItem);
    },

    // "Trade with" the nearest player of this name. The screen only opens once the
    // other player has also requested — poll onOfferScreen() to know when.
    async request(playerName: string): Promise<boolean> {
        const target = Players.query().name(playerName).nearest();
        if (!target) {
            return false;
        }

        return ActionRouter.driver.interactPlayer(target.index, TRADE_OP);
    },

    // Move the whole stack of an item from your pack into the offer. `pick` chooses
    // among slots of the same name — e.g. to offer only unnoted essence (count === 1)
    // while a noted stack (count > 1) of the same name stays in the pack.
    async offerAll(itemName: string, pick?: (i: { count: number; id: number; slot: number }) => boolean): Promise<boolean> {
        if (!reader.tradeOfferOpen()) {
            return false;
        }

        const matches = reader.tradeSidePack().filter(i => i.name?.toLowerCase() === itemName.toLowerCase());
        const it = pick ? matches.find(pick) : matches[0];
        if (!it) {
            return false;
        }

        return ActionRouter.driver.invButton(it.id, it.slot, OFFER_INV, OFFER_ALL);
    },

    // Accept whichever screen is showing. Both screens need a separate accept.
    async accept(): Promise<boolean> {
        if (reader.tradeConfirmOpen()) {
            return actions.ifButton(ACCEPT_CONFIRM);
        }

        if (reader.tradeOfferOpen()) {
            return actions.ifButton(ACCEPT_OFFER);
        }

        return false;
    },

    async decline(): Promise<void> {
        if (!Trade.active()) {
            return;
        }

        actions.ifButton(DECLINE);
        await Execution.delayUntil(() => !Trade.active(), 3000);
    }
};
