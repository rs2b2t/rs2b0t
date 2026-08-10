// docs/CLUES.md#yielding-to-the-host-loop
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/Execution.js';
import { EventSignal } from '#/bot/api/EventSignal.js';
import { Sustain } from '#/bot/api/Sustain.js';
import { Traversal } from '#/bot/api/Traversal.js';
import { Game } from '#/bot/api/Game.js';
import { ChatDialog } from '#/bot/api/hud/ChatDialog.js';
import { Inventory } from '#/bot/api/hud/Inventory.js';
import { GroundItems } from '#/bot/api/queries/GroundItems.js';
import { Locs } from '#/bot/api/queries/Locs.js';
import { Npcs } from '#/bot/api/queries/Npcs.js';
import type { GroundItem, Loc, Npc } from '#/bot/api/entities/index.js';
import { GameMessages } from '#/bot/events/gameMessages.js';
import { identifyStep } from '#/bot/clues/ClueLogic.js';
import { ClueTrace, pushTraceRing } from '#/bot/clues/ClueTrace.js';
import { CASKET_IDS, CLUE_DB } from '#/bot/clues/data/cluedb.js';
import { challengeAnswer } from '#/bot/clues/data/challengeAnswers.js';
import { clueGate } from '#/bot/clues/data/clueGates.js';
import { KILL_ANCHORS } from '#/bot/clues/data/killAnchors.js';
import { ensureSpade, ensureCoordTools, ensureExtraItems, ensureGateItems } from '#/bot/clues/AcquireTools.js';
import { SPADE_NAME } from '#/bot/clues/data/toolAcquire.js';
import { fightGuardian, sustainUntil } from '#/bot/clues/Guardian.js';
import { PuzzleBox } from '#/bot/clues/PuzzleBox.js';
import { casketRewardSlots } from '#/bot/clues/packPlan.js';
import type { ClueRow, ClueStep } from '#/bot/clues/types.js';
import type { NavPoint } from '#/bot/nav/PathFinder.js';
import { talkThrough } from '#/bot/quests/exec/primitives.js';
import { Reach } from '#/bot/api/Reach.js';
import { WalkExecutor } from '#/bot/nav/WalkExecutor.js';

const COORD_ITEMS = ['Sextant', 'Watch', 'Chart'];

const SEARCH_OPS = ['Search', 'Open'];

const ARRIVE_RADIUS = 1;
const WALK_ATTEMPTS = 4;
const WALK_TIMEOUT_MS = 45_000;
// Trails cross the map — Varrock to Feldip, Varrock to level-50 Wilderness — so
// they route through the teleport catalog when the kit is held. Short hops stay
// on foot: a tele is only admitted once the route is longer than this.
const TELEPORT_MIN_SPAN = 40;
const STEP_ATTEMPTS = 4;
const PROGRESS_MS = 6000;
const MAX_STEPS = 20;
const OUTER_GUARD = 1000;
const REWARD_WAIT_MS = 2000;
const REWARD_CLOSE_TRIES = 5;
const CHALLENGE_REPLY_MS = 3000;

const KEY_WALK_RADIUS = 5;
const KEY_HUNT_MS = 120_000;
const KEY_ENGAGE_MS = 3000;
// black_heather respawns in 100 ticks; the rest of the riddle keepers are quicker.
const KEY_RESPAWN_MS = 70_000;
const LOOT_WAIT_MS = 3000;
// player_combat.rs2 refuses op2 outright in single-way combat: while we are still
// flagged from another fight, while another player has hit the target inside the
// last 8 ticks, or when the target is someone else's random event. Each refusal
// is a chat line and a dropped op, so the attack has to be re-sent, not waited out.
const ATTACK_REFUSED = /already under attack|someone else is fighting|not after you/i;

import { TALK_ANCHORS } from '#/bot/clues/data/talkAnchors.js';

export const TRACE_STORAGE_KEY = 'rs2b0t:cluetrace';

export interface ClueProgress {
    clueId: number;
    name: string;
    step: string;
    leg: number;
    attempt: number;
    startedAt: number;
    /** Where this leg is headed — a dig/search coord, or a talk NPC's anchor. */
    target: NavPoint | null;
    /** Distance to `target` when the leg began, so travel can be shown as a bar. */
    startDist: number;
}

