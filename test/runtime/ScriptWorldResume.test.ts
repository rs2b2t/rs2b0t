import { expect, test } from 'bun:test';
import { WorldResumeController, type WorldResumePort } from '../../src/bot/runtime/ScriptWorldResume.js';

function fixture() {
    const data = new Map<string, string>();
    const calls: unknown[] = [];
    let who = 'alice';
    let world = 2;
    let state = 'running';
    let deferred: (() => void) | undefined;
    const port: WorldResumePort = {
        storage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } },
        key: 'profile:alice', worlds: [1, 2, 3],
        current: () => ({ account: who, world, safe: true, script: 'JiveTT', state }),
        defer: fn => { deferred = fn; },
        switchWorld: async target => { calls.push(target); return true; },
        resume: settings => { calls.push(settings); state = 'running'; },
        cancelSwitch: () => { calls.push('cancel'); }
    };
    return { controller: new WorldResumeController(port), port, calls, defer: () => deferred?.(), clearDeferred: () => { deferred = undefined; }, account: (name: string) => { who = name; }, world: (value: number) => { world = value; state = 'idle'; } };
}
const request = { account: 'alice', world: 1, returnWorld: 2, settings: { clueTier: 'hard' } };
test('checkpoint precedes profile switch and resumes only after identity and world match', async () => {
    const f = fixture();
    expect(f.controller.request(request)).toBe(true);
    expect(f.controller.pending('alice')?.world).toBe(1);
    expect(f.calls).toEqual([]);
    f.defer();
    await Promise.resolve();
    expect(f.calls).toEqual([1]);
    f.world(1);
    f.account('bob');
    expect(f.controller.resume()).toBe(false);
    f.account('alice');
    expect(f.controller.resume()).toBe(true);
    expect(f.calls).toEqual([1, request.settings]);
    expect(f.controller.resume()).toBe(false);
});
test('Stop cancels deferred logout and automatic resume', () => {
    const f = fixture();
    f.controller.request(request);
    f.controller.cancel();
    f.defer();
    f.world(1);
    expect(f.controller.resume()).toBe(false);
    expect(f.calls).toEqual(['cancel']);
});
test('rejects unknown worlds and simultaneous switching', () => {
    const f = fixture();
    expect(f.controller.request({ ...request, world: 99 })).toBe(false);
    expect(f.controller.request(request)).toBe(true);
    expect(f.controller.request(request)).toBe(false);
});
test('restart reconciles durable checkpoint without restoring live activities', () => {
    const f = fixture();
    f.controller.request(request);
    const replacement = new WorldResumeController(f.port);
    f.world(1);
    expect(replacement.resume()).toBe(true);
    expect(f.calls).toEqual([request.settings]);
});

test('restart before logout reissues only the checkpointed profile switch', async () => {
    const f = fixture();
    f.controller.request(request);
    f.clearDeferred();
    const replacement = new WorldResumeController(f.port);
    f.world(2);
    expect(replacement.resume()).toBe(false);
    f.defer();
    await Promise.resolve();
    expect(f.calls).toEqual([1]);
});

test('Stop blocks in-memory resume even when durable storage removal fails', () => {
    const f = fixture();
    f.controller.request(request);
    f.port.storage.removeItem = () => { throw new Error('storage unavailable'); };
    expect(() => f.controller.cancel()).not.toThrow();
    f.defer();
    f.world(1);
    expect(f.controller.resume()).toBe(false);
    expect(f.calls).toEqual(['cancel']);
});
