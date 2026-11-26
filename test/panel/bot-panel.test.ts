import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { LoopingBot } from '#/bot/api/bot/Bot.js';
import type { BotHostImpl } from '#/bot/runtime/BotHost.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import * as loader from '#/bot/runtime/loader.js';
import BotPanel from '#/bot/panel/BotPanel.js';
import { Credentials } from '#/bot/runtime/Credentials.js';
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

test('global settings can reveal and hide a password without saving edits', () => {
    Credentials.save('fixture', 'saved-password');
    const root = document.createElement('div');
    new BotPanel(root, { selfTestMissing: [], addDrawListener: () => {} } as unknown as BotHostImpl);
    const open = Array.from(root.querySelectorAll('button')).find(b => b.textContent === 'Global settings')!;
    open.click();
    const input = document.querySelector<HTMLInputElement>('input[placeholder="password"]')!;
    const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="Show password"]');
    expect(input.type).toBe('password');
    expect(toggle).not.toBeNull();
    toggle!.click();
    expect(input.type).toBe('text');
    expect(input.value).toBe('saved-password');
    expect(toggle!.getAttribute('aria-label')).toBe('Hide password');
    input.value = 'edited-password';
    toggle!.click();
    expect(input.type).toBe('password');
    toggle!.click();
    input.closest('.rs2b0t-modal')!.querySelector<HTMLButtonElement>('button')!.click();
    open.click();
    expect(input.type).toBe('password');
    expect(input.value).toBe('edited-password');
    expect(Credentials.get()?.password).toBe('saved-password');
});

test('world status identifies the connected world only after login', () => {
    for (const world of [1, 2, 3]) {
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

function openLibrary() {
    const root = document.createElement('div');
    const panel = new BotPanel(root, { selfTestMissing: [], addDrawListener: () => {} } as unknown as BotHostImpl);
    const browse = Array.from(root.querySelectorAll('button')).find(b => b.textContent === 'Browse…')!;
    browse.click();
    const picker = document.querySelector<HTMLInputElement>('.rs2b0t-library-load input[type=file]')!;
    const backdrop = picker.closest<HTMLElement>('.rs2b0t-modal-backdrop')!;
    const loadFile = loader.loadFromFile;
    const fileLoad = spyOn(loader, 'loadFromFile');

    function startImport(name: string) {
        const ready = Promise.withResolvers<void>();
        fileLoad.mockImplementationOnce(file => ready.promise.then(() => loadFile(file)));
        const transfer = new DataTransfer();
        const source = `export default { __rs2b0tManifest: 1, name: ${JSON.stringify(name)}, create() {} }`;
        transfer.items.add(new File([source], 'fixture.js', { type: 'text/javascript' }));
        picker.files = transfer.files;
        picker.dispatchEvent(new Event('change'));
        const result = fileLoad.mock.results.at(-1)!.value;
        return async () => {
            ready.resolve();
            await result;
        };
    }

    function expectSelected(name: string) {
        expect(panel.selectedScriptName()).toBe(name);
        expect(localStorage.getItem('rs2b0t:selectedScript')).toBe(name);
        expect(sessionStorage.getItem('rs2b0t:selectedScript')).toBe(name);
    }

    return { panel, browse, backdrop, startImport, expectSelected, restore: () => fileLoad.mockRestore() };
}

test.each([
    ['select another card', 'Picked fixture'],
    ['assign from roster', 'Picked fixture'],
    ['dismiss', 'Previous fixture'],
    ['wait', 'Imported fixture']
])('file load after %s leaves %s selected', async (action, selected) => {
    const key = 'rs2b0t:selectedScript';
    for (const name of ['Previous fixture', 'Picked fixture']) {
        ScriptRegistry.register({ name, description: '', create: () => { throw new Error('unused'); } });
    }
    localStorage.setItem(key, 'Previous fixture');
    sessionStorage.setItem(key, 'Previous fixture');
    const library = openLibrary();
    const { backdrop, browse } = library;
    try {
        const finish = library.startImport('Imported fixture');
        if (action === 'select another card') {
            const cardName = Array.from(backdrop.querySelectorAll('.rs2b0t-card-name')).find(el => el.textContent === 'Picked fixture')!;
            cardName.closest<HTMLElement>('.rs2b0t-library-card')!.click();
            browse.click();
        } else if (action === 'dismiss') {
            backdrop.click();
            browse.click();
        } else if (action === 'assign from roster') {
            await library.panel.configureScript('Picked fixture', null, false);
        }
        await finish();

        library.expectSelected(selected);
        expect(backdrop.style.display).toBe(action === 'wait' ? 'none' : 'flex');
        expect(Array.from(backdrop.querySelectorAll('.rs2b0t-card-name'), el => el.textContent)).toContain('Imported fixture ⇪');
    } finally {
        backdrop.click();
        library.restore();
        for (const name of ['Imported fixture', 'Picked fixture', 'Previous fixture']) ScriptRegistry.unregister(name);
    }
});

test.each(['older', 'newer'])('latest import stays selected when the %s import finishes first', async first => {
    ScriptRegistry.register({ name: 'Previous fixture', description: '', create: () => { throw new Error('unused'); } });
    const library = openLibrary();
    try {
        await library.panel.configureScript('Previous fixture', null, false);
        const finishOlder = library.startImport('Older fixture');
        const finishNewer = library.startImport('Newer fixture');
        if (first === 'older') {
            await finishOlder();
            library.expectSelected('Previous fixture');
            expect(library.backdrop.style.display).toBe('flex');
            await finishNewer();
        } else {
            await finishNewer();
            expect(library.backdrop.style.display).toBe('none');
            library.browse.click();
            await finishOlder();
        }
        library.expectSelected('Newer fixture');
        expect(library.backdrop.style.display).toBe(first === 'older' ? 'none' : 'flex');
        library.browse.click();
        const names = Array.from(library.backdrop.querySelectorAll('.rs2b0t-card-name'), el => el.textContent);
        expect(names).toContain('Older fixture ⇪');
        expect(names).toContain('Newer fixture ⇪');
    } finally {
        library.backdrop.click();
        library.restore();
        for (const name of ['Older fixture', 'Newer fixture', 'Previous fixture']) ScriptRegistry.unregister(name);
    }
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


test.each(['local', 'session'])('restores a NatureCrafter selection from %s storage as JiveRC', async layer => {
    const previous = ScriptRegistry.get('JiveRC');
    class SelectedBot extends LoopingBot { override loop(): void {} }
    ScriptRegistry.register({ name: 'Legacy selection fallback', description: 'test fixture', create: () => new SelectedBot() });
    ScriptRegistry.register({ name: 'JiveRC', description: 'test fixture', create: () => new SelectedBot() });
    localStorage.clear();
    sessionStorage.clear();
    const storage = layer === 'local' ? localStorage : sessionStorage;
    storage.setItem('rs2b0t:selectedScript', 'NatureCrafter');
    const root = document.createElement('div');
    const host = { selfTestMissing: [], addDrawListener: () => {} } as unknown as BotHostImpl;
    try {
        const panel = new BotPanel(root, host);
        expect(root.querySelector('.rs2b0t-current-script')?.textContent).toBe('JiveRC');
        panel.startSelectedScript();
        await Promise.resolve();
        expect(ScriptRunner.meta?.name).toBe('JiveRC');
    } finally {
        ScriptRunner.stop('test teardown');
        ScriptRegistry.unregister('JiveRC');
        ScriptRegistry.unregister('Legacy selection fallback');
        if (previous) ScriptRegistry.register(previous);
    }
});
