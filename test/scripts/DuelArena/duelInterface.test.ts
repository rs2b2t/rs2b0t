import { afterEach, describe, expect, test } from 'bun:test';

import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Player } from '#/bot/api/model/Player.js';
import { DUEL_CONFIRM_MODAL, DUEL_SELECT_MODAL, DUEL_WIN_MODAL, Duel, parseDuelPartnerHeader } from '#/bot/scripts/DuelArena/DuelInterface.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { Input } from '#/bot/input/Input.js';

const originals = {
    modals: reader.modals,
    ifText: reader.ifText,
    ifButton: actions.ifButton,
    interactPlayer: Input.interactPlayer,
    closeModal: Modals.close
};

afterEach(() => {
    reader.modals = originals.modals;
    reader.ifText = originals.ifText;
    actions.ifButton = originals.ifButton;
    Input.interactPlayer = originals.interactPlayer;
    Modals.close = originals.closeModal;
});

function modal(main: number): void {
    reader.modals = () => ({ main, side: -1, chat: -1 });
}

function player(index: number): Player {
    return new Player({
        index,
        name: `Bot ${index}`,
        tile: { x: 3368, z: 3274, level: 0 },
        distance: 1,
        inCombat: false,
        faceEntity: -1
    });
}

describe('Duel modal contract', () => {
    test('recognizes only the select, confirm, and victory roots', () => {
        modal(DUEL_SELECT_MODAL);
        expect(Duel.offerOpen()).toBe(true);
        expect(Duel.active()).toBe(true);
        expect(Duel.confirmOpen()).toBe(false);

        modal(DUEL_CONFIRM_MODAL);
        expect(Duel.confirmOpen()).toBe(true);
        expect(Duel.active()).toBe(true);

        modal(DUEL_WIN_MODAL);
        expect(Duel.winOpen()).toBe(true);
        expect(Duel.active()).toBe(false);

        modal(3323); // trade offer is not a duel
        expect(Duel.active()).toBe(false);
        expect(Duel.winOpen()).toBe(false);
    });

    test('clicks the correct accept component for each handshake screen', () => {
        const clicked: number[] = [];
        actions.ifButton = comId => {
            clicked.push(comId);
            return true;
        };

        modal(DUEL_SELECT_MODAL);
        expect(Duel.accept()).toBe(true);
        modal(DUEL_CONFIRM_MODAL);
        expect(Duel.accept()).toBe(true);
        modal(-1);
        expect(Duel.accept()).toBe(false);
        expect(clicked).toEqual([6674, 6520]);
    });

    test('does not spam accept after this player is already waiting', () => {
        modal(DUEL_SELECT_MODAL);
        reader.ifText = comId => (comId === 6684 ? 'Waiting for other player...' : null);
        expect(Duel.waitingForOther()).toBe(true);

        modal(DUEL_CONFIRM_MODAL);
        reader.ifText = comId => (comId === 6571 ? 'Waiting for other player...' : null);
        expect(Duel.waitingForOther()).toBe(true);

        reader.ifText = () => 'Other player has accepted.';
        expect(Duel.waitingForOther()).toBe(false);
    });

    test('cancels only an active duel handshake', async () => {
        let closes = 0;
        let main = DUEL_SELECT_MODAL;
        reader.modals = () => ({ main, side: -1, chat: -1 });
        Modals.close = async () => {
            closes++;
            main = -1;
            return true;
        };

        expect(await Duel.cancel()).toBe(true);
        main = DUEL_CONFIRM_MODAL;
        expect(await Duel.cancel()).toBe(true);
        main = DUEL_WIN_MODAL;
        expect(await Duel.cancel()).toBe(false);
        expect(closes).toBe(2);
    });

    test('does not report cancellation while another duel screen replaced the first', async () => {
        let main = DUEL_SELECT_MODAL;
        reader.modals = () => ({ main, side: -1, chat: -1 });
        Modals.close = async () => {
            main = DUEL_CONFIRM_MODAL;
            return true;
        };
        expect(await Duel.cancel()).toBe(false);

        Modals.close = async () => {
            main = -1;
            return true;
        };
        expect(await Duel.cancel()).toBe(true);
    });

});

describe('Duel player operations', () => {
    test('uses OPPLAYER1 for Challenge/accept and OPPLAYER2 for Fight', async () => {
        const calls: { index: number; op: number }[] = [];
        Input.interactPlayer = (index, op) => {
            calls.push({ index, op });
            return true;
        };
        const target = player(42);
        expect(await Duel.challenge(target)).toBe(true);
        expect(await Duel.fight(target)).toBe(true);
        expect(calls).toEqual([
            { index: 42, op: 1 },
            { index: 42, op: 2 }
        ]);
    });

    test('parses the opponent label without inventing a missing partner', () => {
        expect(parseDuelPartnerHeader('Dueling with: Fresh Bot 9')).toBe('Fresh Bot 9');
        expect(parseDuelPartnerHeader('  dueling WITH :   A B  ')).toBe('A B');
        expect(parseDuelPartnerHeader('')).toBeNull();
        expect(parseDuelPartnerHeader(null)).toBeNull();
    });
});
