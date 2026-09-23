import { afterEach, beforeEach, expect, test } from 'bun:test';
import { LoopingBot } from '#/bot/api/bot/Bot.js';
import type { BotHostImpl } from '#/bot/runtime/BotHost.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import BotPanel from '#/bot/panel/BotPanel.js';
import { TARGET, resolveTarget } from '#/client/config/target.js';
import { attach, detach } from '#/bot/adapter/ClientAdapter.js';

// Why: the URL is process-global and `boxId()` reads it per call, so a `?box=alice` left behind re-namespaces every later `boxKey()` in the run.
const setURL = (url: string): void =>
    (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);

const previousTarget = { ...TARGET };

const PLAIN_URL = 'http://localhost:8081/bot.html';

beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
    setURL(PLAIN_URL);
    delete TARGET.world;
    delete TARGET.httpPrefix;
    Object.assign(TARGET, resolveTarget('local', 'localhost:8081'));
});

afterEach(async () => {
    detach();
    ScriptRunner.stop('test teardown');
    await Promise.resolve();
    await Promise.resolve();
    setURL(PLAIN_URL);
    delete TARGET.world;
    delete TARGET.httpPrefix;
    Object.assign(TARGET, previousTarget);
});

test('sidebar omits chat and low-value status rows', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const host = {
        selfTestMissing: [],
        addDrawListener: () => {}
    } as unknown as BotHostImpl;

    new BotPanel(root, host);

    const sections = Array.from(root.children).filter(node => node.classList.contains('rs2b0t-section'));
    const title = (section: Element): string =>
        Array.from(section.children).find(node => node.classList.contains('rs2b0t-section-title'))?.textContent ?? '';

    expect(sections.map(title)).toEqual(['script', 'parameters', 'status', 'log']);
    expect(root.querySelector('.rs2b0t-chat')).toBeNull();

    const status = sections.find(section => title(section) === 'status');
    expect(status).toBeDefined();
    expect(Array.from(status!.querySelectorAll('.rs2b0t-key'), node => node.textContent)).toEqual(['state', 'world', 'player', 'tile', 'modals']);
});

test('world status identifies the connected world only after login', () => {
    for (const world of [1, 2]) {
        setURL(`${PLAIN_URL}?box=alice&world=${world}`);
        Object.assign(TARGET, resolveTarget('proxy', location.host, false, new URLSearchParams(location.search)));
        for (const ingame of [false, true]) {
            attach({ ingame });
            const root = document.createElement('div');
            const host = { selfTestMissing: [], addDrawListener: () => {} } as unknown as BotHostImpl;
            new BotPanel(root, host);
            expect(root.querySelector('[data-status=world]')?.textContent)
                .toBe(ingame ? `World ${world}` : `logged out (target World ${world})`);
        }
    }
});

test('render controls appear below the log and persist per bot', () => {
    setURL(`${PLAIN_URL}?box=alice`);
    localStorage.setItem('rs2b0t:alice:rendererEnabled', '0');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const enabled: boolean[] = [];
    const frameListeners: Array<() => void> = [];
    const host = {
        selfTestMissing: [],
        addDrawListener: () => {},
        addFrameListener: (listener: () => void) => frameListeners.push(listener)
    } as unknown as BotHostImpl;

    const panel = new BotPanel(root, host, {
        enabled: () => true,
        setEnabled: value => enabled.push(value)
    });

    const sections = Array.from(root.querySelectorAll(':scope > .rs2b0t-section'));
    const headings = sections.map(section => section.querySelector('.rs2b0t-section-title')?.textContent);
    const rendering = sections.at(-1)!;
    const toggle = rendering.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(headings.slice(-2)).toEqual(['log', 'rendering']);
    expect(toggle.checked).toBe(false);
    expect(rendering.querySelector('select')).toBeNull();
    expect(enabled).toEqual([false]);
    expect(frameListeners).toHaveLength(1);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(enabled).toEqual([false, true]);
    expect(localStorage.getItem('rs2b0t:alice:rendererEnabled')).toBe('1');

    panel.setRendererEnabled(false);
    expect(toggle.checked).toBe(false);
    expect(enabled).toEqual([false, true, false]);
    expect(localStorage.getItem('rs2b0t:alice:rendererEnabled')).toBe('0');
});

