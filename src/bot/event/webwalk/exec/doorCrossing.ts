/**
 * Multi-tile door / gate crossing + stall nearby-door open (extracted from WalkExecutor).
 */

import type { WorldTile } from '../../../adapter/ClientAdapter.js';
import { reader } from '../../../adapter/ClientAdapter.js';
import { Execution } from '../../../api/execution/Execution.js';
import { Inventory } from '../../../api/inventory/Inventory.js';
import { Locs, type Loc } from '../../../api/locs/Locs.js';
import { Reachability } from '../geometry/Reachability.js';
import { CANT_REACH, GameMessages } from '../../../api/chatbox/gameMessages.js';
import { Input } from '../../../input/Input.js';
import { DirectNavigator } from '../DirectNavigator.js';
import {
    chooseCrossClick,
    isOnFarSide,
    shouldApproachClosedBarrier
} from '../geometry/followMath.js';
import type { TransportInfo } from '../PathFinder.js';
import {
    classifyWebSlashChat,
    isSlashWeaponName,
    isSlashWebTransport,
    WEB_SLASH_FAIL,
    WEB_SLASH_NO_BLADE,
    WEB_SLASH_SUCCESS,
    WEB_SLASHED_NAME
} from '../slashTool.js';
import { findTransportLoc } from './transportLoc.js';
import { chatShowsQuestLock, dismissQuestLockDialogue } from './questLock.js';
import { DESERT_MINING_CAMP_SCRIPTED_DOOR_IDS } from '../desertMiningCampDoors.js';

const MULTI_DOOR_CROSS_MS = 36_000;
const OPEN_WAIT_MS = 4000;
/** Web cut_web is anim + random roll + mes; allow a few ticks per attempt. */
const WEB_SLASH_CHAT_MS = 3500;
/** After slash success / already-slashed: content p_delay + collision catch-up. */
const WEB_PASSAGE_MS = 4000;
const APPROACH_WALK_MS = 3000;
const SCENE_STEP_MS = 8000;

/** True when content has swapped this placement to bigweb_slashed (walkable). */
function slashedWebAtPlacement(locX: number, locZ: number): boolean {
    return (
        Locs.query()
            .name(WEB_SLASHED_NAME)
            .where(loc => {
                const t = loc.tile();
                return Math.max(Math.abs(t.x - locX), Math.abs(t.z - locZ)) <= 1;
            })
            .nearest() !== null
    );
}

/**
 * Web is passable: slashed leaf visible, or no Slash-target and can step the edge.
 * Prefer slashed-leaf — collision lags a tick after loc_change (blockwalk=no).
 */
function webPassageReady(
    transport: TransportInfo,
    approach: PathStepTile,
    step: PathStepTile
): boolean {
    if (slashedWebAtPlacement(transport.locX, transport.locZ)) {
        return true;
    }
    if (findTransportLoc(transport) !== null) {
        return false;
    }
    return (
        Reachability.canStep(approach, step)
        || Reachability.canReach(step, { maxSteps: 64, adjacentOk: true })
    );
}

/** Walk the planned web edge; wait briefly for server collision after slash. */
async function walkThroughWeb(
    approach: PathStepTile,
    step: PathStepTile,
    transport: TransportInfo,
    log: (msg: string) => void,
    why: string
): Promise<boolean> {
    log(`${transport.locName} at (${transport.locX},${transport.locZ}) ${why} — walking through`);
    // Content: p_delay(1) then loc_change; collision may lag a tick after slashed leaf.
    await Execution.delayUntil(
        () =>
            isOnFarSide(reader.worldTile(), approach, step)
            || Reachability.canStep(approach, step)
            || slashedWebAtPlacement(transport.locX, transport.locZ),
        WEB_PASSAGE_MS
    );
    DirectNavigator.walk(step);
    const ok = await Execution.delayUntil(
        () => isOnFarSide(reader.worldTile(), approach, step),
        4000
    );
    if (ok || isOnFarSide(reader.worldTile(), approach, step)) {
        log(`crossed '${transport.locName}' at (${transport.locX},${transport.locZ})`);
        return true;
    }
    // Slashed / open but still not past — one more scene step.
    DirectNavigator.walk(step);
    await Execution.delayTicks(2);
    if (isOnFarSide(reader.worldTile(), approach, step)) {
        log(`crossed '${transport.locName}' at (${transport.locX},${transport.locZ})`);
        return true;
    }
    return false;
}

