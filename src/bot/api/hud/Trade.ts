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

// Two-party: both players must "Trade with" each other to open the screen, then both accept offer + confirm.
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

    async request(playerName: string): Promise<boolean> {
        const target = Players.query().name(playerName).nearest();
        if (!target) {
            return false;
        }

        return ActionRouter.driver.interactPlayer(target.index, TRADE_OP);
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

        return ActionRouter.driver.invButton(it.id, it.slot, OFFER_INV, OFFER_ALL);
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

    async decline(): Promise<void> {
        if (!Trade.active()) {
            return;
        }

        actions.ifButton(DECLINE);
        await Execution.delayUntil(() => !Trade.active(), 3000);
    }
};
