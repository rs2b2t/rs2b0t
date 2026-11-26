import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import BotPanel, { type PanelRunner } from '#/bot/panel/BotPanel.js';
import { RosterActions, type RosterProfile } from '#/bot/multibox/RosterActions.js';
import { createRosterClient } from '#/bot/panel/RosterClient.js';
import { BotHost } from '#/bot/runtime/BotHost.js';
import { ScriptContext } from '#/bot/runtime/ScriptContext.js';
import { ScriptRegistry, type ScriptMeta } from '#/bot/runtime/ScriptRegistry.js';
import { SettingsStore } from '#/bot/runtime/Settings.js';
import { TARGET } from '#/client/config/target.js';
import { attach, detach } from '#/bot/adapter/ClientAdapter.js';

const previousTarget = { ...TARGET };

class Runner implements PanelRunner {
    state = 'idle';
    ctx: ScriptContext | null = null;
    meta: ScriptMeta | null = null;
    starts: string[] = [];
    stops = 0;
    private listeners = new Set<() => void>();
    start(meta: ScriptMeta): void { this.starts.push(meta.name); this.meta = meta; this.setState('running'); }
    stop(): void { this.stops++; if (['running', 'paused'].includes(this.state)) this.setState('stopping'); }
    pause(): void { this.setState('paused'); }
    resume(): void { this.setState('running'); }
    onChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    setState(state: string): void { this.state = state; for (const listener of this.listeners) listener(); }
}

const names = ['RosterDemo', 'RosterOther', 'WalkTo', 'JiveRC'];
let previousMetas: Array<ScriptMeta | undefined>;
let runner: Runner;
let panel: BotPanel;
let root: HTMLDivElement;
let client: ReturnType<typeof createRosterClient>;

beforeEach(() => {
    Reflect.get(window, 'happyDOM').setURL('http://localhost:8081/bot.html');
    TARGET.wsHost = 'localhost:8081';
    attach({ ingame: true });
    document.body.replaceChildren();
    sessionStorage.clear();
    localStorage.clear();
    localStorage.setItem('rs2b0t:selectedScript', 'RosterDemo');
    previousMetas = names.map(name => ScriptRegistry.get(name));
    for (const name of names) ScriptRegistry.register({
        name, description: '', create: () => { throw new Error('runner boundary'); },
        settingsSchema: name === 'WalkTo' ? {
            destination: { type: 'string', default: 'Lumbridge' },
            customTile: { type: 'tile', default: { x: 0, z: 0, level: 0 } }
        } : {
            leash: { type: 'number', default: 8, min: 0, max: 30 },
            mode: { type: 'string', default: 'Auto', options: ['Auto', 'None'] }
        }
    });
    root = document.createElement('div');
    document.body.append(root);
    runner = new Runner();
    panel = new BotPanel(root, BotHost, undefined, runner);
    client = createRosterClient(panel);
});

afterEach(() => {
    detach();
    Object.assign(TARGET, previousTarget);
    for (const name of names) ScriptRegistry.unregister(name);
    for (const meta of previousMetas) if (meta) ScriptRegistry.register(meta);
    localStorage.clear();
    sessionStorage.clear();
});

test('assign changes the actual panel selection and persisted selection', () => {
    client.assignScript('RosterOther');
    expect(client.selectedScript()).toBe('RosterOther');
    expect(root.querySelector('.rs2b0t-current-script')?.textContent).toBe('RosterOther');
    client.startScript();
    expect(runner.starts).toEqual(['RosterOther']);
    expect(localStorage.getItem('rs2b0t:selectedScript')).toBe('RosterOther');
});