function shortClueName(obj: string): string {
    return obj.replace(/^trail_clue_/, '').replace(/_/g, ' ');
}

function stepTarget(step: ClueStep): NavPoint | null {
    if (step.type === 'open-casket') {
        return null;
    }
    if (step.type === 'talk') {
        const a = TALK_ANCHORS[step.id];
        return a ? { x: a.x, z: a.z, level: a.level } : null;
    }
    return step.coord ?? null;
}

export function tilesTo(target: NavPoint | null): number | null {
    const me = target ? reader.worldTile() : null;
    return me && target ? Math.max(Math.abs(me.x - target.x), Math.abs(me.z - target.z)) : null;
}

let teleportsEnabled = true;

/**
 * Options for a cross-map clue leg, so the teleport policy lives in one place.
 * Close-in walks (stepping onto an NPC or a dropped key) do not use this — a
 * tele would be absurd at two tiles, and the span gate would refuse it anyway.
 */
function walkOpts(log: (m: string) => void, radius = ARRIVE_RADIUS): Parameters<typeof Traversal.walkResilient>[1] {
    return {
        radius,
        attempts: WALK_ATTEMPTS,
        timeoutMs: WALK_TIMEOUT_MS,
        log,
        ...(teleportsEnabled
            ? { useTeleportCatalog: true, policy: { useTeleports: true, distanceBeforeTeleport: TELEPORT_MIN_SPAN } }
            : { useTeleportCatalog: false, policy: { useTeleports: false } })
    };
}

/** Tolls already bought this trail, so a stuck leg cannot shop in a loop. */
const gateItemsTried = new Set<string>();

/**
 * Walk a clue leg, and treat an unpayable toll as a shopping trip rather than a
 * dead end. The navigator names what the route was short of — the Kharidian
 * desert has one entrance and it eats a Shantay pass — so a leg that fails for
 * want of a 5gp ticket buys one and walks again instead of abandoning the trail.
 */
async function walkLeg(dest: NavPoint, log: (m: string) => void, radius = ARRIVE_RADIUS): Promise<boolean> {
    if (await Traversal.walkResilient(dest, walkOpts(log, radius))) {
        return true;
    }
    const short = WalkExecutor.lastMissingGateItems.filter(m => !gateItemsTried.has(m.name));
    if (short.length === 0) {
        return false;
    }
    for (const m of short) {
        gateItemsTried.add(m.name);
    }
    if (!(await ensureGateItems(short, log))) {
        return false;
    }
    return Traversal.walkResilient(dest, walkOpts(log, radius));
}

const trace = new ClueTrace({
    pos: () => {
        const me = reader.worldTile();
        return me ? `${me.x},${me.z},${me.level}` : '?';
    }
});

let sessionActive = false;
let sessionLegs = 0;
let acquireTries = 0;

function heldIds(): number[] {
    return Inventory.items().map(i => i.id);
}

/**
 * Did anything enter the pack since `before`?
 *
 * A step also counts as progressed when it picks up something it needed — a
 * riddle key, a tool — but only gains count. Comparing the whole pack instead
 * made every bite of food read as progress, so a leg that did nothing at all
 * still reported `step done` and burned a leg off the trail budget.
 */
function heldCounts(): Map<number, number> {
    const counts = new Map<number, number>();
    for (const i of Inventory.items()) {
        counts.set(i.id, (counts.get(i.id) ?? 0) + i.count);
    }
    return counts;
}

function gainedSince(before: Map<number, number>): boolean {
    for (const [id, count] of heldCounts()) {
        if (count > (before.get(id) ?? 0)) {
            return true;
        }
    }
    return false;
}

function trackedId(step: ClueStep): number {
    return step.type === 'open-casket' ? step.casketId : step.id;
}

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

async function drainChat(): Promise<void> {
    for (let i = 0; i < 10 && ChatDialog.canContinue(); i++) {
        await ChatDialog.continue();
    }
}

/** Free one slot the only way a trail pack safely can. */
async function eatOneForRoom(): Promise<boolean> {
    const edible = Inventory.items().find(i => i.actions().some(a => a.toLowerCase() === 'eat'));
    if (!edible) {
        return false;
    }
    const before = Inventory.used();
    await edible.interact('Eat');
    return Execution.delayUntil(() => Inventory.used() < before, 3000);
}