type WebSlashAttempt = 'success' | 'fail' | 'no_blade' | 'cant_reach' | 'timeout';

// Why: web.rs2 reports the outcome by chat — success is "You slash the web apart.", fail is "You fail to cut through it." (retry the same web), and no blade is "Only a sharp blade…".

/** One Slash / use-on attempt on a bigweb. */
async function attemptSlashWeb(
    shut: Loc,
    transport: TransportInfo,
    mark: number,
    log: (msg: string) => void
): Promise<WebSlashAttempt> {
    // Prefer plain Knife use-on; else slash-capable inv weapon; else menu Slash
    // (needs worn blade via slash_checker). Metal throwing knives ≠ content knife.
    let slashItem = Inventory.first('Knife');
    if (slashItem === null) {
        slashItem = Inventory.items().find(i => isSlashWeaponName(i.name)) ?? null;
    }
    if (slashItem !== null) {
        log(`using the ${slashItem.name} on ${transport.locName} at (${transport.locX},${transport.locZ})`);
    } else {
        log(`Slash ${transport.locName}: no Knife in inv — trying menu Slash (need worn blade)`);
    }
    const sent =
        slashItem !== null
            ? await Promise.resolve(slashItem.useOn(shut))
            : shut.interact(transport.action);
    if (!sent) {
        log(`'${transport.action}' not offered by ${transport.locName} (ops: ${shut.actions().join(', ')})`);
        return 'timeout';
    }

    await Execution.delayUntil(
        () =>
            GameMessages.sawSince(mark, WEB_SLASH_SUCCESS)
            || GameMessages.sawSince(mark, WEB_SLASH_FAIL)
            || GameMessages.sawSince(mark, WEB_SLASH_NO_BLADE)
            || GameMessages.sawSince(mark, CANT_REACH)
            || findTransportLoc(transport) === null,
        WEB_SLASH_CHAT_MS
    );

    if (GameMessages.sawSince(mark, CANT_REACH)) {
        log(`server says can't reach ${transport.locName} — repathing`);
        return 'cant_reach';
    }
    if (GameMessages.sawSince(mark, WEB_SLASH_NO_BLADE)) {
        log(`${transport.locName}: need Knife or a bladed weapon (server)`);
        return 'no_blade';
    }
    if (GameMessages.sawSince(mark, WEB_SLASH_FAIL)) {
        log(`${transport.locName}: failed to cut — retrying immediately`);
        return 'fail';
    }
    if (GameMessages.sawSince(mark, WEB_SLASH_SUCCESS) || findTransportLoc(transport) === null) {
        log(`slashed '${transport.locName}' at (${transport.locX},${transport.locZ})`);
        return 'success';
    }
    // Fallback: any classified chat since mark
    for (const m of GameMessages.since(mark)) {
        const kind = classifyWebSlashChat(m.text);
        if (kind === 'success') {
            log(`slashed '${transport.locName}' at (${transport.locX},${transport.locZ})`);
            return 'success';
        }
        if (kind === 'fail') {
            log(`${transport.locName}: failed to cut — retrying immediately`);
            return 'fail';
        }
        if (kind === 'no_blade') {
            log(`${transport.locName}: need Knife or a bladed weapon (server)`);
            return 'no_blade';
        }
    }
    log(`${transport.locName}: no slash chat within ${WEB_SLASH_CHAT_MS}ms — retrying`);
    return 'fail';
}

export interface PathStepTile extends WorldTile {
    transport?: TransportInfo;
}

export function isOpenableBarrier(name: string | null, ops: readonly (string | null)[]): boolean {
    return /(door|gate)/i.test(name ?? '') && ops.some(op => op !== null && /^open/i.test(op));
}