test('a full script log appends one row and keeps the other 199 through history rollover', () => {
    const ctx = runner.ctx = new ScriptContext();
    const box = root.querySelector<HTMLElement>('.rs2b0t-log')!;
    const levels = ['info', 'warn', 'error'] as const;
    const start = new Date(2020, 0, 1, 12).getTime();
    const clock = spyOn(Date, 'now');
    const add = (i: number) => {
        clock.mockReturnValue(start + i * 1000);
        ctx.addLog(levels[i % 3], `message ${i}`);
    };
    try {
        for (let i = 0; i < 499; i++) add(i);
        client.startScript();
        for (const i of [499, 500, 501]) {
            const before = Array.from(box.children);
            const append = spyOn(box, 'appendChild');
            try {
                add(i);
                expect(append).toHaveBeenCalledTimes(1);
            } finally {
                append.mockRestore();
            }
            expect(box.childElementCount).toBe(200);
            expect(before[0].parentNode).toBeNull();
            expect(before.slice(1).every((row, index) => row === box.children[index])).toBe(true);
        }
        for (const [index, row] of Array.from(box.children).entries()) {
            const i = 302 + index;
            const time = new Date(start + i * 1000).toTimeString().slice(0, 8);
            expect(row.textContent).toBe(`${time} message ${i}`);
            expect(row.className).toBe(`rs2b0t-log-line rs2b0t-log-${levels[i % 3]}`);
        }
    } finally {
        clock.mockRestore();
    }
});

test('state changes retain log rows until the runner switches contexts', () => {
    const previous = runner.ctx = new ScriptContext();
    previous.addLog('info', 'first run');
    client.startScript();
    const box = root.querySelector<HTMLElement>('.rs2b0t-log')!;
    const row = box.firstElementChild;
    runner.pause();
    expect(box.firstElementChild).toBe(row);
    runner.ctx = new ScriptContext();
    runner.ctx.addLog('warn', 'new run');
    runner.setState('running');
    previous.addLog('info', 'late message');
    runner.ctx.addLog('info', 'next message');
    expect(Array.from(box.children, row => row.textContent?.slice(9))).toEqual(['new run', 'next message']);
});

test('script logs follow the bottom and compensate for a wrapped row evicted above the reader', () => {
    const ctx = runner.ctx = new ScriptContext();
    for (let i = 0; i < 200; i++) ctx.addLog('info', `line ${i}`);
    client.startScript();
    const box = root.querySelector<HTMLElement>('.rs2b0t-log')!;
    Object.defineProperties(box, {
        clientHeight: { value: 150 },
        scrollHeight: { get: () => box.lastElementChild?.textContent?.includes('wrapped') ? 2020 : 2000 }
    });
    box.scrollTop = 1850;
    ctx.addLog('info', 'wrapped\nmessage');
    expect(box.scrollTop).toBeGreaterThanOrEqual(1870);
    box.scrollTop = 100;
    spyOn(box.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 32.5));
    ctx.addLog('info', 'another message');
    expect(box.scrollTop).toBe(67.5);
});

test('repeated fractional row evictions keep the reader in place on a whole-pixel scroller', () => {
    const ctx = runner.ctx = new ScriptContext();
    for (let i = 0; i < 200; i++) ctx.addLog('info', `line ${i}`);
    client.startScript();
    const box = root.querySelector<HTMLElement>('.rs2b0t-log')!;
    const rowHeight = 16.5;
    const rect = new DOMRect(0, 0, 300, rowHeight);
    for (const row of Array.from(box.children)) spyOn(row, 'getBoundingClientRect').mockReturnValue(rect);
    let top = 2000;
    Object.defineProperties(box, {
        clientHeight: { value: 150 },
        scrollHeight: { get: () => box.childElementCount * rowHeight },
        scrollTop: { get: () => top, set: (value: number) => { top = Math.round(value); } }
    });
    const anchor = box.children[123];
    const anchorOffset = () => Array.from(box.children).indexOf(anchor) * rowHeight - box.scrollTop;
    expect(anchorOffset()).toBe(29.5);
    for (let i = 0; i < 80; i++) ctx.addLog('info', `next ${i}`);
    expect(anchorOffset()).toBe(29.5);

    ctx.addLog('info', 'one more eviction');
    box.scrollTop = 550;
    ctx.addLog('info', 'after scrolling');
    expect(box.scrollTop).toBe(534);
});