/**
 * A casket rolls its reward into a side inv and then moves it in one slot at a
 * time — anything that does not fit lands on the floor. Eat food to clear the
 * space first; nothing else in a trail pack is safe to shed.
 */
async function makeRoomForReward(casketObj: string, log: (m: string) => void): Promise<void> {
    const want = casketRewardSlots(casketObj);
    if (Inventory.free() >= want) {
        return;
    }
    log(`casket needs ${want} free slots, pack has ${Inventory.free()} — eating to make room`);
    for (let guard = 0; guard < 28 && Inventory.free() < want; guard++) {
        if (!(await eatOneForRoom())) {
            break;
        }
    }
    if (Inventory.free() < want) {
        log(`only ${Inventory.free()}/${want} slots free and nothing left to eat — will retrieve anything that spills`);
    }
}

/**
 * Whatever the reward could not fit lands under us. Take it back, eating for
 * room as we go, so a tight pack costs nothing. Restricted to our own tile so
 * this never hoovers up unrelated drops.
 */
async function collectSpilledReward(log: (m: string) => void): Promise<void> {
    const here = reader.worldTile();
    if (!here) {
        return;
    }
    for (let guard = 0; guard < 28; guard++) {
        const spill = GroundItems.query()
            .where(g => {
                const t = g.tile();
                return t.x === here.x && t.z === here.z && t.level === here.level;
            })
            .nearest();
        if (!spill) {
            return;
        }
        if (Inventory.isFull() && !(await eatOneForRoom())) {
            log(`WARNING: '${spill.name}' spilled from the casket and the pack is full with nothing to eat — leaving it on the ground`);
            return;
        }
        const before = Inventory.used();
        await spill.interact('Take');
        if (!(await Execution.delayUntil(() => Inventory.used() > before, LOOT_WAIT_MS))) {
            return;
        }
        log(`picked spilled reward '${spill.name}' back up`);
    }
}

async function answerChallengeIfOpen(step: ClueStep, log: (m: string) => void): Promise<boolean> {
    if (step.type !== 'talk' || !reader.countDialogOpen()) {
        return false;
    }
    const n = challengeAnswer(step.id);
    if (n === null) {
        log(`challenge count dialog open but no answer for clue ${step.id} — leaving it (step will abandon)`);
        return false;
    }
    actions.answerCountDialog(n);
    log(`challenge answered: ${n}`);
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), CHALLENGE_REPLY_MS))) {
        log('challenge reply page never opened — leaving it to the next attempt');
        return true;
    }
    await drainChat();
    return true;
}

/**
 * Kill the keeper of a riddle key and pick the key up.
 *
 * Shaped like {@link fightGuardian} rather than a single op: `Attack` is refused
 * outright whenever the server thinks the fight belongs to somebody else, and
 * riddle001's keeper stands in the Bandit Camp, where aggressive bandits keep us
 * combat-flagged for most of the approach. One fire-and-forget op therefore left
 * the bot standing next to an untouched target for the whole wait, so the attack
 * is re-sent until it takes — on the tick, with upkeep pumped the whole way.
 */
