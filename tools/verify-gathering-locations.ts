/**
 * Live helper: teleport to each gather camp and sample nearby rocks / trees / fish.
 * Reports PASS/FAIL only — does not edit location tables.
 *
 * Requires a local engine + deployed bot client (default http://localhost:8890).
 *
 * Usage:
 *   bun tools/verify-gathering-locations.ts              # all skills
 *   bun tools/verify-gathering-locations.ts fishing
 *   bun tools/verify-gathering-locations.ts mining woodcutting
 *   BASE=http://localhost:8888 bun tools/verify-gathering-locations.ts
 */
import { boot, fail, launchBrowser, login, type } from './lib/harness.js';
import { FISHING_LOCATIONS } from '../src/bot/scripts/FishingLocations.js';
import { MINING_LOCATIONS } from '../src/bot/scripts/MiningLocations.js';
import { WOODCUTTING_LOCATIONS } from '../src/bot/scripts/WoodcuttingLocations.js';
import type { GatheringLocation } from '../src/bot/scripts/GatheringLocations.js';

const BASE = process.env.BASE ?? 'http://localhost:8890';
const skills = process.argv.slice(2).map(s => s.toLowerCase());
const wantAll = skills.length === 0;
const wantFishing = wantAll || skills.includes('fishing') || skills.includes('fish');
const wantMining = wantAll || skills.includes('mining') || skills.includes('mine');
const wantWc = wantAll || skills.includes('woodcutting') || skills.includes('wc');

function teleCmd(t: { x: number; z: number; level: number }): string {
    return `::tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
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
    fail('usage: bun tools/verify-gathering-locations.ts [fishing|mining|woodcutting]...');
}

function passFor(expect: Row['expect'], sample: Sample): boolean {
    if (expect === 'rocks') {
        return sample.rocks.length > 0;
    }
    if (expect === 'trees') {
        return sample.trees.length > 0;
    }
    return sample.fish.length > 0;
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
    // Warm scene / cheat ACL like other harnesses.
    await type(page, '::tele 0,50,50,20,20', 1500);
    await page.reload();
    await boot(page);
    for (let i = 0; i < 8 && !(await login(page, u)); i++) {
        await page.waitForTimeout(4000);
    }

    console.log(`verify-gathering-locations: ${rows.length} camps @ ${BASE}\n`);

    for (const row of rows) {
        const { loc, skill, expect } = row;
        const spot = loc.spot;
        await type(page, teleCmd(spot), 2800);

        const sample = await page.evaluate(() => {
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

        const ok = passFor(expect, sample);
        const tag = ok ? 'PASS' : 'FAIL';
        if (ok) {
            passed++;
        } else {
            failed++;
        }
        const me = sample.me ? `${sample.me.x},${sample.me.z},${sample.me.level}` : '?';
        console.log(
            `[${tag}] ${skill} · ${loc.name}  spot=${spot.x},${spot.z},${spot.level}  me=${me}  verified=${loc.verified}`
        );
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
