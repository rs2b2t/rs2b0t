import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { DomSlotOps, orderedSlotElements } from '#/bot/multibox/DomSlotOps.js';
import { renderRailTile } from '#/bot/multibox/RailTile.js';
import type { SlotHandle } from '#/bot/multibox/types.js';
import type { RosterClient } from '#/bot/multibox/RosterTypes.js';

let handles: SlotHandle[] = [];

beforeEach(() => {
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('http://localhost:8081/multibox.html');
    document.body.innerHTML = '<div id="rail"><div id="add"></div><div id="resources"></div></div>';
    handles = [];
});

afterEach(() => {
    for (const handle of handles) {
        handle.destroy();
    }
    document.body.innerHTML = '';
    jest.useRealTimers();
});

describe('DomSlotOps', () => {
    test.each([30, 61])('only the focused rail mirror ticks on a %i-slot wall', size => {
        jest.useFakeTimers();
        const clock = jest as typeof jest & {
            advanceTimersByTime(ms: number): void;
            advanceTimersToNextTimer(): void;
            getTimerCount(): number;
        };
        const start = Date.now();
        const rail = document.getElementById('rail')!;
        rail.id = 'mbx-rail';
        let width = 264;
        Object.defineProperty(rail, 'offsetWidth', { get: () => width });
        const ops = new DomSlotOps(rail, document.getElementById('add')!, false);
        const calls: unknown[][] = [];
        for (let i = 0; i < size; i++) {
            handles.push(ops.spawn({ username: 'slot' + i, password: '' }));
            const frame = rail.querySelector<HTMLIFrameElement>(`iframe[title="slot${i}"]`)!;
            const doc = frame.contentDocument!;
            doc.body.innerHTML = '<canvas id="canvas" width="765" height="503"></canvas><canvas id="overlay" width="765" height="503"></canvas>';
            const mirror = frame.closest('.mbx-slot')!.querySelector('canvas')!;
            Object.defineProperty(mirror, 'getContext', { value: () => ({
                clearRect: (...args: number[]) => calls.push([Date.now() - start, i, 'clear', ...args]),
                drawImage: (source: HTMLCanvasElement, ...args: number[]) => calls.push([Date.now() - start, i, source.id, ...args])
            }) });
            Object.assign(frame.contentWindow!, { rs2b0t: { renderGate: {}, setRenderMode() {} } });
            frame.dispatchEvent(new Event('mbx-client-initialized'));
            clock.advanceTimersByTime(7);
        }
        clock.advanceTimersByTime(50);
        handles[0].setRenderMode('focused');
        const focusedTimers = clock.getTimerCount();
        let finished = false;
        window.setTimeout(() => { finished = true; }, 60_000);
        let ticks = 0;
        while (!finished) {
            clock.advanceTimersToNextTimer();
            if (!finished) ticks++;
        }
        const expected: unknown[][] = [];
        const paint = (ms: number, slot: number) => expected.push(
            [ms, slot, 'clear', 0, 0, 236, 155],
            [ms, slot, 'canvas', 0, 0, 765, 503, 0, 0, 236, 155],
            [ms, slot, 'overlay', 0, 0, 765, 503, 0, 0, 236, 155]
        );
        for (let i = 1; i <= 60; i++) paint(i * 1000, 0);
        expect(calls).toEqual(expected);

        handles[0].setRenderMode('background');
        handles[1].setRenderMode('focused');
        clock.advanceTimersByTime(61_006 - (Date.now() - start));
        handles[1].setRenderMode('focused');
        clock.advanceTimersByTime(1);
        paint(61_007, 1);
        width = 0;
        clock.advanceTimersByTime(1000);
        width = 264;
        clock.advanceTimersByTime(1000);
        paint(63_007, 1);
        handles[1].setRenderMode('hidden');
        handles[2].setRenderMode('focused');
        handles[2].destroy();
        clock.advanceTimersByTime(1500);
        const emptyTimers = clock.getTimerCount();
        handles[0].setRenderMode('focused');
        clock.advanceTimersByTime(493);
        paint(65_000, 0);
        handles[0].destroy();
        clock.advanceTimersByTime(1000);
        expect(calls).toEqual(expected);
        expect({ ticks, focusedTimers, emptyTimers, remaining: clock.getTimerCount() }).toEqual({
            ticks: 60, focusedTimers: 1, emptyTimers: 0, remaining: 0
        });
    });

    test.each(['missing', 'unreadable'])('a startup timeout (%s bridge) stops checks, admits the next frame and allows re-add', bridge => {
        jest.useFakeTimers();
        const clock = jest as typeof jest & { advanceTimersByTime(ms: number): void };
        const rail = document.getElementById('rail')!;
        const ops = new DomSlotOps(rail, document.getElementById('add')!, true, 1);
        const account = { username: 'first', password: '' };
        const first = ops.spawn(account);
        const second = ops.spawn({ username: 'second', password: '' });
        handles.push(first, second);
        const [tile, queued] = orderedSlotElements(rail);
        const nextFrame = queued.querySelector('iframe')!;
        let checks = 0;
        let unreadable = false;
        Object.defineProperty(tile.querySelector('iframe')!.contentWindow!, 'rs2b0t', {
            get() {
                checks++;
                if (unreadable) throw new DOMException('Frame unavailable', 'SecurityError');
                return undefined;
            }
        });
        clock.advanceTimersByTime(179_999);
        expect(checks).toBeGreaterThan(0);
        expect(nextFrame.hasAttribute('src')).toBe(false);
        unreadable = bridge === 'unreadable';
        clock.advanceTimersByTime(1);
        expect(nextFrame.hasAttribute('src')).toBe(true);
        const atDeadline = checks;
        clock.advanceTimersByTime(1000);
        renderRailTile(tile, {
            ...first.status(), username: account.username, id: 1, focused: false,
            mode: 'background', tab: 'Main', switchingWorld: null, targetWorld: 1
        });
        expect(checks - atDeadline).toBe(0);
        expect(tile.querySelector('.mbx-script-status')!.textContent).toBe('Startup timed out');

        first.destroy();
        const retry = ops.spawn(account);
        handles.push(retry);
        nextFrame.dispatchEvent(new Event('mbx-client-initialized'));
        const retryFrame = rail.querySelector<HTMLIFrameElement>('iframe[title="first"]')!;
        Object.assign(retryFrame.contentWindow!, { rs2b0t: {
            reader: { ingame: () => false, localPlayerName: () => null }, client: { constructor: { loopCycle: 0 } },
            renderGate: { drawn: 0 }, runner: { state: 'idle' }
        } });
        clock.advanceTimersByTime(50);
        expect(retry.status().ready).toBe(true);
        clock.advanceTimersByTime(180_000);
        expect(queued.dataset.startup).toBe('Startup timed out');
        expect(retryFrame.closest<HTMLElement>('.mbx-slot')!.dataset.startup).toBeUndefined();
    });

    test('queues a 61-profile launch and frees capacity on boot completion, removal and world reload', () => {
        const ops = new DomSlotOps(document.getElementById('rail')!, document.getElementById('add')!, true);
        for (let i = 0; i < 61; i++) handles.push(ops.spawn({ username: 'slot' + i, password: '' }));
        const frames = Array.from(document.querySelectorAll('iframe'));
        expect(frames.length).toBe(61);
        expect(frames.filter(frame => frame.hasAttribute('src')).length).toBe(4);
        frames[0].dispatchEvent(new Event('mbx-client-initialized'));
        expect(frames[4].hasAttribute('src')).toBe(true);
        handles[5].destroy();
        handles[1].reloadWorld(2);
        expect(frames[6].hasAttribute('src')).toBe(true);
        frames[1].dispatchEvent(new Event('mbx-client-initialized'));
        expect(frames[7].hasAttribute('src')).toBe(false);
        handles[2].destroy();
        expect(frames[7].hasAttribute('src')).toBe(true);
        for (const frame of frames.slice(3)) {
            if (frame.isConnected) {
                expect(frame.hasAttribute('src')).toBe(true);
                frame.dispatchEvent(new Event('mbx-client-initialized'));
            }
        }
        expect(new URL(document.querySelector<HTMLIFrameElement>('iframe[title="slot1"]')!.src).searchParams.get('world')).toBe('2');
    });

    test('roster exposes only the live ready bridge without queueing access', async () => {
        const ops = new DomSlotOps(document.getElementById('rail')!, document.getElementById('add')!, true);
        const handle = ops.spawn({ username: 'alice', password: '', world: 1 });
        handles.push(handle);
        expect(handle.roster?.()).toBeNull();
        const bridge: RosterClient = {
            scripts: () => ['WalkTo'], selectedScript: () => 'WalkTo', readSettings: () => ({}),
            assignScript() {}, copySettings() {}, startScript() {}, stopScript() {},
            configureScript: async () => {}, travelTo: async () => {}, async editSettings() {}
        };
        Object.assign(document.querySelector('iframe')!.contentWindow!, { rs2b0t: { roster: bridge } });
        await new Promise(resolve => setTimeout(resolve, 75));
        expect(handle.roster?.()).toBe(bridge);
        handle.reloadWorld(2);
        expect(handle.roster?.()).toBeNull();
        const next: RosterClient = { ...bridge, scripts: () => ['Fisher'] };
        Object.assign(document.querySelector('iframe')!.contentWindow!, { rs2b0t: { roster: next } });
        await new Promise(resolve => setTimeout(resolve, 75));
        expect(handle.roster?.()).toBe(next);
        handle.destroy();
        expect(handle.roster?.()).toBeNull();
    });

    test('script status follows runner metadata through switches and reloads', async () => {
        const ops = new DomSlotOps(document.getElementById('rail')!, document.getElementById('add')!, true);
        const handle = ops.spawn({ username: 'alice', password: '', world: 1 });
        handles.push(handle);
        expect(handle.status().scriptName).toBeNull();
        const runner = { state: 'idle', meta: null as { name: string } | null };
        Object.assign(document.querySelector('iframe')!.contentWindow!, { rs2b0t: {
            world: 1, reader: { ingame: () => true, localPlayerName: () => 'Alice' },
            client: { constructor: { loopCycle: 0 } }, renderGate: { drawn: 0 }, runner
        } });
        await new Promise(resolve => setTimeout(resolve, 75));
        expect(handle.status()).toMatchObject({ scriptState: 'idle', scriptName: null });
        runner.meta = { name: 'Fisher' };
        runner.state = 'running';
        expect(handle.status()).toMatchObject({ scriptState: 'running', scriptName: 'Fisher' });
        runner.state = 'paused';
        expect(handle.status()).toMatchObject({ scriptState: 'paused', scriptName: 'Fisher' });
        runner.meta = { name: 'AutoFighter' };
        runner.state = 'running';
        expect(handle.status()).toMatchObject({ scriptState: 'running', scriptName: 'AutoFighter' });
        handle.reloadWorld(3);
        expect(handle.status()).toMatchObject({ ready: false, scriptName: null });
    });

    test('mixed-world frames carry explicit targets and expose per-slot controls', () => {
        (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('https://w1.rs2b2t.com/rs2b0t/wall');
        const ops = new DomSlotOps(document.getElementById('rail')!, document.getElementById('add')!, true);
        handles.push(ops.spawn({ username: 'Alice One', password: 'secret', world: 2 }));
        const url = new URL(document.querySelector('iframe')!.src);
        expect(url.origin).toBe('https://w1.rs2b2t.com');
        expect(url.searchParams.get('world')).toBe('2');
        expect(url.searchParams.get('box')).toBe('Alice One');
        expect(url.href).not.toContain('secret');
        expect(Array.from(document.querySelector<HTMLSelectElement>('.mbx-world-select')!.options).map(option => option.value)).toEqual(['1', '2', '3']);
        expect(document.querySelector('.mbx-world-switch')).not.toBeNull();
        expect(document.querySelector('.mbx-world-cancel')).not.toBeNull();
        expect(handles[0].status().world).toBeNull();
    });

    test('a world reload replaces only its frame and preserves tile order and profile storage', async () => {
        const rail = document.getElementById('rail')!;
        const ops = new DomSlotOps(rail, document.getElementById('add')!, true);
        handles.push(ops.spawn({ username: 'alice', password: 'a', world: 1 }));
        handles.push(ops.spawn({ username: 'bob', password: 'b', world: 2 }));
        ops.move(handles[1], handles[0]);
        const tiles = orderedSlotElements(rail);
        const [bobFrame, aliceFrame] = tiles.map(tile => tile.querySelector('iframe')!);
        sessionStorage.setItem('rs2b0t:alice:creds', '{"username":"alice","password":"edited"}');
        sessionStorage.setItem('rs2b0t:alice:selectedScript', 'Mining');
        const oldCalls: string[] = [];
        Object.assign(aliceFrame.contentWindow!, { rs2b0t: {
            world: 1, reader: { ingame: () => false, localPlayerName: () => null },
            client: { constructor: { loopCycle: 12 } }, renderGate: { drawn: 0 }, runner: { state: 'idle' },
            prepareWorldSwitch: () => true, setAutoLogin: () => oldCalls.push('autoLogin'),
            setRenderMode: () => oldCalls.push('render'), setLoginCoordination: () => oldCalls.push('coordination')
        } });
        await new Promise(resolve => setTimeout(resolve, 75));
        expect(handles[0].prepareWorldSwitch()).toBe(true);
        handles[0].reloadWorld(2);
        const replacement = tiles[1].querySelector('iframe')!;
        expect(replacement).not.toBe(aliceFrame);
        expect(tiles[0].querySelector('iframe')).toBe(bobFrame);
        expect(orderedSlotElements(rail)).toEqual(tiles);
        expect(new URL(replacement.src).searchParams.get('world')).toBe('2');
        expect(new URL(replacement.src).searchParams.get('box')).toBe('alice');
        expect(new URL(replacement.src).searchParams.get('autologin')).toBe('0');
        expect(handles[0].status()).toMatchObject({ ready: false, ingame: false, world: null });
        handles[0].setAutoLogin(false);
        expect(oldCalls).toEqual([]);
        const newCalls: boolean[] = [];
        Object.assign(replacement.contentWindow!, { rs2b0t: {
            world: 2, reader: { ingame: () => false, localPlayerName: () => null },
            client: { constructor: { loopCycle: 0 } }, renderGate: { drawn: 0 }, runner: { state: 'idle' },
            setAutoLogin: (on: boolean) => newCalls.push(on)
        } });
        await new Promise(resolve => setTimeout(resolve, 75));
        expect(newCalls).toEqual([false]);
        expect(handles[0].status()).toMatchObject({ ready: true, ingame: false, world: null });
        expect(sessionStorage.getItem('rs2b0t:alice:creds')).toContain('edited');
        expect(sessionStorage.getItem('rs2b0t:alice:selectedScript')).toBe('Mining');
        sessionStorage.removeItem('rs2b0t:alice:creds');
        sessionStorage.removeItem('rs2b0t:alice:selectedScript');
    });

    test('connected world comes from the runtime only while ingame', async () => {
        const ops = new DomSlotOps(document.getElementById('rail')!, document.getElementById('add')!, true);
        handles.push(ops.spawn({ username: 'alice', password: '', world: 2 }));
        let ingame = true;
        Object.assign(document.querySelector('iframe')!.contentWindow!, { rs2b0t: {
            world: 3, reader: { ingame: () => ingame, localPlayerName: () => 'Alice' },
            client: { constructor: { loopCycle: 0 } }, renderGate: { drawn: 0 }, runner: { state: 'idle' }
        } });
        await new Promise(resolve => setTimeout(resolve, 75));
        expect(handles[0].status().world).toBe(3);
        Reflect.set(Reflect.get(document.querySelector('iframe')!.contentWindow!, 'rs2b0t'), 'world', 4);
        expect(handles[0].status().world).toBeNull();
        ingame = false;
        expect(handles[0].status().world).toBeNull();
    });

    test('reorders visually without moving iframe ancestors in the DOM', () => {
        const rail = document.getElementById('rail')!;
        const add = document.getElementById('add')!;
        const ops = new DomSlotOps(rail, add, true);
        const alice = ops.spawn({ username: 'alice', password: '' });
        const bob = ops.spawn({ username: 'bob', password: '' });
        const carol = ops.spawn({ username: 'carol', password: '' });
        handles.push(alice, bob, carol);

        const originalDomOrder = Array.from(rail.querySelectorAll<HTMLElement>('.mbx-slot'));
        const originalFrames = originalDomOrder.map(slot => slot.querySelector('iframe'));

        ops.move(carol, alice);

        expect(Array.from(rail.querySelectorAll('.mbx-slot'))).toEqual(originalDomOrder);
        expect(originalDomOrder.map(slot => slot.querySelector('iframe'))).toEqual(originalFrames);
        expect(orderedSlotElements(rail)).toEqual([originalDomOrder[2], originalDomOrder[0], originalDomOrder[1]]);

        ops.move(carol, null);

        expect(Array.from(rail.querySelectorAll('.mbx-slot'))).toEqual(originalDomOrder);
        expect(orderedSlotElements(rail)).toEqual(originalDomOrder);
    });

    test('keeps newly spawned slots after the current visual order', () => {
        const rail = document.getElementById('rail')!;
        const add = document.getElementById('add')!;
        const ops = new DomSlotOps(rail, add, true);
        const alice = ops.spawn({ username: 'alice', password: '' });
        const bob = ops.spawn({ username: 'bob', password: '' });
        handles.push(alice, bob);
        const [aliceEl, bobEl] = orderedSlotElements(rail);

        ops.move(bob, alice);
        const carol = ops.spawn({ username: 'carol', password: '' });
        handles.push(carol);

        const carolEl = Array.from(rail.querySelectorAll<HTMLElement>('.mbx-slot')).find(slot => slot.querySelector('iframe')?.title === 'carol')!;
        expect(orderedSlotElements(rail)).toEqual([bobEl, aliceEl, carolEl]);
    });
});


test('World 2 wall frames inherit World 2 identity and stay same-origin', () => {
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('https://w2.rs2b2t.com/rs2b0t/wall?nodeid=10&lowmem=0&members=0');
    const ops = new DomSlotOps(document.getElementById('rail')!, document.getElementById('add')!, true);
    handles.push(ops.spawn({ username: 'alice', password: 'secret' }));
    handles.push(ops.spawn({ username: 'bob', password: 'secret' }));
    for (const frame of Array.from(document.querySelectorAll('iframe'))) {
        const url = new URL(frame.src);
        expect(url.origin).toBe('https://w2.rs2b2t.com');
        expect(url.pathname).toBe('/rs2b0t/bot.html');
        expect(url.searchParams.get('nodeid')).toBe('11');
        expect(url.searchParams.get('lowmem')).toBe('0');
        expect(url.searchParams.get('members')).toBe('0');
        expect(url.href).not.toContain('secret');
    }
    expect(handles[0].prepareWorldSwitch()).toBe(false);
});


test('cancelling a booting slot does not leave queued logout requests', async () => {
    const ops = new DomSlotOps(document.getElementById('rail')!, document.getElementById('add')!, true);
    const handle = ops.spawn({ username: 'alice', password: '' });
    handles.push(handle);
    expect(handle.prepareWorldSwitch()).toBe(false);
    handle.cancelWorldSwitch();
    const calls: string[] = [];
    const frame = document.querySelector('iframe')!;
    Object.assign(frame.contentWindow!, { rs2b0t: {
        prepareWorldSwitch: () => { calls.push('prepare'); return true; },
        cancelWorldSwitch: () => calls.push('cancel')
    } });
    await new Promise(resolve => setTimeout(resolve, 75));
    expect(calls).toEqual(['cancel']);
});


test('local slots preserve the engine node and stored assignment without world controls', async () => {
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('http://localhost:8890/multibox.html?nodeid=42&world=2&lowmem=0');
    const ops = new DomSlotOps(document.getElementById('rail')!, document.getElementById('add')!, false);
    const account = { username: 'Alice One', password: '', world: 2 as const };
    const handle = ops.spawn(account);
    handles.push(handle);
    const frame = document.querySelector('iframe')!;
    const url = new URL(frame.src);
    expect(url.origin).toBe('http://localhost:8890');
    expect(url.searchParams.has('world')).toBe(false);
    expect(url.searchParams.get('nodeid')).toBe('42');
    expect(url.searchParams.get('box')).toBe('Alice One');
    expect(url.searchParams.get('lowmem')).toBe('0');
    expect(document.querySelector('.mbx-world-select')).toBeNull();
    expect(document.querySelector('.mbx-world-switch')).toBeNull();
    expect(document.querySelector('.mbx-world-cancel')).toBeNull();
    expect(account.world).toBe(2);
    let preparations = 0;
    Object.assign(frame.contentWindow!, { rs2b0t: {
        world: null, reader: { ingame: () => true, localPlayerName: () => 'Alice' },
        client: { constructor: { loopCycle: 0 } }, renderGate: { drawn: 0 }, runner: { state: 'running' },
        prepareWorldSwitch: () => { preparations++; return true; }
    } });
    await new Promise(resolve => setTimeout(resolve, 75));
    expect(handle.status()).toMatchObject({ ingame: true, world: null, scriptState: 'running' });
    expect(handle.prepareWorldSwitch()).toBe(false);
    handle.reloadWorld(1);
    expect(preparations).toBe(0);
    expect(document.querySelector('iframe')).toBe(frame);
});


test('slot world selection enables Switch immediately and leaves pending controls alone', () => {
    const ops = new DomSlotOps(document.getElementById('rail')!, document.getElementById('add')!, true);
    handles.push(ops.spawn({ username: 'alice', password: '', world: 2 }));
    const select = document.querySelector<HTMLSelectElement>('.mbx-world-select')!;
    const change = document.querySelector<HTMLButtonElement>('.mbx-world-switch')!;
    change.disabled = true;
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    expect(change.disabled).toBe(false);
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    expect(change.disabled).toBe(true);
    select.disabled = true;
    change.disabled = false;
    select.dispatchEvent(new Event('change'));
    expect(change.disabled).toBe(false);
});
