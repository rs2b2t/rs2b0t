import { reader } from '../../../../../adapter/ClientAdapter.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Locs } from '../../../../locs/Locs.js';
import { Reach } from '../../../../walking/Reach.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type { WorldTile } from '../../../../../adapter/ClientAdapter.js';
import type Tile from '../../../../../geometry/Tile.js';
import { SOA_LOC, SOA_TILE, inBlackArmInner, inBlackArmUpper, inPhoenixHq, inPhoenixInner, inStoreGround, inWeaponStore } from './areas.js';
import { driveChoice, promptLoc, settleScene } from '../../exec/prompts.js';
import type { NpcStop } from '../../exec/primitives.js';

const CLIMB_MS = 12_000;
const WALK_MS = 120_000;

// Why: `isFar` is a component test, not a distance test — the two sides of a one-tile wall are two tiles apart.

/** A hideout door teleports you through, so landing on the far side is the only proof. */
async function crossDoor(
    id: number,
    stand: Tile,
    isFar: (t: WorldTile | null) => boolean,
    log: (m: string) => void
): Promise<boolean> {
    if (isFar(Game.tile())) {
        return true;
    }
    if (!(await Traversal.walkResilient(stand, { radius: 1, attempts: 3, timeoutMs: WALK_MS, log }))) {
        return false;
    }
    // Why: `~open_hideout_door` calls `~door_open`, which swings the loc onto a different tile and id, so the shut id is not what stands there after anyone has opened it — and a sealed pocket has one door, so the Open-actioned neighbour is it.
    const door = Locs.query().action('Open').within(4).where(l => l.id === id).nearest()
        ?? Locs.query().action('Open').within(2).where(l => l.name === 'Door').nearest();
    if (!door) {
        log(`no door ${id} or Door within four tiles of (${stand.x},${stand.z})`);
        return false;
    }
    const mark = GameMessages.mark();
    if (!(await door.interact('Open'))) {
        log(`door ${id} refused the Open click`);
        return false;
    }
    const crossed = await Execution.delayUntil(() => isFar(Game.tile()), CLIMB_MS);
    if (!crossed) {
        for (const line of GameMessages.since(mark)) {
            log(`door ${id}: ${line.text}`);
        }
        return false;
    }
    await settleScene();
    return true;
}

// Why: the scene keeps the shut id for a tick after the Open lands, so one check calls a successful open a failure.

/** Open a shut container and wait for its open twin to appear in the scene. */
export async function openContainer(
    name: string,
    shutId: number,
    openId: number,
    stand: Tile,
    log: (m: string) => void
): Promise<boolean> {
    const open = () => Locs.query().within(6).where(l => l.id === openId).nearest();
    for (let attempt = 0; attempt < 3; attempt++) {
        if (open()) {
            return true;
        }
        await promptLoc({
            name,
            op: 'Open',
            near: stand,
            id: shutId,
            within: 6,
            expect: () => open() !== null
        }, log);
        await settleScene();
    }
    if (open()) {
        return true;
    }
    log(`the shut ${name.toLowerCase()} (${shutId}) never became ${openId}`);
    return false;
}

/** Climb a loc that changes level, proving the arrival rather than the click. */
export async function climb(
    locId: number,
    op: string,
    stand: Tile,
    arrive: Tile,
    log: (m: string) => void
): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === arrive.level) {
        return true;
    }
    if (!(await Traversal.walkResilient(stand, { radius: 1, attempts: 3, timeoutMs: WALK_MS, log }))) {
        return false;
    }
    const loc = Locs.query().action(op).within(4).where(l => l.id === locId).nearest();
    if (!loc) {
        log(`no loc ${locId} offering '${op}' near (${stand.x},${stand.z})`);
        return false;
    }
    if (!(await loc.interact(op))) {
        log(`loc ${locId} refused '${op}'`);
        return false;
    }
    await Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && t.level === arrive.level;
    }, CLIMB_MS);
    await settleScene();
    if (Game.tile()?.level === arrive.level) {
        return true;
    }
    log(`'${op}' on loc ${locId} never reached level ${arrive.level}`);
    return false;
}

export async function enterHideout(log: (m: string) => void): Promise<boolean> {
    if (inPhoenixHq(Game.tile())) {
        return true;
    }
    // Why: Reach owns the approach — it walks, opens the building's door and retries on one budget, where a pre-walk plus its own walk spends two and wedges for minutes.
    // Why: two attempts, because the first from outside the building routinely lands on the wrong side of that door and a retry here is far cheaper than another quest-engine round trip.
    let status = 'retry';
    for (let attempt = 0; attempt < 2 && !inPhoenixHq(Game.tile()); attempt++) {
        status = await Reach.locOp({
            name: 'Ladder',
            op: 'Climb-down',
            near: SOA_TILE.CELLAR_LADDER,
            id: SOA_LOC.CELLAR_LADDER,
            expect: () => inPhoenixHq(Game.tile()),
            expectMs: 15_000,
            log
        });
        await settleScene();
    }
    // Why: the status is not the oracle — Reach reports 'retry' on a climb that landed, so where the character is standing settles it.
    if (inPhoenixHq(Game.tile())) {
        return true;
    }
    log(`descent into the hideout returned '${status}' and left the character on the surface`);
    return false;
}

// Why: `talkThrough` never walks, and `gotoNpc`'s shared hop calls a stand two tiles off "arrived" without moving.

