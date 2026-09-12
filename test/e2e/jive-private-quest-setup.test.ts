import { expect, test } from 'bun:test';
import * as fixture from '../../e2e/jive-private-fixture.js';

test.each([
    { scenario: 'missing-dds', value: 6, status: 'complete' },
    { scenario: 'missing-superanti', value: 6, status: 'complete' },
    { scenario: 'sharks14', value: 6, status: 'complete' },
    { scenario: 'guardian', value: 6, status: 'complete' },
    { scenario: 'reward', value: 0, status: 'notStarted' },
] as const)('seeds quest state before relog and client readiness %#', async ({ scenario, value, status }) => {
    const actions: string[] = [];
    await fixture.seedPrivateQuest(scenario, {
        cheat: async command => { actions.push(command); return true; },
        relog: async () => { actions.push('relog'); },
        waitForQuest: async (expected, quest = 'Lost City') => { actions.push(`client:${quest}:${expected}`); },
    });
    expect(actions).toEqual([`setvar zanaris ${value}`, 'setvar trail_status 133', 'relog', `client:Lost City:${status}`]);
});

test.each(['setvar priestperil 61', 'setvar druidspirit 5'])('does not need unrelated regional prerequisite %s', async rejected => {
    let relogged = false;
    await fixture.seedPrivateQuest('guardian', {
        cheat: async command => command !== rejected,
        relog: async () => { relogged = true; },
        waitForQuest: async () => {},
    });
    expect(relogged).toBe(true);
});

test.each(['Priest in Peril', 'Nature Spirit'])('does not require unrelated %s completion', async missing => {
    const failure = new Error('quest status not ready');
    await fixture.seedPrivateQuest('guardian', {
        cheat: async () => true,
        relog: async () => {},
        waitForQuest: async (_status, quest) => { if (quest === missing) throw failure; },
    });
});

test.each(['setvar zanaris 6', 'setvar trail_status 133'])('stops setup when %s is refused', async rejected => {
    const actions: string[] = [];
    await expect(fixture.seedPrivateQuest('guardian', {
        cheat: async command => { actions.push(command); return command !== rejected; },
        relog: async () => { actions.push('relog'); },
        waitForQuest: async () => { actions.push('ready'); },
    })).rejects.toThrow();
    expect(actions).toEqual(rejected === 'setvar zanaris 6' ? [rejected] : ['setvar zanaris 6', rejected]);
});

test('propagates failed relog without trusting stale client status', async () => {
    const failure = new Error('login refused');
    const actions: string[] = [];
    await expect(fixture.seedPrivateQuest('guardian', {
        cheat: async () => true,
        relog: async () => { throw failure; },
        waitForQuest: async () => { actions.push('ready'); },
    })).rejects.toBe(failure);
    expect(actions).toEqual([]);
});

test('propagates client quest readiness failure after relog', async () => {
    const failure = new Error('quest list still not complete');
    await expect(fixture.seedPrivateQuest('guardian', {
        cheat: async () => true,
        relog: async () => {},
        waitForQuest: async () => { throw failure; },
    })).rejects.toBe(failure);
});

test('awaits relog and client readiness before returning to gear setup', async () => {
    const entered = Promise.withResolvers<void>();
    const login = Promise.withResolvers<void>();
    const ready = Promise.withResolvers<void>();
    const checking = Promise.withResolvers<void>();
    const actions: string[] = [];
    const setup = fixture.seedPrivateQuest('guardian', {
        cheat: async () => true,
        relog: async () => { entered.resolve(); await login.promise; },
        waitForQuest: async () => { actions.push('check'); checking.resolve(); await ready.promise; },
    }).then(() => { actions.push('gear'); });
    try {
        await entered.promise;
        expect(actions).toEqual([]);
        login.resolve();
        await checking.promise;
        expect(actions).toEqual(['check']);
    } finally {
        login.resolve();
        ready.resolve();
        await setup;
    }
    expect(actions).toEqual(['check', 'gear']);
});
