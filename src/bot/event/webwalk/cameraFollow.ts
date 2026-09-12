// Client-only path facing, using the cinema camera yaw formula and frame-rate smoothing.

import { actions, reader } from '../../adapter/ClientAdapter.js';
import { BotHost } from '../../runtime/BotHost.js';
import { SettingsStore } from '../../runtime/Settings.js';

/** Scene-unit / tile delta to orbit camera yaw (0-2047). */
export function yawTowardDelta(dx: number, dz: number): number {
    if (dx === 0 && dz === 0) {
        return 0;
    }
    return ((Math.atan2(dx, dz) * -325.949) | 0) & 0x7ff;
}

/** Shortest signed yaw delta in (-1024, 1024]. */
export function yawDelta(from: number, to: number): number {
    let d = (to - from) & 0x7ff;
    if (d > 1024) {
        d -= 2048;
    }
    return d;
}

/** Step current yaw toward target by at most maxStep units (one-shot helper / tests). */
export function stepYaw(current: number, target: number, maxStep: number): number {
    if (maxStep <= 0) {
        return target & 0x7ff;
    }
    const d = yawDelta(current, target);
    if (d > maxStep) {
        return (current + maxStep) & 0x7ff;
    }
    if (d < -maxStep) {
        return (current - maxStep) & 0x7ff;
    }
    return target & 0x7ff;
}

/** Ease one frame toward the target with proportional gain and velocity damping. */
export function easeYaw(
    current: number,
    target: number,
    velocity: number,
    opts?: { gain?: number; maxSpeed?: number; damping?: number; deadzone?: number }
): { yaw: number; velocity: number } {
    const gain = opts?.gain ?? 0.14;
    const maxSpeed = opts?.maxSpeed ?? 18;
    const damping = opts?.damping ?? 0.72;
    const deadzone = opts?.deadzone ?? 6;

    const err = yawDelta(current, target);
    if (Math.abs(err) <= deadzone && Math.abs(velocity) < 1) {
        return { yaw: current & 0x7ff, velocity: 0 };
    }

    // Match the client's +/-24 yaw-velocity scale.
    let desired = err * gain;
    if (desired > maxSpeed) {
        desired = maxSpeed;
    } else if (desired < -maxSpeed) {
        desired = -maxSpeed;
    }

    // Blend toward the target velocity for smooth acceleration.
    let v = velocity * damping + desired * (1 - damping);
    if (Math.abs(v) < 0.15) {
        v = 0;
    }

    // Key-driven camera motion applies half the velocity each frame.
    const next = (current + Math.round(v / 2)) & 0x7ff;
    return { yaw: next, velocity: v };
}

export interface TileLike {
    x: number;
    z: number;
    level?: number;
}

/** A look-ahead tile so the camera tracks the route; less twitchy on diagonals and switchbacks. */
export function lookAheadTile(tiles: TileLike[], pathIdx: number, lookAhead = 12): TileLike | null {
    if (tiles.length === 0) {
        return null;
    }
    const i = Math.min(tiles.length - 1, Math.max(0, pathIdx) + Math.max(1, lookAhead));
    return tiles[i] ?? null;
}

// Why: stop at same-plane coordinate jumps so remote dungeon landings do not pull the camera.
const TRANSPORT_JUMP_TILES = 32;

function isTransportBoundary(a: TileLike, b: TileLike): boolean {
    if (a.level !== undefined && b.level !== undefined && a.level !== b.level) {
        return true;
    }
    // Explicit transport waypoint (PathStep carries transport metadata).
    if ((b as TileLike & { transport?: unknown }).transport) {
        return true;
    }
    const dx = Math.abs(b.x - a.x);
    const dz = Math.abs(b.z - a.z);
    return Math.max(dx, dz) >= TRANSPORT_JUMP_TILES;
}

// Average until the next hop or discontinuity to smooth zigzags.

