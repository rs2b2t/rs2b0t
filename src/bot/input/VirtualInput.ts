import { inject, reader, type ScreenRect } from '../adapter/ClientAdapter.js';
import { BotHost } from '../BotHost.js';
import { DEFAULT_PROFILE, profileFor, type Profile } from './humanize/Profile.js';
import { Prng } from './humanize/Prng.js';
import { windMouse } from './humanize/WindMouse.js';

/** One emitted synthetic event: move / button down / button up. */
export interface StreamEvent {
    t: number;
    x: number;
    y: number;
    e: 'm' | 'd' | 'u';
    /** Button on 'd': 1 left, 2 right. */
    b?: number;
    /** 'd' only: landed exactly on the target box center (must stay false). */
    dc?: boolean;
}

export interface StreamStats {
    windowMs: number;
    moves: number;
    moveDelta: { p50: number; p95: number; max: number };
    clicks: number;
    interClickMs: { p50: number; p95: number };
    deadCenterPct: number;
}

const RING_CAPACITY = 20000;
const FIDGET_IDLE_MS = 2500;
const FIDGET_EXPIRY_MS = 10 * 60_000;

interface Trajectory {
    points: { x: number; y: number }[];
    idx: number;
    clamp: ScreenRect | null;
    resolve: () => void;
    /** Fidgets are throwaway: cancelled by any real gesture. */
    fidget: boolean;
    /** Live goal for a moving target — re-plans the remaining flight. */
    retarget: (() => { x: number; y: number } | null) | null;
    goal: { x: number; y: number } | null;
    retargetsLeft: number;
}

/** Re-check a moving target's position every N trajectory points (~120ms). */
const RETARGET_EVERY = 6;
/** Ignore goal drift below this (px) — micro-corrections read as jitter. */
const RETARGET_MIN_DRIFT = 7;

/**
 * The synthetic mouse+keyboard (Slice 6). Holds a float virtual cursor,
 * ticks once per client frame (BotHost frame hook = once per mainloop), and
 * each tick advances the active WindMouse trajectory by exactly one point —
 * emitting at most the events a real device would (one pointermove per
 * frame, press/release pairs with humanized hold). All injection goes
 * through adapter `inject.*`, which calls the same protected GameShell
 * handlers the DOM listeners call.
 */
class VirtualInputImpl {
    /** Virtual cursor (floats; events emit the int part). */
    x = 380;
    y = 250;

    /** Per-account personality, bound to the logged-in name on first use. */
    profile: Profile = DEFAULT_PROFILE;
    rand = new Prng(0x9e3779b9);
    private profileUser: string | null = null;

    /** Telemetry ring readable from the lcbuddy global (dataset A/B bar). */
    private ring: StreamEvent[] = [];

    private trajectory: Trajectory | null = null;
    private delays: { at: number; resolve: () => void }[] = [];
    private frameWaiters: (() => void)[] = [];
    private keyHolds: { ch: number; until: () => boolean; maxAt: number; resolve: () => void }[] = [];

    private cursorInit = false;
    private lastEmittedX = -1;
    private lastEmittedY = -1;
    private buttonHeld = 0;

    private fidgetsEnabled = false;
    private lastApiCallAt = 0;
    private lastGestureAt = 0;

    constructor() {
        BotHost.addFrameListener(() => this.tick());
    }

    /** Rebind the personality to the logged-in account (stable per name). */
    bindProfile(): void {
        const user = reader.localPlayerName() ?? 'default';
        if (user === this.profileUser) {
            return;
        }

        const bound = profileFor(user);
        this.profile = bound.profile;
        this.rand = bound.rand;
        this.profileUser = user;
    }

    setFidgets(enabled: boolean): void {
        this.fidgetsEnabled = enabled;
    }

    /** Resolves on the next frame tick (after trajectory/delay processing). */
    nextFrame(): Promise<void> {
        this.touch();
        return new Promise(resolve => this.frameWaiters.push(resolve));
    }

    /** Frame-pumped sleep (NOT Execution.* — usable outside script context). */
    sleep(ms: number): Promise<void> {
        this.touch();
        if (ms <= 0) {
            return this.nextFrame();
        }

        return new Promise(resolve => this.delays.push({ at: performance.now() + ms, resolve }));
    }

    /** Mid-flight re-plans performed for moving targets (telemetry). */
    retargets = 0;

