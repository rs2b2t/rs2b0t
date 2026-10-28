// MultiBox roster modal: [self-serve]. Real wall with fixture clients; no game server or accounts.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser } from './lib/harness.js';
import type { Account, SlotSnapshot } from '../src/bot/multibox/types.js';

interface Wall {
    controller: { remove(id: number): void };
    add(account: Account): SlotSnapshot;
    slots(): SlotSnapshot[];
    addTab(name: string): boolean;
    setActiveTab(name: string): boolean;
    activeTab(): string;
    setSlotTab(id: number, tab: string): boolean;
    importProfiles(profiles: Account[]): Promise<number>;
}

async function bundle(entry: string, target = 'proxy'): Promise<string> {
    const build = await Bun.build({ entrypoints: [entry], target: 'browser', define: { 'process.env': JSON.stringify({ RS2B0T_TARGET: target }) } });
    if (!build.success) throw new Error(build.logs.map(String).join('\n'));
    return build.outputs[0].text();
}

const [wallCode, fixtureCode, localCode] = await Promise.all([
    bundle('src/bot/multibox/main.ts'), bundle('e2e/fixtures/roster-client.ts'), bundle('src/bot/multibox/main.ts', 'local')
]);
const server = Bun.serve({ port: 0, fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/multibox.html' || url.pathname === '/local.html') return new Response(Bun.file('public-bot/multibox.html'));
    if (url.pathname === '/bot/multibox.js') return new Response(req.headers.get('referer')?.includes('/local.html') ? localCode : wallCode, { headers: { 'Content-Type': 'application/javascript' } });
    if (url.pathname === '/bot.html') return new Response('<!DOCTYPE html><body style="margin:0;background:#111;color:#9bd49b;font:14px monospace"><script type="module" src="/fixture.js"></script></body>', { headers: { 'Content-Type': 'text/html' } });
    if (url.pathname === '/fixture.js') return new Response(fixtureCode, { headers: { 'Content-Type': 'application/javascript' } });
    return new Response('not found', { status: 404 });
} });