async function acquireRiddleKey(kf: NonNullable<ClueRow['keyFrom']>, huntTile: NavPoint, log: (m: string) => void): Promise<boolean> {
    const haveKey = (): boolean => Inventory.items().some(i => i.id === kf.keyId);
    if (haveKey()) {
        return true;
    }
    const keyOnGround = (): GroundItem | null => GroundItems.query().where(g => g.id === kf.keyId).nearest();
    // Prefer the one already facing us; one another player is fighting is refused.
    const findTarget = (): Npc | null => {
        const up = Npcs.query().name(kf.npc).action('Attack').where(n => !n.targetsAnotherPlayer()).results();
        return up.find(n => n.targetsMe()) ?? up[0] ?? null;
    };
    const takeKey = async (): Promise<boolean> => {
        const key = keyOnGround();
        if (!key) {
            return false;
        }
        if (Inventory.isFull() && !(await eatOneForRoom())) {
            log(`kill-for-key: the '${kf.npc}' key is on the ground but the pack is full with nothing to eat`);
            return false;
        }
        if (key.distance() > 1) {
            await Traversal.walkResilient(key.tile(), { radius: 1, attempts: 2, timeoutMs: WALK_TIMEOUT_MS, log });
        }
        await key.interact('Take');
        return Execution.delayUntil(haveKey, LOOT_WAIT_MS);
    };

    if (!(await walkLeg(huntTile, log, KEY_WALK_RADIUS))) {
        log(`kill-for-key: could not reach the '${kf.npc}' spawn at (${huntTile.x},${huntTile.z}) — abandoning riddle`);
        return false;
    }

    const deadline = Date.now() + KEY_HUNT_MS;
    let refused = 0;
    while (Date.now() < deadline) {
        if (EventSignal.pending()) {
            return false;
        }
        await Sustain.run();
        if (await takeKey()) {
            return true;
        }

        let target = findTarget();
        if (!target) {
            log(`kill-for-key: no '${kf.npc}' up at (${huntTile.x},${huntTile.z}) — waiting out the respawn`);
            const waited = await sustainUntil(
                () => findTarget() !== null || keyOnGround() !== null,
                Math.min(KEY_RESPAWN_MS, deadline - Date.now())
            );
            if (!waited) {
                log(`kill-for-key: '${kf.npc}' never respawned — abandoning riddle`);
                return false;
            }
            continue;
        }
        if (target.distance() > 1 && !Game.inCombat()) {
            await Traversal.walkResilient(target.tile(), { radius: 1, attempts: 2, timeoutMs: WALK_TIMEOUT_MS, log });
            target = findTarget() ?? target;
        }

        const mark = GameMessages.mark();
        await target.interact('Attack');
        await sustainUntil(
            () => Game.inCombat() || keyOnGround() !== null || GameMessages.sawSince(mark, ATTACK_REFUSED),
            KEY_ENGAGE_MS
        );
        if (GameMessages.sawSince(mark, ATTACK_REFUSED)) {
            refused++;
            if (refused === 1) {
                log(`kill-for-key: the server refused the attack on '${kf.npc}' — re-sending until the flag clears`);
            }
            await Execution.delayTicks(2);
            continue;
        }

        // Ride the fight out on the tick so food keeps going in. Falling straight
        // through when we never engaged is the point: the loop re-sends instead
        // of parking on an op the server quietly dropped.
        await sustainUntil(
            () => haveKey() || keyOnGround() !== null || !Game.inCombat(),
            Math.max(0, deadline - Date.now())
        );
    }

    if (await takeKey()) {
        return true;
    }
    if (!haveKey()) {
        log(`kill-for-key: gave up on '${kf.npc}' after ${Math.round(KEY_HUNT_MS / 1000)}s${refused > 0 ? ` (${refused} refused attacks)` : ''}`);
    }
    return haveKey();
}

async function dispatch(step: ClueStep, log: (m: string) => void): Promise<void> {
    switch (step.type) {
        case 'search': {
            if (!step.coord) {
                return;
            }
            const kf = (step as ClueRow).keyFrom;
            if (kf) {
                const huntTile = KILL_ANCHORS[step.id] ?? step.coord;
                if (!(await acquireRiddleKey(kf, huntTile, log))) {
                    return;
                }
            }
            if (!(await walkLeg(step.coord, log))) {
                return;
            }
            const pick = pickSearchLoc(step.coord);
            if (pick) {
                await pick.loc.interact(pick.op);
            } else {
                log(`no searchable loc at (${step.coord.x},${step.coord.z},${step.coord.level})`);
            }
            return;
        }
        case 'dig': {
            if (!step.coord) {
                return;
            }
            const coord = step.coord;
            const standOnIt = (): Promise<boolean> =>
                walkLeg(coord, log);
            const dig = async (): Promise<void> => {
                const spade = Inventory.first(SPADE_NAME);
                if (spade) {
                    await spade.interact('Dig');
                }
            };

            if (!(await standOnIt())) {
                return;
            }
            await dig();

            // A guarded coord yields the wizard on the first dig and the casket
            // only on a dig after it dies, so both happen in one attempt. The
            // fight chases, so walk back before the second dig.
            const guardian = (step as ClueRow).guardian;
            if (guardian) {
                const outcome = await fightGuardian(guardian, log);
                if (outcome.killed && (await standOnIt())) {
                    await dig();
                }
            }
            return;
        }
        case 'talk': {
            const anchor = TALK_ANCHORS[step.id];
            if (!anchor || !step.npc) {
                return;
            }
            const puzzle = (step as ClueRow).puzzle;
            if (puzzle && Inventory.items().some(i => i.id === puzzle.id)) {
                await PuzzleBox.solveHeld(puzzle.id, log);
                // Fall through: the solved box is handed back by re-talking.
            }
            if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
                await talkThrough(step.npc, [], log);
                return;
            }
            const st = await Reach.npcDialog({ name: step.npc, near: anchor, log });
            if (st === 'done') {
                await talkThrough(step.npc, [], log);
            }
            return;
        }
        case 'open-casket': {
            const casket = Inventory.items().find(i => i.id === step.casketId);
            if (casket) {
                await makeRoomForReward(step.casketObj, log);
                await casket.interact('Open');
                await Execution.delayUntil(() => Inventory.items().every(i => i.id !== step.casketId), REWARD_WAIT_MS);
                await collectSpilledReward(log);
            }
            return;
        }
    }
}

