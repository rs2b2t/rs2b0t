import type { Profile } from './Profile.js';
import type { Prng } from './Prng.js';

/**
 * The classic WindMouse trajectory generator (BenLand100): a point mass
 * pulled toward the destination by gravity while a random wind force drifts
 * it sideways; wind damps near the target so the cursor settles instead of
 * orbiting. Output is one point per VirtualInput tick (20ms), so maxStep
 * directly caps cursor speed in px / 20ms.
 */
export function windMouse(sx: number, sy: number, dx: number, dy: number, profile: Profile, rand: Prng): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = [];

    let x = sx;
    let y = sy;
    let vx = 0;
    let vy = 0;
    let wx = 0;
    let wy = 0;

    const gravity = profile.gravity;
    let wind = profile.wind;
    const maxStep = Math.max(4, profile.maxStep);
    const targetArea = Math.max(4, profile.targetArea);
    const sqrt2 = Math.SQRT2;
    const sqrt3 = Math.sqrt(3);
    const sqrt5 = Math.sqrt(5);

    for (let i = 0; i < 2000; i++) {
        const dist = Math.hypot(dx - x, dy - y);
        if (dist < 1) {
            break;
        }

        wind = Math.min(wind, dist);
        if (dist >= targetArea) {
            wx = wx / sqrt3 + ((rand.next() * (wind * 2 + 1) - wind) / sqrt5);
            wy = wy / sqrt3 + ((rand.next() * (wind * 2 + 1) - wind) / sqrt5);
        } else {
            wx /= sqrt2;
            wy /= sqrt2;
        }

        vx += wx + (gravity * (dx - x)) / dist;
        vy += wy + (gravity * (dy - y)) / dist;

        const speed = Math.hypot(vx, vy);
        // settle: cap speed near the target so we don't overshoot every time
        const cap = dist < targetArea ? Math.max(2, dist / 2 + rand.next() * 2) : maxStep;
        if (speed > cap) {
            const clipped = cap / 2 + rand.next() * (cap / 2);
            vx = (vx / speed) * clipped;
            vy = (vy / speed) * clipped;
        }

        x += vx;
        y += vy;
        points.push({ x, y });
    }

    points.push({ x: dx, y: dy });
    return points;
}
