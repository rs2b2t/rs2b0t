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
            await Execution.delayUntil(
                () => findGuardian(name) === null || Game.inCombat() || GameMessages.sawSince(mark, NOT_YOURS),
                ENGAGE_MS
            );
            if (GameMessages.sawSince(mark, NOT_YOURS)) {
                log(`the ${name} here is guarding another player — waiting for ours`);
                await Execution.delayTicks(3);
                continue;
            }
            await Execution.delayUntil(() => findGuardian(name) === null || !Game.inCombat(), FIGHT_MS);
        }
    } finally {
        if (prayed) {
            await Prayer.set(PROTECT_FROM_MAGIC, false);
        }
    }

    log(killed ? `${name} killed` : `${name} still standing after ${Math.round(FIGHT_MS / 1000)}s`);
    return { fought: true, killed };
}
