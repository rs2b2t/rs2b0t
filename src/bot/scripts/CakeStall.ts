import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Traversal } from '../api/Traversal.js';
import { Locs } from '../api/queries/Locs.js';
import { bus } from '../events/EventBus.js';
import { countMatching } from './ArdyFighterLogic.js';
import {
    CAKE_ITEMS, LOCKOUT_TICKS, STALL_NAME, STALL_OP, STALL_TILE, STAND, STAND_ALT,
    classifySteal, shouldReset
} from './CakeStallLogic.js';

/**
 * The shared Baker's-stall steal driver (2026-07-20 design) — the base
 * implementation CakeThiever proves live and ArdyThiever/ArdyFighter reuse.
 *
 * Shape: do our best to stand on the current stand (one bounded claim walk —
 * never loop on exact-tile arrival, that was the old wedge), click
 * Steal-from, and classify what actually happened
 * (CakeStallLogic.classifySteal) instead of predicting line of sight:
 *  - success  -> keep going
 *  - caught   -> return 'combat'; the caller's Flee/Fight task owns it
 *  - lockout  -> wait out the engine's 10-tick post-combat window
 *  - refused  -> free (no damage); after RESET_AFTER_REFUSALS in a row, SWAP
 *               between the two stands (STAND <-> STAND_ALT) — the counter
 *               shades each from the other's watchers — and keep stealing
 *
 * There is deliberately NO guard-proximity gating (user call, 2026-07-20):
 * the bot just thieves, and a guard that catches it is answered by the
 * caller's Fight/Flee task.
 *
 * Callers may feed `lockedOutUntil` (last combat end + LOCKOUT_TICKS) to skip
 * the first refused click after a fight; without it the driver self-heals off
 * the lockout chat line.
 */

const DEADLINE_MS = 90_000; // one execute()'s worth of stealing; caller re-enters
// Long enough to WALK back from the kite/reset tiles (~14 tiles ≈ 8.4s
// unrunning) — the first live smoke's 5s timed out mid-market and the bot
// then stole from the market side, where every click is caught.
const CLAIM_TIMEOUT_MS = 15_000;
// Don't click the stall from beyond this (cheb of STALL_TILE): a far click
// server-walks to whatever adjacent tile the engine picks — usually the
// market side. The stand itself is cheb 2 of the stall loc.
const NEAR_STALL = 2;
const RESOLVE_MS = 2_400; // attempt-mes -> p_arrivedelay -> p_delay(0) -> loot, ~4 ticks
const RESTOCK_WAIT_MS = 8_000; // stall respawn is 8 ticks base, playercount-scaled

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

export async function stealCakes(opts: StealCakesOptions): Promise<StealCakesResult> {
    let stand = STAND; // current stand; refusal streaks swap STAND <-> STAND_ALT
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

            // Best-effort claim of the current stand: one bounded walk per
            // pass — never an arrival-or-bust loop (the old wedge). If we're
            // still not even beside the stall afterwards, do NOT click from
            // afar (the click's server-walk would land us market-side, where
            // every theft is caught); re-claim next pass instead. Adjacent-
            // but-off-stand is fine — the click walks the last tile in.
            const here = Game.tile();
            if (here && stand.distanceTo(here) > 0) {
                await Traversal.walkTo(stand, { radius: 0, timeoutMs: CLAIM_TIMEOUT_MS, log: m => opts.log(`  ${m}`) });
                const now = Game.tile();
                if (!now || STALL_TILE.distanceTo(now) > NEAR_STALL) {
                    opts.log(`claim fell short${now ? ` at (${now.x},${now.z})` : ''} — not stealing from the market side`);
                    await Execution.delayTicks(1);
                    continue;
                }
            }

            const stall = stockedStall();
            if (!stall) {
                // Emptied by our own steal — condition-wait for the respawn.
                opts.log('stall emptied — waiting for the restock');
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
                // Whoever is watching this stand can't see the other one —
                // hop across and keep stealing (next pass's claim walks us).
                stand = stand.equals(STAND_ALT) ? STAND : STAND_ALT;
                opts.setStatus('watched — swapping stands');
                opts.log(`${refusals} refused steals — swapping to the stand at (${stand.x},${stand.z})`);
                opts.onReset?.();
                refusals = 0;
            }
        }
        return 'no-progress';
    } finally {
        unsub();
    }
}
