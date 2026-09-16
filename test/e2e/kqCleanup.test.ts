import { expect, test } from 'bun:test';
import { KqCleanup, type CleanupSample } from '../../e2e/lib/kqCleanup.js';

function player(at = 1000): CleanupSample {
    const tile = { x: 3476, z: 9498, level: 0 };
    return { at, ingame: true, sceneReady: true, tile, serverTile: tile, hp: 50, inCombat: true, runner: 'running', chat: [] };
}

test('cleanup requests retreat before stopping and verifies logout in another sample', () => {
    const c = new KqCleanup(1, 1000); const s = player();
    let actions = c.observe([s]);
    expect(actions.map(a => a.kind)).toEqual(['retreat']);
    c.complete(actions[0], true);
    s.at += 200; expect(c.observe([s])).toEqual([]);
    s.tile = s.serverTile = { x: 2757, z: 3478, level: 0 };
    s.at += 200; expect(c.observe([s])).toEqual([]);
    s.inCombat = false; s.at += 200;
    actions = c.observe([s]); expect(actions.map(a => a.kind)).toEqual(['stop']);
    c.complete(actions[0], true);
    s.runner = 'stopped'; s.at += 200;
    actions = c.observe([s]); expect(actions.map(a => a.kind)).toEqual(['logout']);
    c.complete(actions[0], true);
    expect(c.finished).toBe(false);
    s.ingame = false; s.at += 200; c.observe([s]);
    expect(c.finished).toBe(true);
    expect(c.failures).toEqual([]);
});

test('paused fighters are resumed by the retreat command and never stopped in the nest', () => {
    const c = new KqCleanup(1, 1000); const s = player(); s.runner = 'paused';
    const actions = c.observe([s]);
    expect(actions).toEqual([{ player: 0, kind: 'retreat', at: 1000, resume: true }]);
    c.complete(actions[0], true);
    s.runner = 'running'; s.at += 1000;
    expect(c.observe([s])).toEqual([]);
});

test('death during a pending retreat is retained and fails cleanup', () => {
    const c = new KqCleanup(1, 1000); const s = player();
    const [action] = c.observe([s]);
    s.at += 200; s.hp = 0; s.chat = ['Oh dear, you are dead!'];
    expect(c.observe([s])).toEqual([]);
    expect(c.deaths).toEqual([{ player: 0, at: 1200, hp: 0, chat: ['Oh dear, you are dead!'] }]);
    expect(c.failures).toContain('Player 1 died during cleanup');
    c.complete(action, true);
    s.at += 200; c.observe([s]);
    expect(c.deaths).toHaveLength(1);
});

test('the revision289 death message proves death after HP has reset at Lumbridge', () => {
    const c = new KqCleanup(1, 1000); const s = player();
    s.tile = s.serverTile = { x: 3221, z: 3218, level: 0 }; s.hp = 70; s.chat = ['Oh dear you are dead!'];
    c.observe([s]);
    expect(c.deaths).toEqual([{ player: 0, at: 1000, hp: 70, chat: ['Oh dear you are dead!'] }]);
    expect(c.failures).toContain('Player 1 died during cleanup');
});

test('an accounted recovery-probe death is ignored but a later zero HP sample still fails cleanup', () => {
    const c = new KqCleanup(1, 1000, false, [{ player: 0, chatCount: 1, zeroHp: false }]); const s = player();
    s.chat = ['Oh dear you are dead!']; s.deathChatCount = 1;
    const [action] = c.observe([s]); c.complete(action, true);
    expect(c.deaths).toEqual([]);
    s.at += 200; s.hp = 0; c.observe([s]);
    expect(c.deaths).toHaveLength(1); expect(c.failures).toContain('Player 1 died during cleanup');
});

test('cleanup does not recount an expected death already in progress', () => {
    const c = new KqCleanup(1, 1000, false, [{ player: 0, chatCount: 0, zeroHp: true }]); const s = player();
    s.hp = 0; c.observe([s]); expect(c.deaths).toEqual([]);
    s.at += 1000; s.hp = 70; s.chat = ['Oh dear you are dead!']; s.deathChatCount = 1;
    c.observe([s]); expect(c.deaths).toEqual([]);
});

test('a stopped or crashed fighter receives a marked fixture rescue before logout', () => {
    for (const runner of ['stopped', 'crashed']) {
        const c = new KqCleanup(1, 1000); const s = player(); s.runner = runner;
        const [action] = c.observe([s]);
        expect(action.kind).toBe('teleport');
        expect(c.fixtureTeleports).toEqual([{ player: 0, at: 1000, reason: `${runner} runner in an unsafe location` }]);
        expect(c.failures).toContain('Player 1 needed fixture cleanup teleport');
        c.complete(action, true);
        s.at += 1000; s.tile = s.serverTile = { x: 3308, z: 3120, level: 0 }; s.inCombat = false;
        expect(c.observe([s]).map(a => a.kind)).toEqual(['logout']);
    }
});

test('a rejected logout keeps the client observed and retries without claiming completion', () => {
    const c = new KqCleanup(1, 1000); const s = player();
    s.runner = 'stopped'; s.inCombat = false; s.tile = s.serverTile = { x: 3308, z: 3120, level: 0 };
    const [action] = c.observe([s]); c.complete(action, false);
    s.at += 200; expect(c.observe([s])).toEqual([]);
    expect(c.finished).toBe(false);
    s.at += 2000;
    expect(c.observe([s]).map(a => a.kind)).toEqual(['logout']);
});