test('copy replaces one namespace including stale parameters and refreshes its panel', () => {
    SettingsStore.save('RosterDemo', 'leash', '15');
    SettingsStore.save('RosterDemo', 'stale', 'old');
    SettingsStore.save('RosterOther', 'leash', '19');
    SettingsStore.save('Global', 'lampSkill', 'mining');
    client.copySettings('RosterDemo', { mode: 'None' });
    expect(SettingsStore.saved('RosterDemo', 'leash')).toBeUndefined();
    expect(SettingsStore.saved('RosterDemo', 'stale')).toBeUndefined();
    expect(SettingsStore.saved('RosterDemo', 'mode')).toBe('None');
    expect(SettingsStore.saved('RosterOther', 'leash')).toBe('19');
    expect(SettingsStore.saved('Global', 'lampSkill')).toBe('mining');
    expect(client.selectedScript()).toBe('RosterDemo');
    expect(root.querySelector('.rs2b0t-param-summary')?.textContent).toContain('None');
});

test('read returns effective registered parameters and copied values remain independent', () => {
    SettingsStore.save('RosterDemo', 'leash', '12');
    SettingsStore.save('Global', 'lampSkill', 'mining');
    SettingsStore.save('RosterDemo', 'stale', 'old');
    const values = client.readSettings('RosterDemo');
    expect(values).toEqual({ leash: '12', mode: 'Auto' });
    client.copySettings('RosterOther', values);
    expect(client.selectedScript()).toBe('RosterDemo');
    SettingsStore.save('RosterOther', 'leash', '21');
    expect(client.readSettings('RosterDemo')).toEqual({ leash: '12', mode: 'Auto' });
    expect(values).toEqual({ leash: '12', mode: 'Auto' });
    expect(client.scripts()).toEqual(expect.arrayContaining(names));
});

test.each(['loaded', 'unloaded'])('%s target keeps both stores when the second copied setting exceeds quota', async target => {
    Reflect.get(window, 'happyDOM').setURL('http://localhost:8081/bot.html?box=loaded');
    const profiles: RosterProfile[] = [target, 'source', 'good'].map(username => ({ username, tab: 'Main', world: 1 }));
    if (target === 'loaded') profiles[0].slot = {
        id: 1, username: target, tab: 'Main', focused: true, mode: 'focused', targetWorld: 1, switchingWorld: null,
        ready: true, ingame: false, world: 1, player: '', loopCycle: 0, drawn: 0, scriptState: 'idle', scriptName: 'RosterDemo'
    };
    const actions = new RosterActions({ profiles: () => profiles, client: profile => profile.slot ? client : null, setWorld: async () => true });
    const prefix = `rs2b0t:${target}:set:RosterDemo:`;
    for (const store of [localStorage, sessionStorage]) {
        store.setItem('rs2b0t:source:set:RosterDemo:leash', '12');
        store.setItem('rs2b0t:source:set:RosterDemo:mode', 'None');
        store.setItem('rs2b0t:good:set:RosterDemo:leash', '8');
        store.setItem('rs2b0t:good:set:RosterDemo:mode', 'Auto');
        store.setItem(prefix + 'leash', store === localStorage ? '17' : '19');
    }
    const limited = target === 'loaded' ? localStorage : sessionStorage;
    const other = limited === localStorage ? sessionStorage : localStorage;
    other.setItem(prefix + 'obsolete', '');
    limited.setItem('padding', '1');
    const capacity = limited.length;
    const setItem = limited.setItem;
    Object.defineProperty(limited, 'setItem', { configurable: true, value(key: string, value: string) {
        if (limited.getItem(key) === null && limited.length >= capacity) throw new DOMException(key, 'QuotaExceededError');
        setItem.call(limited, key, value);
    } });
    const command = { kind: 'copy', script: 'RosterDemo', source: 'source' } as const;
    const changes: string[] = [];
    const unsubscribe = SettingsStore.onChange((_name, key) => changes.push(key));
    try {
        const [good, failed] = await actions.run(['good', target], command);
        expect(good.state).toBe('done');
        expect(failed).toMatchObject({ state: 'failed', message: prefix + 'mode' });
        expect(changes).toEqual([]);
        for (const store of [localStorage, sessionStorage]) {
            expect(store.getItem(prefix + 'leash')).toBe(store === localStorage ? '17' : '19');
            expect(store.getItem(prefix + 'mode')).toBeNull();
            expect(store.getItem(prefix + 'obsolete')).toBe(store === other ? '' : null);
            expect(store.getItem('rs2b0t:good:set:RosterDemo:leash')).toBe('12');
            expect(store.getItem('rs2b0t:good:set:RosterDemo:mode')).toBe('None');
        }
        limited.removeItem('padding');
        expect((await actions.run([target], command))[0].state).toBe('done');
        expect(changes).toEqual(target === 'loaded' ? ['leash', 'mode'] : []);
        for (const store of [localStorage, sessionStorage]) {
            expect(store.getItem(prefix + 'leash')).toBe('12');
            expect(store.getItem(prefix + 'mode')).toBe('None');
            expect(store.getItem(prefix + 'obsolete')).toBeNull();
        }
    } finally {
        unsubscribe();
        Object.defineProperty(limited, 'setItem', { value: setItem });
        Reflect.get(window, 'happyDOM').setURL('http://localhost:8081/bot.html');
    }
});

