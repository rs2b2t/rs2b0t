import '../setup-dom.js';

const data = new Map<string, string>();
let keyReads = 0;
Reflect.set(globalThis, 'rs2b0tDesktopStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    keys: () => { keyReads++; return [...data.keys()]; },
    compareAndSet: () => false,
    subscribe: () => {}
});
await import('../../src/bot/panel/desktopStorage.js');
const { readProfileScript, readScriptSettings, replaceScriptSettings } = await import('../../src/bot/multibox/RosterStorage.js');
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
    keyReads = 0;
    panel.open();
    const openReads = keyReads;
    data.set('rs2b0t:miner_0:set:Fisher:fish', 'trout');
    data.set('rs2b0t:miner_0:set:Miner:setting_0', 'coal');
    keyReads = 0;
    panel.refresh();
    console.log(JSON.stringify({ openReads, refreshReads: keyReads, rows: panel.el.querySelectorAll('tbody tr').length,
        scripts: actions.scripts(), updated: panel.el.querySelector('tbody tr')?.textContent?.includes('coal') }));
}
