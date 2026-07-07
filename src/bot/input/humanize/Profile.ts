import { Prng, seedFromName } from './Prng.js';

/**
 * Data-driven humanization profile (JSON-shaped so a future recorded/learned
 * model can implement the same interface). Every knob maps to a server-side
 * observable: WindMouse params -> move-delta magnitudes and curvature,
 * reaction/dwell -> inter-event gaps, overshoot -> correction runs, click
 * jitter -> click-position dispersion, fidgets/camera -> idle cadence.
 */
export interface Profile {
    /** WindMouse: pull toward the target per step. */
    gravity: number;
    /** WindMouse: random perpendicular drift magnitude. */
    wind: number;
    /** WindMouse: max px per 20ms step (peak cursor speed). */
    maxStep: number;
    /** WindMouse: distance under which wind damps and the cursor settles. */
    targetArea: number;

    /** Log-normal reaction before a gesture starts (ms). */
    reactionMu: number;
    reactionSigma: number;
    /** Log-normal dwell between arrival and the press (ms). */
    dwellMu: number;
    dwellSigma: number;
    /** Log-normal button hold time (ms). */
    holdMu: number;
    holdSigma: number;

    /** Overshoot probability ~ min(cap, distance/px * scale). */
    overshootScale: number;
    overshootCap: number;
    /** Overshoot passes the target by ~this fraction of the distance. */
    overshootRatio: number;

    /** Click jitter: std-dev as a fraction of the target box half-extent. */
    clickSigma: number;

    /** Mean seconds between idle fidget moves (poisson-ish). */
    fidgetMeanS: number;
    /** Fidget drift magnitude (px std-dev). */
    fidgetSigma: number;
    /** Mean seconds between idle camera nudges. */
    cameraFidgetMeanS: number;
    /** Preference for rotating left vs right (0..1, used for fidgets). */
    cameraLeftBias: number;
    /** Camera nudge hold time range (ms). */
    cameraNudgeMinMs: number;
    cameraNudgeMaxMs: number;
}

export const DEFAULT_PROFILE: Profile = {
    gravity: 9,
    wind: 3,
    maxStep: 18,
    targetArea: 12,

    reactionMu: Math.log(230),
    reactionSigma: 0.35,
    dwellMu: Math.log(120),
    dwellSigma: 0.4,
    holdMu: Math.log(85),
    holdSigma: 0.25,

    overshootScale: 0.0009,
    overshootCap: 0.3,
    overshootRatio: 0.12,

    clickSigma: 0.38,

    fidgetMeanS: 9,
    fidgetSigma: 14,
    cameraFidgetMeanS: 45,
    cameraLeftBias: 0.5,
    cameraNudgeMinMs: 120,
    cameraNudgeMaxMs: 450
};

/**
 * The per-account personality: DEFAULT_PROFILE with stable seeded variation
 * on every knob, plus the Prng all runtime draws come from. Same username ->
 * same profile and same stream of draws.
 */
export function profileFor(username: string): { profile: Profile; rand: Prng } {
    const seed = seedFromName(username || 'default');
    const rand = new Prng(seed);

    const vary = (v: number, frac: number): number => v * (1 + (rand.next() * 2 - 1) * frac);

    const profile: Profile = {
        gravity: vary(DEFAULT_PROFILE.gravity, 0.3),
        wind: vary(DEFAULT_PROFILE.wind, 0.4),
        maxStep: vary(DEFAULT_PROFILE.maxStep, 0.25),
        targetArea: vary(DEFAULT_PROFILE.targetArea, 0.3),

        reactionMu: DEFAULT_PROFILE.reactionMu + (rand.next() * 2 - 1) * 0.2,
        reactionSigma: vary(DEFAULT_PROFILE.reactionSigma, 0.3),
        dwellMu: DEFAULT_PROFILE.dwellMu + (rand.next() * 2 - 1) * 0.25,
        dwellSigma: vary(DEFAULT_PROFILE.dwellSigma, 0.3),
        holdMu: DEFAULT_PROFILE.holdMu + (rand.next() * 2 - 1) * 0.15,
        holdSigma: vary(DEFAULT_PROFILE.holdSigma, 0.3),

        overshootScale: vary(DEFAULT_PROFILE.overshootScale, 0.4),
        overshootCap: vary(DEFAULT_PROFILE.overshootCap, 0.25),
        overshootRatio: vary(DEFAULT_PROFILE.overshootRatio, 0.35),

        clickSigma: vary(DEFAULT_PROFILE.clickSigma, 0.25),

        fidgetMeanS: vary(DEFAULT_PROFILE.fidgetMeanS, 0.4),
        fidgetSigma: vary(DEFAULT_PROFILE.fidgetSigma, 0.4),
        cameraFidgetMeanS: vary(DEFAULT_PROFILE.cameraFidgetMeanS, 0.4),
        cameraLeftBias: rand.range(0.25, 0.75),
        cameraNudgeMinMs: vary(DEFAULT_PROFILE.cameraNudgeMinMs, 0.3),
        cameraNudgeMaxMs: vary(DEFAULT_PROFILE.cameraNudgeMaxMs, 0.3)
    };

    return { profile, rand };
}
