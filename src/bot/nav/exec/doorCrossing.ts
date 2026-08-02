/**
 * Multi-tile door / gate crossing + stall nearby-door open (extracted from WalkExecutor).
 */

import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/Execution.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Locs } from '../../api/queries/Locs.js';
import { Reachability } from '../../api/Reachability.js';
import { CANT_REACH, GameMessages } from '../../events/gameMessages.js';
import { ActionRouter } from '../../input/ActionRouter.js';
import { DirectNavigator } from '../DirectNavigator.js';
import {
    chooseCrossClick,
    isOnFarSide,
    shouldApproachClosedBarrier
} from '../followMath.js';
import type { TransportInfo } from '../PathFinder.js';
import { findTransportLoc } from './transportLoc.js';
import { chatShowsQuestLock, dismissQuestLockDialogue } from './questLock.js';

const MULTI_DOOR_CROSS_MS = 36_000;
const OPEN_WAIT_MS = 4000;
const APPROACH_WALK_MS = 3000;
const SCENE_STEP_MS = 8000;

export interface PathStepTile extends WorldTile {
    transport?: TransportInfo;
}

export function isOpenableBarrier(name: string | null, ops: readonly (string | null)[]): boolean {
    return /(door|gate)/i.test(name ?? '') && ops.some(op => op !== null && /^open/i.test(op));
}

export function isOpenBarrierLeaf(name: string | null, ops: readonly (string | null)[]): boolean {
    return /(door|gate)/i.test(name ?? '') && ops.some(op => op !== null && /^close/i.test(op));
}

export function noteFailedDoor(
    step: PathStepTile,
    doorStrikes: Map<string, number>,
    avoidDoors: { x: number; z: number }[]
): void {
    const t = step.transport;
    if (!t) {
        return;
    }
    const key = `${t.locX}|${t.locZ}`;
    const strikes = (doorStrikes.get(key) ?? 0) + 1;
    doorStrikes.set(key, strikes);
    if (strikes >= 2) {
        avoidDoors.push({ x: t.locX, z: t.locZ });
    }
}

export async function tryNearbyDoor(log: (msg: string) => void): Promise<boolean> {
    const door = Locs.query()
        .where(l => isOpenableBarrier(l.name, l.actions()))
        .within(3)
        .nearest();
    if (!door) {
        return false;
    }

    const op = door.actions().find(a => /^open/i.test(a));
    const t = door.tile();
    log(`stalled next to closed '${door.name}' at (${t.x},${t.z}) — opening it`);
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

export async function crossMultiTileDoor(
    approach: PathStepTile,
    step: PathStepTile,
    transport: TransportInfo,
    log: (msg: string) => void,
    onQuestLock?: (x: number, z: number) => void
): Promise<boolean> {
    const dir = { x: Math.sign(step.x - approach.x), z: Math.sign(step.z - approach.z) };
    const landing = { x: step.x + dir.x, z: step.z + dir.z, level: step.level };
    const deadline = performance.now() + MULTI_DOOR_CROSS_MS;
    while (performance.now() < deadline) {
        const here = reader.worldTile();
        if (isOnFarSide(here, approach, step)) {
            log(`crossed '${transport.locName}' at (${transport.locX},${transport.locZ})`);
            return true;
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
            const knife = transport.action === 'Slash' ? Inventory.first('Knife') : null;
            if (knife !== null) {
                log(`using the ${knife.name} on ${transport.locName} at (${transport.locX},${transport.locZ})`);
            }
            const sent = knife !== null ? await Promise.resolve(knife.useOn(shut)) : shut.interact(transport.action);
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
            ActionRouter.driver.walk(landingLocal!.lx, landingLocal!.lz);
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
