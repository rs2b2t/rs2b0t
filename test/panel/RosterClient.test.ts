import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import BotPanel, { type PanelRunner } from '#/bot/panel/BotPanel.js';
import { RosterActions, type RosterProfile } from '#/bot/multibox/RosterActions.js';
import { createRosterClient } from '#/bot/panel/RosterClient.js';
import { BotHost } from '#/bot/runtime/BotHost.js';
import { ScriptRegistry, type ScriptMeta } from '#/bot/runtime/ScriptRegistry.js';
import { SettingsStore } from '#/bot/runtime/Settings.js';
import { TARGET } from '#/client/config/target.js';
import { attach, detach } from '#/bot/adapter/ClientAdapter.js';

const previousTarget = { ...TARGET };

class Runner implements PanelRunner {
    state = 'idle';
    ctx = null;
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
