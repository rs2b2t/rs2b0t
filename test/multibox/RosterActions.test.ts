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
        async configureScript(script, values, start) {
            if (values) this.copySettings(script, values);
            if (!values || start) this.assignScript(script);
            if (start) this.startScript();
        },
        startScript() {}, stopScript() {}, async travelTo() {}, async editSettings() {}
    };
}

test('copy targets only selected profiles, excludes source, and configures active clients', async () => {
    const profiles = [profile('source', 'running'), profile('idle', 'idle'), profile('busy', 'paused'), profile('offline'), profile('other')];
    replaceScriptSettings('source', 'Miner', { rock: 'coal', runners: 'alice,bob' });
    const clients = new Map(profiles.map(p => [p.username, client(p.username)]));
    const actions = new RosterActions({ profiles: () => profiles, client: p => p.slot ? clients.get(p.username)! : null, setWorld: async () => true });
    const result = await actions.run(['source', 'idle', 'busy', 'offline'], { kind: 'copy', script: 'Miner', source: 'source' });
    expect(result.map(r => r.state)).toEqual(['skipped', 'done', 'done', 'done']);
    expect(readScriptSettings('offline', 'Miner')).toEqual({ rock: 'coal', runners: 'alice,bob' });
    expect(readScriptSettings('idle', 'Miner')).toEqual({ rock: 'coal', runners: 'alice,bob' });
    expect(readScriptSettings('busy', 'Miner')).toEqual({ rock: 'coal', runners: 'alice,bob' });
    expect(readScriptSettings('other', 'Miner')).toEqual({});
});