for (const state of ['running', 'paused', 'stopping']) test(`${state} blocks assignments, copies, editing and starts at the panel boundary`, () => {
    runner.setState(state);
    expect(() => client.assignScript('RosterOther')).toThrow();
    expect(() => client.copySettings('RosterDemo', { leash: '12' })).toThrow();
    expect(() => client.startScript()).toThrow();
    expect(() => panel.editScriptSettings()).toThrow();
    expect(() => panel.assignScript('RosterOther')).toThrow();
    expect(SettingsStore.saved('RosterDemo', 'leash')).toBeUndefined();
    expect(client.selectedScript()).toBe('RosterDemo');
    expect(runner.starts).toEqual([]);
});

test('world switching blocks all script writes, edits, starts and travel', async () => {
    panel.setWorldSwitchPending(true);
    expect(() => client.assignScript('RosterOther')).toThrow();
    expect(() => client.copySettings('RosterDemo', { mode: 'None' })).toThrow();
    expect(() => client.startScript()).toThrow();
    expect(() => panel.editScriptSettings()).toThrow();
    await expect(client.travelTo('Varrock')).rejects.toThrow();
    expect(runner.stops).toBe(0);
    expect(SettingsStore.saved('WalkTo', 'destination')).toBeUndefined();
});

test('invalid scripts and destinations reject without stopping or writing', async () => {
    expect(() => client.assignScript('missing')).toThrow();
    expect(() => client.copySettings('missing', {})).toThrow();
    expect(() => client.readSettings('missing')).toThrow();
    runner.setState('running');
    await expect(client.travelTo('Nowhere')).rejects.toThrow();
    ScriptRegistry.unregister('WalkTo');
    await expect(client.travelTo('Varrock')).rejects.toThrow();
    expect(runner.stops).toBe(0);
    expect(SettingsStore.saved('WalkTo', 'destination')).toBeUndefined();
});

test('URL overrides reject copies and travel before clearing settings or stopping', async () => {
    SettingsStore.save('RosterDemo', 'leash', '17');
    const override = spyOn(SettingsStore, 'isUrlOverride').mockImplementation((name, key) =>
        (name === 'RosterDemo' && key === 'mode') || (name === 'WalkTo' && key === 'customTile'));
    try {
        expect(() => client.copySettings('RosterDemo', { leash: '12' })).toThrow();
        runner.setState('running');
        await expect(client.travelTo('Varrock')).rejects.toThrow();
        expect(SettingsStore.saved('RosterDemo', 'leash')).toBe('17');
        expect(SettingsStore.saved('WalkTo', 'destination')).toBeUndefined();
        expect(runner.stops).toBe(0);
    } finally {
        override.mockRestore();
    }
});

