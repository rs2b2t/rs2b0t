import '../setup-dom.js';
import assert from 'node:assert/strict';
import type { DesktopStorage } from '#/bot/runtime/desktopStorage.js';

const data = new Map<string, string>();
let keyReads = 0;
let selectionReads = 0;
let notify: Parameters<DesktopStorage['subscribe']>[0];
Reflect.set(globalThis, 'rs2b0tDesktopStorage', {
    getItem: (key: string) => {
        if (key.endsWith(':selectedScript')) selectionReads++;
        return data.get(key) ?? null;
    },
    getItems: (keys: string[]) => {
        selectionReads++;
        return keys.map(key => data.get(key) ?? null);
    },
    setItem: (key: string, value: string) => {
        if (!key.startsWith('rs2b0t:')) throw new Error('Invalid saved setting');
        data.set(key, value);
    },
    removeItem: (key: string) => { data.delete(key); },
    keys: () => { keyReads++; return [...data.keys()]; },
    compareAndSet: () => false,
    subscribe: listener => { notify = listener; }
} satisfies DesktopStorage);
await import('../../src/bot/panel/desktopStorage.js');
if (process.argv.includes('--installed-shell')) {
    const { SettingsStore } = await import('../../src/bot/runtime/Settings.js');
    const { applyBoxStorage, collectBoxStorage } = await import('../../src/bot/multibox/ProfileTransfer.js');
    const browser = Reflect.get(window, 'happyDOM') as { setURL(url: string): void };
    SettingsStore.save('Global', 'runEnergyMin', '73');
    browser.setURL('http://localhost/bot.html?box=set');
    localStorage.setItem('rs2b0t:set:set:Global:runEnergyMin', '42');
    SettingsStore.save('Global', 'runEnergyMin', '65');
    sessionStorage.clear();
    assert.equal(SettingsStore.globalBag().num('runEnergyMin'), 65);
    const backup = collectBoxStorage(['set']);
    assert.deepEqual(backup, { set: { 'set:Global:runEnergyMin': '65' } });
    SettingsStore.clear('Global', 'runEnergyMin');
    assert.equal(SettingsStore.globalBag().num('runEnergyMin'), 20);
    applyBoxStorage(backup, ['set']);
    sessionStorage.clear();
    assert.equal(SettingsStore.globalBag().num('runEnergyMin'), 65);
    browser.setURL('http://localhost/bot.html');
    assert.equal(SettingsStore.globalBag().num('runEnergyMin'), 73);
    process.exit(0);
}
if (process.argv.includes('--export-cleared')) {
    const user = process.argv[3];
    const { SettingsStore } = await import('../../src/bot/runtime/Settings.js');
    const { applyBoxStorage, collectBoxStorage } = await import('../../src/bot/multibox/ProfileTransfer.js');
    const browser = Reflect.get(window, 'happyDOM') as { setURL(url: string): void };
    browser.setURL('http://localhost/bot.html?box=' + encodeURIComponent(user));
    const legacy = `rs2b0t:${user}:set:Global:runEnergyMin`;
    localStorage.setItem(legacy, '73');
    SettingsStore.clear('Global', 'runEnergyMin');
    sessionStorage.clear();
    sessionStorage.setItem(legacy, '42');
    const { boxKey } = await import('../../src/bot/runtime/box.js');
    sessionStorage.setItem(boxKey('set:Global:runEnergyMin', user), '65');
    SettingsStore.save('Miner', 'rock', 'iron');
    SettingsStore.clear('Miner', 'rock');
    sessionStorage.setItem(boxKey('set:Miner:rock', user), 'iron');
    assert.equal(SettingsStore.globalBag().num('runEnergyMin'), 20);
    const offered: string[] = [];
    const storage = collectBoxStorage([user], suffix => { offered.push(suffix); return true; });
    assert.deepEqual(storage, {});
    applyBoxStorage(storage, [user]);
    sessionStorage.clear();
    console.log(JSON.stringify({ offered, restored: SettingsStore.globalBag().num('runEnergyMin') }));
    process.exit(0);
}
if (process.argv.includes('--export-edited-login')) {
    const { applyBoxStorage, collectBoxStorage, serializeProfileFile } = await import('../../src/bot/multibox/ProfileTransfer.js');
    const user = process.argv[3];
    const { boxKey } = await import('../../src/bot/runtime/box.js');
    const { Credentials } = await import('../../src/bot/runtime/Credentials.js');
    const browser = Reflect.get(window, 'happyDOM') as { setURL(url: string): void };
    browser.setURL('http://localhost/bot.html?box=' + encodeURIComponent(user));
    applyBoxStorage({ [user]: { creds: JSON.stringify({ username: 'original', password: '' }), selectedScript: 'Miner', rendererEnabled: '1' } }, [user]);
    localStorage.setItem(boxKey('selectedScript', user), 'Fisher');
    localStorage.setItem(boxKey('rendererEnabled', user), '0');
    Credentials.save('edited', '');
    const profiles = [{ username: user, password: '' }];
    console.log(serializeProfileFile({ profiles, tabs: [], activeTab: 'Main', storage: collectBoxStorage([user]) }));
    process.exit(0);
}
if (process.argv.includes('--export-legacy-fields')) {
    const { collectBoxStorage, applyBoxStorage } = await import('../../src/bot/multibox/ProfileTransfer.js');
    const { boxKey } = await import('../../src/bot/runtime/box.js');
    const user = 'set:Travel';
    localStorage.setItem(`rs2b0t:${user}:selectedScript`, 'Miner');
    sessionStorage.setItem(`rs2b0t:${user}:selectedScript`, 'Fisher');
    sessionStorage.setItem(`rs2b0t:${user}:rendererEnabled`, '1');
    localStorage.setItem(`rs2b0t:${user}:creds`, 'old');
    const login = JSON.stringify({ username: 'edited', password: '' });
    sessionStorage.setItem(`rs2b0t:${user}:creds`, login);
    const backup = collectBoxStorage([user], () => true);
    sessionStorage.setItem(boxKey('creds', user), 'edited');
    const offered: string[] = [];
    const storage = collectBoxStorage([user], field => { offered.push(field); return true; });
    sessionStorage.clear();
    applyBoxStorage(backup, [user]);
    assert.equal(sessionStorage.getItem(boxKey('creds', user)), login);
    console.log(JSON.stringify({ storage, offered: offered.sort() }));
    process.exit(0);
}
if (process.argv.includes('--export-set')) {
    const user = process.argv[3];
    const { SettingsStore } = await import('../../src/bot/runtime/Settings.js');
    const { collectBoxStorage, applyBoxStorage } = await import('../../src/bot/multibox/ProfileTransfer.js');
    const { boxKey, readBoxItem, disableLegacySetProfileSettings } = await import('../../src/bot/runtime/box.js');
    SettingsStore.save('set', 'travel:mode', 'walk');
    sessionStorage.clear();
    sessionStorage.setItem(`rs2b0t:${user}:set:Miner:rock`, 'coal');
    for (const [key, value] of data) notify!(key, null, value);
    assert.equal(sessionStorage.getItem(boxKey('set:set:travel:mode', '')), 'walk');
    const threshold = `rs2b0t:${user}:set:Global:runEnergyMin`;
    localStorage.setItem(threshold, '73');
    sessionStorage.setItem(threshold, '42');
    assert.equal(readBoxItem('set:Global:runEnergyMin', user), '73');
    const before = collectBoxStorage([user], () => true);
    const current = boxKey('set:Global:runEnergyMin', user);
    sessionStorage.setItem(current, '51');
    assert.equal(collectBoxStorage([user], () => true)[user]['set:Global:runEnergyMin'], '73');
    localStorage.setItem(current, '87');
    assert.equal(collectBoxStorage([user], () => true)[user]['set:Global:runEnergyMin'], '87');
    assert.equal(collectBoxStorage([user])[user]['set:Global:runEnergyMin'], '87');
    sessionStorage.removeItem(current);
    localStorage.removeItem(current);
    disableLegacySetProfileSettings(localStorage, user);
    sessionStorage.setItem(current, '51');
    assert.equal(readBoxItem('set:Miner:rock', user), null);
    const offered: string[] = [];
    const after = collectBoxStorage([user], suffix => { offered.push(suffix); return true; });
    applyBoxStorage(before, [user]);
    sessionStorage.clear();
    assert.equal(readBoxItem('set:Global:runEnergyMin', user), '73');
    assert.equal(readBoxItem('set:Miner:rock', user), 'coal');
    console.log(JSON.stringify({ before, offered, after }));
    process.exit(0);
}
const { readProfileScript, readScriptSettings, replaceScriptSettings, writeProfileScript } = await import('../../src/bot/multibox/RosterStorage.js');
if (process.argv.includes('--export')) {
    const { collectBoxStorage, serializeProfileFile } = await import('../../src/bot/multibox/ProfileTransfer.js');
    writeProfileScript('source', 'Miner');
    data.set('rs2b0t:source:selectedScript', 'Fisher');
    const profiles = [{ username: 'source', password: '' }];
    console.log(serializeProfileFile({ profiles, tabs: [], activeTab: 'Main', storage: collectBoxStorage(['source']) }));
    process.exit(0);
}
localStorage.setItem('rs2b0t:legacy:selectedScript', 'NatureCrafter');
localStorage.setItem('rs2b0t:legacy:set:NatureCrafter:rune', 'Cosmic runes');
sessionStorage.setItem('rs2b0t:legacy:set:NatureCrafter:rune', 'Air runes');
sessionStorage.setItem('rs2b0t:legacy:set:NatureCrafter:obsolete', 'stale');
localStorage.setItem('rs2b0t:legacy:set:NatureCrafter:partner', 'old runner');
localStorage.setItem('rs2b0t:legacy:set:JiveRC:partner', 'current runner');
sessionStorage.setItem('rs2b0t:legacy:set:JiveRC:partner', 'stale runner');
assert.equal(readProfileScript('legacy'), 'JiveRC');
assert.deepEqual(readScriptSettings('legacy', 'JiveRC'), { rune: 'Cosmic runes', partner: 'current runner' });
replaceScriptSettings('legacy', 'JiveRC', {});
assert.deepEqual(readScriptSettings('legacy', 'JiveRC'), {});
assert.equal(sessionStorage.getItem('rs2b0t:legacy:set:NatureCrafter:obsolete'), null);
localStorage.setItem('rs2b0t:source:selectedScript', 'Miner');
sessionStorage.setItem('rs2b0t:source:selectedScript', 'Fisher');
localStorage.setItem('rs2b0t:source:set:Miner:rock', 'coal');
sessionStorage.setItem('rs2b0t:source:set:Miner:rock', 'iron');
sessionStorage.setItem('rs2b0t:source:set:Miner:stale', 'true');
replaceScriptSettings('target', 'Miner', readScriptSettings('source', 'Miner'));
console.log(JSON.stringify({
    script: readProfileScript('source'),
    source: readScriptSettings('source', 'Miner'),
    target: readScriptSettings('target', 'Miner'),
    durable: data.get('rs2b0t:target:set:Miner:rock'),
    session: sessionStorage.getItem('rs2b0t:target:set:Miner:rock')
}));

