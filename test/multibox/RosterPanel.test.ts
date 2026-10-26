import { afterEach, expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { RosterActions, type RosterProfile } from '#/bot/multibox/RosterActions.js';
import { RosterPanel } from '#/bot/multibox/RosterPanel.js';
import type { RosterClient } from '#/bot/multibox/RosterTypes.js';
import type { SlotSnapshot } from '#/bot/multibox/types.js';
import { readScriptSettings, replaceScriptSettings, writeProfileScript } from '#/bot/multibox/RosterStorage.js';

function slot(username: string, state = 'stopped'): SlotSnapshot {
    return { username, id: 1, ready: true, ingame: true, world: 1, player: username, loopCycle: 0, drawn: 0, scriptState: state, scriptName: 'Miner', focused: false, mode: 'focused', tab: 'Main', targetWorld: 1, switchingWorld: null };
}

function fixture(worldRouting = true, edit: (profile: RosterProfile) => void = () => {}) {
    const profiles: RosterProfile[] = [
        { username: 'alice', tab: 'Miners', world: 1, slot: slot('alice', 'running') },
        { username: 'bob', tab: 'Miners', world: 2 },
        { username: '<img src=x onerror=alert(1)>', tab: 'Main', world: 1 }
    ];
    replaceScriptSettings('alice', 'Miner', { Ore: '<b>Iron</b>', Location: 'Varrock' });
    writeProfileScript('bob', 'Fisher');
    const client: RosterClient = {
        scripts: () => ['Miner', 'Fisher'], selectedScript: () => 'Miner', readSettings: () => readScriptSettings('alice', 'Miner'),
        assignScript: () => {}, copySettings: () => {}, startScript: () => {}, stopScript: () => {}, travelTo: async () => {}, editSettings: () => {}
    };
    const actions = new RosterActions({ profiles: () => profiles, client: p => p.slot ? client : null, setWorld: async () => true });
    const panel = new RosterPanel(actions, { tabs: () => ['Main', 'Miners'], activeTab: () => 'Miners', worldRouting, edit });
    document.body.append(panel.el);
    panel.open();
    return { panel, actions, profiles };
}

function get<T extends HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    return element;
}
function change(selector: string, value: string): void {
    const input = get<HTMLInputElement | HTMLSelectElement>(selector);
    input.value = value;
    input.dispatchEvent(new Event(input instanceof HTMLInputElement ? 'input' : 'change', { bubbles: true }));
}
function select(username: string): void {
    const row = Array.from(document.querySelectorAll<HTMLElement>('[data-profile]')).find(row => row.dataset.profile === username);
    row?.querySelector<HTMLInputElement>('input')?.click();
}
const settle = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)); };

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); sessionStorage.clear(); });

test('tab and search filters clear selected targets without changing wall scope', () => {
    const { panel } = fixture();
    expect(document.querySelectorAll('[data-profile]')).toHaveLength(2);
    select('bob');
    expect(get('#mbx-roster-count').textContent).toContain('1 selected');
    get('[data-scope="all"]').click();
    expect(document.querySelectorAll('[data-profile]')).toHaveLength(3);
    expect(get('#mbx-roster-count').textContent).toContain('0 selected');
    select('bob');
    change('#mbx-roster-search', 'alice');
    expect(document.querySelectorAll('[data-profile]')).toHaveLength(1);
    expect(get('#mbx-roster-count').textContent).toContain('0 selected');
    panel.close(); panel.open();
    expect(get<HTMLInputElement>('#mbx-roster-search').value).toBe('alice');
});

test('copy uses the chosen source/script and preserves the target selected script', async () => {
    const { panel, profiles } = fixture();
    profiles.push({ username: 'carol', tab: 'Main', world: 1 });
    replaceScriptSettings('carol', 'Miner', { Ore: 'Coal' });
    panel.refresh();
    select('bob');
    get('[data-action="copy"]').click();
    change('#mbx-roster-script', 'Miner');
    change('#mbx-roster-source', 'alice');
    expect(get('#mbx-roster-preview').textContent).toContain('<b>Iron</b>');
    expect(get('#mbx-roster-preview').querySelector('b')).toBeNull();
    change('#mbx-roster-source', 'carol');
    get('#mbx-roster-apply').click();
    await settle();
    expect(readScriptSettings('bob', 'Miner')).toEqual({ Ore: 'Coal' });
    expect(sessionStorage.getItem('rs2b0t:bob:selectedScript')).toBe('Fisher');
    expect(get('[data-profile="bob"]').textContent).toContain('Copied Miner settings.');
});

