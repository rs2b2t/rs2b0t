// docs/TESTING.md#live-harnesses
// Live CoalTrucks run against a local engine.
//   bun tools/coaltrucks-test.ts --phase cross --speed 300 --minutes 3   # proves the log balance level
//   bun tools/coaltrucks-test.ts --phase fill  --speed 300 --minutes 8
//   bun tools/coaltrucks-test.ts --phase drain --speed 300 --minutes 8
//   bun tools/coaltrucks-test.ts --minutes 45                            # full uncheated loop
//
// The truck count is a server-only varp the bot cannot read, but ::getvar can —
// so the truck is seeded with ::setvar and asserted with ::getvar.
import { fail, launchBrowser } from './lib/harness.js';
import { cheatQuiet, getServerVar, mainlandAccount, relog, startScript } from './tutorial/harness.js';

// ::tele takes level,squareX,squareZ,localX,localZ — i.e. x>>6, x&63.
const TELE = {
    mine: '0,40,54,22,25', // 2582,3481 — the rocks
    mineTruck: '0,40,54,15,30', // 2575,3486 — the mine-side truck stand
    seersTruck: '0,42,54,7,47', // 2695,3503 — the Seers-side truck stand
    logWest: '0,40,54,38,21' // 2598,3477 — west of the log balance
};

const PHASES = ['cross', 'fill', 'partial', 'run', 'drain', 'nopick', 'full'] as const;
type Phase = (typeof PHASES)[number];

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};

const base = opt('--base') ?? 'http://localhost:8888';
const user = opt('--user') ?? `ct${Date.now().toString(36).slice(-7)}`;
const minutes = Number(opt('--minutes') ?? 8);
const speed = opt('--speed');
const phase = (opt('--phase') ?? 'full') as Phase;

if (!PHASES.includes(phase)) {
    fail(`unknown --phase '${phase}' (want one of ${PHASES.join(', ')})`);
}

