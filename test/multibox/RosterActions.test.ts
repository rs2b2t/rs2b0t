import { beforeEach, expect, jest, spyOn, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { RosterActions, type RosterProfile, type RosterResult } from '#/bot/multibox/RosterActions.js';
import type { RosterClient } from '#/bot/multibox/RosterTypes.js';
import { readScriptSettings, replaceScriptSettings, readProfileScript, writeProfileScript } from '#/bot/multibox/RosterStorage.js';

const testClock = jest as typeof jest & { advanceTimersByTime(ms: number): void; getTimerCount(): number };

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

async function flushPromises(): Promise<void> {
    for (let i = 0; i < 6; i++) await Promise.resolve();
}

function profile(username: string, state?: string): RosterProfile {
    return { username, tab: 'Miners', world: 1, ...(state ? { slot: {
        id: username.length, username, tab: 'Miners', focused: false, mode: 'background', targetWorld: 1, switchingWorld: null,
        ready: true, ingame: true, world: 1, player: username, loopCycle: 0, drawn: 0, scriptState: state, scriptName: 'Miner'
    } } : {}) };
}

function client(username: string): RosterClient {
    return {
        scripts: () => ['Miner', 'WalkTo'], selectedScript: () => readProfileScript(username),
        readSettings: script => readScriptSettings(username, script),
        assignScript: script => writeProfileScript(username, script),
        copySettings: (script, values) => replaceScriptSettings(username, script, values),
        startScript() {}, stopScript() {}, async travelTo() {}, editSettings() {}
    };
}

test('copy targets only selected profiles, excludes source, and skips active clients', async () => {
    const profiles = [profile('source', 'running'), profile('idle', 'idle'), profile('busy', 'paused'), profile('offline'), profile('other')];
    replaceScriptSettings('source', 'Miner', { rock: 'coal', runners: 'alice,bob' });
    const actions = new RosterActions({ profiles: () => profiles, client: p => p.slot ? client(p.username) : null, setWorld: async () => true });
    const result = await actions.run(['source', 'idle', 'busy', 'offline'], { kind: 'copy', script: 'Miner', source: 'source' });
    expect(result.map(r => r.state)).toEqual(['skipped', 'done', 'skipped', 'done']);
    expect(readScriptSettings('offline', 'Miner')).toEqual({ rock: 'coal', runners: 'alice,bob' });
    expect(readScriptSettings('idle', 'Miner')).toEqual({ rock: 'coal', runners: 'alice,bob' });
    expect(readScriptSettings('busy', 'Miner')).toEqual({});
    expect(readScriptSettings('other', 'Miner')).toEqual({});
});

test('snapshots source once and continues after a client failure', async () => {
    const profiles = [profile('source'), profile('broken', 'idle'), profile('good', 'idle'), profile('offline')];
    replaceScriptSettings('source', 'Miner', { rock: 'iron' });
    const actions = new RosterActions({ profiles: () => profiles, client: p => {
        if (!p.slot) return null;
        const c = client(p.username);
        if (p.username === 'broken') c.copySettings = () => { replaceScriptSettings('source', 'Miner', { rock: 'coal' }); throw runInNewContext('new Error("Client disconnected")'); };
        return c;
    }, setWorld: async () => true });
    const result = await actions.run(['broken', 'good', 'offline'], { kind: 'copy', script: 'Miner', source: 'source' });
    expect(result.map(r => r.state)).toEqual(['failed', 'done', 'done']);
    expect(result[0].message).toBe('Client disconnected');
    expect(readScriptSettings('offline', 'Miner')).toEqual({ rock: 'iron' });
});

test('travel requires ready logged-in clients and reports each outcome', async () => {
    const profiles = [profile('offline'), profile('login', 'idle'), profile('ready', 'running')];
    profiles[1].slot!.ingame = false;
    const destinations: string[] = [];
    const clients = new Map(profiles.map(p => {
        const c = client(p.username);
        c.travelTo = async d => { destinations.push(`${p.username}:${d}`); };
        return [p.username, c];
    }));
    const actions = new RosterActions({ profiles: () => profiles, client: p => clients.get(p.username) ?? null, setWorld: async () => true });
    const result = await actions.run(profiles.map(p => p.username), { kind: 'travel', destination: "Seers' Village" });
    expect(result.map(r => r.state)).toEqual(['skipped', 'skipped', 'done']);
    expect(destinations).toEqual(["ready:Seers' Village"]);
});

test('world batches report progress, continue failures, and prevent overlapping operations', async () => {
    const profiles = [profile('alice', 'running'), profile('bob')];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const worlds: string[] = [];
    const results: RosterResult[] = [];
    const actions = new RosterActions({ profiles: () => profiles, client: p => client(p.username), setWorld: async (p, world) => {
        worlds.push(`${p.username}:${world}`); await gate; return p.username !== 'bob';
    } });
    const running = actions.run(['alice', 'bob'], { kind: 'world', world: 3 }, r => results.push(r));
    expect(actions.busy).toBe(true);
    await expect(actions.run(['alice'], { kind: 'stop' })).rejects.toThrow('already');
    expect(worlds).toEqual(['alice:3', 'bob:3']);
    expect(results.map(r => r.state)).toEqual(['pending', 'pending']);
    release();
    expect((await running).map(r => r.state)).toEqual(['done', 'failed']);
    expect(actions.busy).toBe(false);
});

test('loading and switching slots cannot receive assignment; unloaded profiles can', async () => {
    const profiles = [profile('loading', 'idle'), profile('switching', 'idle'), profile('offline')];
    profiles[0].slot!.ready = false;
    profiles[1].slot!.switchingWorld = 2;
    const actions = new RosterActions({ profiles: () => profiles, client: p => client(p.username), setWorld: async () => true });
    const result = await actions.run(profiles.map(p => p.username), { kind: 'assign', script: 'Miner' });
    expect(result.map(r => r.state)).toEqual(['skipped', 'skipped', 'done']);
    expect(readProfileScript('offline')).toBe('Miner');
    expect(readProfileScript('loading')).toBe('');
});

test('a failing progress listener cannot release a batch while another target is pending', async () => {
    const errors = spyOn(console, 'error').mockImplementation(() => {});
    const profiles = [profile('first'), profile('second')];
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const actions = new RosterActions({ profiles: () => profiles, client: () => null, setWorld: async p => {
        if (p.username === 'second') await gate;
        return true;
    } });
    const running = actions.run(['first', 'second'], { kind: 'world', world: 2 }, result => {
        if (result.state === 'done') throw new Error('Detached UI');
    });
    try {
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(actions.busy).toBe(true);
        finish();
        expect((await running).map(r => r.state)).toEqual(['done', 'done']);
        expect(actions.busy).toBe(false);
    } finally {
        finish();
        errors.mockRestore();
    }
});

test('removed travel targets settle while the batch waits for surviving targets', async () => {
    jest.useFakeTimers();
    await flushPromises();
    const timers = testClock.getTimerCount();
    let profiles = [profile('removed', 'running'), profile('remaining', 'running')];
    let finishRemaining!: () => void;
    const removed = client('removed');
    removed.travelTo = () => new Promise(() => {});
    const remaining = client('remaining');
    remaining.travelTo = () => new Promise(resolve => { finishRemaining = resolve; });
    const clients = new Map([['removed', removed], ['remaining', remaining]]);
    const progress: RosterResult[] = [];
    const actions = new RosterActions({ profiles: () => profiles, client: p => clients.get(p.username) ?? null, setWorld: async () => true });
    try {
        const running = actions.run(['removed', 'remaining'], { kind: 'travel', destination: 'Varrock' }, result => progress.push(result));
        profiles = [profiles[1]];
        clients.delete('removed');
        testClock.advanceTimersByTime(100);
        await flushPromises();
        expect(progress.filter(result => result.username === 'removed').map(result => result.state)).toEqual(['pending', 'failed']);
        expect(actions.busy).toBe(true);
        finishRemaining();
        expect((await running).map(result => result.state)).toEqual(['failed', 'done']);
        expect(actions.busy).toBe(false);
        testClock.advanceTimersByTime(100);
        expect(testClock.getTimerCount()).toBe(timers);
    } finally {
        jest.useRealTimers();
    }
});

test('parent travel timeout cancels the original command and releases its timers', async () => {
    jest.useFakeTimers();
    await flushPromises();
    const timers = testClock.getTimerCount();
    const profiles = [profile('alice', 'running')];
    let cancelled = false;
    let finish!: () => void;
    let lateStarts = 0;
    const original = client('alice');
    original.travelTo = () => new Promise<void>(resolve => { finish = resolve; }).then(() => { if (!cancelled) lateStarts++; });
    original.stopScript = () => { cancelled = true; };
    const actions = new RosterActions({ profiles: () => profiles, client: () => original, setWorld: async () => true });
    try {
        const running = actions.run(['alice'], { kind: 'travel', destination: 'Varrock' });
        testClock.advanceTimersByTime(10_999);
        expect(actions.busy).toBe(true);
        testClock.advanceTimersByTime(1);
        await flushPromises();
        expect(cancelled).toBe(true);
        expect(actions.busy).toBe(false);
        expect((await running)[0]).toMatchObject({ state: 'failed', message: expect.stringMatching(/timed out/i) });
        testClock.advanceTimersByTime(100);
        expect(testClock.getTimerCount()).toBe(timers);
        finish();
        await flushPromises();
        expect(lateStarts).toBe(0);
        testClock.advanceTimersByTime(100);
        expect(testClock.getTimerCount()).toBe(timers);
    } finally {
        jest.useRealTimers();
    }
});

test('replacement cancels an old travel without stopping the replacement client', async () => {
    jest.useFakeTimers();
    await flushPromises();
    const timers = testClock.getTimerCount();
    const profiles = [profile('alice', 'running')];
    const original = client('alice');
    original.travelTo = () => new Promise(() => {});
    let oldStops = 0;
    let newStops = 0;
    original.stopScript = () => { oldStops++; };
    const replacement = client('alice');
    replacement.stopScript = () => { newStops++; };
    let current = original;
    const actions = new RosterActions({ profiles: () => profiles, client: () => current, setWorld: async () => true });
    try {
        const running = actions.run(['alice'], { kind: 'travel', destination: 'Varrock' });
        current = replacement;
        testClock.advanceTimersByTime(100);
        await flushPromises();
        expect(actions.busy).toBe(false);
        expect((await running)[0].state).toBe('failed');
        expect(newStops).toBe(0);
        expect(oldStops).toBe(1);
        testClock.advanceTimersByTime(100);
        expect(testClock.getTimerCount()).toBe(timers);
    } finally {
        jest.useRealTimers();
    }
});

test('resolved and rejected travel commands release parent timers', async () => {
    jest.useFakeTimers();
    await flushPromises();
    const timers = testClock.getTimerCount();
    const profiles = [profile('alice', 'running')];
    const original = client('alice');
    const actions = new RosterActions({ profiles: () => profiles, client: () => original, setWorld: async () => true });
    try {
        expect((await actions.run(['alice'], { kind: 'travel', destination: 'Varrock' }))[0].state).toBe('done');
        testClock.advanceTimersByTime(100);
        expect(testClock.getTimerCount()).toBe(timers);
        original.travelTo = async () => { throw new Error('travel failed'); };
        expect((await actions.run(['alice'], { kind: 'travel', destination: 'Varrock' }))[0].state).toBe('failed');
        testClock.advanceTimersByTime(100);
        expect(testClock.getTimerCount()).toBe(timers);
    } finally {
        jest.useRealTimers();
    }
});

for (const reserved of ['Global', 'MapPicker', 'Loadouts', 'PriceBooks']) test(`actions reject reserved ${reserved} even when a client advertises it`, async () => {
    const profiles = [profile('source', 'idle'), profile('offline')];
    const source = client('source');
    source.scripts = () => ['Miner', 'WalkTo', 'Global', 'MapPicker', 'Loadouts', 'PriceBooks'];
    source.readSettings = () => ({ value: 'overwrite' });
    for (const store of [localStorage, sessionStorage]) {
        store.setItem(`rs2b0t:offline:set:${reserved}:value`, 'keep');
        store.setItem('rs2b0t:offline:selectedScript', 'Miner');
    }
    const actions = new RosterActions({ profiles: () => profiles, client: p => p.slot ? source : null, setWorld: async () => true });
    expect(actions.scripts()).toEqual(['Miner', 'WalkTo']);
    expect(() => actions.settings('source', reserved)).toThrow();
    await expect(actions.run(['offline'], { kind: 'assign', script: reserved })).rejects.toThrow();
    await expect(actions.run(['offline'], { kind: 'copy', script: reserved, source: 'source' })).rejects.toThrow();
    for (const store of [localStorage, sessionStorage]) {
        expect(store.getItem(`rs2b0t:offline:set:${reserved}:value`)).toBe('keep');
        expect(store.getItem('rs2b0t:offline:selectedScript')).toBe('Miner');
    }
});

for (const rejection of [undefined, null, '']) test(`travel rejection ${String(rejection)} remains a failed result`, async () => {
    const profiles = [profile('alice', 'running')];
    const original = client('alice');
    original.travelTo = () => Promise.reject(rejection);
    const actions = new RosterActions({ profiles: () => profiles, client: () => original, setWorld: async () => true });
    expect((await actions.run(['alice'], { kind: 'travel', destination: 'Varrock' }))[0].state).toBe('failed');
    expect(actions.busy).toBe(false);
});