test('refresh preserves input identity, focus, selection, and reports live running status', () => {
    const { panel, profiles } = fixture();
    select('bob');
    const search = get<HTMLInputElement>('#mbx-roster-search');
    search.focus();
    profiles[0].slot!.scriptState = 'paused';
    panel.refresh();
    expect(document.activeElement).toBe(search);
    expect(get('#mbx-roster-search')).toBe(search);
    expect(get('[data-profile="alice"]').textContent).toContain('Paused');
    panel.close(); panel.open();
    expect(get<HTMLInputElement>('[data-profile="bob"] input').checked).toBe(true);
});

test('busy actions disable mutation controls and retain each result on refresh', async () => {
    const { panel, actions, profiles } = fixture();
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const client: RosterClient = { scripts: () => ['Miner'], selectedScript: () => 'Miner', readSettings: () => ({}), assignScript: () => {}, copySettings: () => {}, startScript: () => {}, stopScript: () => {}, travelTo: () => waiting, editSettings: () => {} };
    const running = new RosterActions({ profiles: () => profiles, client: () => client, setWorld: async () => true });
    panel.close(); panel.el.remove();
    const busyPanel = new RosterPanel(running, { tabs: () => ['Main', 'Miners'], activeTab: () => 'Miners', worldRouting: true, edit: () => {} });
    document.body.append(busyPanel.el); busyPanel.open();
    select('alice'); get('[data-action="travel"]').click();
    get('#mbx-roster-apply').focus();
    get('#mbx-roster-apply').click();
    expect(document.activeElement === get('#mbx-roster-close')).toBe(true);
    expect(get<HTMLButtonElement>('#mbx-roster-apply').disabled).toBe(true);
    expect(get<HTMLInputElement>('[data-profile="alice"] input').disabled).toBe(true);
    expect(get<HTMLSelectElement>('#mbx-roster-destination').disabled).toBe(true);
    finish(); await settle(); busyPanel.refresh();
    expect(get('[data-profile="alice"]').textContent).toContain('WalkTo started: Lumbridge.');
    expect(actions.busy).toBe(false);
});

test('close, done, escape, and backdrop restore opener focus', () => {
    const { panel } = fixture();
    const opener = document.createElement('button'); document.body.append(opener);
    for (const dismiss of [
        () => get('#mbx-roster-close').click(),
        () => get('#mbx-roster-done').click(),
        () => panel.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
        () => panel.el.click()
    ]) {
        panel.open(opener); dismiss();
        expect(panel.el.hidden).toBe(true);
        expect(document.activeElement === opener).toBe(true);
    }
});

test('focus stays in the modal and names are rendered as text', () => {
    fixture(); get('[data-scope="all"]').click();
    expect(get('#mbx-roster-table').textContent).toContain('<img src=x onerror=alert(1)>');
    expect(get('#mbx-roster-table').querySelector('img')).toBeNull();
    const done = get('#mbx-roster-done'); done.focus();
    done.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement === get('#mbx-roster-close')).toBe(true);
});

test('local engine omits world action and unavailable scripts explain how to populate the list', () => {
    const { actions, panel, profiles } = fixture(false);
    expect(document.querySelector('[data-action="world"]')).toBeNull();
    profiles.splice(0); localStorage.clear(); sessionStorage.clear(); panel.refresh();
    expect(actions.scripts()).toEqual([]);
    expect(get('#mbx-roster-script-hint').textContent).toContain('Load a bot');
    expect(get<HTMLButtonElement>('#mbx-roster-apply').disabled).toBe(true);
});

test('edit rejects unloaded and active profiles and reports callback failures visibly', async () => {
    let edited = '';
    const { profiles, panel } = fixture(true, profile => { edited = profile.username; throw new Error('Editor unavailable'); });
    get('[data-profile="bob"] [data-edit]').click();
    expect(panel.el.hidden).toBe(false);
    expect(get('[data-profile="bob"]').textContent).toContain('Load');
    get('[data-profile="alice"] [data-edit]').click();
    expect(edited).toBe('');
    profiles[0].slot!.scriptState = 'stopped'; panel.refresh();
    get('[data-profile="alice"] [data-edit]').click(); await settle();
    expect(edited).toBe('alice');
    expect(panel.el.hidden).toBe(false);
    expect(get('#mbx-roster-message').textContent).toContain('Editor unavailable');
});

