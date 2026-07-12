// Headless live smoke for RuneMysteries: fresh account, mainland-ready (the
// only cheats — off-island tele + tutorial varp + relog), start the script,
// and watch it walk the whole quest for real: talisman -> package -> notes ->
// journal complete + QP, script stops itself.
//
// Requires: engine on :8890 + local build deployed (deploy-local.sh).
// Budget 25 min (~12 min clean + headroom for accepted variance; see BUDGET_MS).
// In run-all-smokes sweeps this gets a longer kill timeout automatically (its
// LONG entry, 1600s); pass --timeout to override, or run it standalone.
// Usage: bun tools/rune-mysteries-test.ts [base-url] [username]

import { chromium } from 'playwright-core';
import { mainlandAccount, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `rm${Date.now().toString(36).slice(-7)}`;
// A clean run is ~11-12 min, but two ACCEPTED, unfixed-here variances stack on
// top: the wizard-tower ladder's trapped-landing re-roll (~90s each; a
// baked-collision-vs-live mismatch that fix #4 recovers from rather than
// prevents) and a random-event teleport that can bounce the bot off an NPC
// mid-dialogue (~90s round-trip). A live PASS hit BOTH at once and still
// finished at ~14.7 min; 25 min leaves headroom for an unluckier stack. This is
// budget for known variance only — the diagonal-door stall itself is fixed in
// WalkExecutor.crossMultiTileDoor, not papered over here.
const BUDGET_MS = 25 * 60_000;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type Snapshot = {
    pos: { x: number; z: number; level: number } | null;
    journal: string;
    held: string[];
    qp: number;
    runner: string;
};

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, username);
    console.log(`mainland-ready as '${username}'`);
    await startScript(page, 'RuneMysteries');
    console.log('started RuneMysteries — watching');

    const QUEST_ITEMS = ['air talisman', 'research package', 'notes'];
    // Two page globals: `__rs2b0t` is the script ABI (Quests, reader — the
    // pattern quests-tab-test uses); `rs2b0t` is the dev handle (runner —
    // the pattern flax-spinner-test uses).
    const snap = (): Promise<Snapshot> =>
        page.evaluate(items => {
            const g = globalThis as never as {
                __rs2b0t: {
                    reader: { worldTile(): { x: number; z: number; level: number } | null; inventory(): { name: string | null }[] };
                    Quests: { status(n: string): string; points(): number };
                };
                rs2b0t: { runner: { state: string } };
            };
            const names = g.__rs2b0t.reader.inventory().map(i => (i.name ?? '').toLowerCase());
            return {
                pos: g.__rs2b0t.reader.worldTile(),
                journal: g.__rs2b0t.Quests.status('Rune Mysteries Quest'),
                held: items.filter(q => names.includes(q)),
                qp: g.__rs2b0t.Quests.points(),
                runner: g.rs2b0t.runner.state
            };
        }, QUEST_ITEMS);

    const seen = { talisman: false, package: false, notes: false };
    const deadline = Date.now() + BUDGET_MS;
    let last: Snapshot | null = null;
    while (Date.now() < deadline) {
        last = await snap();
        seen.talisman ||= last.held.includes('air talisman');
        seen.package ||= last.held.includes('research package');
        seen.notes ||= last.held.includes('notes');
        const t = Math.round((BUDGET_MS - (deadline - Date.now())) / 1000);
        console.log(`  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'} journal=${last.journal} held=[${last.held.join(',')}] qp=${last.qp} runner=${last.runner}`);
        if (last.journal === 'complete' && last.runner !== 'running') { break; }
        await page.waitForTimeout(10_000);
    }

    if (!last) { fail('no snapshot'); }
    if (!seen.talisman) { fail('never held the Air talisman (Duke leg failed)'); }
    if (!seen.package) { fail('never held the Research package (first Sedridor leg failed)'); }
    if (!seen.notes) { fail('never held the Notes (Aubury legs failed)'); }
    if (last.journal !== 'complete') { fail(`journal is '${last.journal}', expected 'complete'`); }
    if (last.qp < 1) { fail(`quest points ${last.qp}, expected >= 1`); }
    if (last.runner === 'running') { fail('script did not stop itself after completion'); }
    console.log(`PASS (Rune Mysteries: talisman -> package -> notes -> journal complete, QP=${last.qp}, clean stop)`);
} finally {
    await browser.close();
}
