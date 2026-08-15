/** Live helper: teleport to each gather camp and sample nearby rocks / trees / fish. Reports PASS/FAIL only and never edits the location tables.
 *  Skill names as argv (default all), BASE / HEADED / SLOWMO from the environment. Requires a local engine and a deployed bot client. */

// Usage:
//   bun e2e/verify-gathering-locations.ts              # all skills
//   bun e2e/verify-gathering-locations.ts fishing
//   bun e2e/verify-gathering-locations.ts mining woodcutting
//   BASE=http://localhost:8888 bun e2e/verify-gathering-locations.ts
//   HEADED=1 bun e2e/verify-gathering-locations.ts fishing   # visible Chrome
//   HEADED=1 SLOWMO=400 bun e2e/verify-gathering-locations.ts mining
import { boot, cheatQuiet, fail, launchBrowser, login } from './lib/harness.js';
import type { GatheringLocation } from '../src/bot/data/gatheringLocations.js';

// Location tables import BankLocations → Skills/Quests → client graphics (Jpeg needs document).
// bun test preloads happy-dom; plain `bun tools/...` does not.
const { GlobalRegistrator } = await import('@happy-dom/global-registrator');
GlobalRegistrator.register();
const { FISHING_LOCATIONS } = await import('../src/bot/data/fishingLocations.js');
const { MINING_LOCATIONS } = await import('../src/bot/data/miningLocations.js');
const { WOODCUTTING_LOCATIONS } = await import('../src/bot/data/woodcuttingLocations.js');

const BASE = process.env.BASE ?? 'http://localhost:8890';
const skills = process.argv.slice(2).map(s => s.toLowerCase());
const wantAll = skills.length === 0;
const wantFishing = wantAll || skills.includes('fishing') || skills.includes('fish');
const wantMining = wantAll || skills.includes('mining') || skills.includes('mine');
const wantWc = wantAll || skills.includes('woodcutting') || skills.includes('wc');

function teleCheat(t: { x: number; z: number; level: number }): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

interface Sample {
    me: { x: number; z: number; level: number } | null;
    rocks: string[];
    trees: string[];
    fish: string[];
    banks: string[];
}

interface Abi {
    __rs2b0t: {
        Locs: {
            query(): {
                results(): {
                    name: string | null;
                    tile(): { x: number; z: number; level: number };
                    actions(): string[];
                    distance(): number;
                }[];
            };
        };
        Npcs: {
            query(): {
                results(): {
                    name: string | null;
                    tile(): { x: number; z: number; level: number };
                    distance(): number;
                    actions?(): string[];
                }[];
            };
        };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
}

type Row = {
    skill: string;
    loc: GatheringLocation;
    expect: 'rocks' | 'trees' | 'fish';
};

const rows: Row[] = [];
if (wantFishing) {
    for (const loc of FISHING_LOCATIONS) {
        rows.push({ skill: 'fishing', loc, expect: 'fish' });
    }
}
if (wantMining) {
    for (const loc of MINING_LOCATIONS) {
        rows.push({ skill: 'mining', loc, expect: 'rocks' });
    }
}
if (wantWc) {
    for (const loc of WOODCUTTING_LOCATIONS) {
        rows.push({ skill: 'woodcutting', loc, expect: 'trees' });
    }
}

if (rows.length === 0) {
    fail('usage: bun e2e/verify-gathering-locations.ts [fishing|mining|woodcutting]...');
}

function chebyshev(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/** Resources only count when the bot arrived near the seed spot. */
const ARRIVE_MAX = 18;

function passFor(expect: Row['expect'], sample: Sample, spot: { x: number; z: number; level: number }): boolean {
    if (!sample.me) {
        return false;
    }
    if (sample.me.level !== spot.level || chebyshev(sample.me, spot) > ARRIVE_MAX) {
        return false;
    }
    if (expect === 'rocks') {
        return sample.rocks.length > 0;
    }
    if (expect === 'trees') {
        return sample.trees.length > 0;
    }
    return sample.fish.length > 0;
}

async function sampleScene(page: import('playwright-core').Page): Promise<Sample> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        const me = g.__rs2b0t.reader.worldTile();
        const locs = g.__rs2b0t.Locs.query()
            .results()
            .filter(l => l.distance() <= 12)
            .sort((a, b) => a.distance() - b.distance());
        const npcs = g.__rs2b0t.Npcs.query()
            .results()
            .filter(n => n.distance() <= 14)
            .sort((a, b) => a.distance() - b.distance());

        const rocks = locs
            .filter(l => /rock/i.test(l.name ?? ''))
            .slice(0, 8)
            .map(l => `${l.name}@${l.tile().x},${l.tile().z} d${l.distance()} [${l.actions().join('/')}]`);
        const trees = locs
            .filter(l => /tree|oak|willow|maple|yew|magic/i.test(l.name ?? ''))
            .slice(0, 8)
            .map(l => `${l.name}@${l.tile().x},${l.tile().z} d${l.distance()} [${l.actions().join('/')}]`);
        const banks = locs
            .filter(l => /bank/i.test(l.name ?? ''))
            .slice(0, 4)
            .map(l => `${l.name}@${l.tile().x},${l.tile().z} d${l.distance()}`);
        const fish = npcs
            .filter(n => /fishing spot/i.test(n.name ?? ''))
            .slice(0, 8)
            .map(n => `${n.name}@${n.tile().x},${n.tile().z} d${n.distance()}`);
        return { me, rocks, trees, fish, banks };
    });
}

