import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Input } from '../../input/Input.js';
import type { Player } from '../../api/model/Player.js';
import { Modals } from '../../api/ui/widgets/Modals.js';

// 2004scape's Duel Arena contract (game_duelarena/duel_arena.rs2):
// set_player_op("Challenge", 1) in the lobby and "Fight", 2 in an arena.
const CHALLENGE_OP = 1;
const FIGHT_OP = 2;

export const DUEL_SELECT_MODAL = 6575;
export const DUEL_CONFIRM_MODAL = 6412;
export const DUEL_WIN_MODAL = 6733;

const DUEL_SELECT_ACCEPT = 6674;
const DUEL_CONFIRM_ACCEPT = 6520;
const DUEL_SELECT_PARTNER = 6671;
const DUEL_SELECT_STATUS = 6684;
const DUEL_CONFIRM_STATUS = 6571;

// `duelstatus` (varp 285) is intentionally server-only in 2004scape: its
// config omits transmit=yes. Client behavior must use visible duel state.

/** Strip the server-populated `Dueling with:` prefix to a display name. */
export function parseDuelPartnerHeader(header: string | null): string | null {
    if (header === null) {
        return null;
    }
    const name = header
        .trim()
        .replace(/^dueling with\s*:\s*/i, '')
        .trim();
    return name.length > 0 ? name : null;
}

function waiting(statusComId: number): boolean {
    return /^waiting for other player/i.test(reader.ifText(statusComId)?.trim() ?? '');
}

// Why: the two accept screens deliberately stay separate — both players must click each one, and the first click leaves that player on "Waiting...".

/** The no-stake Duel Arena handshake and player operations. */
export const Duel = {
    offerOpen(): boolean {
        return reader.modals().main === DUEL_SELECT_MODAL;
    },

    confirmOpen(): boolean {
        return reader.modals().main === DUEL_CONFIRM_MODAL;
    },

    winOpen(): boolean {
        return reader.modals().main === DUEL_WIN_MODAL;
    },

    active(): boolean {
        return Duel.offerOpen() || Duel.confirmOpen();
    },

    partner(): string | null {
        return parseDuelPartnerHeader(reader.ifText(DUEL_SELECT_PARTNER));
    },

    waitingForOther(): boolean {
        if (Duel.offerOpen()) {
            return waiting(DUEL_SELECT_STATUS);
        }
        if (Duel.confirmOpen()) {
            return waiting(DUEL_CONFIRM_STATUS);
        }
        return false;
    },

    challenge(player: Player): boolean | Promise<boolean> {
        return Input.interactPlayer(player.index, CHALLENGE_OP);
    },

    fight(player: Player): boolean | Promise<boolean> {
        return Input.interactPlayer(player.index, FIGHT_OP);
    },

    accept(): boolean {
        if (Duel.offerOpen()) {
            return actions.ifButton(DUEL_SELECT_ACCEPT);
        }
        if (Duel.confirmOpen()) {
            return actions.ifButton(DUEL_CONFIRM_ACCEPT);
        }
        return false;
    },

    async cancel(): Promise<boolean> {
        if (!Duel.active()) {
            return false;
        }
        const closed = await Modals.close();
        return closed && !Duel.active();
    },

    async closeWin(): Promise<boolean> {
        if (!Duel.winOpen()) {
            return false;
        }
        return Modals.close();
    }
};
