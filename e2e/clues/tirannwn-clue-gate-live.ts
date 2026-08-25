/** The three Regicide-gated clues (3560, 3562, 3564) through ClueSolver twice on one account:
 *  once with the quest unfinished, once with `regicide_quest` seeded complete.
 *  A pass is a solved trail. Unfinished must abandon naming Regicide; complete must walk the
 *  clue, cross Isafdar and open the casket. The gate opening is a step on the way, not the result.
 *  Isafdar has no baked nav edges, so the crossings come from REGICIDE_SEAMS via travelTirannwn.
 *  `--gate-only` stops at the gate verdict and reports the walk, for bisecting a regression. */

//   ~/redeploy.sh
//   bun e2e/clues/tirannwn-clue-gate-live.ts
//   bun e2e/clues/tirannwn-clue-gate-live.ts --ids 3564          # one clue
//   bun e2e/clues/tirannwn-clue-gate-live.ts --open-secs 300     # longer post-gate walk
//   HEADED=1 bun e2e/clues/tirannwn-clue-gate-live.ts --tick 150
//   bun e2e/clues/tirannwn-clue-gate-live.ts --gate-only         # stop at the gate, do not judge the solve
import type { Page } from 'playwright-core';

import { CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import { CLUE_GATES } from '#/bot/api/ai/clues/data/clueGates.js';
import { TALK_ANCHORS } from '#/bot/api/ai/clues/data/talkAnchors.js';

import { deployIsolatedClient, fail, launchBrowser, setSettings } from '../lib/harness.js';
import { createHarnessProof } from '../lib/harnessProof.js';
import { dropInvMatching, ensureRunnerStopped, giveItems, setTickRate } from '../lib/navLiveHarness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    getServerVarQuiet,
    mainlandAccount,
    relog,
    seedItemsToBank,
    teleTo,
    type BankSeedItem
} from '../tutorial/harness.js';

const argv = process.argv.slice(2);
const arg = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 ? (argv[i + 1] ?? null) : null;
};

const base = arg('base') ?? process.env.BASE ?? 'http://localhost:8890';
const TICK_MS = Number(arg('tick') ?? 300);
/** The gate verdict lands before any walking, so the shut phase needs no travel budget. */
const SHUT_MS = Number(arg('shut-secs') ?? 180) * 1000;
const OPEN_MS = Number(arg('open-secs') ?? 240) * 1000;
/** How long to keep reading nav lines after the solve step starts, for the report. */
const DIAG_MS = Number(arg('diag-secs') ?? 25) * 1000;
/** Default. The clue must solve; the gate opening is a step on the way, not the result. */
const GATE_ONLY = argv.includes('--gate-only');
const ONLY = arg('ids')?.split(',').map(Number);

const QUEST = 'Regicide';
const ARDOUGNE_BANK = { x: 2655, z: 3283, level: 0 };
const REGICIDE_COMPLETE = 15;
const UPASS_COMPLETE = 10;
// Why: every orb, badge and the horn, the bits `cave_well` and the temple doors read; seeded
// alongside the stage so the journal a finished account would have is coherent.
const IBANMULTI_ALL = (1 << 22) - 1;

const STATS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
];
/** `--agility N` lowers the sticks/pitfall roll so a run exercises the retry budget. */
const STAT_LEVEL = 70;
const AGILITY = Number(arg('agility') ?? STAT_LEVEL);

// Why: the gate is checked before the spade and the sextant trio, so a missing tool would hide
// behind it in the shut phase and replace it in the open one. Hand over the lot up front.
const KIT: readonly (readonly [string, number])[] = [
    ['spade', 1],
    ['trail_sextant', 1],
    ['trail_watch', 1],
    ['trail_chart', 1],
    ['shark', 12],
    ['coins', 50_000]
];