test('first open reads the hydrated wall tab and later opens preserve the chosen scope', () => {
    const { panel, actions } = fixture();
    panel.close(); panel.el.remove();
    let active = 'Main';
    const restored = new RosterPanel(actions, { tabs: () => ['Main', 'Miners'], activeTab: () => active, worldRouting: true, edit: () => {} });
    document.body.append(restored.el);
    active = 'Miners';
    restored.open();
    expect(document.querySelectorAll('[data-profile]')).toHaveLength(2);
    expect(document.querySelector('[data-profile="alice"]')).not.toBeNull();
    get('[data-scope="all"]').click();
    restored.close(); restored.open();
    expect(document.querySelectorAll('[data-profile]')).toHaveLength(3);
});

test('refresh removes selected profiles that moved out of scope and recovers deleted tab scope', () => {
    const { actions, panel, profiles } = fixture();
    select('bob');
    profiles[1].tab = 'Main'; panel.refresh();
    expect(get('#mbx-roster-count').textContent).toContain('0 selected');
    panel.close(); panel.el.remove();
    let tabs = ['Main', 'Miners'];
    const restored = new RosterPanel(actions, { tabs: () => tabs, activeTab: () => 'Main', worldRouting: true, edit: () => {} });
    document.body.append(restored.el); restored.open();
    get('[data-scope="Miners"]').click(); select('alice');
    tabs = ['Main']; profiles[0].tab = 'Main'; restored.refresh();
    expect(get('#mbx-roster-count').textContent).toContain('0 selected');
    expect(document.querySelectorAll('[data-profile]')).toHaveLength(3);
    expect(get('[data-scope="Main"]').getAttribute('aria-pressed')).toBe('true');
});

test('world and state distinguish logged out targets, saved profiles, loading and switching', () => {
    const { profiles, panel } = fixture();
    profiles[0].slot!.ingame = false;
    profiles[0].slot!.targetWorld = 2;
    panel.refresh();
    expect(get('[data-profile="alice"]').textContent).toContain('W2 (target)');
    expect(get('[data-profile="alice"]').textContent).toContain('Logged out');
    expect(get('[data-profile="bob"]').textContent).toContain('W2 (saved)');
    profiles[0].slot!.ready = false; panel.refresh();
    expect(get('[data-profile="alice"]').textContent).toContain('Loading');
    profiles[0].slot!.ready = true;
    profiles[0].slot!.ingame = true;
    profiles[0].slot!.switchingWorld = 2; panel.refresh();
    expect(get('[data-profile="alice"]').textContent).toContain('W1 → W2');
    expect(get('[data-profile="alice"]').textContent).toContain('Switching world');
});


test('open makes background inert and close restores its existing state without moving iframes', () => {
    const { panel } = fixture();
    panel.close();
    const wall = document.createElement('div');
    const frame = document.createElement('iframe');
    const opener = document.createElement('button');
    wall.append(frame, opener);
    const blocked = document.createElement('div');
    blocked.setAttribute('inert', 'inert');
    document.body.append(wall, blocked);
    panel.open(opener); panel.open(opener);
    expect(wall.hasAttribute('inert')).toBe(true);
    expect(blocked.hasAttribute('inert')).toBe(true);
    expect(panel.el.hasAttribute('inert')).toBe(false);
    expect(frame.parentElement === wall).toBe(true);
    panel.close();
    expect(wall.hasAttribute('inert')).toBe(false);
    expect(blocked.getAttribute('inert')).toBe('inert');
    expect(frame.parentElement === wall).toBe(true);
    expect(document.activeElement === opener).toBe(true);
});

test('editor failures from another realm preserve the failure message', async () => {
    const error: unknown = runInNewContext('new Error("Frame editor unavailable")');
    const { panel, profiles } = fixture(true, () => { throw error; });
    profiles[0].slot!.scriptState = 'stopped'; panel.refresh();
    get('[data-profile="alice"] [data-edit]').click(); await settle();
    expect(panel.el.hidden).toBe(false);
    expect(get('#mbx-roster-message').textContent).toContain('Frame editor unavailable');
});
