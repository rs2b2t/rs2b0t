import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Game } from '../../../../game/Game.js';
import { crossTeleportDoor, settleScene, useOnLoc } from '../../exec/prompts.js';
import {
    HERO_ID,
    HERO_LOC,
    HERO_SAY,
    HERO_TILE,
    inBrimhavenHq,
    inGarden,
    inKitchen,
    inMansion,
    inSideRoom,
    inTreasureRoom,
    inYard
} from './areas.js';

// Why: every door here is script-gated and absent from the baked graph, so the module owns both
// directions of each one — a crossing removed from the navigator seals whatever it guards.

function log2(log: (m: string) => void, mark: number, what: string): void {
    for (const line of GameMessages.since(mark)) {
        log(`${what}: ${line.text}`);
    }
}

/**
 * Grubor's door: the first Open raises his challenge, and only the answer unbars it. The second
 * Open crosses.
 */
export async function enterBrimhavenHq(log: (m: string) => void): Promise<boolean> {
    if (inBrimhavenHq(Game.tile())) {
        return true;
    }
    // Why: every pocket in this quest is sealed in the baked graph, so a bot standing in one of the
    // others has no route to this door at all — the walk reads `unreachable` and never starts.
    if (!(await returnToStreet(log))) {
        return false;
    }
    const mark = GameMessages.mark();
    for (let attempt = 0; attempt < 2 && !inBrimhavenHq(Game.tile()); attempt++) {
        await crossTeleportDoor({
            id: HERO_LOC.GRUBOR_DOOR,
            stand: HERO_TILE.GRUBOR_DOOR,
            isFar: () => inBrimhavenHq(Game.tile()),
            prefer: [HERO_SAY.BLACK_ARM_PASSWORD],
            log
        });
        await settleScene();
    }
    if (inBrimhavenHq(Game.tile())) {
        return true;
    }
    log2(log, mark, 'grubor door');
    return false;
}

export async function leaveBrimhavenHq(log: (m: string) => void): Promise<boolean> {
    if (!inBrimhavenHq(Game.tile())) {
        return true;
    }
    return crossTeleportDoor({
        id: HERO_LOC.GRUBOR_DOOR,
        stand: HERO_TILE.GRUBOR_DOOR_INNER,
        isFar: () => !inBrimhavenHq(Game.tile()),
        log
    });
}

/**
 * Garv's door: the first Open is his challenge, which only passes with the papers in the pack and
 * the black armour worn, and it unlocks rather than opening. The second Open crosses.
 */
export async function enterMansion(log: (m: string) => void): Promise<boolean> {
    if (inMansion(Game.tile())) {
        return true;
    }
    if (inTreasureRoom(Game.tile())) {
        return crossTreasureDoorOut(log);
    }
    // Why: Garv's door is out of the baked graph, so from the hideout or the kitchen there is no route
    // to it — the pocket has to be left before the walk can even be planned.
    if (!(await returnToStreet(log))) {
        return false;
    }
    const mark = GameMessages.mark();
    for (let attempt = 0; attempt < 2 && !inMansion(Game.tile()); attempt++) {
        await crossTeleportDoor({
            id: HERO_LOC.GARV_DOOR,
            stand: HERO_TILE.GARV_DOOR,
            isFar: () => inMansion(Game.tile()),
            prefer: [],
            log
        });
        await settleScene();
    }
    if (inMansion(Game.tile())) {
        return true;
    }
    log2(log, mark, 'garv door');
    return false;
}

export async function leaveMansion(log: (m: string) => void): Promise<boolean> {
    if (!inMansion(Game.tile())) {
        return true;
    }
    return crossTeleportDoor({
        id: HERO_LOC.GARV_DOOR,
        stand: HERO_TILE.GARV_DOOR_INNER,
        isFar: () => !inMansion(Game.tile()),
        log
    });
}

export async function enterKitchen(log: (m: string) => void): Promise<boolean> {
    if (inKitchen(Game.tile()) || inGarden(Game.tile()) || inYard(Game.tile()) || inSideRoom(Game.tile())) {
        return true;
    }
    // Why: the kitchen door is out of the baked graph, so a bot inside the hideout or the mansion has
    // no route to the restaurant floor it is clicked from.
    if (!(await returnToStreet(log))) {
        return false;
    }
    return crossTeleportDoor({
        id: HERO_LOC.KITCHEN_DOOR,
        stand: HERO_TILE.KITCHEN_DOOR,
        isFar: () => inKitchen(Game.tile()),
        log
    });
}

