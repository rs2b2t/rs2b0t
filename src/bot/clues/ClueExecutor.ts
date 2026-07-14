/**
 * ClueExecutor — the reactive easy-clue solve loop (Task 5).
 *
 * Drives a held clue trail to completion by RE-IDENTIFYING the next step from
 * the pack every iteration (identifyStep is pure — Task 4) and dispatching the
 * matching client action. Because the whole decision is a function of the held
 * items, the loop is idempotent and self-healing: a relog, a random event, or a
 * mis-timed interrupt just re-enters at the same step next pass. No progress
 * varp is read (trail_status is server-only), and no client state is cached.
 *
 * Step mechanics (verified against the rs2b2t-content game_trail scripts):
 *   - search: walk to the clue coord and interact the loc there with its
 *     search-style op. Crates/boxes/open-chests offer 'Search'; a closed
 *     chest/drawer offers 'Open' — and BOTH fire the trail interaction directly
 *     (chests.rs2/crates.rs2/drawers.rs2 all call `@trail_clue_loc_interact`
 *     off the container op when the held clue's trail_coord matches loc_coord).
 *   - dig: stand within 1 tile of the coord and use the Spade's 'Dig' op
 *     (spade.rs2 opheld1 dels the clue, adds the casket). Needs a Spade.
 *   - talk: walk to the NPC's area and Talk-to; the clue check is the FIRST
 *     branch of each opnpc1 handler and jumps to the clue label, so the normal
 *     dialogue options are bypassed (verified: ned/bluemoon_bartender/squire) —
 *     hence `prefer: []` is safe.
 *   - open-casket: use the held casket's 'Open' op. A reward casket takes
 *     precedence over a scroll (identifyStep), so this always runs first.
 *
 * Modal shapes: intermediate "another clue"/"found a casket!" popups are
 * objboxes → CHAT modals with a continue button (drain via ChatDialog); the
 * final trail_reward is `if_openmain` → a MAIN modal dismissed with
 * actions.closeModal() (its BUTTON_CLOSE is present). Reward loot is added to the
 * pack before the interface shows, so a null step == trail complete.
 *
 * Progress is verified by watching the HELD id set change — a step consumed its
 * own object (the tracked id leaves the pack) or the inventory signature moved
 * at all. No unit tests: behaviour is proven by the Task 7 live smoke; the
 * decision logic it leans on (identifyStep) is already tested.
 */
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/Execution.js';
import { EventSignal } from '#/bot/api/EventSignal.js';
import Tile from '#/bot/api/Tile.js';
import { Traversal } from '#/bot/api/Traversal.js';
import { ChatDialog } from '#/bot/api/hud/ChatDialog.js';
import { Inventory } from '#/bot/api/hud/Inventory.js';
import { Locs } from '#/bot/api/queries/Locs.js';
import type { Loc } from '#/bot/api/entities/index.js';
import { identifyStep } from '#/bot/clues/ClueLogic.js';
import { CASKET_IDS, CLUE_DB } from '#/bot/clues/data/cluedb.js';
import type { ClueStep } from '#/bot/clues/types.js';
import type { NavPoint } from '#/bot/nav/PathFinder.js';
import { gotoNpc, talkThrough, type NpcStop } from '#/bot/quests/exec/primitives.js';

const SPADE = 'Spade';

/** Search-style loc ops that trigger the trail interaction, in priority order.
 *  'Search' covers crates/boxes/open containers; 'Open' covers closed chests and
 *  drawers (op1 Open fires the interaction directly when the clue matches).
 *  Deliberately excludes 'Look-at' and the like — those are no-ops for trails. */
const SEARCH_OPS = ['Search', 'Open'];

const ARRIVE_RADIUS = 1; // dig checks distance<=1; search locs sit on the clue coord
const NPC_LEASH = 10; // NPCs wander; talkThrough re-finds them from the anchor
const WALK_ATTEMPTS = 4; // bounded so an unreachable coord escalates to abandon
const WALK_TIMEOUT_MS = 45_000; // per baked-walk pass
const STEP_ATTEMPTS = 4; // real interact tries per step (random-event yields don't count)
const STEP_GUARD = 200; // total per-step iterations incl. yields (anti-spin)
const PROGRESS_MS = 6000; // wait for the held id set to change after an action
const MAX_STEPS = 20; // trail steps solved before giving up (trails are 2-4)
const OUTER_GUARD = 1000; // total loop iterations incl. random-event yields
const REWARD_WAIT_MS = 2000; // let the trail_reward main modal open after the last step
const REWARD_CLOSE_TRIES = 5;