const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 500_000 },
    { debugName: 'shark', displayName: 'Shark', qty: 40 },
    { debugName: 'spade', displayName: 'Spade', qty: 1 },
    { debugName: 'trail_sextant', displayName: 'Sextant', qty: 1 },
    { debugName: 'trail_watch', displayName: 'Watch', qty: 1 },
    { debugName: 'trail_chart', displayName: 'Chart', qty: 1 },
    // Why: rune chain and med helm, not plate and full helm; those two want Dragon Slayer and
    // `Equipment.equip` refuses them without a word.
    { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 },
    { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
    { debugName: 'rune_platelegs', displayName: 'Rune platelegs', qty: 1 },
    { debugName: 'rune_med_helm', displayName: 'Rune med helm', qty: 1 },
    { debugName: 'rune_kiteshield', displayName: 'Rune kiteshield', qty: 1 }
];

const IDS = Object.keys(CLUE_GATES)
    .map(Number)
    .filter(id => CLUE_GATES[id]!.quest === QUEST)
    .filter(id => ONLY === undefined || ONLY.includes(id))
    .sort((a, b) => a - b);

const rx = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The block `clueGate` writes while the quest is unfinished. */
const gateLine = (id: number): RegExp => new RegExp(`${rx(CLUE_GATES[id]!.reason)}\\s*\\(${QUEST} reads`, 'i');
const ANY_GATE_RE = new RegExp(`${QUEST} reads`, 'i');
const ABANDON_RE = /abandoning [^:]+: (.+)$/;
// Why: ClueSolver logs this only after SolveClue reports 'clue solved', so it is the one line
// Why: that means the trail finished rather than the walk merely progressing.
const SOLVED_RE = /trail done . returning to the/i;
/** How close counts as having reached the dig site or the NPC anchor. */
const ARRIVED_TILES = 6;

interface Dest { x: number; z: number; level: number }

function destination(id: number): Dest {
    const row = CLUE_DB[id]!;
    if (row.coord) {
        return { ...row.coord };
    }
    const anchor = TALK_ANCHORS[id];
    if (!anchor) {
        fail(`clue ${id} has neither a coord nor a talk anchor`);
    }
    return { x: anchor.x, z: anchor.z, level: anchor.level };
}

const cheb = (a: Dest, b: Dest): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const NAV_STOP_RE = /no path to|unreachable|walk timed out|could not stand/i;

type Abi = {
    rs2b0t: {
        runner: { start(s: unknown): void; stop(reason: string): void; state: string; ctx: { log: { msg: string }[] } | null };
        registry: { get(n: string): unknown };
    };
    __rs2b0t: {
        Inventory: { items(): { id: number; name: string | null }[] };
        Quests: { status(n: string): string };
        Game: { tile(): Dest | null };
    };
};

const LOADOUT_NAME = 'tirannwn-clue';

// Why: ClueSolver reads its food through `scriptFood`, which resolves the LOADOUT, not a `food`
// Why: setting. With no loadout defined it falls back to '' and `isFood` answers false for every
// Why: item, so Sustain never eats and the bot walks Isafdar foodless until a trap kills it.
async function seedLoadout(page: Page): Promise<void> {
    const ok = await page.evaluate(name => {
        const g = globalThis as never as {
            __rs2b0t: { Loadouts: { save(l: readonly unknown[]): void; byName(n: string): unknown } };
        };
        g.__rs2b0t.Loadouts.save([{
            name,
            worn: {
                righthand: 'Rune scimitar',
                torso: 'Rune chainbody',
                legs: 'Rune platelegs',
                head: 'Rune med helm',
                lefthand: 'Rune kiteshield'
            },
            carry: [{ item: 'Shark', qty: 12 }]
        }]);
        return g.__rs2b0t.Loadouts.byName(name) !== null;
    }, LOADOUT_NAME);
    if (!ok) {
        fail(`loadout '${LOADOUT_NAME}' did not save — ClueSolver would run foodless`);
    }
    console.log(`  loadout '${LOADOUT_NAME}': Shark x12 + rune gear`);
}

