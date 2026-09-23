import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DomSlotOps, orderedSlotElements } from '#/bot/multibox/DomSlotOps.js';
import type { SlotHandle } from '#/bot/multibox/types.js';

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
});

describe('DomSlotOps', () => {
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
        handle.reloadWorld(2);
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
        expect(Array.from(document.querySelector<HTMLSelectElement>('.mbx-world-select')!.options).map(option => option.value)).toEqual(['1', '2']);
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
            world: 1, reader: { ingame: () => ingame, localPlayerName: () => 'Alice' },
            client: { constructor: { loopCycle: 0 } }, renderGate: { drawn: 0 }, runner: { state: 'idle' }
        } });
        await new Promise(resolve => setTimeout(resolve, 75));
        expect(handles[0].status().world).toBe(1);
        Reflect.set(Reflect.get(document.querySelector('iframe')!.contentWindow!, 'rs2b0t'), 'world', 3);
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


test('a slot still booting receives both switch preparation and cancellation in order', async () => {
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
    expect(calls).toEqual(['prepare', 'cancel']);
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