interface Snapshot {
    pos: { x: number; z: number; level: number } | null;
    coal: number;
    /** Anything held that is neither coal nor a pickaxe — random-event junk must not pile up. */
    junk: string[];
    /** Count, not a flag: a kept spare is exactly the leak the keep-list must not have. */
    picks: number;
    xp: number;
    tick: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, user);
    console.log(`mainland-ready as '${user}'`);

    if (speed && !(await cheatQuiet(page, `speed ${speed}`))) {
        fail('could not set speed');
    }
    if (!(await cheatQuiet(page, '~maxme'))) {
        fail('could not max stats');
    }

    // A fresh bot always starts in the fill phase, so there is no teleport that drops it
    // straight into draining — the run/cross/drain legs all start at the mine truck with
    // a full truck and a full pack, and reach their leg through the real transitions.
    const seat = phase === 'run' || phase === 'cross' || phase === 'drain' ? TELE.mineTruck : TELE.mine;

    // ::setvar works on a protected varp as long as the account is idle.
    if (phase === 'drain' || phase === 'run' || phase === 'cross') {
        if (!(await cheatQuiet(page, 'setvar coal_truck 120'))) {
            fail('could not seed the truck');
        }
    }
    if (phase === 'run' || phase === 'cross' || phase === 'drain') {
        // 27, not 28: the pickaxe needs the last slot, and 27 coal + pickaxe is still
        // a full pack, so the deposit fires against a full truck and answers "full".
        if (!(await cheatQuiet(page, 'give coal 27'))) {
            fail('could not seed the pack with coal');
        }
    }
    if (phase === 'fill' || phase === 'partial') {
        // Coal is a 16/100 roll, so a pack mined from empty takes ~11 minutes. Seed
        // most of it and let the bot mine the last few: the leg is about the deposit
        // ladder, and the xp assertion still proves it did the mining itself.
        if (!(await cheatQuiet(page, 'give coal 24'))) {
            fail('could not seed the pack with coal');
        }
    }
    if (phase === 'partial') {
        // 110 + a 27-coal pack overshoots 120, so the truck takes 10 and answers
        // "some" — the one deposit branch the other legs never reach.
        if (!(await cheatQuiet(page, 'setvar coal_truck 110'))) {
            fail('could not seed the truck');
        }
    }
    // ~maxme grants stats and never gear. Pickaxe *acquisition* is what --phase nopick
    // covers, so handing one to the other legs cannot hide a missing-tool bug.
    if (phase !== 'nopick') {
        if (!(await cheatQuiet(page, 'give rune_pickaxe'))) {
            fail('could not seed a pickaxe');
        }
    }
    // Stand-ins for random-event leavings: neither is coal, neither is bankable by the
    // truck, and both squat a coal slot on every future load until the bank clears them.
    // A spare bronze pickaxe checks the keep-list is the pickaxe *in use*, not any pickaxe.
    if (phase === 'drain' || phase === 'full') {
        for (const junk of ['give coins 500', 'give bones 3', 'give bronze_pickaxe']) {
            if (!(await cheatQuiet(page, junk))) {
                fail(`could not seed junk (${junk})`);
            }
        }
    }
    if (!(await cheatQuiet(page, `tele ${seat}`))) {
        fail(`could not tele for phase ${phase}`);
    }
    // A headless ::tele leaves the scene unbuilt; the login payload rebuilds it.
    await relog(page, user);

    const read = (): Promise<Snapshot> =>
        page.evaluate((): Snapshot => {
            const g = globalThis as never as {
                __rs2b0t: {
                    reader: {
                        worldTile(): { x: number; z: number; level: number } | null;
                        inventory(): { name: string | null; count: number }[];
                    };
                    Skills: { xp(n: string): number };
                };
                rs2b0t: {
                    host: { tickCount: number };
                    runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } };
                };
            };
            const inv = g.__rs2b0t.reader.inventory().map(i => i.name ?? '');
            return {
                pos: g.__rs2b0t.reader.worldTile(),
                coal: inv.filter(n => n === 'Coal').length,
                junk: [...new Set(inv.filter(n => n !== 'Coal' && !/pickaxe$/i.test(n)))],
                picks: inv.filter(n => /pickaxe$/i.test(n)).length,
                xp: g.__rs2b0t.Skills.xp('mining'),
                tick: g.rs2b0t.host.tickCount,
                runner: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-60)
            };
        });

    const truckBefore = await getServerVar(page, 'coal_truck');
    const first = await read();
    console.log(`seeded phase=${phase} truck=${truckBefore} pos=${fmt(first.pos)} xp=${first.xp}`);

    await startScript(page, 'CoalTrucks');
    console.log('started CoalTrucks — watching');

    const t0 = Date.now();
    const deadline = t0 + minutes * 60_000;
    let lastLogTime = 0;
    let last = first;
    // WalkExecutor logs "<label>: crossed" only after isOnFarSide confirms it, so this
    // is evidence the log was actually walked — not that a packet was sent.
    let crossed = false;
    /** A leg that meant to hand over a pickaxe and did not is a broken seed, not a pass. */
    let sawNoPickaxe = false;
    const deposits: string[] = [];
    // A completed cycle ends back at the mine, so the final position is no evidence
    // Seers was ever reached — track it across the whole run.
    let reachedSeers = false;
    // Capping the truck should not end the fill phase: the bot tops the pack up first,
    // so mining xp must still move between the capping deposit and the crossing.
    let xpAtCap: number | null = null;
    let xpAtCross: number | null = null;
    // The truck is capped when the haul starts, so the carried pack must reach the bank
    // before the bot touches the truck. Ordered log of which happened first.
    const haulOrder: string[] = [];

    while (Date.now() < deadline) {
        await page.waitForTimeout(10_000);
        last = await read();
        console.log(
            `  t=${Math.round((Date.now() - t0) / 1000)}s pos=${fmt(last.pos)} pack=${last.coal} xp=+${last.xp - first.xp} runner=${last.runner}`
        );
        for (const line of last.logs) {
            if (line.time > lastLogTime) {
                console.log(`      · [${line.level}] ${line.msg}`);
                if (line.msg.includes('Coal trucks log balance: crossed')) {
                    crossed = true;
                    xpAtCross ??= last.xp;
                }
                if (line.msg.includes('no pickaxe') || line.msg.includes('no usable pickaxe')) {
                    sawNoPickaxe = true;
                }
                if (/^banked \d+ coal/.test(line.msg)) {
                    haulOrder.push('bank');
                }
                // Walking to the truck with a full pack is the detour this catches: the
                // operation order can read bank-then-pull while the route still doubles back.
                if (line.msg.includes('walking to the Seers truck')) {
                    haulOrder.push('truck-walk');
                }
                if (/^took \d+ coal from the truck/.test(line.msg)) {
                    haulOrder.push('took');
                }
                const deposit = /coal in the truck \((\w+)\)/.exec(line.msg);
                if (deposit) {
                    deposits.push(deposit[1]);
                    if ((deposit[1] === 'partial' || deposit[1] === 'full') && xpAtCap === null) {
                        xpAtCap = last.xp;
                    }
                }
            }
        }
        if (last.logs.length > 0) {
            lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time));
        }
        if ((last.pos?.x ?? 0) >= 2650) {
            reachedSeers = true;
        }
        if (last.runner === 'stopped') {
            console.log('  runner stopped');
            break;
        }
    }

    const truckAfter = await getServerVar(page, 'coal_truck');
    const ticks = last.tick - first.tick;
    const gained = last.xp - first.xp;
    console.log(`final: truck=${truckAfter} xp=+${gained} over ${ticks} ticks pos=${fmt(last.pos)} deposits=[${deposits.join(',')}]`);

    // Catch a broken seed before it reads as a pass: every leg but nopick hands over a
    // pickaxe, and a pack seeded so full it has no room for one silently reroutes the
    // whole run down the no-pickaxe path.
    if (phase !== 'nopick' && sawNoPickaxe) {
        fail('the pickaxe seed did not land — the pack had no free slot for it');
    }

    // Any leg that actually hauls must bank the carried pack before walking anywhere near
    // the truck: it is capped, so a truck-first route costs 196 tiles against 156. Checking
    // the walk and not just the pull matters — the operation order can read bank-then-pull
    // while the route still doubles back, which is exactly how this shipped broken once.
    if (haulOrder.includes('took') && haulOrder[0] !== 'bank') {
        fail(`walked to the truck before banking the carried pack (order: ${haulOrder.slice(0, 5).join(' -> ')})`);
    }

    // Junk-seeded legs: banking must be bank-all-except-the-pickaxe. Anything the deposit
    // misses squats a coal slot on every future load — a silent leak, not a failure.
    if (phase === 'drain' || phase === 'full') {
        if (last.junk.length > 0) {
            fail(`junk still held after banking: ${last.junk.join(', ')} — the deposit is allow-listing, not bank-all-except`);
        }
        if (last.picks === 0) {
            fail('banked the pickaxe too — the keep-list is not protecting the tool in use');
        }
        // The seed includes a spare bronze pickaxe: the keep-list must be the ONE pickaxe
        // bestPickaxe selected, not "anything shaped like a pickaxe".
        if (last.picks > 1) {
            fail(`${last.picks} pickaxes still held — the keep-list is a category, not the tool in use`);
        }
        console.log('junk check: pack holds only coal + exactly one pickaxe');
    }

    // Assert on game state, never on log lines.
    if (phase === 'cross') {
        if (!crossed) {
            fail(`the log balance never reported a crossing (ended at ${fmt(last.pos)})`);
        }
        // A crossing that dumped us on the level-1 deck would strand us there: the deck
        // is an 8x5 island with no descent, so arriving anywhere else proves level 0.
        if (last.pos?.level !== 0) {
            fail(`log balance left us on level ${last.pos?.level} — the edge levels in transports.json are wrong`);
        }
        if ((last.pos?.x ?? 0) < 2603) {
            fail(`crossed but drifted back west (${fmt(last.pos)})`);
        }
        console.log(`PASS: crossed the log balance, now at ${fmt(last.pos)} on level 0`);
    } else if (phase === 'fill') {
        if ((truckAfter ?? 0) <= (truckBefore ?? 0)) {
            fail(`truck did not gain coal (${truckBefore} -> ${truckAfter})`);
        }
        if (gained <= 0) {
            fail('no mining xp gained — the bot never mined');
        }
        console.log(`PASS: truck ${truckBefore} -> ${truckAfter}, +${gained} mining xp`);
    } else if (phase === 'partial') {
        if (!deposits.includes('partial')) {
            fail(`the deposit never reported a partial accept (saw [${deposits.join(',')}])`);
        }
        if (!reachedSeers) {
            fail('a partial accept means the truck hit 120 — the bot should have run to Seers');
        }
        // The partial leg leaves the pack short (110 + 27 caps at 120, keeping 17), so the
        // bot must mine the difference before leaving — the haul costs the same either way.
        if (xpAtCap === null || xpAtCross === null) {
            fail(`never saw both the cap and the crossing (cap=${xpAtCap}, cross=${xpAtCross})`);
        }
        if (xpAtCross <= xpAtCap) {
            fail(`no mining between capping the truck and leaving — the pack was not topped up (xp ${xpAtCap} -> ${xpAtCross})`);
        }
        console.log(`PASS: capped at 120, topped the pack up (+${xpAtCross - xpAtCap} xp before leaving), then ran to Seers (truck ${truckBefore} -> ${truckAfter})`);
    } else if (phase === 'drain') {
        if ((truckAfter ?? 120) >= (truckBefore ?? 120)) {
            fail(`truck was not drained (${truckBefore} -> ${truckAfter})`);
        }
        // The 4-pull budget deliberately leaves the ~12 remainder rather than spending a
        // 102-tile round trip on it, so a truck drained to zero means the cap is not working.
        if ((truckAfter ?? 0) === 0) {
            fail('truck drained to zero — the 4-pull budget should leave the remainder behind');
        }
        const pulls = haulOrder.filter(e => e === 'took').length;
        console.log(`PASS: truck ${truckBefore} -> ${truckAfter} in ${pulls} pulls, remainder left for the next cycle`);
    } else if (phase === 'run') {
        if (!deposits.includes('full')) {
            fail(`the deposit never reported a full truck (saw [${deposits.join(',')}])`);
        }
        if (!reachedSeers) {
            fail(`never reached Seers (ended at ${fmt(last.pos)})`);
        }
        console.log('PASS: deposit answered "full", ran to Seers');
    } else if (phase === 'nopick') {
        // Regression guard: mining with no pickaxe fails silently, so the bot must
        // notice and stop rather than mime at the rocks forever.
        if (last.runner !== 'stopped') {
            fail(`no pickaxe but the bot is still ${last.runner} at ${fmt(last.pos)}`);
        }
        if (gained > 0) {
            fail(`gained ${gained} mining xp with no pickaxe — the seed is wrong`);
        }
        if ((last.pos?.x ?? 0) < 2650) {
            fail(`stopped without going to the bank for a pickaxe (${fmt(last.pos)})`);
        }
        console.log(`PASS: no pickaxe — walked to the bank and stopped honestly at ${fmt(last.pos)}`);
    } else {
        // "It gained xp" would pass a run that mined forever and never completed a
        // cycle, so require the whole loop: filled the truck to the cap, ran to Seers,
        // and drained it.
        if (gained <= 0) {
            fail('no mining xp gained over the full run');
        }
        if (!deposits.includes('all')) {
            fail(`never completed a plain deposit (saw [${deposits.join(',')}])`);
        }
        if (!deposits.includes('full') && !deposits.includes('partial')) {
            fail(`never filled the truck to the 120 cap (saw [${deposits.join(',')}])`);
        }
        if (!reachedSeers) {
            fail('filled the truck but never ran it to Seers');
        }
        if (!crossed) {
            fail('reached Seers without ever taking the log balance');
        }
        console.log(`PASS: full cycle — deposits [${deposits.join(',')}], crossed the log, truck at ${truckAfter}, +${gained} mining xp over ${ticks} ticks`);
    }
} finally {
    await browser.close();
}

function fmt(pos: { x: number; z: number; level: number } | null): string {
    return pos ? `${pos.x},${pos.z},${pos.level}` : '?';
}
