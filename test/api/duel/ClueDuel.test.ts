import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Duel } from '#/bot/api/duel/Duel.js';
import { Game } from '#/bot/api/game/Game.js';
import { ClueDuelHelper, ClueDuelHandshake } from '#/bot/api/duel/ClueDuel.js';

function fixture(confirm = false) {
    const state = { options: 1024, partner: 'Trusted solver', ready: true, accepted: 0, cancelled: 0, toggles: [] as number[], stake: '' };
    spyOn(Duel, 'active').mockReturnValue(true);
    spyOn(Duel, 'offerOpen').mockReturnValue(!confirm);
    spyOn(Duel, 'partner').mockImplementation(() => state.partner);
    spyOn(Duel, 'waitingForOther').mockReturnValue(false);
    spyOn(Duel, 'accept').mockImplementation(() => { state.accepted++; return true; });
    spyOn(Duel, 'cancel').mockImplementation(async () => { state.cancelled++; return true; });
    spyOn(reader, 'varp').mockImplementation(() => state.options);
    spyOn(reader, 'duelOffers').mockImplementation(() => ({ ready: state.ready, mine: state.stake === 'mine' ? [{ id: 995, name: 'Coins', count: 1, slot: 0, comId: confirm ? 6507 : 6669, ops: [] }] : [], theirs: state.stake === 'theirs' ? [{ id: 995, name: 'Coins', count: 1, slot: 0, comId: confirm ? 6508 : 6670, ops: [] }] : [] }));
    spyOn(actions, 'ifButton').mockImplementation(id => { state.toggles.push(id); return true; });
    return { state, handshake: new ClueDuelHandshake('Trusted_solver', true, () => {}) };
}

afterEach(() => mock.restore());

for (const confirm of [false, true]) {
    test(`${confirm ? 'confirm' : 'offer'} accepts only the named player with zero stakes and obstacles-only rules`, async () => {
        const { state, handshake } = fixture(confirm);
        await handshake.tick();
        expect(state.accepted).toBe(1);
        expect(state.cancelled).toBe(0);
    });
    test(`${confirm ? 'confirm' : 'offer'} cancels an unexpected partner`, async () => {
        const { state, handshake } = fixture(confirm);
        state.partner = 'Stranger';
        expect(await handshake.tick()).toBe(false);
        expect(state.accepted).toBe(0);
        expect(state.cancelled).toBe(1);
    });
    for (const side of ['mine', 'theirs']) test(`${confirm ? 'confirm' : 'offer'} rejects even a single staked coin in ${side}`, async () => {
        const { state, handshake } = fixture(confirm);
        state.stake = side;
        expect(await handshake.tick()).toBe(false);
        expect(state.accepted).toBe(0);
        expect(state.cancelled).toBe(1);
    });
    for (const mask of [1025, 1026, 1280, 512, 2048, ...(confirm ? [0] : [])]) {
        test(`${confirm ? 'confirm' : 'offer'} rejects unsafe rule mask ${mask}`, async () => {
            const { state, handshake } = fixture(confirm);
            state.options = mask;
            expect(await handshake.tick()).toBe(false);
            expect(state.accepted).toBe(0);
        });
    }
    test(`${confirm ? 'confirm' : 'offer'} waits for the server's stake snapshot`, async () => {
        const { state, handshake } = fixture(confirm);
        state.ready = false;
        expect(await handshake.tick()).toBe(true);
        expect(state.accepted).toBe(0);
        state.ready = true;
        await handshake.tick();
        expect(state.accepted).toBe(1);
    });
}

test('only the initiating solver enables obstacles and it waits for the update', async () => {
    const { state, handshake } = fixture();
    state.options = 0;
    await handshake.tick();
    await handshake.tick();
    expect(state.toggles).toEqual([6732]);
    expect(state.accepted).toBe(0);
    state.options = 1024;
    await handshake.tick();
    expect(state.accepted).toBe(1);
});

test('helper waits without toggling the obstacles switch back off', async () => {
    const { state } = fixture();
    state.options = 0;
    const handshake = new ClueDuelHandshake('Trusted solver', false, () => {});
    await handshake.tick();
    expect(state.toggles).toEqual([]);
    expect(state.accepted).toBe(0);
});


test('helper inside the arena stays idle and never attacks', async () => {
    spyOn(Game, 'tile').mockReturnValue({ x: 3370, z: 3250, level: 0 });
    const fight = spyOn(Duel, 'fight').mockReturnValue(true);
    const challenge = spyOn(Duel, 'challenge').mockReturnValue(true);
    const helper = new ClueDuelHelper('Trusted solver', () => {});
    await helper.execute();
    await helper.execute();
    expect(fight).not.toHaveBeenCalled();
    expect(challenge).not.toHaveBeenCalled();
});

test('lobby player lookup normalizes spaces and underscores before challenging', async () => {
    spyOn(Duel, 'active').mockReturnValue(false);
    spyOn(reader, 'players').mockReturnValue([
        { name: 'Stranger', index: 1, inCombat: false, tile: { x: 3368, z: 3274, level: 0 }, distance: 1 },
        { name: 'Trusted solver', index: 2, inCombat: false, tile: { x: 3368, z: 3274, level: 0 }, distance: 2 }
    ] as never);
    const challenge = spyOn(Duel, 'challenge').mockReturnValue(true);
    await new ClueDuelHandshake('Trusted_solver', true, () => {}).tick();
    expect(challenge).toHaveBeenCalledTimes(1);
    expect(challenge.mock.calls[0][0].name).toBe('Trusted solver');
});
