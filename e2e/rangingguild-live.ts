/** Live proof for RangingGuild: --phase round|redeem|full, --minutes, --tick.
 *  Why: every function in RangingGuild.ts drives a live client, so this run is the only proof the round, the payout and the ticket shop work. */

// Usage: HEADED=1 bun e2e/rangingguild-live.ts [--base url] [--phase round|redeem|full] [--minutes n] [--tick ms] [--no-deploy]
import { deployIsolatedClient, fail, launchBrowser, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, relog, seedItemsToBank, startScript, teleTo } from './tutorial/harness.js';

type Phase = 'round' | 'redeem' | 'full';
const PHASES: Phase[] = ['round', 'redeem', 'full'];

interface Args {
    base: string;
    user: string;
    phase: Phase;
    minutes: number;
    tickMs: number;
    deploy: boolean;
}

function parse(argv: readonly string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `rg${Date.now().toString(36).slice(-6)}`,
        phase: 'full',
        minutes: 15,
        tickMs: 0,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--phase') { out.phase = value as Phase; }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
    }
    if (!PHASES.includes(out.phase)) { fail(`--phase takes ${PHASES.join(', ')}, got '${out.phase}'`); }
    if (!Number.isFinite(out.minutes) || out.minutes <= 0) { fail(`--minutes takes a positive number, got '${out.minutes}'`); }
    return out;
}

const args = parse(process.argv.slice(2));

interface Point { x: number; z: number; level: number }

// Why: RangingGuildLogic is not on the harness ABI, so the tiles and ids are mirrored here and a drift in either copy fails a milestone rather than passing in silence.
const STAND: Point = { x: 2672, z: 3419, level: 0 };
const MERCHANT_STAND: Point = { x: 2659, z: 3430, level: 0 };
const SEERS_BANK: Point = { x: 2725, z: 3491, level: 0 };
const GUILD = { minX: 2652, maxX: 2690, minZ: 3410, maxZ: 3437 };
const VARP_TARGET_COUNT = 156;
const VARP_TARGET_SCORE = 157;
const COINS = 995;
const RUNE_ARROW = 892;
const ARCHERY_TICKET = 1464;
const BRONZE_ARROW = 882;
const TICKETS_PER_TRADE = 2000;
const ARROWS_PER_TRADE = 50;
const RANGED = 70;
const COINS_PER_TRIP = 400;
const POLL_MS = 2000;

