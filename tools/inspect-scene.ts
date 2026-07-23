import { boot, fail, launchBrowser, login, type } from './lib/harness.js';

const arg = (process.argv[2] || '').split(',').map(Number);
if (arg.length < 2) fail('usage: bun tools/inspect-scene.ts <x,z,level> [locFilter] [npcFilter]');
const [x, z, level = 0] = arg;
const locFilter = (process.argv[3] || '').toLowerCase();
const npcFilter = (process.argv[4] || '').toLowerCase();
const tele = `::tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`;

interface Abi {
    __rs2b0t: {
        Locs: { query(): { results(): { name: string | null; tile(): { x: number; z: number; level: number }; actions(): string[]; distance(): number }[] } };
        Npcs: { query(): { results(): { name: string | null; tile(): { x: number; z: number; level: number }; distance(): number }[] } };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await page.goto('http://localhost:8890/bot.html');
    await boot(page);
    const u = `in${Date.now().toString(36).slice(-6)}`;
    if (!(await login(page, u))) fail('login failed');
    await type(page, '::tele 0,50,50,20,20', 1500);
    await page.reload();
    await boot(page);
    for (let i = 0; i < 8 && !(await login(page, u)); i++) await page.waitForTimeout(4000);
    await type(page, tele, 2500);

    const out = await page.evaluate(({ lf, nf }) => {
        const g = globalThis as never as Abi;
        const me = g.__rs2b0t.reader.worldTile();
        const defaults = ['stair', 'ladder', 'manhole', 'gate', 'door', 'trapdoor', 'climb'];
        const locs = g.__rs2b0t.Locs.query().results()
            .filter(l => {
                const n = (l.name ?? '').toLowerCase();
                if (!n) return false;
                return lf ? n.includes(lf) : (defaults.some(d => n.includes(d)) || l.actions().some(a => /climb|open|enter|go-up|go-down/i.test(a)));
            })
            .filter(l => l.distance() <= 14)
            .sort((a, b) => a.distance() - b.distance())
            .slice(0, 16)
            .map(l => `${l.name} @ ${l.tile().x},${l.tile().z},${l.tile().level} d${l.distance()} [${l.actions().join('/')}]`);
        const npcs = g.__rs2b0t.Npcs.query().results()
            .filter(n => n.name && (!nf || (n.name).toLowerCase().includes(nf)) && n.distance() <= 16)
            .sort((a, b) => a.distance() - b.distance())
            .slice(0, 10)
            .map(n => `${n.name} @ ${n.tile().x},${n.tile().z},${n.tile().level} d${n.distance()}`);
        return { me, locs, npcs };
    }, { lf: locFilter, nf: npcFilter });

    console.log(`at ${out.me?.x},${out.me?.z},${out.me?.level}`);
    console.log('--- locs ---'); for (const l of out.locs) console.log(`  ${l}`);
    console.log('--- npcs ---'); for (const n of out.npcs) console.log(`  ${n}`);
} finally {
    await browser.close();
}
