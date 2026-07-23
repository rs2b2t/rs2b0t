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

const DEADLINE_MS = 90_000;
const CLAIM_TIMEOUT_MS = 15_000;
const NEAR_STALL = 2;
const RESOLVE_MS = 2_400;
const RESTOCK_WAIT_MS = 8_000;

const ATTEMPT_RE = /you attempt to steal/i;
const LOCKOUT_RE = /can't steal from the market stall during combat/i;

export type StealCakesResult = 'stocked' | 'combat' | 'aborted' | 'no-progress';

export interface StealCakesOptions {
    fillTo: number;
    abort: () => boolean;
    shouldEat?: () => boolean;
    lockedOutUntil?: () => number;
    setStatus: (s: string) => void;
    log: (m: string) => void;
    onSteal?: () => void;
    onReset?: () => void;
}

export function carriedCakes(): number {
    return countMatching(Inventory.items(), CAKE_ITEMS);
}

function stockedStall() {
    return Locs.query()
        .name(STALL_NAME)
        .action(STALL_OP)
        .where(l => l.tile().distanceTo(STALL_TILE) <= 3)
        .nearest();
}

export async function stealCakes(opts: StealCakesOptions): Promise<StealCakesResult> {
    let stand = STAND;
    let refusals = 0;
    let selfLockout = 0;
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

            const until = Math.max(opts.lockedOutUntil?.() ?? 0, selfLockout);
            if (Game.tick() < until) {
                opts.setStatus('waiting out the post-combat steal lockout');
                await Execution.delayUntil(() => Game.tick() >= until || opts.abort(), 12_000);
                continue;
            }

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
                refusals++;
            }

            if (shouldReset(refusals)) {
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
