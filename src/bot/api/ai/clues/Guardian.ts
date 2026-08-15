// docs/reference/clues-mechanics.md#dig-guardians
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { PROTECT_FROM_MAGIC, Prayer } from '#/bot/api/prayer/Prayer.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Npcs } from '#/bot/api/npcs/Npcs.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import type { Npc } from '#/bot/api/model/Npc.js';

// npc_add drops the wizard on a line-of-sight tile beside the dig, and the
// engine deletes it once we are more than 17 tiles away.
const SPAWN_RADIUS = 12;
const SPAWN_WAIT_MS = 6000;
const FIGHT_MS = 180_000;
const ENGAGE_MS = 4000;
/** How long to ride an engaged fight before re-checking that it is still ours. */
const RIDE_MS = 15_000;
const CLOSE_IN_RADIUS = 1;
const WALK_TIMEOUT_MS = 20_000;
// spade.rs2 refuses a guardian that is not ours with this message.
const NOT_YOURS = /not after you/i;
// Dying respawns us in Lumbridge, which empties the scene of the guardian —
// indistinguishable from killing it unless the death itself is read.
const DIED = /oh dear.*you are dead/i;

interface GuardianOutcome {
    fought: boolean;
    killed: boolean;
}

interface SustainWaitDeps {
    now: () => number;
    pump: () => Promise<void>;
    tick: () => Promise<void>;
}

const LIVE_WAIT: SustainWaitDeps = {
    now: () => Date.now(),
    pump: () => Sustain.run(),
    tick: () => Execution.delayTicks(1)
};

/**
 * Wait for `cond` on the tick, running per-pass upkeep throughout.
 * Why: a guardian is a mage that lands hits through Protect-from-Magic, so a single `delayUntil` leaves `Sustain` unpumped for the fight and the bot dies holding full food.
 */
export async function sustainUntil(
    cond: () => boolean,
    ms: number,
    deps: SustainWaitDeps = LIVE_WAIT
): Promise<boolean> {
    const until = deps.now() + ms;
    for (;;) {
        await deps.pump();
        if (cond()) {
            return true;
        }
        if (deps.now() >= until) {
            return false;
        }
        await deps.tick();
    }
}

/** Ours faces us; another player's is refused by the server, so skip it. */
function findGuardian(name: string): Npc | null {
    const candidates = Npcs.query()
        .name(name)
        .action('Attack')
        .where(n => n.distance() <= SPAWN_RADIUS && !n.targetsAnotherPlayer())
        .results();
    return candidates.find(n => n.targetsMe()) ?? candidates[0] ?? null;
}

/** Wait out the spawn window after digging a guarded coord and, if the wizard appears, kill it. */
export async function fightGuardian(name: string, log: (m: string) => void): Promise<GuardianOutcome> {
    await Execution.delayUntil(() => findGuardian(name) !== null, SPAWN_WAIT_MS);
    if (!findGuardian(name)) {
        return { fought: false, killed: false };
    }

    log(`${name} guards this dig — engaging`);
    const prayed = await Prayer.set(PROTECT_FROM_MAGIC, true);
    if (!prayed) {
        log(`no ${PROTECT_FROM_MAGIC} available (prayer ${Prayer.points()}/${Prayer.max()}) — fighting without it`);
    }

    let killed = false;
    let died = false;
    const fightMark = GameMessages.mark();
    try {
        const deadline = Date.now() + FIGHT_MS;
        while (Date.now() < deadline) {
            await Sustain.run();

            if (GameMessages.sawSince(fightMark, DIED)) {
                died = true;
                break;
            }
            const target = findGuardian(name);
            if (!target) {
                killed = true;
                break;
            }

            // Why: the engine takes one action per tick, so an Attack sent here lands in the same tick as the bite `Sustain.run()` sent and replaces it.
            // Why: measured two bites logged and zero lobsters consumed while the bot was beaten from 62 to 0 in six ticks.
            // Why: once the guardian is facing us the fight continues on its own and the tick belongs to food.
            if (!(Game.inCombat() && target.targetsMe())) {
                if (target.distance() > CLOSE_IN_RADIUS && !Game.inCombat()) {
                    await Traversal.walkResilient(target.tile(), { radius: CLOSE_IN_RADIUS, attempts: 2, timeoutMs: WALK_TIMEOUT_MS, log });
                }

                const mark = GameMessages.mark();
                const engaged = findGuardian(name);
                if (!engaged) {
                    killed = true;
                    break;
                }
                await engaged.interact('Attack');
                await sustainUntil(
                    () => findGuardian(name) === null || Game.inCombat() || GameMessages.sawSince(mark, NOT_YOURS),
                    ENGAGE_MS
                );
                if (GameMessages.sawSince(mark, NOT_YOURS)) {
                    log(`the ${name} here is guarding another player — waiting for ours`);
                    await Execution.delayTicks(3);
                    continue;
                }
            }

            // Why: our own combat bar is set by taking hits too, so exiting on it spun this loop into the re-attack above every tick.
            // Why: bounded in slices rather than one long park, so food keeps going in.
            await sustainUntil(
                () => findGuardian(name) === null || GameMessages.sawSince(fightMark, DIED),
                Math.min(RIDE_MS, Math.max(0, deadline - Date.now()))
            );
        }
    } finally {
        if (prayed) {
            await Prayer.set(PROTECT_FROM_MAGIC, false);
        }
    }

    if (died) {
        log(`died to the ${name} — the dig is unguarded until it respawns`);
        return { fought: true, killed: false };
    }
    log(killed ? `${name} killed` : `${name} still standing after ${Math.round(FIGHT_MS / 1000)}s`);
    return { fought: true, killed };
}
