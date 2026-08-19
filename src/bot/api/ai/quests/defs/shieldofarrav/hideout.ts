import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Game } from '../../../../game/Game.js';
import { Reach } from '../../../../walking/Reach.js';
import type { WorldTile } from '../../../../../adapter/ClientAdapter.js';
import type Tile from '../../../../../geometry/Tile.js';
import { SOA_LOC, SOA_TILE, inBlackArmInner, inBlackArmUpper, inPhoenixHq, inPhoenixInner, inStoreGround, inWeaponStore } from './areas.js';
import { crossTeleportDoor, settleScene } from '../../exec/prompts.js';
import { climb, walkAndTalk } from '../../exec/legs.js';
import type { NpcStop } from '../../exec/primitives.js';

// Why: the generic legs live in exec/ so a second partner quest can use them; the hideout keeps only
// the Shield of Arrav pockets they are pointed at.
export { climb, openContainer, talkUntil, walkAndTalk } from '../../exec/legs.js';

// Why: `isFar` is a component test, not a distance test — the two sides of a one-tile wall are two tiles apart.

/** A hideout door teleports you through, so landing on the far side is the only proof. */
async function crossDoor(
    id: number,
    stand: Tile,
    isFar: (t: WorldTile | null) => boolean,
    log: (m: string) => void
): Promise<boolean> {
    const mark = GameMessages.mark();
    const crossed = await crossTeleportDoor({ id, stand, isFar: () => isFar(Game.tile()), log });
    if (!crossed) {
        for (const line of GameMessages.since(mark)) {
            log(`door ${id}: ${line.text}`);
        }
    }
    return crossed;
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