export function isOpenBarrierLeaf(name: string | null, ops: readonly (string | null)[]): boolean {
    return /(door|gate)/i.test(name ?? '') && ops.some(op => op !== null && /^close/i.test(op));
}

/** Failed crossings at one placement before A* is told to avoid it this walk. */
export const DOOR_AVOID_STRIKES = 2;

// Why: `resetAvoids` throws the per-walk avoid list away on the next `walkTo`, so a door that cannot be crossed — a quest-locked gate, a leaf the server refuses — is replanned by the next `walkResilient` ladder pass and the walk loops forever.
// Why: strikes therefore count across walks, and a placement that has refused this many crossings is treated as shut for the session.
export const DOOR_SESSION_STRIKES = 3;

// Why: a gangplank or ladder that "refuses" is usually a scene that has not caught up, and banning it can strand the walker somewhere with one exit.
// Why: live, three missed `Gangplank` frames on the Karamja ship left a bot marooned on the deck.

/** True when the barrier is openable, the only kind that may be banned for the run. */
export function barrierBannable(kind: string | undefined, locName: string | undefined): boolean {
    return kind === 'door' || kind === 'gate' || /\b(door|gate)\b/i.test(locName ?? '');
}

/** Records a failed crossing and returns the running strike count. */
export function noteFailedDoor(
    step: PathStepTile,
    doorStrikes: Map<string, number>,
    avoidDoors: { x: number; z: number }[]
): number {
    const t = step.transport;
    if (!t) {
        return 0;
    }
    const key = `${t.locX}|${t.locZ}`;
    const strikes = (doorStrikes.get(key) ?? 0) + 1;
    doorStrikes.set(key, strikes);
    if (strikes >= DOOR_AVOID_STRIKES) {
        avoidDoors.push({ x: t.locX, z: t.locZ });
    }
    return strikes;
}

/**
 * Path-scoped stall recovery: only open doors that belong on the published route.
 * Street-front house doors sit *next* to the path corridor — proximity must not win.
 */
interface PathDoorHint {
    tiles: readonly { x: number; z: number; level: number }[];
    pathIdx: number;
    // Why: defaults to 0, so the door placement must be a path tile.
    // Why: pathfinder door edges put the closed loc on an edge endpoint, while lateral house doors sit at d≥1.

    /** Max Chebyshev distance from a path tile for a door to count as on-route. */
    corridor?: number;
    /** How far ahead of pathIdx to consider (default 12). */
    window?: number;
    /**
     * Planned door/gate hop placements (transport.locX/Z) ahead on the path.
     * Highest priority — exact map placement we intend to cross.
     */
    hopDoors?: readonly { x: number; z: number }[];
}

// Why: with a path hint only doors whose placement is a path tile (or matches a planned hop) qualify — an off-path house or shop door is never opened for being nearer.
// Why: without a path the nearest closed barrier wins, which is the walkResilient unstick case only.
// Why: kept a pure helper so tests can pin the preference without a live scene.