const t0 = Date.now();
const stamp = (): string => `[${Math.round((Date.now() - t0) / 1000)}s]`;

const questStatus = (page: Page): Promise<string> =>
    page.evaluate(n => (globalThis as never as Abi).__rs2b0t.Quests.status(n), QUEST);

// Why: `ScriptRunner.start` builds a fresh ScriptContext per run, so the log always starts at 0
// Why: for this leg. An offset carried over from the previous leg slices every line away.
const logLines = (page: Page): Promise<string[]> =>
    page.evaluate(() => ((globalThis as never as Abi).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));

const holdsClue = (page: Page, id: number): Promise<boolean> =>
    page.evaluate(n => (globalThis as never as Abi).__rs2b0t.Inventory.items().some(i => i.id === n), id);

async function seedClue(page: Page, id: number): Promise<void> {
    await dropInvMatching(page, /clue|casket/i);
    for (let attempt = 0; attempt < 4 && !(await holdsClue(page, id)); attempt++) {
        await cheatQuiet(page, `give ${CLUE_DB[id]!.obj}`);
    }
    if (!(await holdsClue(page, id))) {
        fail(`could not seed clue ${id} (${CLUE_DB[id]!.obj})`);
    }
}

interface LegOutcome {
    /** Every runner line the leg produced. */
    lines: string[];
    /** The reason on the first `abandoning …:` line, or null if none landed. */
    abandon: string | null;
    solved: boolean;
    gate: boolean;
    /** Closest the player got to the clue's own coord, which is the Isafdar crossing proved. */
    nearest: number;
    /** The seeded clue left the pack, so its step completed rather than being abandoned on. */
    consumed: boolean;
    /** ClueExecutor logged its `leg N ... solving` line, which it only reaches past `blockReason`. */
    pastGate: boolean;
}

/** Run ClueSolver on the held clue until it abandons, solves, or the budget runs out.
 *  `diagMs` stops the leg that many ms after the solve line, so the open phase does not sit
 *  through four walk attempts at 45s each on a destination the pack cannot route to. */
async function runLeg(page: Page, id: number, budgetMs: number, diagMs?: number): Promise<LegOutcome> {
    await ensureRunnerStopped(page);
    const dest = destination(id);
    let nearest = 9999;
    await page.evaluate(() => {
        const g = (globalThis as never as Abi).rs2b0t;
        g.runner.start(g.registry.get('ClueSolver'));
    });

    const pastGateRe = new RegExp(`leg \\d+ . solving .*\\[${id}\\]`);
    const deadline = Date.now() + budgetMs;
    let seen = 0;
    let abandon: string | null = null;
    let solved = false;
    let pastGate = false;
    let diagDeadline: number | null = null;
    while (Date.now() < deadline) {
        await page.waitForTimeout(2000);
        const at = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Game.tile());
        if (at && at.level === dest.level) {
            nearest = Math.min(nearest, cheb(at, dest));
        }
        const lines = await logLines(page);
        for (const line of lines.slice(seen)) {
            console.log(`    ${line}`);
            const hit = ABANDON_RE.exec(line);
            if (hit && abandon === null) {
                abandon = hit[1]!.trim();
            }
            if (SOLVED_RE.test(line)) {
                solved = true;
            }
            if (pastGateRe.test(line)) {
                pastGate = true;
            }
        }
        seen = lines.length;
        if (abandon !== null || solved) {
            break;
        }
        if (pastGate && diagMs !== undefined) {
            diagDeadline ??= Date.now() + diagMs;
            if (Date.now() >= diagDeadline) {
                break;
            }
        }
    }
    const lines = await logLines(page);
    const consumed = !(await holdsClue(page, id));
    await ensureRunnerStopped(page);
    return { lines, abandon, solved, pastGate, nearest, consumed, gate: lines.some(l => ANY_GATE_RE.test(l)) };
}