    /**
     * WindMouse the cursor to (tx, ty), one trajectory point per frame.
     * `clamp` keeps every emitted point inside a rect (used for in-menu
     * moves so the 10px auto-close band is never crossed). `retarget`
     * (moving targets) is polled mid-flight; when the goal has drifted,
     * the remaining flight re-plans from the current cursor — the throw
     * lands on where the target IS, not where it was at aim time.
     */
    moveTo(tx: number, ty: number, clamp?: ScreenRect, retarget?: () => { x: number; y: number } | null): Promise<void> {
        this.touch();
        this.lastGestureAt = performance.now();
        this.ensureCursor();
        this.cancelTrajectory();

        if (Math.hypot(tx - this.x, ty - this.y) < 1.5) {
            return Promise.resolve();
        }

        const points = windMouse(this.x, this.y, tx, ty, this.profile, this.rand);
        return new Promise(resolve => {
            this.trajectory = { points, idx: 0, clamp: clamp ?? null, resolve, fidget: false, retarget: retarget ?? null, goal: { x: tx, y: ty }, retargetsLeft: 4 };
        });
    }

    /**
     * Press+hold+release at the current cursor. `targetCenter` is the aimed
     * box center — used only to record the dead-center flag (the humanizer
     * must never land exactly there).
     */
    async click(right: boolean, targetCenter?: { x: number; y: number }): Promise<void> {
        this.touch();
        this.lastGestureAt = performance.now();
        this.ensureCursor();

        const dc = targetCenter !== undefined && (this.x | 0) === (targetCenter.x | 0) && (this.y | 0) === (targetCenter.y | 0);
        inject.mouseDown(this.x, this.y, right);
        this.buttonHeld = right ? 2 : 1;
        this.record('d', right ? 2 : 1, dc);

        await this.sleep(this.rand.logNormal(this.profile.holdMu, this.profile.holdSigma, 40, 400));

        inject.mouseUp(this.x, this.y);
        this.buttonHeld = 0;
        this.record('u');
    }

    /**
     * Hold an arrow key until `until()` holds (checked per frame) or maxMs
     * elapses. ch: 1 left, 2 right, 3 up, 4 down — keyHeld is exactly what
     * the camera reads.
     */
    holdKeyUntil(ch: number, until: () => boolean, maxMs: number): Promise<void> {
        this.touch();
        this.lastGestureAt = performance.now();
        inject.key(ch, true);
        return new Promise(resolve => {
            this.keyHolds.push({ ch, until, maxAt: performance.now() + maxMs, resolve });
        });
    }

    /** Release anything held and drop pending waits (script stop/teardown). */
    cancelAll(): void {
        this.cancelTrajectory();

        if (this.buttonHeld !== 0) {
            inject.mouseUp(this.x, this.y);
            this.buttonHeld = 0;
            this.record('u');
        }

        for (const hold of this.keyHolds) {
            inject.key(hold.ch, false);
            hold.resolve();
        }
        this.keyHolds = [];

        for (const delay of this.delays) {
            delay.resolve();
        }
        this.delays = [];

        const waiters = this.frameWaiters;
        this.frameWaiters = [];
        for (const w of waiters) {
            w();
        }
    }

    /** Raw event stream (ring buffer, newest last). */
    stream(): StreamEvent[] {
        return this.ring.slice();
    }

    /** Distribution summary over the trailing window (default 2 minutes). */
    stats(windowMs: number = 120_000): StreamStats {
        const since = performance.now() - windowMs;
        const events = this.ring.filter(ev => ev.t >= since);

        const moveDeltas: number[] = [];
        let prev: StreamEvent | null = null;
        for (const ev of events) {
            if (ev.e !== 'm') {
                continue;
            }
            if (prev) {
                moveDeltas.push(Math.hypot(ev.x - prev.x, ev.y - prev.y));
            }
            prev = ev;
        }

        const clicks = events.filter(ev => ev.e === 'd');
        const interClick: number[] = [];
        for (let i = 1; i < clicks.length; i++) {
            interClick.push(clicks[i].t - clicks[i - 1].t);
        }

        const dead = clicks.filter(c => c.dc).length;

        return {
            windowMs,
            moves: moveDeltas.length,
            moveDelta: { p50: percentile(moveDeltas, 0.5), p95: percentile(moveDeltas, 0.95), max: moveDeltas.length ? Math.max(...moveDeltas) : 0 },
            clicks: clicks.length,
            interClickMs: { p50: percentile(interClick, 0.5), p95: percentile(interClick, 0.95) },
            deadCenterPct: clicks.length ? (dead / clicks.length) * 100 : 0
        };
    }

    // ---- frame pump ----