/** Pick which nearby closed barrier to open. */
export function pickNearbyDoorTile(
    candidates: readonly { x: number; z: number; level: number }[],
    me: { x: number; z: number; level: number },
    path?: PathDoorHint | null
): { x: number; z: number; level: number } | null {
    if (candidates.length === 0) {
        return null;
    }
    const hasPath = !!(path && path.tiles.length > 0);
    // Default 0: must be *on* a path tile. corridor=1 treats every street-front
    // door as on-route and re-opens the "tour the house" failure mode.
    const corridor = path?.corridor ?? 0;
    const window = path?.window ?? 12;
    const hopDoors = path?.hopDoors ?? [];
    let best: { x: number; z: number; level: number } | null = null;
    let bestScore = -Infinity;

    for (const c of candidates) {
        if (c.level !== me.level) {
            continue;
        }
        const distMe = Math.max(Math.abs(c.x - me.x), Math.abs(c.z - me.z));
        let score: number;

        if (!hasPath) {
            // Unstick / no route: nearest closed barrier only.
            score = -distMe;
        } else {
            const hopMatch = hopDoors.some(h => h.x === c.x && h.z === c.z);
            const lo = Math.max(0, path!.pathIdx);
            const hi = Math.min(path!.tiles.length - 1, path!.pathIdx + window);
            let onPath = false;
            let pathDist = 999;
            for (let i = lo; i <= hi; i++) {
                const t = path!.tiles[i]!;
                if (t.level !== c.level) {
                    continue;
                }
                const d = Math.max(Math.abs(c.x - t.x), Math.abs(c.z - t.z));
                if (d < pathDist) {
                    pathDist = d;
                }
                if (d <= corridor) {
                    onPath = true;
                }
            }
            if (hopMatch) {
                // Exact planned hop placement beats path-tile proximity.
                score = 2000 - distMe;
            } else if (onPath) {
                score = 1000 - pathDist - distMe * 0.01;
            } else {
                // Off-path: never open when we have a published route.
                continue;
            }
        }

        if (score > bestScore) {
            bestScore = score;
            best = c;
        }
    }
    return best;
}

export async function tryNearbyDoor(
    log: (msg: string) => void,
    path?: PathDoorHint | null,
    /** Placements already given up on — never re-open one the route now avoids. */
    exclude?: ReadonlySet<string>
): Promise<boolean> {
    const me = reader.worldTile();
    if (!me) {
        return false;
    }
    const candidates = Locs.query()
        .where(l => isOpenableBarrier(l.name, l.actions()))
        .within(3)
        .results()
        .filter(l => {
            const t = l.tile();
            return !DESERT_MINING_CAMP_SCRIPTED_DOOR_IDS.has(l.id) && !exclude?.has(`${t.x}|${t.z}`);
        });
    if (candidates.length === 0) {
        return false;
    }
    const pick = pickNearbyDoorTile(
        candidates.map(l => {
            const t = l.tile();
            return { x: t.x, z: t.z, level: me.level };
        }),
        me,
        path
    );
    const door =
        pick === null
            ? null
            : (candidates.find(l => {
                const t = l.tile();
                return t.x === pick.x && t.z === pick.z;
            }) ?? null);
    if (!door) {
        // Path-scoped stall with only off-path doors nearby — repath, don't tour houses.
        if (path && path.tiles.length > 0) {
            log('stalled with no path-corridor door to open — leaving door-hunt to repath');
        }
        return false;
    }

    const op = door.actions().find(a => /^open/i.test(a));
    const t = door.tile();
    const hopHit = path?.hopDoors?.some(h => h.x === t.x && h.z === t.z) ?? false;
    const scoped =
        path && path.tiles.length > 0 ? (hopHit ? ' (path hop)' : ' (path corridor)') : '';
    log(`stalled next to closed '${door.name}' at (${t.x},${t.z})${scoped} — opening it`);
    if (!op || !door.interact(op)) {
        return false;
    }
    const opened = await Execution.delayUntil(() => {
        const cur = Locs.query()
            .where(
                l =>
                    l.tile().x === t.x
                    && l.tile().z === t.z
                    && (l.name ?? '') === (door.name ?? '')
                    && isOpenableBarrier(l.name, l.actions())
            )
            .nearest();
        return cur === null || Reachability.canReach(t, { maxSteps: 200, adjacentOk: true });
    }, 5000);

    // Quest-lock mesbox with no passage → caller may blacklist via return flag.
    if (!opened && chatShowsQuestLock()) {
        await dismissQuestLockDialogue();
        return false;
    }
    return opened;
}

/**
 * After a failed nearby-door open, if chat shows quest lock, return the door tile to blacklist.
 */
export function questLockDoorTileNearPlayer(): { x: number; z: number } | null {
    if (!chatShowsQuestLock()) {
        return null;
    }
    const door = Locs.query()
        .where(l => /(door|gate)/i.test(l.name ?? ''))
        .within(3)
        .nearest();
    if (!door) {
        return null;
    }
    const t = door.tile();
    return { x: t.x, z: t.z };
}

