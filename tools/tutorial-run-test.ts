// The growing full-run tutorial integration test. A fresh account starts
// TutorialBot and we assert the tutorial-stage varp reaches TARGET.
//
// Task 2 (this scaffold) leaves the assertion deliberately FAILING:
// TutorialBot only observes the varp, so a fresh account sits at 0 forever
// and this correctly reports "reached tutorial=0" — proof the harness
// detects "no progress" rather than rubber-stamping a pass. Later tasks add
// stage tasks to TutorialBot and bump TARGET (final = the tutorial-complete
// value) as each stage is proven end to end. See docs/tutorial-map.md.
//
// Usage: bun tools/tutorial-run-test.ts [base-url] [varp-index] [target] [timeout-ms]
//
// The timeout arg lets a "confirm no progress" check finish in seconds instead
// of the multi-minute patience a real full run needs — e.g. a do-nothing
// scaffold provably stays at varp=0, so `... 281 1 15000` reports the intended
// "reached tutorial=0" within ~15s. Defaults to 15 min for real full runs.

import { chromium } from 'playwright-core';
import { bootAndLogin, startScript, runToVarp, tutorialVarp } from './tutorial/harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const TUTORIAL_VARP = Number(process.argv[3] ?? 281); // keep in sync with docs/tutorial-map.md
const TARGET = Number(process.argv[4] ?? 1); // bumped per task; final = tutorial_complete value
const TIMEOUT_MS = Number(process.argv[5] ?? 15 * 60_000); // full-run patience; override for fast "no progress" checks

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log(`pageerror: ${e}`));

await bootAndLogin(page, base, `tut${Date.now().toString(36).slice(-6)}`);
await startScript(page, 'TutorialBot');

const ok = await runToVarp(page, TUTORIAL_VARP, TARGET, TIMEOUT_MS);
const at = await tutorialVarp(page, TUTORIAL_VARP);
await browser.close();

if (!ok) {
    console.error(`FAIL: reached tutorial=${at}, wanted >=${TARGET}`);
    process.exit(1);
}
console.log(`PASS: reached tutorial=${at}`);