test('snapshots source once and continues after a client failure', async () => {
    const profiles = [profile('source'), profile('broken', 'idle'), profile('good', 'idle'), profile('offline')];
    replaceScriptSettings('source', 'Miner', { rock: 'iron' });
    const clients = new Map<string, RosterClient>();
    const actions = new RosterActions({ profiles: () => profiles, client: p => {
        if (!p.slot) return null;
        const existing = clients.get(p.username);
        if (existing) return existing;
        const c = client(p.username);
        clients.set(p.username, c);
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
    let rebuilds = 0;
    const actions = new RosterActions({ profiles: () => { rebuilds++; return profiles; }, client: p => clients.get(p.username) ?? null, setWorld: async () => true });
    try {
        const running = actions.run(['removed', 'remaining'], { kind: 'travel', destination: 'Varrock' }, result => progress.push(result));
        expect(testClock.getTimerCount()).toBe(timers + 1);
        rebuilds = 0;
        testClock.advanceTimersByTime(100);
        expect(rebuilds).toBe(1);
        profiles = [profiles[1]];
        clients.delete('removed');
        rebuilds = 0;
        testClock.advanceTimersByTime(100);
        await flushPromises();
        expect(rebuilds).toBe(1);
        expect(progress.filter(result => result.username === 'removed').map(result => result.state)).toEqual(['pending', 'failed']);
        expect(actions.busy).toBe(true);
        expect(testClock.getTimerCount()).toBe(timers + 1);
        finishRemaining();
        expect((await running).map(result => result.state)).toEqual(['failed', 'done']);
        expect(actions.busy).toBe(false);
        rebuilds = 0;
        testClock.advanceTimersByTime(100);
        expect(rebuilds).toBe(0);
        expect(testClock.getTimerCount()).toBe(timers);
    } finally {
        jest.useRealTimers();
    }
});

test('one failed poll snapshot only cancels the target that requested it', async () => {
    jest.useFakeTimers();
    await flushPromises();
    const timers = testClock.getTimerCount();
    const profiles = [profile('alice', 'running'), profile('bob', 'running')];
    const clients = profiles.map(p => client(p.username));
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    for (const c of clients) c.travelTo = () => gate;
    const stops = clients.map(c => spyOn(c, 'stopScript'));
    let reads = 0;
    let fail = false;
    const actions = new RosterActions({ profiles: () => {
        reads++;
        if (fail) {
            fail = false;
            throw new Error('Snapshot unavailable');
        }
        return profiles;
    }, client: p => clients[profiles.indexOf(p)], setWorld: async () => true });
    const events: string[] = [];
    try {
        const running = actions.run(['alice', 'bob'], { kind: 'travel', destination: 'Varrock' }, r => events.push(r.username + ':' + r.state));
        reads = 0;
        fail = true;
        testClock.advanceTimersByTime(100);
        await flushPromises();
        expect(reads).toBe(1);
        expect(events).toEqual(['alice:pending', 'bob:pending', 'alice:failed']);
        testClock.advanceTimersByTime(50);
        finish();
        expect((await running).map(r => r.state)).toEqual(['failed', 'done']);
        expect(stops[0]).toHaveBeenCalledTimes(1);
        expect(stops[1]).not.toHaveBeenCalled();
        testClock.advanceTimersByTime(0);
        expect(testClock.getTimerCount()).toBe(timers);
    } finally {
        jest.useRealTimers();
    }
});

test('travel completion sees a slot replaced since the last poll', async () => {
    jest.useFakeTimers();
    let profiles = [profile('alice', 'running')];
    let finish!: () => void;
    const original = client('alice');
    original.travelTo = () => new Promise(resolve => { finish = resolve; });
    const stop = spyOn(original, 'stopScript');
    const actions = new RosterActions({ profiles: () => profiles, client: () => original, setWorld: async () => true });
    try {
        const running = actions.run(['alice'], { kind: 'travel', destination: 'Varrock' });
        testClock.advanceTimersByTime(100);
        profiles = [profile('alice', 'running')];
        profiles[0].slot!.id++;
        finish();
        expect((await running)[0]).toMatchObject({ state: 'failed', message: expect.stringMatching(/replaced/) });
        expect(stop).toHaveBeenCalledTimes(1);
    } finally {
        jest.useRealTimers();
    }
});

test('parent travel timeout cancels each command at its own deadline and releases the timer', async () => {
    jest.useFakeTimers();
    await flushPromises();
    const timers = testClock.getTimerCount();
    const start = Date.now();
    const profiles = ['alice', 'bob', 'carol'].map(name => profile(name, 'running'));
    const stops: [string, number][] = [];
    let finish!: () => void;
    let lateStarts = 0;
    let reads = 0;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const clients = new Map(profiles.map(p => {
        const c = client(p.username);
        let stopped = false;
        c.travelTo = () => {
            testClock.advanceTimersByTime(25);
            return gate.then(() => { if (!stopped) lateStarts++; });
        };
        c.stopScript = () => {
            stopped = true;
            stops.push([p.username, Date.now() - start]);
        };
        return [p.username, c];
    }));
    const actions = new RosterActions({ profiles: () => { reads++; return profiles; }, client: p => clients.get(p.username)!, setWorld: async () => true });
    try {
        const running = actions.run([...clients.keys()], { kind: 'travel', destination: 'Varrock' });
        testClock.advanceTimersByTime(11_000 - (Date.now() - start));
        expect(stops).toEqual([['alice', 11_000]]);
        expect(actions.busy).toBe(true);
        reads = 0;
        testClock.advanceTimersByTime(25);
        expect(stops).toEqual([['alice', 11_000], ['bob', 11_025]]);
        expect(reads).toBe(0);
        testClock.advanceTimersByTime(25);
        finish();
        for (const result of await running) expect(result).toMatchObject({ state: 'failed', message: expect.stringMatching(/timed out/i) });
        expect(stops).toEqual([['alice', 11_000], ['bob', 11_025], ['carol', 11_050]]);
        expect(lateStarts).toBe(0);
        expect(actions.busy).toBe(false);
        testClock.advanceTimersByTime(0);
        expect(testClock.getTimerCount()).toBe(timers);
    } finally {
        jest.useRealTimers();
    }
});

test('a late completion times out even if the watchdog has not run yet', async () => {
    const clock = spyOn(Date, 'now').mockReturnValue(25);
    const p = profile('alice', 'running');
    const c = client(p.username);
    let finish!: () => void;
    c.travelTo = () => new Promise(resolve => { finish = resolve; });
    const stop = spyOn(c, 'stopScript');
    const actions = new RosterActions({ profiles: () => [p], client: () => c, setWorld: async () => true });
    try {
        const running = actions.run([p.username], { kind: 'travel', destination: 'Varrock' });
        clock.mockReturnValue(11_050);
        finish();
        expect((await running)[0]).toMatchObject({ state: 'failed', message: expect.stringMatching(/timed out/i) });
        expect(stop).toHaveBeenCalledTimes(1);
    } finally {
        clock.mockRestore();
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


test('copy and start selects the copied script and only starts loaded targets', async () => {
    const profiles = [profile('source'), profile('alice', 'running'), profile('offline')];
    replaceScriptSettings('source', 'WalkTo', { destination: 'Varrock', customTile: '0,0,0' });
    writeProfileScript('alice', 'Miner');
    const loaded = client('alice');
    const starts: string[] = [];
    loaded.startScript = () => { starts.push(readProfileScript('alice')); };
    const actions = new RosterActions({ profiles: () => profiles, client: p => p.slot ? loaded : null, setWorld: async () => true });
    const results = await actions.run(['alice', 'offline'], { kind: 'copy', script: 'WalkTo', source: 'source', start: true });
    expect(results.map(result => result.state)).toEqual(['done', 'done']);
    expect(starts).toEqual(['WalkTo']);
    expect(readProfileScript('offline')).toBe('WalkTo');
    expect(readScriptSettings('alice', 'WalkTo')).toEqual({ destination: 'Varrock', customTile: '0,0,0' });
    expect(readScriptSettings('offline', 'WalkTo')).toEqual({ destination: 'Varrock', customTile: '0,0,0' });
    expect(results[1].message).toMatch(/load.*start/i);
});

test('a removed client cancels pending configuration without starting its replacement', async () => {
    jest.useFakeTimers();
    const profiles = [profile('alice', 'running')];
    const old = client('alice');
    let cancelled = false;
    let finish!: () => void;
    old.configureScript = () => new Promise<void>(resolve => { finish = resolve; });
    old.stopScript = () => { cancelled = true; };
    let current = old;
    const actions = new RosterActions({ profiles: () => profiles, client: () => current, setWorld: async () => true });
    try {
        const changing = actions.run(['alice'], { kind: 'assign', script: 'WalkTo', start: true });
        current = client('alice');
        testClock.advanceTimersByTime(100);
        await flushPromises();
        expect((await changing)[0].state).toBe('failed');
        expect(cancelled).toBe(true);
        finish();
        await flushPromises();
        expect(actions.busy).toBe(false);
    } finally {
        jest.useRealTimers();
    }
});


test('removing a profile cancels its pending editor and releases the roster', async () => {
    let profiles = [profile('alice', 'running')];
    const original = client('alice');
    original.editSettings = () => new Promise(() => {});
    let stopped = false;
    original.stopScript = () => { stopped = true; };
    const actions = new RosterActions({ profiles: () => profiles, client: () => original, setWorld: async () => true });
    const editing = actions.edit(profiles[0]);
    expect(actions.busy).toBe(true);
    profiles = [];
    await expect(editing).rejects.toThrow(/removed/i);
    expect(stopped).toBe(true);
    expect(actions.busy).toBe(false);
});