test('wall start and stop use the script selected in the bot panel', async () => {
    setURL(`${PLAIN_URL}?box=alice`);
    class SelectedBot extends LoopingBot {
        override loop(): void {}
    }
    const name = 'BotPanel wall control test';
    const instances: SelectedBot[] = [];
    ScriptRegistry.register({
        name,
        description: 'test fixture',
        create: () => {
            const bot = new SelectedBot();
            instances.push(bot);
            return bot;
        }
    });
    localStorage.setItem('rs2b0t:alice:selectedScript', name);
    const root = document.createElement('div');
    document.body.appendChild(root);
    const host = {
        selfTestMissing: [],
        addDrawListener: () => {}
    } as unknown as BotHostImpl;
    const panel = new BotPanel(root, host);

    panel.startSelectedScript();
    panel.startSelectedScript();
    await Promise.resolve();
    await Promise.resolve();

    expect(instances).toHaveLength(1);
    expect(ScriptRunner.meta?.name).toBe(name);
    expect(ScriptRunner.state).toBe('running');

    panel.stopScript();
    expect(ScriptRunner.state).toBe('stopped');

    // Why: ScriptRegistry is a process-wide singleton, so a fixture left registered leaks into every later test.
    ScriptRegistry.unregister(name);
});

test('the bot panel offers a Loadouts button that opens the panel', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const host = {
        selfTestMissing: [],
        addDrawListener: () => {}
    } as unknown as BotHostImpl;

    new BotPanel(root, host);

    const btn = Array.from(root.querySelectorAll('button'))
        .find(b => b.textContent === 'Loadouts') as HTMLButtonElement | undefined;
    expect(btn).toBeDefined();
    btn!.click();
    expect(document.querySelector('[data-slot=righthand]')).not.toBeNull();
});

test('a pending world switch blocks panel and wall script starts until cancelled', async () => {
    const name = 'World switch start gate';
    let starts = 0;
    class SelectedBot extends LoopingBot { override loop(): void {} }
    ScriptRegistry.register({ name, description: 'test fixture', create: () => { starts++; return new SelectedBot(); } });
    localStorage.setItem('rs2b0t:selectedScript', name);
    const root = document.createElement('div');
    const host = { selfTestMissing: [], addDrawListener: () => {} } as unknown as BotHostImpl;
    const panel = new BotPanel(root, host);
    try {
        panel.setWorldSwitchPending(true);
        const start = Array.from(root.querySelectorAll('button')).find(button => button.textContent === 'Start')!;
        expect(start.disabled).toBe(true);
        start.click();
        panel.startSelectedScript();
        expect(starts).toBe(0);
        panel.setWorldSwitchPending(false);
        expect(starts).toBe(0);
        expect(start.disabled).toBe(false);
        panel.startSelectedScript();
        await Promise.resolve();
        expect(starts).toBe(1);
    } finally {
        ScriptRunner.stop('test teardown');
        ScriptRegistry.unregister(name);
    }
});


test('local status and wall link preserve a custom engine node despite an unused world query', () => {
    setURL(`${PLAIN_URL}?world=2&nodeid=42`);
    delete TARGET.world;
    delete TARGET.httpPrefix;
    Object.assign(TARGET, resolveTarget('local', location.host));
    const previousMode = process.env.RS2B0T_TARGET;
    process.env.RS2B0T_TARGET = 'local';
    try {
        for (const ingame of [false, true]) {
            attach({ ingame });
            const root = document.createElement('div');
            const host = { selfTestMissing: [], addDrawListener: () => {} } as unknown as BotHostImpl;
            new BotPanel(root, host);
            expect(root.querySelector('[data-status=world]')?.textContent).toBe(ingame ? 'Local engine' : 'logged out (local engine)');
            const href = root.querySelector<HTMLAnchorElement>('.rs2b0t-wall-link')!.href;
            expect(new URL(href).searchParams.get('nodeid')).toBe('42');
            expect(new URL(href).searchParams.has('world')).toBe(false);
        }
    } finally {
        if (previousMode === undefined) delete process.env.RS2B0T_TARGET;
        else process.env.RS2B0T_TARGET = previousMode;
    }
});
