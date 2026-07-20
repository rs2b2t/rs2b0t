import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Traversal } from '../api/Traversal.js';
import { Locs } from '../api/queries/Locs.js';
import { Npcs } from '../api/queries/Npcs.js';
import { bus } from '../events/EventBus.js';
import { countMatching } from './ArdyFighterLogic.js';
import {
    CAKE_ITEMS, LOCKOUT_TICKS, RESET_TILE, STALL_NAME, STALL_OP, STALL_TILE, STAND,
    classifySteal, shouldReset
} from './CakeStallLogic.js';

/**
 * The shared Baker's-stall steal driver (2026-07-20 design) — the base
 * implementation CakeThiever proves live and ArdyThiever/ArdyFighter reuse.
 *
 * Shape: do our best to stand on THE stand (one bounded claim walk — never
 * loop on exact-tile arrival, that was the old wedge), click Steal-from, and
 * classify what actually happened (CakeStallLogic.classifySteal) instead of
 * predicting the Baker's line of sight:
 *  - success  -> keep going
 *  - caught   -> return 'combat'; the caller's Flee/Fight task owns it
 *  - lockout  -> wait out the engine's 10-tick post-combat window
 *  - refused  -> free (no damage); after RESET_AFTER_REFUSALS in a row, walk
 *               to RESET_TILE until the Baker drifts off the stand, come back
 *
 * Callers may feed `lockedOutUntil` (last combat end + LOCKOUT_TICKS) to skip
 * the first refused click after a fight; without it the driver self-heals off
 * the lockout chat line.
 */

const DEADLINE_MS = 90_000; // one execute()'s worth of stealing; caller re-enters
const CLAIM_TIMEOUT_MS = 5_000;
const RESOLVE_MS = 2_400; // attempt-mes -> p_arrivedelay -> p_delay(0) -> loot, ~4 ticks
const RESTOCK_WAIT_MS = 8_000; // stall respawn is 8 ticks base, playercount-scaled
const RESET_WAIT_MS = 10_000; // Baker wander-out bound while parked on RESET_TILE
const OWNER = 'Baker';
const OWNER_RANGE = 5; // the engine's catch radius

const ATTEMPT_RE = /you attempt to steal/i;
const LOCKOUT_RE = /can't steal from the market stall during combat/i;

export type StealCakesResult = 'stocked' | 'combat' | 'aborted' | 'no-progress';

export interface StealCakesOptions {
    /** Stop once carried stall food reaches this (or the pack fills). */
    fillTo: number;
    /** Bail signal (death, random event, open dialog...) — checked between actions. */
    abort: () => boolean;
    /** Caller's eat gate: true -> return 'aborted' so its eat task runs. */
    shouldEat?: () => boolean;
    /** Game tick before which steals are engine-refused (last combat end + 10). */
    lockedOutUntil?: () => number;
    setStatus: (s: string) => void;
    log: (m: string) => void;
    onSteal?: () => void;
    onReset?: () => void;
}

/** Carried stall food, bite-stages included — the count `fillTo` is against. */
export function carriedCakes(): number {
    return countMatching(Inventory.items(), CAKE_ITEMS);
}

/** The stocked stall (the emptied respawn variant drops the Steal-from op). */
function stockedStall() {
    return Locs.query()
        .name(STALL_NAME)
        .action(STALL_OP)
        .where(l => l.tile().distanceTo(STALL_TILE) <= 3)
        .nearest();
}

/** Baker inside the engine's catch radius of the stand (position only — no
 *  LOS modelling; the reset wait just outlasts him). */
function bakerNearStand(): boolean {
    return Npcs.query().name(OWNER).where(n => n.tile().distanceTo(STAND) <= OWNER_RANGE).nearest() !== null;
}

export async function stealCakes(opts: StealCakesOptions): Promise<StealCakesResult> {
    let refusals = 0;
    let selfLockout = 0; // learned from the lockout chat line when the caller has no tracking
    let attemptSeen = false;
    let lockoutSeen = false;
    const unsub = bus.on('chat.message', e => {
        if (ATTEMPT_RE.test(e.text)) {
            attemptSeen = true;
        }
        if (LOCKOUT_RE.test(e.text)) {
            lockoutSeen = true;
        }
    });
    try {
        const deadline = performance.now() + DEADLINE_MS;
        while (performance.now() < deadline) {
            if (opts.abort() || opts.shouldEat?.()) {
                return 'aborted';
            }
            if (Game.inCombat()) {
                return 'combat';
            }
            if (Inventory.isFull() || carriedCakes() >= opts.fillTo) {
                opts.log(`stocked ${carriedCakes()} stall food`);
                return 'stocked';
            }

            // Engine lockout: don't spam clicks the server will refuse.
            const until = Math.max(opts.lockedOutUntil?.() ?? 0, selfLockout);
            if (Game.tick() < until) {
                opts.setStatus('waiting out the post-combat steal lockout');
                await Execution.delayUntil(() => Game.tick() >= until || opts.abort(), 12_000);
                continue;
            }

            // Best-effort claim of THE stand: one bounded walk per pass. On a
            // walk hiccup we still steal from here — the click's server-walk
            // covers the last step — and re-try the claim next pass.
            const here = Game.tile();
            if (here && STAND.distanceTo(here) > 0) {
                await Traversal.walkTo(STAND, { radius: 0, timeoutMs: CLAIM_TIMEOUT_MS, log: m => opts.log(`  ${m}`) });
            }

            const stall = stockedStall();
            if (!stall) {
                // Emptied by our own steal — condition-wait for the respawn.
                await Execution.delayUntil(() => stockedStall() !== null || opts.abort(), RESTOCK_WAIT_MS);
                continue;
            }

            attemptSeen = false;
            lockoutSeen = false;
            const before = carriedCakes();
            opts.setStatus(`stealing cake (${before}/${opts.fillTo})`);
            if (!(await stall.interact(STALL_OP))) {
                refusals++;
                await Execution.delayTicks(1);
            } else {
                await Execution.delayUntil(() => carriedCakes() > before || Game.inCombat() || lockoutSeen, RESOLVE_MS);
                const outcome = classifySteal({ gained: carriedCakes() > before, combat: Game.inCombat(), lockoutSeen, attemptSeen });
                if (outcome === 'success') {
                    refusals = 0;
                    opts.onSteal?.();
                    continue;
                }
                if (outcome === 'caught') {
                    return 'combat';
                }
                if (outcome === 'lockout') {
                    selfLockout = Game.tick() + LOCKOUT_TICKS;
                    continue;
                }
                refusals++; // 'refused' | 'timeout' — both free, both count toward the reset
            }

            if (shouldReset(refusals)) {
                opts.setStatus('watched — resetting off the stall');
                opts.log(`${refusals} refused steals — resetting at ${RESET_TILE.x},${RESET_TILE.z} until the Baker drifts`);
                opts.onReset?.();
                await Traversal.walkTo(RESET_TILE, { radius: 1, timeoutMs: 15_000, log: m => opts.log(`  ${m}`) });
                await Execution.delayUntil(() => !bakerNearStand() || opts.abort(), RESET_WAIT_MS);
                refusals = 0;
            }
        }
        return 'no-progress';
    } finally {
        unsub();
    }
}