if (process.argv.includes('--roster')) {
    data.clear(); sessionStorage.clear();
    const { RosterActions } = await import('../../src/bot/multibox/RosterActions.js');
    const { RosterPanel } = await import('../../src/bot/multibox/RosterPanel.js');
    const profiles = Array.from({ length: 12 }, (_, index) => ({ username: `miner_${index}`, tab: 'Main', world: 1 as const }));
    for (const profile of profiles) {
        data.set(`rs2b0t:${profile.username}:selectedScript`, 'Miner');
        for (let index = 0; index < 40; index++) data.set(`rs2b0t:${profile.username}:set:Miner:setting_${index}`, 'iron');
    }
    const actions = new RosterActions({ profiles: () => profiles, client: () => null, setWorld: async () => true });
    const panel = new RosterPanel(actions, { tabs: () => ['Main'], activeTab: () => 'Main', worldRouting: true, edit: () => {} });
    document.body.append(panel.el);
    selectionReads = 0;
    keyReads = 0;
    panel.open();
    const openSelectionReads = selectionReads;
    const openReads = keyReads;
    data.set('rs2b0t:miner_0:set:Fisher:fish', 'trout');
    data.set('rs2b0t:miner_0:set:Miner:setting_0', 'coal');
    data.set('rs2b0t:miner_1:selectedScript', 'NatureCrafter');
    data.delete('rs2b0t:miner_2:selectedScript');
    selectionReads = 0;
    keyReads = 0;
    panel.refresh();
    const labels = Array.from(panel.el.querySelectorAll<HTMLTableRowElement>('tbody tr'), row => row.cells[2].textContent);
    const choices = Array.from(panel.el.querySelectorAll<HTMLOptionElement>('#mbx-roster-script option'), option => option.value);
    console.log(JSON.stringify({ openSelectionReads, refreshSelectionReads: selectionReads, labels, openReads, refreshReads: keyReads, rows: panel.el.querySelectorAll('tbody tr').length,
        scripts: choices, updated: panel.el.querySelector('tbody tr')?.textContent?.includes('coal') }));
}