/**
 * True when the barrier is not a shut Open-target (open leaf with Close, or
 * no matching loc). Caller still verifies passage with Reachability.
 */
export function barrierLooksOpen(transport: TransportInfo): boolean {
    return findTransportLoc(transport) === null;
}

export async function crossMultiTileDoor(
    approach: PathStepTile,
    step: PathStepTile,
    transport: TransportInfo,
    log: (msg: string) => void,
    onQuestLock?: (x: number, z: number) => void
): Promise<boolean> {
    const dir = { x: Math.sign(step.x - approach.x), z: Math.sign(step.z - approach.z) };
    const landing = { x: step.x + dir.x, z: step.z + dir.z, level: step.level };

    // Why: a web already slashed (multiloc or a prior cut) is walked through as soon as "Slashed web" or passage shows, without a long canStep-only poll.
    // Why: only an identical placement matches, so a neighbouring web is never slashed instead.
    if (isSlashWebTransport(transport.locName, transport.action)) {
        const here0 = reader.worldTile();
        if (isOnFarSide(here0, approach, step)) {
            log(`crossed '${transport.locName}' at (${transport.locX},${transport.locZ}) (already past)`);
            return true;
        }
        if (webPassageReady(transport, approach, step)) {
            return walkThroughWeb(
                approach,
                step,
                transport,
                log,
                slashedWebAtPlacement(transport.locX, transport.locZ)
                    ? 'already slashed'
                    : 'already open'
            );
        }
    }

    // Fast path: already open (or gone). Skip approach-Open-wait loops that feel
    // like a multi-second pause at every previously-opened door on the route.
    if (barrierLooksOpen(transport)) {
        const here0 = reader.worldTile();
        if (isOnFarSide(here0, approach, step)) {
            log(`crossed '${transport.locName}' at (${transport.locX},${transport.locZ}) (already past)`);
            return true;
        }
        const passage =
            Reachability.canStep(approach, step)
            || Reachability.canReach(step, { maxSteps: 64, adjacentOk: true });
        if (passage) {
            log(`${transport.locName} at (${transport.locX},${transport.locZ}) already open — continuing`);
            // Only nudge through if we are already on the approach tile; otherwise
            // clear the hop and let the path follower walk the open corridor.
            if (
                here0
                && here0.level === approach.level
                && here0.x === approach.x
                && here0.z === approach.z
            ) {
                DirectNavigator.walk(step);
                await Execution.delayUntil(() => isOnFarSide(reader.worldTile(), approach, step), 2500);
                if (isOnFarSide(reader.worldTile(), approach, step)) {
                    log(`crossed '${transport.locName}' at (${transport.locX},${transport.locZ})`);
                    return true;
                }
            }
            return true;
        }
        // No shut Open-target but passage still blocked — fall through to scene-step.
        log(`${transport.locName} open-loc missing but edge blocked — scene-stepping`);
    }

    const deadline = performance.now() + MULTI_DOOR_CROSS_MS;
    while (performance.now() < deadline) {
        const here = reader.worldTile();
        if (isOnFarSide(here, approach, step)) {
            log(`crossed '${transport.locName}' at (${transport.locX},${transport.locZ})`);
            return true;
        }
        // Mid-loop: web became slashed (us or someone else) → walk, do not re-Slash.
        if (
            isSlashWebTransport(transport.locName, transport.action)
            && webPassageReady(transport, approach, step)
        ) {
            return walkThroughWeb(
                approach,
                step,
                transport,
                log,
                slashedWebAtPlacement(transport.locX, transport.locZ)
                    ? 'slashed'
                    : 'passage open'
            );
        }
        const shut = findTransportLoc(transport);
        if (shouldApproachClosedBarrier(here, approach, shut !== null)) {
            DirectNavigator.walk(approach);
            await Execution.delayUntil(() => {
                const p = reader.worldTile();
                return p !== null && p.x === approach.x && p.z === approach.z && p.level === approach.level;
            }, APPROACH_WALK_MS);
            continue;
        }
        if (shut) {
            const mark = GameMessages.mark();
            // Stand on the approach tile before Open — CANT_REACH is common when
            // the walker clicks a door from one tile too far (manor vestibule, guild).
            const p0 = reader.worldTile();
            if (
                p0
                && (p0.x !== approach.x || p0.z !== approach.z || p0.level !== approach.level)
                && Math.max(Math.abs(p0.x - approach.x), Math.abs(p0.z - approach.z)) <= 4
            ) {
                DirectNavigator.walk(approach);
                await Execution.delayUntil(() => {
                    const p = reader.worldTile();
                    return p !== null && p.x === approach.x && p.z === approach.z && p.level === approach.level;
                }, APPROACH_WALK_MS);
            }
            // Why: content web.rs2 decides a slash by chat — random(2) fail sends "You fail to cut through it.", which retries the same web now.
            // Why: on success the code waits for Slashed web or passage, walks through once and returns rather than continue-looping onto the neighbour web.
            if (isSlashWebTransport(transport.locName, transport.action)) {
                const outcome = await attemptSlashWeb(shut, transport, mark, log);
                if (outcome === 'no_blade' || outcome === 'cant_reach') {
                    return false;
                }
                if (outcome === 'fail') {
                    // Immediate retry on the same placement (still shut).
                    continue;
                }
                if (outcome === 'success') {
                    return walkThroughWeb(approach, step, transport, log, 'just slashed');
                }
                // timeout / unknown — retry same placement
                continue;
            }

            const sent = await shut.interact(transport.action);
            if (!sent) {
                log(`'${transport.action}' not offered by ${transport.locName} (ops: ${shut.actions().join(', ')})`);
                return false;
            }
            await Execution.delayUntil(
                () =>
                    findTransportLoc(transport) === null
                    || Reachability.canStep(approach, step)
                    || GameMessages.sawSince(mark, CANT_REACH)
                    || chatShowsQuestLock(),
                OPEN_WAIT_MS
            );
            if (GameMessages.sawSince(mark, CANT_REACH)) {
                log(`server says can't reach ${transport.locName} — repathing`);
                return false;
            }
            if (chatShowsQuestLock()) {
                log(`quest-locked '${transport.locName}' at (${transport.locX},${transport.locZ}) — blacklisting`);
                await dismissQuestLockDialogue();
                onQuestLock?.(transport.locX, transport.locZ);
                return false;
            }
            // Collision often lags a tick after Open — step through immediately.
            await Execution.delayTicks(1);
            DirectNavigator.walk(step);
            await Execution.delayUntil(() => isOnFarSide(reader.worldTile(), approach, step), 4000);
            continue;
        }
        const canStepEdge = Reachability.canStep(approach, step);
        const landingLocal = reader.toLocal(landing.x, landing.z);
        const canReachLanding = landingLocal !== null && Reachability.canReach(landing, { maxSteps: 128 });
        const choice = chooseCrossClick(canStepEdge, canReachLanding);
        if (choice === 'step') {
            DirectNavigator.walk(step);
            await Execution.delayUntil(() => isOnFarSide(reader.worldTile(), approach, step), 3000);
        } else if (choice === 'landing-click') {
            Input.walk(landingLocal!.lx, landingLocal!.lz);
            await Execution.delayTicks(2);
        } else {
            log(`leaf blocks landing — scene-stepping through '${transport.locName}'`);
            DirectNavigator.walk(landing);
            await Execution.delayUntil(() => isOnFarSide(reader.worldTile(), approach, step), SCENE_STEP_MS);
        }
    }
    // Timed out — check quest lock mesbox left open.
    if (chatShowsQuestLock()) {
        log(`quest-locked '${transport.locName}' at (${transport.locX},${transport.locZ}) — blacklisting`);
        await dismissQuestLockDialogue();
        onQuestLock?.(transport.locX, transport.locZ);
    }
    log(`${transport.locName} at (${transport.locX},${transport.locZ}) did not cross in time, repathing`);
    return false;
}