/** Walk to a stop and drive its dialogue. */
export async function walkAndTalk(
    stop: NpcStop,
    prefer: readonly string[],
    log: (m: string) => void
): Promise<boolean> {
    const here = Game.tile();
    if (!here || stop.anchor.distanceTo(here) > stop.leash || here.level !== stop.anchor.level) {
        await Traversal.walkResilient(stop.anchor, { radius: 2, attempts: 3, timeoutMs: WALK_MS, log });
    }
    const status = await Reach.npcDialog({ name: stop.npc, near: stop.anchor, log });
    if (status !== 'done') {
        log(`could not open a dialogue with ${stop.npc} (${status})`);
        return false;
    }
    return driveChoice([...prefer], log);
}

// Why: `~mesbox` and `~objbox` build a MAIN modal that no dialogue driver can see, and the curator and the king both use them mid-conversation — a chat-only driver stalls on the first one.

/** Drive a conversation that mixes chat with mesboxes, until the goal lands. */
export async function talkUntil(
    stop: NpcStop,
    prefer: readonly string[],
    expect: () => boolean,
    log: (m: string) => void,
    ms = 45_000
): Promise<boolean> {
    if (expect()) {
        return true;
    }
    await walkAndTalk(stop, prefer, log);
    const deadline = performance.now() + ms;
    while (performance.now() < deadline && !expect()) {
        if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
            await driveChoice([...prefer], log);
            continue;
        }
        if (reader.modals().main !== -1) {
            await Modals.close();
            await Execution.delayTicks(1);
            continue;
        }
        await Execution.delayTicks(1);
    }
    // Why: the closing mesbox stays up after the goal lands, and a main modal blocks the next leg's player interaction.
    if (reader.modals().main !== -1) {
        await Modals.close();
    }
    if (!expect()) {
        log(`${stop.npc} conversation ended without the expected result`);
    }
    return expect();
}

/** Reach an NPC that lives inside the hideout, entering it first. */
export async function talkInHideout(
    stop: NpcStop,
    prefer: readonly string[],
    log: (m: string) => void
): Promise<boolean> {
    if (!(await enterHideout(log))) {
        return false;
    }
    return walkAndTalk(stop, prefer, log);
}

export async function leaveHideout(log: (m: string) => void): Promise<boolean> {
    if (!inPhoenixHq(Game.tile())) {
        return true;
    }
    // Why: the chest sits behind the gang door, which is the pocket's only crossing in either direction.
    if (inPhoenixInner(Game.tile())
        && !(await crossDoor(SOA_LOC.PHOENIX_DOOR, SOA_TILE.PHOENIX_DOOR_INNER, t => inPhoenixHq(t) && !inPhoenixInner(t), log))) {
        return false;
    }
    const status = await Reach.locOp({
        name: 'Ladder',
        op: 'Climb-up',
        near: SOA_TILE.HQ_LADDER,
        id: SOA_LOC.HQ_LADDER,
        expect: () => !inPhoenixHq(Game.tile()),
        expectMs: 15_000,
        log
    });
    await settleScene();
    if (!inPhoenixHq(Game.tile())) {
        return true;
    }
    log(`climb out of the hideout returned '${status}' and left the character underground`);
    return false;
}

/** Through the gang door into the half of the hideout the chest is in. */
export async function enterPhoenixInner(log: (m: string) => void): Promise<boolean> {
    if (!(await enterHideout(log))) {
        return false;
    }
    return crossDoor(SOA_LOC.PHOENIX_DOOR, SOA_TILE.PHOENIX_DOOR, inPhoenixInner, log);
}

/** Through the gang door only — the stairs are a leg further on. */
async function enterBlackArmInner(log: (m: string) => void): Promise<boolean> {
    if (inBlackArmInner(Game.tile()) || inBlackArmUpper(Game.tile())) {
        return true;
    }
    return crossDoor(SOA_LOC.BLACKARM_DOOR, SOA_TILE.BLACKARM_DOOR, inBlackArmInner, log);
}

export async function enterBlackArmUpper(log: (m: string) => void): Promise<boolean> {
    if (inBlackArmUpper(Game.tile())) {
        return true;
    }
    if (!(await enterBlackArmInner(log))) {
        return false;
    }
    return climb(SOA_LOC.BLACKARM_STAIRS, 'Climb-up', SOA_TILE.BLACKARM_STAIRS, SOA_TILE.BLACKARM_STAIRS_TOP, log);
}

export async function leaveBlackArmUpper(log: (m: string) => void): Promise<boolean> {
    if (inBlackArmUpper(Game.tile())
        && !(await climb(SOA_LOC.BLACKARM_STAIRS_TOP, 'Climb-down', SOA_TILE.BLACKARM_STAIRS_TOP, SOA_TILE.BLACKARM_STAIRS, log))) {
        return false;
    }
    // Why: the stairs sit in a pocket the gang door seals, and that door is out of the nav graph — climbing down alone strands the character with the half, and every route out reads unreachable.
    if (!inBlackArmInner(Game.tile())) {
        return true;
    }
    return crossDoor(SOA_LOC.BLACKARM_DOOR, SOA_TILE.BLACKARM_DOOR_INNER, t => t !== null && t.level === 0 && !inBlackArmInner(t), log);
}

export async function leaveWeaponStore(log: (m: string) => void): Promise<boolean> {
    if (inWeaponStore(Game.tile())
        && !(await climb(SOA_LOC.STORE_LADDER_TOP, 'Climb-down', SOA_TILE.STORE_LADDER_TOP, SOA_TILE.STORE_LADDER, log))) {
        return false;
    }
    // Why: the ground floor is a ten-tile pocket the store door seals, and that door is out of the nav graph — climbing down alone strands the character with the crossbows.
    // Why: `unlock_weaponstore_door` lets a leaver through on op1, so no key is needed on the way out.
    if (!inStoreGround(Game.tile())) {
        return true;
    }
    return crossDoor(SOA_LOC.STORE_DOOR, SOA_TILE.STORE_DOOR_INNER, t => t !== null && t.level === 0 && !inStoreGround(t), log);
}
