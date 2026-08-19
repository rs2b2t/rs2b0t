// docs/QUESTS.md
import { DirectNavigator } from '../../../../../event/webwalk/DirectNavigator.js';
import type Tile from '../../../../../geometry/Tile.js';
import { Equipment } from '../../../../equipment/Equipment.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Locs } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { heldId, settleScene } from '../../exec/prompts.js';
import { isUnderground, talkStrict } from '../../exec/primitives.js';
import {
    GUARDIAN_STOP,
    IKOV_LOC,
    IKOV_NAME,
    IKOV_OBJ,
    IKOV_TILE,
    LAVA_BRIDGE_ZONE,
    WINELDA_STOP,
    inGuardianTemple,
    onWineldaLedge
} from './areas.js';
import { escapePocket } from './dungeon.js';

const WALK_MS = 300_000;

function templeWalk(dest: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    return Traversal.walkResilient(dest, {
        radius,
        attempts: 3,
        timeoutMs: WALK_MS,
        avoidZones: [LAVA_BRIDGE_ZONE],
        log
    });
}

// Why: her teleport lands five ticks after the conversation closes, so a leg that acts the moment it returns is still standing on the ledge — where the shiny key is a McGrubor round trip away rather than seventy tiles.

/** Wait out Winelda's ferry, and ask her again if it never came. */
async function ensureAcrossTheLava(log: (m: string) => void): Promise<boolean> {
    const onLedge = (): boolean => {
        const t = Game.tile();
        return t !== null && onWineldaLedge(t);
    };
    if (!onLedge()) {
        return true;
    }
    if (await Execution.delayUntil(() => !onLedge(), 12_000)) {
        await settleScene();
        return true;
    }
    log('ikov: still on the ledge — asking Winelda for the ferry again');
    if (!(await templeWalk(IKOV_TILE.WINELDA, 2, log))) {
        return false;
    }
    if (!(await talkStrict(WINELDA_STOP.npc, WINELDA_STOP.prefer, log))) {
        return false;
    }
    const crossed = await Execution.delayUntil(() => !onLedge(), 15_000);
    if (crossed) {
        await settleScene();
    }
    return crossed;
}

async function takeShinyKey(log: (m: string) => void): Promise<boolean> {
    if (heldId(IKOV_OBJ.SHINY_KEY) > 0) {
        return true;
    }
    if (!(await templeWalk(IKOV_TILE.SHINY_KEY_SPAWN, 1, log))) {
        return false;
    }
    const key = GroundItems.query().where(g => g.id === IKOV_OBJ.SHINY_KEY).within(8).nearest();
    if (!key) {
        log(`ikov: no shiny key at (${IKOV_TILE.SHINY_KEY_SPAWN.x},${IKOV_TILE.SHINY_KEY_SPAWN.z})`);
        return false;
    }
    if (!(await key.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(IKOV_OBJ.SHINY_KEY) > 0, 8000);
}

// Why: the wall is a "Wall" with a `Push`, not a door, so `derive-doors` never baked it and no route crosses it on its own.
async function pushSecretWall(intoTemple: boolean, log: (m: string) => void): Promise<boolean> {
    const arrived = (): boolean => {
        const t = Game.tile();
        return t !== null && inGuardianTemple(t) === intoTemple;
    };
    if (arrived()) {
        return true;
    }
    const stand = intoTemple ? IKOV_TILE.SECRET_WALL : IKOV_TILE.SECRET_WALL_INSIDE;
    const through = intoTemple ? IKOV_TILE.SECRET_WALL_INSIDE : IKOV_TILE.SECRET_WALL;
    if (!(await templeWalk(stand, 0, log))) {
        return false;
    }
    await settleScene();
    const wall = Locs.query()
        .where(l => l.id === IKOV_LOC.SECRET_WALL || l.id === IKOV_LOC.SECRET_WALL_OPEN)
        .within(4)
        .nearest();
    if (wall && wall.id === IKOV_LOC.SECRET_WALL) {
        log(`ikov: pushing the secret wall ${intoTemple ? 'into' : 'out of'} the guardians' temple`);
        if (!(await wall.interact('Push'))) {
            return false;
        }
        // Why: `open_and_close_door2` teleports the player through rather than opening a leaf to walk past.
        if (await Execution.delayUntil(arrived, 8000)) {
            await settleScene();
            return true;
        }
    }
    await DirectNavigator.walkTo(through, 0, 8000);
    if (!arrived()) {
        return false;
    }
    await settleScene();
    return true;
}

/** Everything the guardians must not see: Lucien's pendant worn, or the staff carried. */
async function shedLucienColours(log: (m: string) => void): Promise<boolean> {
    if (Equipment.contains(IKOV_NAME.PENDANT_LUCIEN)) {
        log("ikov: stowing Lucien's pendant before the guardians see it");
        if (!(await Equipment.unequip(IKOV_NAME.PENDANT_LUCIEN))) {
            return false;
        }
    }
    if (heldId(IKOV_OBJ.STAFF) > 0) {
        log('ikov: holding the staff would set every guardian on us — this run does not take it');
        return false;
    }
    return true;
}

/**
 * Cross the wall and talk a guardian into the Armadyl pendant.
 * @see docs/decisions/quest-pitfalls-25.md
 */
export async function joinTheGuardians(log: (m: string) => void): Promise<boolean> {
    if (heldId(IKOV_OBJ.PENDANT_ARMADYL) > 0 || Equipment.contains(IKOV_NAME.PENDANT_ARMADYL)) {
        return true;
    }
    if (!(await escapePocket(log))) {
        return false;
    }
    if (!(await ensureAcrossTheLava(log))) {
        return false;
    }
    if (!(await takeShinyKey(log))) {
        return false;
    }
    if (!(await shedLucienColours(log))) {
        return false;
    }
    if (!(await pushSecretWall(true, log))) {
        return false;
    }
    if (!(await templeWalk(IKOV_TILE.GUARDIANS, 2, log))) {
        return false;
    }
    await settleScene();
    if (!(await talkStrict(GUARDIAN_STOP.npc, GUARDIAN_STOP.prefer, log))) {
        return false;
    }
    return Execution.delayUntil(
        () => heldId(IKOV_OBJ.PENDANT_ARMADYL) > 0 || Equipment.contains(IKOV_NAME.PENDANT_ARMADYL),
        8000
    );
}

/** The shiny-key door in McGrubor's Wood is the only way off the far side of the lava. */
export async function leaveTheFarSide(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!here) {
        return false;
    }
    // Why: the leg only runs past Winelda's ferry, so standing on the surface is proof it has already been left.
    if (!isUnderground(here)) {
        return true;
    }
    if (inGuardianTemple(here) && !(await pushSecretWall(false, log))) {
        return false;
    }
    if (!(await takeShinyKey(log))) {
        return false;
    }
    if (!(await templeWalk(IKOV_TILE.MCGRUBOR_LADDER, 1, log))) {
        return false;
    }
    const ladder = Locs.query().name('Ladder').action('Climb-up').within(4).nearest();
    if (!ladder || !(await ladder.interact('Climb-up'))) {
        log("ikov: no ladder up to McGrubor's Wood");
        return false;
    }
    const out = await Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && t.z < 5000;
    }, 10_000);
    if (out) {
        await settleScene();
    }
    return out;
}
