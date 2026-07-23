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
import type { Loc } from '#/bot/api/entities/index.js';
import { identifyStep } from '#/bot/clues/ClueLogic.js';
import { ClueTrace, pushTraceRing } from '#/bot/clues/ClueTrace.js';
import { CASKET_IDS, CLUE_DB } from '#/bot/clues/data/cluedb.js';
import { challengeAnswer } from '#/bot/clues/data/challengeAnswers.js';
import { KILL_ANCHORS } from '#/bot/clues/data/killAnchors.js';
import { ensureSpade, ensureCoordTools } from '#/bot/clues/AcquireTools.js';
import type { ClueRow, ClueStep } from '#/bot/clues/types.js';
import type { NavPoint } from '#/bot/nav/PathFinder.js';
import { talkThrough } from '#/bot/quests/exec/primitives.js';
import { Reach } from '#/bot/api/Reach.js';

const SPADE = 'Spade';

const COORD_ITEMS = ['Sextant', 'Watch', 'Chart'];

const SEARCH_OPS = ['Search', 'Open'];

const ARRIVE_RADIUS = 1;
const WALK_ATTEMPTS = 4;
const WALK_TIMEOUT_MS = 45_000;
const STEP_ATTEMPTS = 4;
const PROGRESS_MS = 6000;
const MAX_STEPS = 20;
const OUTER_GUARD = 1000;
const REWARD_WAIT_MS = 2000;
const REWARD_CLOSE_TRIES = 5;
const CHALLENGE_REPLY_MS = 3000;

const KEY_WALK_RADIUS = 5;
const KILL_WAIT_MS = 20_000;
const LOOT_WAIT_MS = 3000;

import { TALK_ANCHORS } from '#/bot/clues/data/talkAnchors.js';

export const TRACE_STORAGE_KEY = 'rs2b0t:cluetrace';

export interface ClueProgress {
    clueId: number;
    name: string;
    step: string;
    leg: number;
    attempt: number;
    startedAt: number;
}

function shortClueName(obj: string): string {
    return obj.replace(/^trail_clue_/, '').replace(/_/g, ' ');
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

function heldSignature(): string {
    return Inventory.items()
        .map(i => `${i.id}x${i.count}`)
        .sort()
        .join(',');
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

async function acquireRiddleKey(kf: NonNullable<ClueRow['keyFrom']>, huntTile: NavPoint, log: (m: string) => void): Promise<boolean> {
    const haveKey = (): boolean => Inventory.items().some(i => i.id === kf.keyId);
    if (haveKey()) {
        return true;
    }
    await Traversal.walkResilient(huntTile, { radius: KEY_WALK_RADIUS, attempts: WALK_ATTEMPTS, timeoutMs: WALK_TIMEOUT_MS, log });
    let target = Npcs.query().name(kf.npc).action('Attack').nearest();
    if (!target) {
        log(`kill-for-key: no '${kf.npc}' near (${huntTile.x},${huntTile.z}) — abandoning riddle`);
        return false;
    }
    if (target.distance() > 1) {
        await Traversal.walkResilient(target.tile(), { radius: 1, attempts: 2, timeoutMs: WALK_TIMEOUT_MS, log });
        target = Npcs.query().name(kf.npc).action('Attack').nearest() ?? target;
    }
    await target.interact('Attack');
    const keyOnGround = () => GroundItems.query().where(g => g.id === kf.keyId).nearest();
    await Execution.delayUntil(() => haveKey() || keyOnGround() !== null || (!target.valid() && !Game.inCombat()), KILL_WAIT_MS);
    const key = keyOnGround();
    if (key) {
        if (key.distance() > 1) {
            await Traversal.walkResilient(key.tile(), { radius: 1, attempts: 2, timeoutMs: WALK_TIMEOUT_MS, log });
        }
        await key.interact('Take');
        await Execution.delayUntil(haveKey, LOOT_WAIT_MS);
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
            if (!(await Traversal.walkResilient(step.coord, { radius: ARRIVE_RADIUS, attempts: WALK_ATTEMPTS, timeoutMs: WALK_TIMEOUT_MS, log }))) {
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
            if (!(await Traversal.walkResilient(step.coord, { radius: ARRIVE_RADIUS, attempts: WALK_ATTEMPTS, timeoutMs: WALK_TIMEOUT_MS, log }))) {
                return;
            }
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
                await casket.interact('Open');
            }
            return;
        }
    }
}

function blockReason(step: ClueStep): string | null {
    if (step.type === 'dig' && !Inventory.first(SPADE)) {
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
    if (step.type !== 'dig') {
        return false;
    }
    if (!Inventory.first(SPADE)) {
        return ensureSpade(log);
    }
    if ((step as ClueRow).needsSextant && COORD_ITEMS.some(n => !Inventory.first(n))) {
        return ensureCoordTools(log);
    }
    return false;
}

async function solveStep(step: ClueStep, log: (m: string) => void, onAttempt: (n: number) => void): Promise<boolean> {
    const tracked = trackedId(step);
    const sigBefore = heldSignature();
    const progressed = (): boolean => !heldIds().includes(tracked) || heldSignature() !== sigBefore;

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
            }
            ClueExecutor.current = { clueId, name, step: describeStep(step), leg: sessionLegs + 1, attempt: 0, startedAt: ClueExecutor.current?.startedAt ?? Date.now() };

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
