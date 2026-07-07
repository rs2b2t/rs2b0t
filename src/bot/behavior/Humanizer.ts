import { actions, reader } from '../adapter/ClientAdapter.js';
import { BotHost } from '../BotHost.js';
import { Prng, seedFromName } from '../input/humanize/Prng.js';
import { Scheduler } from '../runtime/Scheduler.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';

/**
 * Host-side human-behaviour layer applied to EVERY bot (wired from main.ts,
 * like AutoRelogin). Two parts, both account-seeded so a character behaves
 * consistently:
 *
 *  - RUN ENERGY: keeps run sensibly on like a real player — runs while there's
 *    energy, lets it deplete (the engine force-walks at 0), and re-enables
 *    after it regenerates past a personality threshold, with a human reaction
 *    delay and the odd skipped re-enable. Idempotent IF_BUTTON on the controls
 *    run toggle.
 *
 *  - BREAKS: a fatigue model schedules short micro-pauses and rarer longer
 *    breaks. During a break the scheduler withholds new loop iterations
 *    (in-flight actions finish first), so the bot rests between actions rather
 *    than mid-fight. This is the main anti-detection signal — uninterrupted,
 *    perfectly-regular activity is the most bot-like thing there is.
 *
 * Breaks gate only NEW work, so the verified grind loops still make progress;
 * the first break is delayed so short functional tests rarely hit one.
 */
class HumanizerImpl {
    private enabled = false;
    private boundUser: string | null = null;
    private rand = new Prng(0xc0ffee);

    // run policy
    private runThreshold = 30; // % energy to (re)enable run; personality-set
    private runKnownOn = false;
    private runReenableAt = 0;

    // breaks
    private sessionStart = 0;
    private breakUntil = 0;
    private nextBreakAt = 0;
    private breaks = 0;
    private restMs = 0;

    enable(): void {
        if (this.enabled) {
            return;
        }
        this.enabled = true;
        this.sessionStart = performance.now();
        Scheduler.launchGate = () => this.onBreak();
        BotHost.addFrameListener(() => this.tick());
    }

    /** True while resting — consulted by the Scheduler to withhold new loops. */
    onBreak(): boolean {
        return performance.now() < this.breakUntil;
    }

    /** Test hook: start a break of `ms` right now. */
    forceBreak(ms: number): void {
        this.breakUntil = performance.now() + ms;
        this.restMs += ms;
        this.breaks++;
        ScriptRunner.ctx?.addLog('info', `human break: forced ~${Math.round(ms / 1000)}s`);
    }

    /** Total time spent on breaks this session (ms) — for the panel/tests. */
    restTotalMs(): number {
        return this.restMs;
    }

    breakCount(): number {
        return this.breaks;
    }

    private scriptActive(): boolean {
        // only while actually running — a user pause should be fully idle (no
        // run toggling, no break scheduling). Breaks themselves keep the state
        // 'running' (they gate the scheduler), so they still work.
        return ScriptRunner.state === 'running';
    }

    private bindOnce(): void {
        const user = reader.localPlayerName();
        if (!user || user === this.boundUser) {
            return;
        }

        this.boundUser = user;
        this.rand = new Prng(seedFromName(user) ^ 0x5eed);
        // personalities differ: some run-happy (low threshold), some let it
        // recover more before bothering
        this.runThreshold = Math.round(this.rand.range(20, 45));
        this.scheduleNextBreak(true);
    }

    private tick(): void {
        if (!this.enabled || !reader.ingame() || !this.scriptActive()) {
            return;
        }

        this.bindOnce();
        this.tickRun();
        this.tickBreaks();
    }

    // ---- run energy ----

    private tickRun(): void {
        const energy = reader.energy(); // 0..100
        const now = performance.now();

        if (energy <= 0) {
            // engine force-disables run at 0 energy
            this.runKnownOn = false;
            this.runReenableAt = 0;
            return;
        }

        if (this.runKnownOn) {
            return;
        }

        // run is (believed) off and we have some energy — decide when to enable
        if (energy < this.runThreshold) {
            this.runReenableAt = 0; // not enough buffer yet; wait
            return;
        }

        if (this.runReenableAt === 0) {
            // just crossed the threshold: react like a human (notice it late),
            // and occasionally not bother for a while
            const skip = this.rand.next() < 0.15;
            this.runReenableAt = now + (skip ? this.rand.range(8000, 25000) : this.rand.range(800, 4000));
            return;
        }

        if (now >= this.runReenableAt) {
            if (actions.setRun(true)) {
                this.runKnownOn = true;
                this.runReenableAt = 0;
                ScriptRunner.ctx?.addLog('info', `run enabled (energy ${energy}%)`);
            }
        }
    }

    // ---- breaks ----

    private scheduleNextBreak(first: boolean): void {
        const now = performance.now();
        // first break delayed well into the session; then every ~4-12 min of
        // activity (fatigue: intervals shorten slightly as the session grows)
        const sessionMin = (now - this.sessionStart) / 60_000;
        const fatigue = Math.min(0.4, sessionMin / 180); // up to -40% interval over 3h
        const baseMin = first ? this.rand.range(7, 14) : this.rand.range(4, 12) * (1 - fatigue);
        this.nextBreakAt = now + baseMin * 60_000;
    }

    private tickBreaks(): void {
        const now = performance.now();
        if (now < this.nextBreakAt || this.onBreak()) {
            return;
        }

        // pick a break length: mostly short micro-pauses, sometimes a longer
        // step-away, rarely a proper afk
        const roll = this.rand.next();
        let len: number;
        let kind: string;
        if (roll < 0.7) {
            len = this.rand.range(2000, 8000);
            kind = 'micro-pause';
        } else if (roll < 0.95) {
            len = this.rand.range(15000, 60000);
            kind = 'short break';
        } else {
            len = this.rand.range(90000, 240000);
            kind = 'afk break';
        }

        this.breakUntil = now + len;
        this.restMs += len;
        this.breaks++;
        ScriptRunner.ctx?.addLog('info', `human break: ${kind} ~${Math.round(len / 1000)}s`);
        this.scheduleNextBreak(false);
    }
}

export const Humanizer = new HumanizerImpl();
