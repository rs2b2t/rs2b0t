import '../setup-dom.js';

const data = new Map<string, string>();
Reflect.set(globalThis, 'rs2b0tDesktopStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    keys: () => [...data.keys()],
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