    private tick(): void {
        const now = performance.now();

        // advance the active trajectory by one point (= one frame = ~20ms)
        const traj = this.trajectory;
        if (traj) {
            let { x, y } = traj.points[traj.idx];
            if (traj.clamp) {
                x = Math.min(traj.clamp.x + traj.clamp.w, Math.max(traj.clamp.x, x));
                y = Math.min(traj.clamp.y + traj.clamp.h, Math.max(traj.clamp.y, y));
            }
            this.x = x;
            this.y = y;
            this.emitMove();

            traj.idx++;
            if (traj.idx >= traj.points.length) {
                this.trajectory = null;
                traj.resolve();
            } else if (traj.retarget && traj.retargetsLeft > 0 && traj.idx % RETARGET_EVERY === 0) {
                // moving target: if the goal drifted, re-plan the remaining
                // flight from where the hand is now
                const fresh = traj.retarget();
                if (fresh && traj.goal && Math.hypot(fresh.x - traj.goal.x, fresh.y - traj.goal.y) >= RETARGET_MIN_DRIFT) {
                    traj.points = windMouse(this.x, this.y, fresh.x, fresh.y, this.profile, this.rand);
                    traj.idx = 0;
                    traj.goal = fresh;
                    traj.retargetsLeft--;
                    this.retargets++;
                }
            }
        }

        // due sleeps
        if (this.delays.length > 0) {
            const due = this.delays.filter(d => now >= d.at);
            this.delays = this.delays.filter(d => now < d.at);
            for (const d of due) {
                d.resolve();
            }
        }

        // key holds: release when the predicate holds or time is up
        if (this.keyHolds.length > 0) {
            const still: typeof this.keyHolds = [];
            for (const hold of this.keyHolds) {
                let done = now >= hold.maxAt;
                try {
                    done = done || hold.until();
                } catch {
                    done = true;
                }

                if (done) {
                    inject.key(hold.ch, false);
                    hold.resolve();
                } else {
                    still.push(hold);
                }
            }
            this.keyHolds = still;
        }

        // frame waiters (after state updates so pollers see this frame)
        if (this.frameWaiters.length > 0) {
            const waiters = this.frameWaiters;
            this.frameWaiters = [];
            for (const w of waiters) {
                w();
            }
        }

        this.maybeFidget(now);
    }

    /** Occasional idle drift/camera nudge so quiet stretches aren't frozen. */
    private maybeFidget(now: number): void {
        if (!this.fidgetsEnabled || this.trajectory || this.keyHolds.length > 0 || this.buttonHeld !== 0 || !reader.ingame()) {
            return;
        }
        if (now - this.lastApiCallAt < FIDGET_IDLE_MS || this.lastGestureAt === 0 || now - this.lastGestureAt > FIDGET_EXPIRY_MS) {
            return;
        }

        // ~one drift per fidgetMeanS seconds of idle (checked at 50Hz)
        if (this.rand.chance(1 / (this.profile.fidgetMeanS * 50))) {
            this.ensureCursor();
            const tx = clampScreen(this.x + this.rand.gaussian() * this.profile.fidgetSigma, 2, 763);
            const ty = clampScreen(this.y + this.rand.gaussian() * this.profile.fidgetSigma, 2, 501);
            const points = windMouse(this.x, this.y, tx, ty, this.profile, this.rand);
            this.trajectory = { points, idx: 0, clamp: null, resolve: () => {}, fidget: true, retarget: null, goal: null, retargetsLeft: 0 };
            return;
        }

        // rarer idle camera-rotation habit (arrow tap)
        if (this.rand.chance(1 / (this.profile.cameraFidgetMeanS * 50))) {
            const ch = this.rand.chance(this.profile.cameraLeftBias) ? 1 : 2;
            const holdMs = this.rand.range(this.profile.cameraNudgeMinMs, this.profile.cameraNudgeMaxMs);
            inject.key(ch, true);
            this.keyHolds.push({ ch, until: () => false, maxAt: now + holdMs, resolve: () => {} });
        }
    }

    private emitMove(): void {
        const ix = this.x | 0;
        const iy = this.y | 0;
        if (ix === this.lastEmittedX && iy === this.lastEmittedY) {
            return;
        }

        inject.mouseMove(ix, iy);
        this.lastEmittedX = ix;
        this.lastEmittedY = iy;
        this.record('m');
    }

    private cancelTrajectory(): void {
        if (this.trajectory) {
            const t = this.trajectory;
            this.trajectory = null;
            t.resolve();
        }
    }

    /** First use: adopt the real mouse position if one exists. */
    private ensureCursor(): void {
        if (this.cursorInit) {
            return;
        }

        this.cursorInit = true;
        const m = reader.mouse();
        if (m.x >= 0 && m.y >= 0) {
            this.x = m.x;
            this.y = m.y;
        }
    }

    private touch(): void {
        this.lastApiCallAt = performance.now();
        // a real gesture displaces any fidget drift in progress
        if (this.trajectory?.fidget) {
            this.cancelTrajectory();
        }
    }

    private record(e: 'm' | 'd' | 'u', b?: number, dc?: boolean): void {
        const ev: StreamEvent = { t: performance.now(), x: this.x | 0, y: this.y | 0, e };
        if (b !== undefined) {
            ev.b = b;
        }
        if (dc !== undefined) {
            ev.dc = dc;
        }

        this.ring.push(ev);
        if (this.ring.length > RING_CAPACITY) {
            this.ring.splice(0, this.ring.length - RING_CAPACITY);
        }
    }
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return sorted[idx];
}

function clampScreen(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
}

export const VirtualInput = new VirtualInputImpl();