async function pollArrived(
    page: import('playwright-core').Page,
    spot: { x: number; z: number; level: number },
    polls = 10
): Promise<Sample> {
    let sample = await sampleScene(page);
    for (let poll = 0; poll < polls; poll++) {
        if (
            sample.me &&
            sample.me.level === spot.level &&
            chebyshev(sample.me, spot) <= ARRIVE_MAX
        ) {
            return sample;
        }
        await page.waitForTimeout(400);
        sample = await sampleScene(page);
    }
    return sample;
}

/** Packet-based ::tele + wait for arrival. Soft retries only — no logout/reload thrash. */
async function teleArrive(
    page: import('playwright-core').Page,
    spot: { x: number; z: number; level: number }
): Promise<Sample> {
    const cmd = teleCheat(spot);
    for (let attempt = 0; attempt < 3; attempt++) {
        const sent = await cheatQuiet(page, cmd, attempt === 0 ? 1200 : 900);
        if (!sent) {
            await page.waitForTimeout(500);
            continue;
        }
        const sample = await pollArrived(page, spot, 12);
        if (
            sample.me &&
            sample.me.level === spot.level &&
            chebyshev(sample.me, spot) <= ARRIVE_MAX
        ) {
            return sample;
        }
    }
    return sampleScene(page);
}

const browser = await launchBrowser();
let failed = 0;
let passed = 0;
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await page.goto(`${BASE}/bot.html`);
    await boot(page);
    const u = `vgl${Date.now().toString(36).slice(-6)}`;
    if (!(await login(page, u))) {
        fail('login failed');
    }

    // No warmup reload — local engines accept CLIENT_CHEAT once ingame.
    // (A tele+reload warmup only costs a long unclean-disconnect relogin.)

    const headed = !!process.env.HEADED;
    console.log(
        `verify-gathering-locations: ${rows.length} camps @ ${BASE}${headed ? ' (HEADED)' : ''}\n`
    );

    for (const row of rows) {
        const { loc, skill, expect } = row;
        const spot = loc.spot;
        const sample = await teleArrive(page, spot);

        const arrived =
            !!sample.me && sample.me.level === spot.level && chebyshev(sample.me, spot) <= ARRIVE_MAX;
        const ok = passFor(expect, sample, spot);
        const tag = ok ? 'PASS' : 'FAIL';
        if (ok) {
            passed++;
        } else {
            failed++;
        }
        const me = sample.me ? `${sample.me.x},${sample.me.z},${sample.me.level}` : '?';
        const dist =
            sample.me && sample.me.level === spot.level
                ? ` d${chebyshev(sample.me, spot)}`
                : sample.me
                    ? ' (wrong level)'
                    : '';
        console.log(
            `[${tag}] ${skill} · ${loc.name}  spot=${spot.x},${spot.z},${spot.level}  me=${me}${dist}  verified=${loc.verified}`
        );
        if (!arrived) {
            console.log(`       notes: tele did not arrive within ${ARRIVE_MAX} tiles of seed`);
        }
        if (loc.notes) {
            console.log(`       notes: ${loc.notes}`);
        }
        if (expect === 'rocks') {
            console.log(`       rocks: ${sample.rocks.join(' | ') || '(none)'}`);
        } else if (expect === 'trees') {
            console.log(`       trees: ${sample.trees.join(' | ') || '(none)'}`);
        } else {
            console.log(`       fish:  ${sample.fish.join(' | ') || '(none)'}`);
        }
        if (sample.banks.length) {
            console.log(`       banks: ${sample.banks.join(' | ')}`);
        }
        console.log('');
    }
} finally {
    await browser.close();
}

console.log(`done: ${passed} PASS, ${failed} FAIL (of ${rows.length})`);
console.log('This tool does not flip verified flags — edit location tables by hand after review.');
if (failed > 0) {
    process.exit(1);
}