/**
 * Talk-clue NPC anchors, keyed by CLUE obj id (NOT display name — two easy clues
 * both talk to a "Bartender": id 2686 = Blue Moon Inn, Varrock and id 2696 =
 * Rusty Anchor, Port Sarim, at completely different tiles). Each tile is the
 * NPC's exact spawn read from the map's `==== NPC ====` section
 * (rs2b2t-content/maps); gotoNpc arrives within 1 tile and talkThrough re-finds
 * the NPC within NPC_LEASH, so a counter-front arrival is fine.
 */
const TALK_ANCHORS: Record<number, Tile> = {
    2681: new Tile(3207, 3233, 0), // Hans — Lumbridge Castle courtyard
    2683: new Tile(3288, 3190, 0), // Zeke — Al Kharid scimitar stall
    2684: new Tile(3276, 3193, 0), // Tanner (Ellis) — Al Kharid tannery
    2686: new Tile(3226, 3399, 0), // Bartender — Blue Moon Inn, Varrock
    2693: new Tile(2977, 3342, 0), // Squire — White Knights' Castle, Falador
    2696: new Tile(3045, 3257, 0), // Bartender — Rusty Anchor Inn, Port Sarim
    2697: new Tile(3100, 3258, 0), // Ned — Draynor Village wheat field (smoke target)
    2698: new Tile(2952, 3451, 0), // Doric — Doric's hut, north of Falador
    2699: new Tile(2885, 3449, 0), // Gaius — weapon shop, Taverley
    2701: new Tile(2803, 3430, 0), // Arhein — Catherby waterfront
    2702: new Tile(2761, 3497, 0), // Sir Kay — Camelot Castle
    3496: new Tile(3028, 3216, 0), // Captain Tobias — Port Sarim docks
    3513: new Tile(2734, 3581, 0), // Louisa — Sinclair Mansion (Seers' area)
    3514: new Tile(3361, 3242, 0) // Jeed — Duel Arena, east of Al Kharid
};

/** Held obj ids in the pack right now. */
function heldIds(): number[] {
    return Inventory.items().map(i => i.id);
}

/** Signature of the whole pack (id + count) — changes when any step consumes a
 *  clue/casket, digs up a casket, or drops reward loot. */
function heldSignature(): string {
    return Inventory.items()
        .map(i => `${i.id}x${i.count}`)
        .sort()
        .join(',');
}

/** The obj id this step consumes — a scroll's id, or the casket's id. */
function trackedId(step: ClueStep): number {
    return step.type === 'open-casket' ? step.casketId : step.id;
}

/** Human log label for a step. */
function describeStep(step: ClueStep): string {
    if (step.type === 'open-casket') {
        return `${step.casketObj} (open-casket)`;
    }
    if (step.type === 'talk') {
        return `${step.obj} (talk ${step.npc ?? '?'})`;
    }
    const c = step.coord;
    return `${step.obj} (${step.type})${c ? ` at (${c.x},${c.z},${c.level})` : ''}`;
}

/** The loc at (or beside) `coord` whose ops include a search-style verb, and the
 *  op to use. Prefers the loc nearest the exact coord, then the higher-priority
 *  op ('Search' over 'Open'). Null when nothing searchable is in scene there. */
function pickSearchLoc(coord: NavPoint): { loc: Loc; op: string } | null {
    let best: { loc: Loc; op: string; dist: number; rank: number } | null = null;
    for (const loc of Locs.query().results()) {
        const tile = loc.tile();
        if (tile.level !== coord.level) {
            continue;
        }
        const dist = tile.distanceTo(coord);
        if (dist > ARRIVE_RADIUS) {
            continue;
        }
        const ops = loc.actions();
        const rank = SEARCH_OPS.findIndex(v => ops.some(a => a.toLowerCase() === v.toLowerCase()));
        if (rank === -1) {
            continue;
        }
        if (best === null || dist < best.dist || (dist === best.dist && rank < best.rank)) {
            best = { loc, op: SEARCH_OPS[rank], dist, rank };
        }
    }
    return best ? { loc: best.loc, op: best.op } : null;
}

/** Drain any open objbox / continue-page chat popup so the next interact isn't
 *  blocked by a busy player. Bounded — clue objboxes are 1-2 pages; the cap only
 *  guards against a modal that never advances. */
async function drainChat(): Promise<void> {
    for (let i = 0; i < 10 && ChatDialog.canContinue(); i++) {
        await ChatDialog.continue();
    }
}

/** Dispatch the one client action for `step`. Positioning + interaction only —
 *  progress is verified by the caller. */