test('travel waits for stop before saving destination and starting WalkTo', async () => {
    runner.setState('paused');
    const travel = client.travelTo(' varrock ');
    expect(runner.stops).toBe(1);
    expect(runner.state).toBe('stopping');
    expect(SettingsStore.saved('WalkTo', 'destination')).toBeUndefined();
    expect(runner.starts).toEqual([]);
    await expect(client.travelTo('Falador')).rejects.toThrow();
    expect(() => client.assignScript('RosterOther')).toThrow();
    expect(() => client.copySettings('RosterDemo', {})).toThrow();
    expect(() => client.startScript()).toThrow();
    panel.startSelectedScript();
    expect(runner.starts).toEqual([]);
    runner.setState('stopped');
    await travel;
    expect(SettingsStore.saved('WalkTo', 'destination')).toBe('Varrock');
    expect(SettingsStore.saved('WalkTo', 'customTile')).toBe('0,0,0');
    expect(client.selectedScript()).toBe('WalkTo');
    expect(runner.starts).toEqual(['WalkTo']);
});

test('travel times out after ten seconds without changing settings or selection', async () => {
    runner.setState('stopping');
    const now = spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(10_001);
    try {
        await expect(client.travelTo('Varrock')).rejects.toThrow(/timed out/i);
        expect(SettingsStore.saved('WalkTo', 'destination')).toBeUndefined();
        expect(client.selectedScript()).toBe('RosterDemo');
        expect(runner.starts).toEqual([]);
    } finally {
        now.mockRestore();
    }
    runner.setState('stopped');
    client.assignScript('RosterOther');
    expect(client.selectedScript()).toBe('RosterOther');
});

test('a world switch during stop cancels pending travel', async () => {
    runner.setState('running');
    const travel = client.travelTo('Varrock');
    panel.setWorldSwitchPending(true);
    runner.setState('stopped');
    await expect(travel).rejects.toThrow();
    expect(SettingsStore.saved('WalkTo', 'destination')).toBeUndefined();
    expect(runner.starts).toEqual([]);
});

test('edit opens the existing parameter modal for the selected script', async () => {
    client.assignScript('RosterOther');
    await client.editSettings();
    expect(document.querySelector('.rs2b0t-params-body')?.closest('.rs2b0t-modal-backdrop')?.getAttribute('style')).toContain('display: flex');
    const range = document.querySelector<HTMLInputElement>('.rs2b0t-param-range')!;
    range.value = '14';
    range.dispatchEvent(new Event('input'));
    expect(SettingsStore.saved('RosterOther', 'leash')).toBe('14');
    expect(SettingsStore.saved('RosterDemo', 'leash')).toBeUndefined();
});

test('logged-out travel rejects before stopping or changing settings', async () => {
    attach({ ingame: false });
    runner.setState('running');
    await expect(client.travelTo('Varrock')).rejects.toThrow();
    expect(runner.stops).toBe(0);
    expect(SettingsStore.saved('WalkTo', 'destination')).toBeUndefined();
});

test('logging out while stopping cancels travel without writing settings', async () => {
    runner.setState('running');
    const travel = client.travelTo('Varrock');
    attach({ ingame: false });
    runner.setState('stopped');
    await expect(travel).rejects.toThrow();
    expect(SettingsStore.saved('WalkTo', 'destination')).toBeUndefined();
    expect(runner.starts).toEqual([]);
});

test('an external restart during stopping prevents travel from replacing its settings', async () => {
    runner.setState('running');
    const travel = client.travelTo('Varrock');
    runner.setState('running');
    await expect(travel).rejects.toThrow();
    expect(SettingsStore.saved('WalkTo', 'destination')).toBeUndefined();
    expect(client.selectedScript()).toBe('RosterDemo');
});