function blockReason(step: ClueStep): string | null {
    if (step.type !== 'open-casket') {
        const gated = clueGate(step.id);
        if (gated) {
            return gated;
        }
    }
    if (step.type === 'dig' && !Inventory.first(SPADE_NAME)) {
        return 'no Spade held';
    }
    if (step.type === 'talk' && (!step.npc || !TALK_ANCHORS[step.id])) {
        return `no anchor for NPC '${step.npc ?? '?'}'`;
    }
    if (step.type === 'dig' && (step as ClueRow).needsSextant) {
        const missing = COORD_ITEMS.filter(n => !Inventory.first(n));
        if (missing.length > 0) {
            return `coordinate clue needs ${missing.join('+')} (not held)`;
        }
    }
    const extras = ((step as ClueRow).items ?? []).filter(n => !Inventory.first(n));
    if (extras.length > 0) {
        return `needs ${extras.join('+')} (not held)`;
    }
    return null;
}

async function tryAcquire(step: ClueStep, log: (m: string) => void): Promise<boolean> {
    if (step.type === 'open-casket') {
        return false;
    }
    // Row extras (Baxtorian's Rope) come first: the bank prep only withdraws
    // them when the bank already has one, and without it the trail abandons.
    const extras = ((step as ClueRow).items ?? []).filter(n => !Inventory.first(n));
    if (extras.length > 0 && (await ensureExtraItems(extras, log))) {
        return true;
    }
    if (step.type !== 'dig') {
        return false;
    }
    if (!Inventory.first(SPADE_NAME)) {
        return ensureSpade(log);
    }
    if ((step as ClueRow).needsSextant && COORD_ITEMS.some(n => !Inventory.first(n))) {
        return ensureCoordTools(log);
    }
    return false;
}

async function solveStep(step: ClueStep, log: (m: string) => void, onAttempt: (n: number) => void): Promise<boolean> {
    const tracked = trackedId(step);
    const before = heldCounts();
    const progressed = (): boolean => !heldIds().includes(tracked) || gainedSince(before);

    for (let attempt = 0; attempt < STEP_ATTEMPTS; attempt++) {
        if (progressed()) {
            return true;
        }
        if (EventSignal.pending()) {
            return false;
        }
        await Sustain.run();
        onAttempt(attempt + 1);
        await drainChat();
        if (!(await answerChallengeIfOpen(step, log))) {
            await dispatch(step, log);
        }
        if (await Execution.delayUntil(progressed, PROGRESS_MS)) {
            return true;
        }
    }
    return progressed();
}

async function dismissRewardModal(): Promise<void> {
    await Execution.delayUntil(() => reader.modals().main !== -1, REWARD_WAIT_MS);
    for (let i = 0; i < REWARD_CLOSE_TRIES && reader.modals().main !== -1; i++) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
}