async function dispatch(step: ClueStep, log: (m: string) => void): Promise<void> {
    switch (step.type) {
        case 'search': {
            if (!step.coord) {
                return;
            }
            await Traversal.walkResilient(step.coord, { radius: ARRIVE_RADIUS, attempts: WALK_ATTEMPTS, timeoutMs: WALK_TIMEOUT_MS, log });
            const pick = pickSearchLoc(step.coord);
            if (pick) {
                await pick.loc.interact(pick.op);
            } else {
                log(`[clue] no searchable loc at (${step.coord.x},${step.coord.z},${step.coord.level})`);
            }
            return;
        }
        case 'dig': {
            if (!step.coord) {
                return;
            }
            await Traversal.walkResilient(step.coord, { radius: ARRIVE_RADIUS, attempts: WALK_ATTEMPTS, timeoutMs: WALK_TIMEOUT_MS, log });
            const spade = Inventory.first(SPADE);
            if (spade) {
                await spade.interact('Dig');
            }
            return;
        }
        case 'talk': {
            const anchor = TALK_ANCHORS[step.id];
            if (!anchor || !step.npc) {
                return;
            }
            const stop: NpcStop = { npc: step.npc, anchor, leash: NPC_LEASH, prefer: [] };
            if (await gotoNpc(stop, [], log)) {
                await talkThrough(step.npc, [], log);
            }
            return;
        }
        case 'open-casket': {
            const casket = Inventory.items().find(i => i.id === step.casketId);
            if (casket) {
                await casket.interact('Open');
            }
            return;
        }
    }
}

/** Reasons a step can't be attempted at all (missing tool / no anchor). */
function blockReason(step: ClueStep): string | null {
    if (step.type === 'dig' && !Inventory.first(SPADE)) {
        return 'no Spade held';
    }
    if (step.type === 'talk' && (!step.npc || !TALK_ANCHORS[step.id])) {
        return `no anchor for NPC '${step.npc ?? '?'}'`;
    }
    return null;
}

/**
 * Solve one identified step: retry the client action up to STEP_ATTEMPTS times,
 * verifying after each that the held id set moved (the step consumed its clue /
 * casket, or dug one up). Random-event yields don't count against the attempt
 * budget. Returns true once progress is seen, false if the step is stuck.
 */
async function solveStep(step: ClueStep, log: (m: string) => void): Promise<boolean> {
    const tracked = trackedId(step);
    const sigBefore = heldSignature();
    const progressed = (): boolean => !heldIds().includes(tracked) || heldSignature() !== sigBefore;

    let attempts = 0;
    for (let guard = 0; guard < STEP_GUARD; guard++) {
        if (progressed()) {
            return true;
        }
        if (EventSignal.pending()) {
            await Execution.delayTicks(1); // yield to the random-event handler; not an attempt
            continue;
        }
        if (attempts >= STEP_ATTEMPTS) {
            break;
        }
        attempts++;
        await drainChat();
        await dispatch(step, log);
        if (await Execution.delayUntil(progressed, PROGRESS_MS)) {
            return true;
        }
    }
    return progressed();
}

/** Close the trail_reward main modal (loot is already in the pack). */
async function dismissRewardModal(): Promise<void> {
    await Execution.delayUntil(() => reader.modals().main !== -1, REWARD_WAIT_MS);
    for (let i = 0; i < REWARD_CLOSE_TRIES && reader.modals().main !== -1; i++) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
}

export const ClueExecutor = {
    /**
     * Run the whole held clue trail to completion. Returns 'done' when nothing
     * clue-like remains in the pack (the trail finished — the reward modal is
     * dismissed on the way out), or 'abandon' when a step can't be made or makes
     * no progress after its bounded attempts.
     */
    async solveHeldClue(log: (m: string) => void): Promise<'done' | 'abandon'> {
        let solved = 0;
        for (let guard = 0; guard < OUTER_GUARD; guard++) {
            if (EventSignal.pending()) {
                await Execution.delayTicks(1); // defer to the random-event handler before touching chat
                continue;
            }
            await drainChat();

            const step = identifyStep(heldIds(), CLUE_DB, CASKET_IDS);
            if (step === null) {
                await dismissRewardModal();
                log('[clue] trail complete');
                return 'done';
            }

            if (solved >= MAX_STEPS) {
                log(`[clue] abandoning ${describeStep(step)}: exceeded ${MAX_STEPS} steps`);
                return 'abandon';
            }

            const blocked = blockReason(step);
            if (blocked) {
                log(`[clue] abandoning ${describeStep(step)}: ${blocked}`);
                return 'abandon';
            }

            log(`[clue] solving ${describeStep(step)}`);
            if (!(await solveStep(step, log))) {
                log(`[clue] abandoning ${describeStep(step)}: no progress after ${STEP_ATTEMPTS} attempts`);
                return 'abandon';
            }
            log('[clue] step done');
            solved++;
        }
        log('[clue] abandoning: loop guard reached (stuck?)');
        return 'abandon';
    }
};