test('an overdue retreat is rescued while all players continue to be sampled', () => {
    const c = new KqCleanup(2, 1000); const samples = [player(), player()];
    for (const action of c.observe(samples)) c.complete(action, true);
    samples.forEach(s => { s.at += 15001; });
    const actions = c.observe(samples);
    expect(actions.map(a => a.kind)).toEqual(['teleport', 'teleport']);
    samples[1].hp = 0;
    samples.forEach(s => { s.at += 200; }); c.observe(samples);
    expect(c.deaths.map(d => d.player)).toEqual([1]);
    expect(c.finished).toBe(false);
});

test('a loading or unknown tile cannot authorize stop or logout', () => {
    const c = new KqCleanup(1, 1000); const s = player();
    const [action] = c.observe([s]); c.complete(action, true);
    s.at += 200; s.sceneReady = false; s.tile = s.serverTile = null; s.inCombat = false;
    expect(c.observe([s])).toEqual([]);
    expect(c.finished).toBe(false);
});

test('an unknown HP sample cannot suppress a later observed death', () => {
    const c = new KqCleanup(1, 1000); const s = player();
    s.sceneReady = false; s.hp = -1; c.observe([s]);
    s.at += 200; s.sceneReady = true; s.hp = 0; c.observe([s]);
    expect(c.deaths).toHaveLength(1); expect(c.failures).toContain('Player 1 died during cleanup');
});

test('a crashed runner still fails cleanup when it is already outside the nest', () => {
    const c = new KqCleanup(1, 1000); const s = player();
    s.runner = 'crashed'; s.inCombat = false; s.tile = s.serverTile = { x: 3308, z: 3120, level: 0 };
    expect(c.observe([s]).map(a => a.kind)).toEqual(['logout']);
    expect(c.failures).toContain('Player 1 runner crashed during cleanup');
});

test('failed retreat requests trigger fixture rescue without stopping combat', () => {
    const c = new KqCleanup(1, 1000); const s = player();
    const [action] = c.observe([s]); c.complete(action, false, 'request rejected');
    s.at += 200;
    expect(c.observe([s]).map(a => a.kind)).toEqual(['teleport']);
    expect(c.failures).toContain('Player 1 cleanup retreat failed: request rejected');
});

test('an offline client with stale zero HP is not a new death', () => {
    const c = new KqCleanup(1, 1000); const s = player();
    s.ingame = false; s.sceneReady = false; s.hp = 0;
    expect(c.observe([s])).toEqual([]);
    expect(c.finished).toBe(true);
    expect(c.deaths).toEqual([]);
});

test('final paint capture waits for every fighter to reach safety and pauses them there', () => {
    const c = new KqCleanup(2, 1000, true); const samples = [player(), player()];
    for (const action of c.observe(samples)) c.complete(action, true);
    samples[0].tile = samples[0].serverTile = { x: 3308, z: 3120, level: 0 }; samples[0].inCombat = false;
    samples.forEach(s => { s.at += 200; });
    const [pause] = c.observe(samples); expect(pause.kind).toBe('pause'); c.complete(pause, true);
    samples[0].runner = 'paused'; c.observe(samples);
    expect(c.captureReady).toBe(false);
    samples[1].tile = samples[1].serverTile = { x: 2757, z: 3478, level: 0 }; samples[1].inCombat = false;
    const [otherPause] = c.observe(samples); c.complete(otherPause, true);
    samples[1].runner = 'paused'; c.observe(samples);
    expect(c.captureReady).toBe(true);
    c.releaseCapture();
    expect(c.observe(samples).map(a => a.kind)).toEqual(['stop', 'stop']);
});

test('a lagging Arena sprite cannot pause a runner already walking outside the safe area', () => {
    const c = new KqCleanup(1, 1789591332063, true);
    const s = { ...player(1789591332064), tile: { x: 2758, z: 3477, level: 0 }, serverTile: { x: 2758, z: 3477, level: 0 } };
    const [retreat] = c.observe([s]); c.complete(retreat, true);
    s.at = 1789591335600; s.inCombat = false;
    s.tile = { x: 3309, z: 3224, level: 0 };
    s.serverTile = { x: 3310, z: 3215, level: 0 };
    expect(c.observe([s])).toEqual([]);
    s.at = 1789591337259; s.tile = { ...s.serverTile };
    expect(c.observe([s])).toEqual([]);
    s.at += 1000; s.tile = s.serverTile = { x: 3308, z: 3120, level: 0 };
    const [pause] = c.observe([s]); expect(pause.kind).toBe('pause'); c.complete(pause, true);
    s.runner = 'paused'; s.at += 200; c.observe([s]);
    expect(c.captureReady).toBe(true);
    expect(c.fixtureTeleports).toEqual([]);
});

test('a safe rendered tile without a server position cannot authorize pause or capture', () => {
    const c = new KqCleanup(1, 1000, true);
    const s = { ...player(), tile: { x: 3308, z: 3120, level: 0 }, serverTile: null, inCombat: false };
    const [retreat] = c.observe([s]); c.complete(retreat, true);
    s.at += 200;
    expect(c.observe([s])).toEqual([]);
    s.runner = 'paused'; s.at += 200; c.observe([s]);
    expect(c.captureReady).toBe(false);
});