/** The first nav line worth quoting, so the open phase reports why the walk stopped. */
function navDiagnosis(lines: readonly string[]): string | null {
    return lines.find(l => NAV_STOP_RE.test(l))?.replace(/^\[clue\]\s*/, '') ?? null;
}

interface Result {
    id: number;
    phase: 'shut' | 'open';
    ok: boolean;
    detail: string;
}

const results: Result[] = [];
const record = (r: Result): void => {
    results.push(r);
    console.log(`${stamp()} ${r.ok ? 'PASS' : 'FAIL'} ${r.phase} ${r.id}: ${r.detail}`);
};

const proof = createHarnessProof({ issue: 0, slug: 'tirannwn-clue-gate' });
const client = deployIsolatedClient(`tircg-${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser({ swiftshader: true });

try {
    await proof.ensureDirs();
    const user = `tcg${Date.now().toString(36).slice(-6)}`;
    console.log(`tirannwn-clue-gate base=${base} clues=${IDS.join(',')} tick=${TICK_MS}ms user=${user}`);

    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await mainlandAccount(page, base, user, client.page);
    await setTickRate(page, TICK_MS);

    for (const skill of STATS) {
        await cheatQuiet(page, `setstat ${skill} ${skill === 'agility' ? AGILITY : STAT_LEVEL}`);
    }
    if (AGILITY !== STAT_LEVEL) {
        console.log(`  agility ${AGILITY} (rest ${STAT_LEVEL}) — trap rolls will fail more often`);
    }
    await clearChatDialogs(page, 'level-up dialog(s)');
    await giveItems(page, KIT);
    await seedItemsToBank(page, BANK_SEED, ARDOUGNE_BANK);
    await seedLoadout(page);
    await setSettings(page, 'ClueSolver', { loadout: LOADOUT_NAME, foodWithdraw: 12, restorePrayer: true, useTeleports: true });

    // Why: `unknown` is the quest tab unread, and it would shut the gate for the wrong reason,
    // which would let the shut phase pass on an account whose journal was never loaded.
    const before = await questStatus(page);
    console.log(`${stamp()} ${QUEST} reads ${before}`);
    if (before === 'unknown') {
        fail(`${QUEST} reads unknown — the quest tab never loaded, so neither phase would mean anything`);
    }
    if (before === 'complete') {
        fail(`${QUEST} already reads complete on a fresh account — nothing to open`);
    }

    console.log(`\n════ phase 1: ${QUEST} ${before} — the gate must shut ════`);
    for (const id of IDS) {
        console.log(`\n══ ${id} ${CLUE_DB[id]!.obj}`);
        if (!(await teleTo(page, ARDOUGNE_BANK, 10, 25_000))) {
            fail(`tele to the Ardougne bank did not arrive before clue ${id}`);
        }
        await seedClue(page, id);
        const leg = await runLeg(page, id, SHUT_MS);
        if (leg.pastGate) {
            record({ id, phase: 'shut', ok: false, detail: 'reached the solve step — the gate let it through' });
        } else if (leg.abandon === null) {
            record({ id, phase: 'shut', ok: false, detail: `no abandon inside ${SHUT_MS / 1000}s — the gate never fired` });
        } else if (!gateLine(id).test(leg.abandon)) {
            record({ id, phase: 'shut', ok: false, detail: `abandoned on '${leg.abandon}', which is not the ${QUEST} gate` });
        } else {
            record({ id, phase: 'shut', ok: true, detail: leg.abandon });
        }
    }

    console.log(`\n${stamp()} seeding ${QUEST} complete`);
    await cheatQuiet(page, `setvar upass ${UPASS_COMPLETE}`);
    await cheatQuiet(page, `setvar ibanmulti ${IBANMULTI_ALL}`);
    await cheatQuiet(page, `setvar regicide_quest ${REGICIDE_COMPLETE}`);
    const stage = await getServerVarQuiet(page, 'regicide_quest');
    if (stage !== REGICIDE_COMPLETE) {
        fail(`setvar regicide_quest ${REGICIDE_COMPLETE} did not take (read back ${stage})`);
    }
    // Why: only the login script's ~update_questlist recolours the row a setvar moved, and that
    // colour is all Quests.status reads.
    await relog(page, user);
    await clearChatDialogs(page, 'post-relog dialog(s)');
    await setTickRate(page, TICK_MS);

    const after = await questStatus(page);
    console.log(`${stamp()} ${QUEST} reads ${after}`);
    if (after !== 'complete') {
        fail(`${QUEST} reads ${after} after the seed and relog — the open phase would prove nothing`);
    }

    console.log(`\n════ phase 2: ${QUEST} complete — the gate must open ════`);
    for (const id of IDS) {
        console.log(`\n══ ${id} ${CLUE_DB[id]!.obj}`);
        if (!(await teleTo(page, ARDOUGNE_BANK, 10, 25_000))) {
            fail(`tele to the Ardougne bank did not arrive before clue ${id}`);
        }
        await seedClue(page, id);
        const leg = await runLeg(page, id, OPEN_MS, GATE_ONLY ? DIAG_MS : undefined);
        if (leg.gate) {
            record({ id, phase: 'open', ok: false, detail: `still gated: ${leg.abandon ?? 'gate line with no abandon'}` });
            continue;
        }
        const reached = leg.nearest <= ARRIVED_TILES;
        // Why: the log line alone would pass on a trail that solved some other clue, and the
        // Why: distance alone would pass on a walk that arrived and then failed the dig. Both,
        // Why: plus the seeded clue leaving the pack, is what "this clue was solved" means.
        if (reached && leg.consumed) {
            record({
                id,
                phase: 'open',
                ok: true,
                detail: `solved: reached ${leg.nearest} tiles from (${destination(id).x},${destination(id).z}), clue consumed`
                    + `${leg.solved ? ', trail done' : ''}`
            });
            continue;
        }
        // Why: no gate line is absence of evidence, and a leg that died in the bank stop would show
        // the same. The `leg N ... solving` line is the positive one: ClueExecutor logs it on the
        // statement after `blockReason` returns null.
        const stopped = leg.abandon ?? navDiagnosis(leg.lines) ?? `still going at ${OPEN_MS / 1000}s`;
        if (!leg.pastGate) {
            record({ id, phase: 'open', ok: false, detail: `never reached the solve step: ${stopped}` });
            continue;
        }
        // Why: --gate-only stops at the gate verdict and reports the walk. It is for bisecting a
        // Why: regression, not for judging the clue, so the default run fails here until it solves.
        const how = `nearest=${leg.nearest === 9999 ? 'never on level' : leg.nearest} consumed=${leg.consumed}`;
        record({
            id,
            phase: 'open',
            ok: GATE_ONLY,
            detail: GATE_ONLY
                ? `past the gate, then '${stopped}' (gate-only: not a solve)`
                : `did not solve: ${stopped} [${how}]`
        });
    }

    const pass = results.filter(r => r.ok).length;
    console.log(`\n── summary ${pass}/${results.length} ──`);
    for (const r of results) {
        console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.phase} ${r.id} ${CLUE_DB[r.id]!.obj}: ${r.detail}`);
    }

    const payload = { legs: results, quest: QUEST, gateOnly: GATE_ONLY, base };
    if (pass === results.length) {
        await proof.writeSuccess(page, payload);
        console.log(`proof=${proof.paths.successProof}`);
        console.log(`PASS tirannwn-clue-gate ${pass}/${results.length}`);
    } else {
        await proof.writeFailure(page, payload);
        process.exit(1);
    }
} catch (e) {
    console.error(e);
    process.exit(1);
} finally {
    await browser.close();
    client.cleanup();
}
