// docs/CLUES.md#dig-guardians
import { Execution } from '#/bot/api/Execution.js';
import { Game } from '#/bot/api/Game.js';
import { PROTECT_FROM_MAGIC, Prayer } from '#/bot/api/Prayer.js';
import { Sustain } from '#/bot/api/Sustain.js';
import { Traversal } from '#/bot/api/Traversal.js';
import { Npcs } from '#/bot/api/queries/Npcs.js';
import { GameMessages } from '#/bot/events/gameMessages.js';
import type { Npc } from '#/bot/api/entities/index.js';

// npc_add drops the wizard on a line-of-sight tile beside the dig, and the
// engine deletes it once we are more than 17 tiles away.
const SPAWN_RADIUS = 12;
const SPAWN_WAIT_MS = 6000;
const FIGHT_MS = 180_000;
const ENGAGE_MS = 4000;
const CLOSE_IN_RADIUS = 1;
const WALK_TIMEOUT_MS = 20_000;
// spade.rs2 refuses a guardian that is not ours with this message.
const NOT_YOURS = /not after you/i;

export interface GuardianOutcome {
    fought: boolean;
    killed: boolean;
}

export interface SustainWaitDeps {
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
 * Wait for `cond` on the tick, running per-pass upkeep the whole time.
 *
 * A guardian is a mage that lands hits through Protect-from-Magic, so a fight is
 * exactly when eating matters most. Waiting it out in a single `delayUntil` left
 * `Sustain` unpumped for the whole fight — the bot held full food and died with
 * it in the pack.
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

/**
 * Wait out the spawn window after digging a guarded coord and, if the wizard
 * appears, kill it. Prayer is only touched when there is actually a fight.
 */
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
    try {
        const deadline = Date.now() + FIGHT_MS;
        while (Date.now() < deadline) {
            await Sustain.run();

            const target = findGuardian(name);
            if (!target) {
                killed = true;
                break;
            }
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
            // Ride the fight out on the tick so food keeps going in. The whole
            // remaining budget, not FIGHT_MS again — a slow kill used to be able
            // to run twice the deadline.
            await sustainUntil(
                () => findGuardian(name) === null || !Game.inCombat(),
                Math.max(0, deadline - Date.now())
            );
        }
    } finally {
        if (prayed) {
            await Prayer.set(PROTECT_FROM_MAGIC, false);
        }
    }

    log(killed ? `${name} killed` : `${name} still standing after ${Math.round(FIGHT_MS / 1000)}s`);
    return { fought: true, killed };
}