test('an explicit stop cancels the pending travel restart', async () => {
    runner.setState('running');
    const travel = client.travelTo('Varrock');
    client.stopScript();
    runner.setState('stopped');
    await expect(travel).rejects.toThrow();
    expect(SettingsStore.saved('WalkTo', 'destination')).toBeUndefined();
    expect(runner.starts).toEqual([]);
});

test('cancelling a world switch does not revive an earlier travel request', async () => {
    runner.setState('running');
    const travel = client.travelTo('Varrock');
    panel.setWorldSwitchPending(true);
    panel.setWorldSwitchPending(false);
    runner.setState('stopped');
    await expect(travel).rejects.toThrow();
    expect(SettingsStore.saved('WalkTo', 'destination')).toBeUndefined();
    expect(runner.starts).toEqual([]);
});

test('starting closes the parameter modal before its controls can write active script settings', async () => {
    await client.editSettings();
    const backdrop = document.querySelector('.rs2b0t-params-body')!.closest<HTMLElement>('.rs2b0t-modal-backdrop')!;
    expect(backdrop.style.display).toBe('flex');
    client.startScript();
    expect(backdrop.style.display).toBe('none');
    expect(SettingsStore.saved('RosterDemo', 'leash')).toBeUndefined();
});

for (const reserved of ['Global', 'MapPicker', 'Loadouts', 'PriceBooks']) test(`client excludes reserved ${reserved} from script operations`, () => {
    const previous = ScriptRegistry.get(reserved);
    ScriptRegistry.register({ name: reserved, description: '', settingsSchema: { leash: { type: 'number', default: 8 } }, create: () => { throw new Error('runner boundary'); } });
    SettingsStore.save(reserved, 'leash', '15');
    try {
        expect(client.scripts()).not.toContain(reserved);
        expect(() => client.readSettings(reserved)).toThrow();
        expect(() => client.assignScript(reserved)).toThrow();
        expect(() => client.copySettings(reserved, { leash: '20' })).toThrow();
        expect(SettingsStore.saved(reserved, 'leash')).toBe('15');
        expect(client.selectedScript()).toBe('RosterDemo');
    } finally {
        ScriptRegistry.unregister(reserved);
        if (previous) ScriptRegistry.register(previous);
    }
});


test('legacy roster reads and assignment resolve to the canonical JiveRC registration', () => {
    SettingsStore.save('NatureCrafter', 'leash', '12');
    SettingsStore.save('JiveRC', 'leash', '21');
    client.assignScript('NatureCrafter');
    expect(client.selectedScript()).toBe('JiveRC');
    expect(localStorage.getItem('rs2b0t:selectedScript')).toBe('JiveRC');
    expect(client.readSettings('NatureCrafter')).toEqual({ leash: '21', mode: 'Auto' });
});

test.each(['JiveRC', 'NatureCrafter'])('live %s default copies clear legacy settings including removed parameters', name => {
    SettingsStore.save('NatureCrafter', 'leash', '12');
    SettingsStore.save('NatureCrafter', 'obsolete', 'old');
    SettingsStore.save('JiveRC', 'mode', 'None');
    SettingsStore.save('RosterOther', 'leash', '19');
    SettingsStore.save('Global', 'lampSkill', 'mining');
    client.copySettings(name, {});
    expect(client.readSettings('JiveRC')).toEqual({ leash: '8', mode: 'Auto' });
    expect(SettingsStore.saved('JiveRC', 'obsolete')).toBeUndefined();
    expect(SettingsStore.saved('NatureCrafter', 'leash')).toBeUndefined();
    expect(SettingsStore.saved('RosterOther', 'leash')).toBe('19');
    expect(SettingsStore.saved('Global', 'lampSkill')).toBe('mining');
});