interface Snapshot {
    pos: Point | null;
    count: number;
    score: number;
    tickets: number;
    coins: number;
    runeArrows: number;
    bronzeWorn: number;
    xp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

const client = args.deploy ? deployIsolatedClient(`rg${Date.now().toString(36).slice(-6)}`) : null;
const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, args.base, args.user, client?.page);
    console.log(`mainland-ready as '${args.user}'`);

    if (args.tickMs > 0 && !(await cheatQuiet(page, `speed ${args.tickMs}`))) {
        fail('could not set the tick speed');
    }
    if (!(await cheatQuiet(page, `setstat ranged ${RANGED}`, 1200))) {
        fail('could not set the ranged level');
    }
    await clearChatDialogs(page, 'ranged level-ups');

    if (args.phase === 'full') {
        await setSettings(page, 'RangingGuild', { coinsPerTrip: COINS_PER_TRIP });
        await seedItemsToBank(page, [
            { debugName: 'magic_shortbow', displayName: 'Magic shortbow', qty: 1 },
            { debugName: 'coins', displayName: 'Coins', qty: COINS_PER_TRIP }
        ], SEERS_BANK);
        // Why: one round short of a trade, so the first payout crosses 2000 and the redeem leg runs inside the same cycle.
        if (!(await cheatQuiet(page, `give archery_ticket ${TICKETS_PER_TRADE - 1}`))) {
            fail('could not seed the tickets');
        }
        if (!(await teleTo(page, SEERS_BANK, 6, 25_000))) {
            fail('could not reach the Seers bank stand');
        }
    } else {
        for (const seed of args.phase === 'round'
            ? ['give magic_shortbow', 'give coins 200']
            : ['give magic_shortbow', `give archery_ticket ${TICKETS_PER_TRADE}`]) {
            if (!(await cheatQuiet(page, seed))) {
                fail(`could not seed the pack (${seed})`);
            }
        }
        const seat = args.phase === 'round' ? STAND : MERCHANT_STAND;
        if (!(await teleTo(page, seat, 6, 25_000))) {
            fail(`could not reach (${seat.x},${seat.z})`);
        }
    }
    // Why: a headless ::tele leaves the scene unbuilt and the login payload rebuilds it.
    await relog(page, args.user);

    const read = (): Promise<Snapshot> =>
        page.evaluate(([countVarp, scoreVarp, coins, rune, ticket, bronze]): Snapshot => {
            const g = globalThis as never as {
                __rs2b0t: { Skills: { xp(n: string): number } };
                rs2b0t: {
                    runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } };
                    reader: {
                        worldTile(): Point | null;
                        inventory(): { id: number; count: number }[];
                        equipment(): { id: number; count: number }[];
                        varp(id: number): number;
                    };
                };
            };
            const sum = (items: { id: number; count: number }[], id: number): number => items.filter(i => i.id === id).reduce((n, i) => n + i.count, 0);
            const inv = g.rs2b0t.reader.inventory();
            return {
                pos: g.rs2b0t.reader.worldTile(),
                count: g.rs2b0t.reader.varp(countVarp),
                score: g.rs2b0t.reader.varp(scoreVarp),
                tickets: sum(inv, ticket),
                coins: sum(inv, coins),
                runeArrows: sum(inv, rune),
                bronzeWorn: sum(g.rs2b0t.reader.equipment(), bronze),
                xp: g.__rs2b0t.Skills.xp('ranged'),
                runner: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-80)
            };
        }, [VARP_TARGET_COUNT, VARP_TARGET_SCORE, COINS, RUNE_ARROW, ARCHERY_TICKET, BRONZE_ARROW] as const);

    const first = await read();
    console.log(`seeded phase=${args.phase} pos=${fmt(first.pos)} tickets=${first.tickets} coins=${first.coins} xp=${first.xp}`);

    await startScript(page, 'RangingGuild');
    console.log('started RangingGuild, watching');

    const t0 = Date.now();
    const deadline = t0 + args.minutes * 60_000;
    let last = first;
    let lastLogTime = 0;
    let countMax = 0;
    let sawReset = false;
    let ticketsMax = first.tickets;
    let runeMax = 0;
    let scoreMax = 0;
    let shots = 0;
    let rounds = 0;
    let buys = 0;
    let reachedGuild = false;
    let stopReason = '';
    let bankedArrowsAfterBuy = false;
    let shotTaken = false;
    const screenshot = `docs/e2e/rangingguild-${args.phase}-live.png`;

    while (Date.now() < deadline) {
        await page.waitForTimeout(POLL_MS);
        last = await read();
        countMax = Math.max(countMax, last.count);
        if (countMax >= 1 && last.count === 0) { sawReset = true; }
        ticketsMax = Math.max(ticketsMax, last.tickets);
        runeMax = Math.max(runeMax, last.runeArrows);
        scoreMax = Math.max(scoreMax, last.score);
        if (runeMax >= ARROWS_PER_TRADE && last.runeArrows === 0) { bankedArrowsAfterBuy = true; }
        if (last.pos && last.pos.x >= GUILD.minX && last.pos.x <= GUILD.maxX && last.pos.z >= GUILD.minZ && last.pos.z <= GUILD.maxZ) {
            reachedGuild = true;
        }
        const fresh = last.logs.filter(l => l.time > lastLogTime);
        for (const line of fresh) {
            console.log(`      · [${line.level}] ${line.msg}`);
            if (/^shot \d+\/10:/.test(line.msg)) { shots++; }
            if (/^round \d+: scored/.test(line.msg)) { rounds++; }
            if (/^bought \d+ rune arrows/.test(line.msg)) { buys++; }
            const stopped = /^stopping\b.*?(RangingGuild: .*)$/.exec(line.msg);
            if (stopped) { stopReason = stopped[1]; }
        }
        if (fresh.length > 0) {
            lastLogTime = Math.max(lastLogTime, ...fresh.map(l => l.time));
        }
        console.log(`  t=${Math.round((Date.now() - t0) / 1000)}s pos=${fmt(last.pos)} count=${last.count} score=${last.score} tickets=${last.tickets} coins=${last.coins} rune=${last.runeArrows} xp=+${last.xp - first.xp} runner=${last.runner}`);

        // Why: the overlay only paints while the script runs, so the proof frame is taken mid-round rather than after the stop.
        if (!shotTaken && (shots >= 5 || buys >= 1)) {
            await page.screenshot({ path: screenshot });
            shotTaken = true;
        }
        if (last.runner === 'stopped') {
            console.log('  runner stopped');
            break;
        }
        if (args.phase === 'round' && sawReset && last.tickets > first.tickets) {
            break;
        }
        if (args.phase === 'redeem' && runeMax >= ARROWS_PER_TRADE) {
            break;
        }
    }

    if (!shotTaken) {
        await page.screenshot({ path: screenshot });
    }
    if (last.runner !== 'stopped') {
        await stopScript(page);
    }
    const gained = last.xp - first.xp;
    console.log(`final: pos=${fmt(last.pos)} countMax=${countMax} scoreMax=${scoreMax} ticketsMax=${ticketsMax} runeMax=${runeMax} shots=${shots} rounds=${rounds} buys=${buys} xp=+${gained} stop='${stopReason}'`);

    // Why: the count sits at 11 for the tick between the last shot and the payout, so a 2s poll misses it and the reset plus the ticket gain are the proof of a round.
    if (args.phase === 'round') {
        if (!sawReset) {
            fail('the judge never reset the round, the payout did not happen');
        }
        if (last.tickets <= first.tickets) {
            fail(`no tickets landed (${first.tickets} -> ${last.tickets})`);
        }
        if (gained <= 0) {
            fail('no ranged xp, the shots never fired');
        }
        console.log(`PASS: one round, ${shots} shots, scored ${scoreMax}, +${last.tickets - first.tickets} tickets, +${gained} ranged xp`);
    } else if (args.phase === 'redeem') {
        if (runeMax < ARROWS_PER_TRADE) {
            fail(`the ticket shop never handed over ${ARROWS_PER_TRADE} rune arrows (peak ${runeMax})`);
        }
        if (ticketsMax - last.tickets !== TICKETS_PER_TRADE) {
            fail(`the trade took ${ticketsMax - last.tickets} tickets, not ${TICKETS_PER_TRADE}`);
        }
        console.log(`PASS: ${TICKETS_PER_TRADE} tickets -> ${ARROWS_PER_TRADE} rune arrows (${last.tickets} tickets left)`);
    } else {
        if (!reachedGuild) {
            fail(`never walked from the bank into the guild (ended at ${fmt(last.pos)})`);
        }
        if (!sawReset) {
            fail(`no round completed (count peaked at ${countMax})`);
        }
        if (buys < 1 || runeMax < ARROWS_PER_TRADE) {
            fail(`never bought rune arrows (buys=${buys}, peak held ${runeMax})`);
        }
        if (rounds < 2) {
            fail(`only ${rounds} rounds paid out; ${COINS_PER_TRIP} coins should fund two`);
        }
        if (last.runner !== 'stopped' || !/out of coins/.test(stopReason)) {
            fail(`expected an honest stop on empty coins, got runner=${last.runner} reason='${stopReason}'`);
        }
        if (!bankedArrowsAfterBuy) {
            fail(`the rune arrows were still in the pack after the last bank trip (${last.runeArrows} held)`);
        }
        if (gained <= 0) {
            fail('no ranged xp over the run');
        }
        console.log(`PASS: full cycle, banked for the kit, ${rounds} rounds, ${buys * ARROWS_PER_TRADE} rune arrows bought and banked, stopped honestly on empty coins`);
    }
} finally {
    await browser.close();
    client?.cleanup();
}

function fmt(pos: Point | null): string {
    return pos ? `${pos.x},${pos.z},${pos.level}` : '?';
}