const browser = await launchBrowser();
const out = '.superpowers/roster-verification';
mkdirSync(out, { recursive: true });
try {
    const page = await browser.newPage({ viewport: { width: 1480, height: 940 } });
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on('pageerror', err => { errors.push(err.message); console.error(err.message); });
    await page.goto(`http://localhost:${server.port}/multibox.html`);
    await page.waitForFunction(() => Boolean(Reflect.get(globalThis, 'multibox')));
    console.log('wall booted');
    await page.click('#mbx-manage');
    await page.fill('#mbx-vault-pass', 'roster-fixture');
    await page.fill('#mbx-vault-confirm', 'roster-fixture');
    await page.click('#mbx-vault-go');
    await page.locator('#mbx-roster').waitFor({ state: 'visible' });
    console.log('vault unlocked; modal opened');
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
        const wall = Reflect.get(globalThis, 'multibox') as Wall;
        wall.addTab('Miners');
        wall.addTab('Runners');
        wall.setActiveTab('Miners');
        const profiles: Account[] = [
            { username: 'miner_source', password: '', tab: 'Miners', world: 1 },
            { username: 'miner_target', password: '', tab: 'Miners', world: 1 },
            { username: 'miner_busy', password: '', tab: 'Miners', world: 1 },
            { username: 'miner_fail', password: '', tab: 'Miners', world: 1 },
            { username: 'miner_saved', password: '', tab: 'Miners', world: 1 },
            { username: 'nature_peer', password: '', tab: 'Runners', world: 1 }
        ];
        await wall.importProfiles(profiles);
        for (const store of [localStorage, sessionStorage]) {
            store.setItem('rs2b0t:miner_source:set:Miner:rock', 'iron');
            store.setItem('rs2b0t:miner_target:set:Miner:rock', 'coal');
            store.setItem('rs2b0t:miner_target:set:Miner:stale', 'true');
            store.setItem('rs2b0t:miner_target:set:Global:runAuto', 'false');
            store.setItem('rs2b0t:miner_saved:selectedScript', 'Miner');
        }
        for (const p of profiles) {
            const slot = wall.add({ ...p, tab: 'Main' });
            wall.setSlotTab(slot.id, p.tab!);
            if (p.username === 'miner_saved') wall.controller.remove(slot.id);
        }
    });
    await page.waitForFunction(() => (Reflect.get(globalThis, 'multibox') as Wall).slots().every(s => s.ready));
    console.log('fixture clients ready');
    const frames = await page.locator('iframe').elementHandles();
    await page.click('#mbx-manage');
    const modal = page.locator('#mbx-roster');
    const action = (name: string) => modal.locator(`[data-action="${name}"]`);
    const select = (name: string) => modal.getByRole('checkbox', { name: `Select ${name}`, exact: true });
    const apply = async () => {
        await page.click('#mbx-roster-apply');
        await page.waitForFunction(() => document.getElementById('mbx-roster-message')?.textContent?.startsWith('Action finished.'));
    };
    await modal.getByRole('button', { name: /^Miners/ }).click();
    await modal.getByRole('button', { name: 'Select tab', exact: true }).click();
    await action('assign').click();
    await page.selectOption('#mbx-roster-script', 'NatureCrafter');
    await apply();
    await page.waitForFunction(() => localStorage.getItem('rs2b0t:miner_saved:selectedScript') === 'NatureCrafter');
    console.log('assignment persisted');
    await action('copy').click();
    await page.selectOption('#mbx-roster-script', 'Miner');
    await page.selectOption('#mbx-roster-source', 'miner_source');
    await apply();
    await page.waitForFunction(() => localStorage.getItem('rs2b0t:miner_saved:set:Miner:rock') === 'iron');
    const stored = await page.evaluate(() => ({
        target: localStorage.getItem('rs2b0t:miner_target:set:Miner:rock'),
        stale: sessionStorage.getItem('rs2b0t:miner_target:set:Miner:stale'),
        global: localStorage.getItem('rs2b0t:miner_target:set:Global:runAuto'),
        selected: localStorage.getItem('rs2b0t:miner_target:selectedScript'),
        busy: localStorage.getItem('rs2b0t:miner_busy:set:Miner:rock')
    }));
    if (JSON.stringify(stored) !== JSON.stringify({ target: 'iron', stale: null, global: 'false', selected: 'NatureCrafter', busy: null })) throw new Error(`Bad copy: ${JSON.stringify(stored)}`);
    if (!(await modal.locator('tr[data-username="miner_fail"]').textContent())?.includes('Fixture copy failure')) throw new Error('Missing partial-failure result');
    await page.screenshot({ path: join(out, 'roster-modal.png') });

    await modal.getByRole('button', { name: 'Clear', exact: true }).click();
    await select('miner_target').check();
    await action('assign').click();
    await page.selectOption('#mbx-roster-script', 'Miner');
    await apply();
    await modal.locator('tr[data-username="miner_target"]').getByRole('button', { name: /Edit/ }).click();
    await modal.waitFor({ state: 'hidden' });
    const target = page.frames().find(f => new URL(f.url()).searchParams.get('box') === 'miner_target')!;
    await target.fill('#fixture-parameter', 'copper');
    await target.getByRole('button', { name: 'Save fixture parameter' }).click();
    const copy = await page.evaluate(() => ['miner_source', 'miner_target', 'miner_saved'].map(name => localStorage.getItem(`rs2b0t:${name}:set:Miner:rock`)));
    if (JSON.stringify(copy) !== JSON.stringify(['iron', 'copper', 'iron'])) throw new Error('Individual edit changed other profiles');
    for (const frame of frames) if (!await frame.evaluate(el => el.isConnected)) throw new Error('Modal operation replaced an iframe');

    await page.click('#mbx-manage');
    await action('travel').click();
    await page.selectOption('#mbx-roster-destination', "Seers' Village");
    await target.evaluate(() => { Reflect.get(globalThis, 'rosterFixture').holdTravel = true; });
    await page.locator('#mbx-roster-apply').focus();
    await page.keyboard.press('Enter');
    await target.waitForFunction(() => Boolean(Reflect.get(globalThis, 'rosterFixture').releaseTravel));
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Tab');
        if (!await page.evaluate(() => Boolean(document.activeElement?.closest('#mbx-roster')))) throw new Error('Focus escaped a busy modal');
    }
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden' });
    await page.click('#mbx-manage');
    if (!await page.locator('#mbx-roster-apply').isDisabled()) throw new Error('Reopened modal allowed an overlapping action');
    await target.evaluate(() => Reflect.get(globalThis, 'rosterFixture').releaseTravel());
    await page.waitForFunction(() => document.getElementById('mbx-roster-message')?.textContent?.startsWith('Action finished.'));
    await page.waitForFunction(() => localStorage.getItem('rs2b0t:miner_target:set:WalkTo:destination') === "Seers' Village");
    await action('stop').click();
    await apply();
    await select('miner_saved').check();
    await action('world').click();
    await page.selectOption('#mbx-roster-world', '2');
    await apply();
    await page.waitForFunction(() => (Reflect.get(globalThis, 'multibox') as Wall).slots().some(s => s.username === 'miner_target' && s.world === 2));
    await modal.getByRole('button', { name: 'Done', exact: true }).click();
    if (!await page.locator('#mbx-manage').evaluate(el => el === document.activeElement)) throw new Error('Focus not restored');
    await page.click('#mbx-add');
    const savedWorld = await page.locator('.mbx-profile-row').filter({ hasText: 'miner_saved' }).locator('select').inputValue();
    if (savedWorld !== '2') throw new Error('Unloaded profile world was not persisted');
    await page.mouse.click(5, 5);
    await page.click('#mbx-manage');
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden' });
    await page.click('#mbx-manage');
    await page.mouse.click(5, 5);
    await modal.waitFor({ state: 'hidden' });
    await page.click('#mbx-manage');
    await modal.getByRole('button', { name: /Close/ }).click();
    await modal.waitFor({ state: 'hidden' });

    await page.click('#mbx-manage');
    await modal.getByRole('button', { name: /^Runners/ }).click();
    if (await modal.locator('tbody tr').count() !== 1) throw new Error('Tab scope did not filter roster');
    if (await modal.getByRole('checkbox', { checked: true }).count()) throw new Error('Filter retained hidden selection');
    if (await page.evaluate(() => (Reflect.get(globalThis, 'multibox') as Wall).activeTab()) !== 'Miners') throw new Error('Roster filter changed wall tab');
    await modal.getByRole('button', { name: /^Miners/ }).click();
    await page.setViewportSize({ width: 800, height: 800 });
    await page.screenshot({ path: join(out, 'roster-narrow.png') });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Narrow modal overflows viewport');
    await page.setViewportSize({ width: 1480, height: 940 });
    await modal.getByRole('button', { name: 'Clear', exact: true }).click();
    await select('miner_target').check();
    const switched = page.frames().find(f => new URL(f.url()).searchParams.get('box') === 'miner_target')!;
    await switched.evaluate(() => { Reflect.get(globalThis, 'rosterFixture').holdTravel = true; });
    await action('travel').click();
    await page.click('#mbx-roster-apply');
    await switched.waitForFunction(() => Boolean(Reflect.get(globalThis, 'rosterFixture').releaseTravel));
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
        const wall = Reflect.get(globalThis, 'multibox') as Wall;
        const slot = wall.slots().find(s => s.username === 'miner_target')!;
        wall.controller.remove(slot.id);
    });
    await page.click('#mbx-manage');
    await page.waitForFunction(() => document.getElementById('mbx-roster-message')?.textContent?.startsWith('Action finished.'), undefined, { timeout: 15_000 });
    await modal.getByRole('button', { name: 'Clear', exact: true }).click();
    await select('miner_source').check();
    await action('stop').click();
    await apply();
    await page.goto(`http://localhost:${server.port}/local.html`);
    await page.click('#mbx-manage');
    await page.fill('#mbx-vault-pass', 'roster-fixture');
    await page.click('#mbx-vault-go');
    await modal.waitFor({ state: 'visible' });
    if (await action('world').isVisible()) throw new Error('Local engine offers world switching');
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('PASS: roster assignment, copy isolation, partial failures, individual edit, travel, world switching, modal dismissal, focus, tab scope, responsive layout, iframe identity, and removal during travel');
} finally {
    await browser.close();
    server.stop(true);
}