export const ClueExecutor = {
    current: null as ClueProgress | null,

    /** Route clue legs through the teleport catalog (spells, ring of dueling). */
    setTeleports(on: boolean): void {
        teleportsEnabled = on;
    },

    async solveHeldClue(log: (m: string) => void): Promise<'done' | 'abandon' | 'yield'> {
        const tlog = (m: string): void => {
            trace.note(m);
            log(m);
        };
        const end = (outcome: 'done' | 'abandon', reason?: string): 'done' | 'abandon' => {
            if (outcome === 'abandon') {
                dumpFailure(reason ?? 'unknown', log);
            }
            sessionActive = false;
            sessionLegs = 0;
            acquireTries = 0;
            gateItemsTried.clear();
            ClueExecutor.current = null;
            return outcome;
        };

        for (let guard = 0; guard < OUTER_GUARD; guard++) {
            if (EventSignal.pending()) {
                trace.note('yield — random event pending');
                return 'yield';
            }
            await Sustain.run();
            await drainChat();

            const step = identifyStep(heldIds(), CLUE_DB, CASKET_IDS);
            if (step === null) {
                await dismissRewardModal();
                tlog('trail complete');
                return end('done');
            }

            const clueId = trackedId(step);
            const name = shortClueName(step.type === 'open-casket' ? step.casketObj : step.obj);
            if (!sessionActive) {
                trace.begin(clueId, name);
                sessionActive = true;
                sessionLegs = 0;
                acquireTries = 0;
                gateItemsTried.clear();
            }
            const target = stepTarget(step);
            const sameLeg = ClueExecutor.current?.clueId === clueId;
            ClueExecutor.current = {
                clueId,
                name,
                step: describeStep(step),
                leg: sessionLegs + 1,
                attempt: 0,
                startedAt: ClueExecutor.current?.startedAt ?? Date.now(),
                target,
                // Keep the leg's original distance across retries so the bar
                // does not reset every attempt.
                startDist: sameLeg ? (ClueExecutor.current?.startDist ?? 0) : (tilesTo(target) ?? 0)
            };

            if (sessionLegs >= MAX_STEPS) {
                const reason = `exceeded ${MAX_STEPS} steps`;
                tlog(`abandoning ${describeStep(step)}: ${reason}`);
                return end('abandon', reason);
            }

            const blocked = blockReason(step);
            if (blocked) {
                if (acquireTries < 2 && (await tryAcquire(step, tlog))) {
                    acquireTries++;
                    continue;
                }
                tlog(`abandoning ${describeStep(step)}: ${blocked}`);
                return end('abandon', blocked);
            }

            tlog(`leg ${sessionLegs + 1} — solving ${describeStep(step)} [${clueId}]`);
            const onAttempt = (n: number): void => {
                if (ClueExecutor.current) {
                    ClueExecutor.current.attempt = n;
                }
                if (n > 1) {
                    trace.note(`attempt ${n}/${STEP_ATTEMPTS}`);
                }
            };
            if (!(await solveStep(step, tlog, onAttempt))) {
                if (EventSignal.pending()) {
                    trace.note('yield — event fired mid-step');
                    return 'yield';
                }
                const reason = `no progress after ${STEP_ATTEMPTS} attempts`;
                tlog(`abandoning ${describeStep(step)}: ${reason}`);
                return end('abandon', reason);
            }
            tlog('step done');
            sessionLegs++;
        }
        tlog('abandoning: loop guard reached (stuck?)');
        return end('abandon', 'loop guard reached');
    }
};

function dumpFailure(reason: string, log: (m: string) => void): void {
    const dump = trace.dump(reason, sessionLegs);
    log(`==== clue trace (abandon: ${reason}) — ${dump.name} [${dump.clueId ?? '?'}], ${dump.legs} leg${dump.legs === 1 ? '' : 's'} solved ====`);
    const t0 = dump.lines[0]?.t ?? dump.startedAt;
    for (let i = 0; i < dump.lines.length; i++) {
        const l = dump.lines[i];
        log(`  ${i + 1}. +${((l.t - t0) / 1000).toFixed(1)}s @${l.pos} ${l.m}`);
    }
    log('==== end clue trace ====');
    console.error('[rs2b0t] clue solve failed', JSON.stringify(dump));
    if (typeof localStorage !== 'undefined') {
        pushTraceRing(localStorage, TRACE_STORAGE_KEY, dump);
    }
}