export async function leaveKitchen(log: (m: string) => void): Promise<boolean> {
    if (!inKitchen(Game.tile())) {
        return true;
    }
    return crossTeleportDoor({
        id: HERO_LOC.KITCHEN_DOOR,
        stand: HERO_TILE.KITCHEN_DOOR_INNER,
        isFar: () => !inKitchen(Game.tile()),
        log
    });
}

/** The kitchen's secret panel is a Wall with a Push, never a Door, so no derivation ever bakes it. */
export async function pushPanel(log: (m: string) => void): Promise<boolean> {
    if (inGarden(Game.tile())) {
        return true;
    }
    if (!(await enterKitchen(log))) {
        return false;
    }
    return crossTeleportDoor({
        id: HERO_LOC.KITCHEN_PANEL,
        stand: HERO_TILE.KITCHEN_PANEL,
        name: 'Wall',
        op: 'Push',
        isFar: () => inGarden(Game.tile()),
        log
    });
}

// Why: the yard reaches the garden through an ordinary door the graph already carries, so both sides
// of the panel push start from wherever behind it the character happens to be.
export async function pushPanelBack(log: (m: string) => void): Promise<boolean> {
    if (!inGarden(Game.tile()) && !inYard(Game.tile())) {
        return true;
    }
    return crossTeleportDoor({
        id: HERO_LOC.KITCHEN_PANEL,
        stand: HERO_TILE.KITCHEN_PANEL_INNER,
        name: 'Wall',
        op: 'Push',
        isFar: () => inKitchen(Game.tile()),
        log
    });
}

/**
 * Undo whichever sealed pocket the character is standing in, so a walk to a bank, a shop or a partner
 * has a route at all. Every door here is out of the baked graph.
 */
export async function returnToStreet(log: (m: string) => void): Promise<boolean> {
    if (inTreasureRoom(Game.tile()) && !(await crossTreasureDoorOut(log))) {
        return false;
    }
    if (inMansion(Game.tile()) && !(await leaveMansion(log))) {
        return false;
    }
    if (inSideRoom(Game.tile()) && !(await crossSideDoorOut(log))) {
        return false;
    }
    if (!(await pushPanelBack(log))) {
        return false;
    }
    if (!(await leaveKitchen(log))) {
        return false;
    }
    return leaveBrimhavenHq(log);
}

// Why: `[oploc1,pete_sidedoor]` only opens for someone already standing on the door's own row, which
// is the side room — from the yard it answers "This door is locked" and yields only to the key.

/** Into the five-tile side room, which needs Grip's spare key from a Black Arm partner. */
export async function crossSideDoorIn(log: (m: string) => void): Promise<boolean> {
    if (inSideRoom(Game.tile())) {
        return true;
    }
    const mark = GameMessages.mark();
    const ok = await useOnLoc(
        HERO_ID.MISC_KEY,
        { name: 'Door', near: HERO_TILE.YARD, within: 4, id: HERO_LOC.SIDE_DOOR },
        [],
        () => inSideRoom(Game.tile()),
        log
    );
    if (!ok) {
        log2(log, mark, 'side door');
    }
    return ok;
}

export async function crossSideDoorOut(log: (m: string) => void): Promise<boolean> {
    if (!inSideRoom(Game.tile())) {
        return true;
    }
    return crossTeleportDoor({
        id: HERO_LOC.SIDE_DOOR,
        stand: HERO_TILE.SIDE_ROOM,
        isFar: () => !inSideRoom(Game.tile()),
        log
    });
}

/** Into the treasure room, which yields only to Grip's own keyring and only after the papers. */
export async function crossTreasureDoorIn(log: (m: string) => void): Promise<boolean> {
    if (inTreasureRoom(Game.tile())) {
        return true;
    }
    const mark = GameMessages.mark();
    const ok = await useOnLoc(
        HERO_ID.GRIP_KEYS,
        { name: 'Door', near: HERO_TILE.TREASURE_DOOR, within: 4, id: HERO_LOC.TREASURE_DOOR },
        [],
        () => inTreasureRoom(Game.tile()),
        log
    );
    if (!ok) {
        log2(log, mark, 'treasure door');
    }
    return ok;
}

export async function crossTreasureDoorOut(log: (m: string) => void): Promise<boolean> {
    if (!inTreasureRoom(Game.tile())) {
        return true;
    }
    return crossTeleportDoor({
        id: HERO_LOC.TREASURE_DOOR,
        stand: HERO_TILE.TREASURE_DOOR_INNER,
        isFar: () => !inTreasureRoom(Game.tile()),
        log
    });
}