/** Average heading from `from` across several path tiles ahead. */
export function pathFacingYaw(
    from: TileLike,
    tiles: TileLike[],
    pathIdx: number,
    lookAhead = 12
): number | null {
    if (tiles.length === 0) {
        return null;
    }
    const start = Math.max(0, pathIdx) + 1;
    const end = Math.min(tiles.length - 1, Math.max(0, pathIdx) + Math.max(2, lookAhead));
    if (start > end) {
        return null;
    }
    let dx = 0;
    let dz = 0;
    let n = 0;
    let prev: TileLike = from;
    for (let i = start; i <= end; i++) {
        const t = tiles[i]!;
        // Do not average across a transport or level hop.
        if (isTransportBoundary(prev, t)) {
            break;
        }
        if (from.level !== undefined && t.level !== undefined && from.level !== t.level) {
            break;
        }
        dx += t.x - from.x;
        dz += t.z - from.z;
        n++;
        prev = t;
    }
    if (n === 0 || (dx === 0 && dz === 0)) {
        return null;
    }
    return yawTowardDelta(dx, dz);
}

/** Orbit yaw facing from `from` toward `to` on the same level; null for the same tile or a level hop. */
export function yawTowardTiles(from: TileLike, to: TileLike): number | null {
    if (from.level !== undefined && to.level !== undefined && from.level !== to.level) {
        return null;
    }
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (dx === 0 && dz === 0) {
        return null;
    }
    return yawTowardDelta(dx, dz);
}

/** How far desired yaw may jump before we retarget (reduces micro-chatter). */
const TARGET_RETARGET_MIN = 28;
// Why: walk follow samples once per loop then `delayTicks(2)`, about 1200 ms at 600 ms ticks, so this must exceed that interval with margin or the camera freeze-starts.

/** Stop driving the camera this long after the last path sample (walk ended or stalled). */
const STALE_MS = 3000;

/** Frame-driven path camera: WalkExecutor publishes a heading and this eases orbit yaw each frame while Global.navCameraFollow is on. */
class PathCameraFollowImpl {
    private hooked = false;
    private active = false;
    private desiredYaw: number | null = null;
    private velocity = 0;
    private lastSampleAt = 0;

    enable(): void {
        if (this.hooked) {
            return;
        }
        this.hooked = true;
        BotHost.addFrameListener(() => this.onFrame());
    }

    /** Latest path-facing yaw from the walk follow loop; no-op when the setting is off. */
    samplePathYaw(yaw: number): void {
        if (!SettingsStore.globalBag().bool('navCameraFollow', false)) {
            this.release();
            return;
        }
        this.enable();
        this.active = true;
        this.lastSampleAt = performance.now();

        if (this.desiredYaw === null) {
            this.desiredYaw = yaw & 0x7ff;
            return;
        }
        // Ignore small heading changes so straight corridors do not retarget every tile.
        if (Math.abs(yawDelta(this.desiredYaw, yaw)) >= TARGET_RETARGET_MIN) {
            this.desiredYaw = yaw & 0x7ff;
        }
    }

    /** Call when a walkTo finishes so the camera coasts to a stop. */
    release(): void {
        this.active = false;
        this.desiredYaw = null;
        this.velocity = 0;
    }

    private onFrame(): void {
        if (!this.active || this.desiredYaw === null) {
            return;
        }
        if (!SettingsStore.globalBag().bool('navCameraFollow', false)) {
            this.release();
            return;
        }
        if (!reader.ingame()) {
            return;
        }
        if (performance.now() - this.lastSampleAt > STALE_MS) {
            // Walk stopped sampling, let residual velocity die, then idle.
            this.velocity *= 0.6;
            if (Math.abs(this.velocity) < 0.5) {
                this.release();
            }
            return;
        }

        const current = reader.cameraYaw();
        const next = easeYaw(current, this.desiredYaw, this.velocity);
        this.velocity = next.velocity;
        if (next.yaw !== current || Math.abs(this.velocity) > 0.2) {
            actions.setCameraYaw(next.yaw);
        }
    }
}

export const PathCameraFollow = new PathCameraFollowImpl();
