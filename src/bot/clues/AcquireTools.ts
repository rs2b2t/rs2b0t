import { Execution } from '#/bot/api/Execution.js';
import { EventSignal } from '#/bot/api/EventSignal.js';
import { Game } from '#/bot/api/Game.js';
import { Traversal } from '#/bot/api/Traversal.js';
import { Inventory } from '#/bot/api/hud/Inventory.js';
import { GroundItems } from '#/bot/api/queries/GroundItems.js';
import { gotoNpc, talkThrough } from '#/bot/quests/exec/primitives.js';
import { CLUE_DB } from '#/bot/clues/data/cluedb.js';
import {
    KOJO, MURPHY, PROFESSOR, SPADE_NAME, SPADE_SPAWNS, TRIO,
    nextCoordTool, type HeldTrio
} from '#/bot/clues/data/toolAcquire.js';

/**
 * Acquire the clue tools the medium solver otherwise abandons on (2026-07-20
 * design): a Spade for any dig, and the Sextant/Watch/Chart for a coordinate
 * dig. Best-effort — return false and the caller falls back to graceful
 * abandon. Both functions are idempotent (verify the item is HELD before
 * returning true) and re-entrant on a random-event yield (the primitives bail
 * on EventSignal.pending()).
 */

const SPADE_OBJ_ID = 952;
const WALK_ATTEMPTS = 4;
const WALK_TIMEOUT_MS = 120_000;
const TAKE_WAIT_MS = 3000;
const TOOL_WAIT_MS = 3000; // for a talk-given tool to land in the pack
const CHAIN_GUARD = 8; // bounded loop — the chain is 3 acquisitions

/** Which of the trio are held right now. */
export function heldTrio(): HeldTrio {
    return {
        sextant: Inventory.first('Sextant') !== null,
        watch: Inventory.first('Watch') !== null,
        chart: Inventory.first('Chart') !== null
    };
}

export function hasAllTrio(): boolean {
    return TRIO.every(n => Inventory.first(n) !== null);
}

/** A held clue that needs the sextant trio (gates the NPC chain server-side). */
export function hasCoordClueHeld(): boolean {
    return Inventory.items().some(i => CLUE_DB[i.id]?.needsSextant === true);
}

/** Get a Spade into the pack via the nearer of the two ground spawns. */
export async function ensureSpade(log: (m: string) => void): Promise<boolean> {
    if (Inventory.first(SPADE_NAME) !== null) {
        return true;
    }
    const here = Game.tile();
    // Nearest spawn first, then the other as a fallback (chebyshev; the two are
    // ~410 tiles apart so straight-line reliably picks the right region).
    const spawns = here
        ? [...SPADE_SPAWNS].sort((a, b) => a.distanceTo(here) - b.distanceTo(here))
        : SPADE_SPAWNS;
    for (const spawn of spawns) {
        if (EventSignal.pending()) {
            return false;
        }
        log(`acquiring a spade — walking to (${spawn.x},${spawn.z})`);
        await Traversal.walkResilient(spawn, { radius: 1, attempts: WALK_ATTEMPTS, timeoutMs: WALK_TIMEOUT_MS, log: m => log(`  ${m}`) });
        const spade = GroundItems.query().where(g => g.id === SPADE_OBJ_ID || (g.name ?? '').toLowerCase() === 'spade').nearest();
        if (spade) {
            if (spade.distance() > 1) {
                await Traversal.walkResilient(spade.tile(), { radius: 1, attempts: 2, timeoutMs: WALK_TIMEOUT_MS, log: m => log(`  ${m}`) });
            }
            await spade.interact('Take');
            if (await Execution.delayUntil(() => Inventory.first(SPADE_NAME) !== null, TAKE_WAIT_MS)) {
                log('got a spade');
                return true;
            }
        }
        log(`no spade at (${spawn.x},${spawn.z}) — trying the next spawn`);
    }
    return false;
}

/** Walk the professor->Murphy->Kojo->professor chain for the missing tools.
 *  Precondition: a coordinate clue is in the pack (else every NPC no-ops). */
export async function ensureCoordTools(log: (m: string) => void): Promise<boolean> {
    if (hasAllTrio()) {
        return true;
    }
    if (!hasCoordClueHeld()) {
        log('coord-tool chain needs a coordinate clue held — skipping');
        return false;
    }
    for (let guard = 0; guard < CHAIN_GUARD && !hasAllTrio(); guard++) {
        if (EventSignal.pending()) {
            return false; // yield; caller re-enters at the same held-item state
        }
        const need = nextCoordTool(heldTrio());
        if (need === null) {
            break;
        }
        // sextant needs the professor 'learn' first, then Murphy hands it over;
        // watch = Kojo; chart = professor (2nd visit). One acquisition per loop;
        // verify the expected item landed before advancing.
        if (need === 'sextant') {
            log('coord-tools: learning from the professor, then Murphy for the sextant');
            if (await gotoNpc(PROFESSOR, [], log)) {
                await talkThrough(PROFESSOR.npc, PROFESSOR.prefer, log);
            }
            if (EventSignal.pending()) {
                return false;
            }
            if (await gotoNpc(MURPHY, [], log)) {
                await talkThrough(MURPHY.npc, MURPHY.prefer, log);
            }
            await Execution.delayUntil(() => Inventory.first('Sextant') !== null, TOOL_WAIT_MS);
            if (Inventory.first('Sextant') === null) {
                log('coord-tools: Murphy did not yield a sextant — abandoning the chain');
                return false;
            }
        } else if (need === 'watch') {
            log('coord-tools: Brother Kojo for the watch');
            if (await gotoNpc(KOJO, [], log)) {
                await talkThrough(KOJO.npc, KOJO.prefer, log);
            }
            await Execution.delayUntil(() => Inventory.first('Watch') !== null, TOOL_WAIT_MS);
            if (Inventory.first('Watch') === null) {
                log('coord-tools: Kojo did not yield a watch — abandoning the chain');
                return false;
            }
        } else {
            log('coord-tools: back to the professor for the chart');
            if (await gotoNpc(PROFESSOR, [], log)) {
                await talkThrough(PROFESSOR.npc, PROFESSOR.prefer, log);
            }
            await Execution.delayUntil(() => Inventory.first('Chart') !== null, TOOL_WAIT_MS);
            if (Inventory.first('Chart') === null) {
                log('coord-tools: the professor did not yield a chart — abandoning the chain');
                return false;
            }
        }
    }
    return hasAllTrio();
}