for (const state of ['running', 'paused', 'stopping']) test(`configuration waits for ${state} to finish before copying and starting`, async () => {
    runner.setState(state);
    const changing = client.configureScript('RosterOther', { leash: '12' }, true);
    expect(runner.state).toBe('stopping');
    expect(client.selectedScript()).toBe('RosterDemo');
    expect(SettingsStore.saved('RosterOther', 'leash')).toBeUndefined();
    expect(runner.starts).toEqual([]);
    runner.setState('stopped');
    await changing;
    expect(client.selectedScript()).toBe('RosterOther');
    expect(SettingsStore.saved('RosterOther', 'leash')).toBe('12');
    expect(runner.starts).toEqual(['RosterOther']);
});

test('configuration validates before stopping and an explicit stop cancels its restart', async () => {
    runner.setState('running');
    await expect(client.configureScript('missing', null, true)).rejects.toThrow();
    await expect(client.configureScript('RosterOther', { missing: '12' }, true)).rejects.toThrow();
    expect(runner.stops).toBe(0);
    const changing = client.configureScript('RosterOther', { leash: '12' }, true);
    client.stopScript();
    runner.setState('stopped');
    await expect(changing).rejects.toThrow(/cancelled/i);
    expect(SettingsStore.saved('RosterOther', 'leash')).toBeUndefined();
    expect(runner.starts).toEqual([]);
});

test('copy without start stops the runner but preserves the selected script', async () => {
    runner.setState('running');
    const changing = client.configureScript('RosterOther', { leash: '12' }, false);
    runner.setState('stopped');
    await changing;
    expect(client.selectedScript()).toBe('RosterDemo');
    expect(SettingsStore.saved('RosterOther', 'leash')).toBe('12');
    expect(runner.starts).toEqual([]);
});

test('editing stops first and starts with the edited values from the parameter modal', async () => {
    runner.setState('running');
    const editing = client.editSettings();
    expect(document.querySelector('.rs2b0t-params-body')?.closest<HTMLElement>('.rs2b0t-modal-backdrop')?.style.display).not.toBe('flex');
    runner.setState('stopped');
    await editing;
    const range = document.querySelector<HTMLInputElement>('.rs2b0t-param-range')!;
    range.value = '14';
    range.dispatchEvent(new Event('input'));
    const start = document.querySelector<HTMLButtonElement>('[data-action="start-script"]')!;
    expect(start).not.toBeNull();
    start.click();
    start.click();
    expect(SettingsStore.saved('RosterDemo', 'leash')).toBe('14');
    expect(runner.starts).toEqual(['RosterDemo']);
    expect(document.querySelector('.rs2b0t-params-body')?.closest<HTMLElement>('.rs2b0t-modal-backdrop')?.style.display).toBe('none');
});


test('removing a client while stopping cancels its eventual settings write and restart', async () => {
    let profiles: RosterProfile[] = [{ username: 'alice', tab: 'Main', world: 1, slot: {
        id: 1, username: 'alice', tab: 'Main', focused: true, mode: 'focused', targetWorld: 1, switchingWorld: null,
        ready: true, ingame: true, world: 1, player: 'alice', loopCycle: 0, drawn: 0, scriptState: 'running', scriptName: 'RosterDemo'
    } }];
    const actions = new RosterActions({ profiles: () => profiles, client: () => client, setWorld: async () => true });
    runner.setState('running');
    const changing = actions.run(['alice'], { kind: 'assign', script: 'RosterOther', start: true });
    profiles = [];
    const result = await changing;
    expect(result[0].state).toBe('failed');
    runner.setState('stopped');
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(client.selectedScript()).toBe('RosterDemo');
    expect(runner.starts).toEqual([]);
});

test('configuration times out without writing or starting and later changes still work', async () => {
    runner.setState('stopping');
    const now = spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(10_001);
    try {
        await expect(client.configureScript('RosterOther', { leash: '12' }, true)).rejects.toThrow(/timed out/i);
    } finally {
        now.mockRestore();
    }
    runner.setState('stopped');
    expect(SettingsStore.saved('RosterOther', 'leash')).toBeUndefined();
    expect(runner.starts).toEqual([]);
    await client.configureScript('RosterOther', null, false);
    expect(client.selectedScript()).toBe('RosterOther');
});
