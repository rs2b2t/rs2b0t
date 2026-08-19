import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import Tile from '../../../../../geometry/Tile.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { isUnderground } from '../../exec/primitives.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import { attackable, fight } from '../trollstronghold/combat.js';
import { OBS_ID, OBS_LOC, OBS_LOC_NAME, OBS_QUEST, OBS_TILE } from './areas.js';

const walk = (to: Tile, log: (m: string) => void, radius = 0): Promise<boolean> =>
    Traversal.walkResilient(to, { radius, attempts: 3, timeoutMs: 180_000, log });

function locById(id: number, within = 6): Loc | null {
    return Locs.query().where(l => l.id === id).within(within).nearest();
}

// Why: the dome is a walled pocket of the surface — nothing walks into it, and its own ladder only goes down.
export function inDome(t: { x: number; z: number; level: number }): boolean {
    return t.level === 0 && t.x >= 2430 && t.x <= 2450 && t.z >= 3150 && t.z <= 3170;
}

/** True while standing south of the keep gate, the four tiles the sack sits in. */
export function inKeep(t: { x: number; z: number }): boolean {
    return isUnderground(t) && t.x >= 2386 && t.x <= 2392 && t.z >= 9450 && t.z <= 9457;
}

// Why: `obs_dungeonladderdown` is a `p_telejump` behind two lines of the assistant warning about the goblins, which is why the derived graph marks the edge "behind a runtime guard" and disables it.
// Why: the climb has to drive that dialogue, so it is the module's leg rather than a `LadderHop` — `hopLadder` clicks and waits, and the wait outlives the conversation.

/** Climb the reception ladder into the cavern, answering the assistant on the way. */
export async function descend(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && isUnderground(here)) {
        return true;
    }
    if (!(await walk(OBS_TILE.RECEPTION_LADDER, log, 1))) {
        return false;
    }
    const ladder = locById(OBS_LOC.RECEPTION_LADDER, 4);
    if (!ladder) {
        log(`observatory: no cavern ladder at (${OBS_TILE.RECEPTION_LADDER.x},${OBS_TILE.RECEPTION_LADDER.z})`);
        return false;
    }
    log('observatory: climbing down into the goblin cavern');
    if (!(await ladder.interact('Climb-down'))) {
        return false;
    }
    const down = await driveUntil(() => {
        const t = Game.tile();
        return t !== null && isUnderground(t);
    }, [], log, 20_000);
    if (down) {
        await settleScene();
    }
    return down;
}

/** Climb out of the cavern the way the baked graph does, so the surface legs start above ground. */
async function ascendToReception(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && !isUnderground(here)) {
        return true;
    }
    return walk(OBS_TILE.PROFESSOR, log, 2);
}

// Why: `loc_2197` is the only one of the cavern's eight chests that holds a key — six of the others are `shutdungeonchest`, whose Search spawns a poisonous spider, so nothing here is looked up by the name they all share.
// Why: it is `forceapproach=north` placed at angle 2, which rotates the legal side to the south.

/** Open and search the keep-key chest. */
export async function fetchKeepKey(log: (m: string) => void): Promise<boolean> {
    if (heldId(OBS_ID.KEEP_KEY) > 0) {
        return true;
    }
    if (!(await descend(log))) {
        return false;
    }
    if (!(await walk(OBS_TILE.KEY_CHEST_STAND, log, 0))) {
        return false;
    }
    await settleScene();
    const shut = locById(OBS_LOC.KEY_CHEST_SHUT, 4);
    if (shut) {
        log('observatory: opening the keep-key chest');
        if (!(await shut.interact('Open'))) {
            return false;
        }
        await Execution.delayUntil(() => locById(OBS_LOC.KEY_CHEST_OPEN, 4) !== null, 6000);
    }
    const open = locById(OBS_LOC.KEY_CHEST_OPEN, 4);
    if (!open) {
        log(`observatory: no keep-key chest at (${OBS_TILE.KEY_CHEST_STAND.x},${OBS_TILE.KEY_CHEST_STAND.z})`);
        return false;
    }
    if (!(await open.interact('Search'))) {
        return false;
    }
    return driveUntil(() => heldId(OBS_ID.KEEP_KEY) > 0, [], log, 12_000);
}

function gate(): Loc | null {
    return Locs.query()
        .where(l => l.id === OBS_LOC.GATE_RIGHT || l.id === OBS_LOC.GATE_LEFT)
        .within(4)
        .nearest();
}

// Why: opening the gate runs `~npc_retaliate(0)` on any goblin guard within eight tiles, and it then follows the leg into the keep and interrupts the search.
// Why: it spawns beside the north stand, and an NPC standing on a tile makes it unwalkable for the client's own path search.

/** Clear the guard off the gate before touching it. */
async function clearGuard(log: (m: string) => void): Promise<boolean> {
    const guard = attackable('Goblin guard', 10);
    if (!guard) {
        return true;
    }
    log('observatory: killing the goblin guard on the keep gate');
    return fight({
        what: 'Goblin guard',
        target: () => attackable('Goblin guard', 10),
        won: () => attackable('Goblin guard', 10) === null,
        protect: 'melee',
        guard: 300
    }, log);
}

// Why: the gate does not swing — `@open_keep_gate` teleports the player one tile across it and re-adds the loc three ticks later, which is why the crossing is checked by the tile rather than by the loc.
// Why: from the north it refuses with "The gate is locked." until `%itkeepgatelock` is set, and the key is what sets it; from the south it always opens, and the key is never needed again.

/** Cross the keep gate southwards. False when it is still locked and the pack holds no key. */
export async function enterKeep(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && inKeep(here)) {
        return true;
    }
    if (!(await walk(OBS_TILE.GATE_NORTH, log, 0))) {
        return false;
    }
    await settleScene();
    await clearGuard(log);
    const shut = gate();
    if (!shut) {
        log(`observatory: no keep gate at (${OBS_TILE.GATE_NORTH.x},${OBS_TILE.GATE_NORTH.z})`);
        return false;
    }
    const key = Inventory.items().find(item => item.id === OBS_ID.KEEP_KEY);
    if (key) {
        log('observatory: unlocking the keep gate with the keep key');
        if (!(await key.useOn(shut))) {
            return false;
        }
    } else {
        log('observatory: trying the keep gate without a key');
        if (!(await shut.interact('Open'))) {
            return false;
        }
    }
    const crossed = await driveUntil(() => {
        const t = Game.tile();
        return t !== null && inKeep(t);
    }, [], log, 8000);
    // Why: "The gate is locked." is a chat line rather than a refusal the click reports, so the tile is the only test — and it is the one that says whether the key is needed at all.
    if (!crossed && !key) {
        log('observatory: the keep gate is locked — fetching the keep key');
        await fetchKeepKey(log);
    }
    return crossed;
}

/** Cross back out; from inside, the gate opens for anyone. */
async function leaveKeep(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && !inKeep(here)) {
        return true;
    }
    if (!(await walk(OBS_TILE.GATE_SOUTH, log, 0))) {
        return false;
    }
    const shut = gate();
    if (!shut || !(await shut.interact('Open'))) {
        log('observatory: cannot leave the keep — no gate in reach');
        return false;
    }
    return driveUntil(() => {
        const t = Game.tile();
        return t !== null && !inKeep(t);
    }, [], log, 10_000);
}

/** Fetch the lens mould from the sack the goblins hid it under, and get back out. */
export async function fetchLensMould(log: (m: string) => void): Promise<boolean> {
    if (heldId(OBS_ID.LENS_MOULD) === 0) {
        if (!(await descend(log))) {
            return false;
        }
        if (!(await enterKeep(log))) {
            return false;
        }
        if (!(await walk(OBS_TILE.SACK_STAND, log, 0))) {
            return false;
        }
        await settleScene();
        const sack = locById(OBS_LOC.SACK, 4);
        if (!sack) {
            log(`observatory: no sack at (${OBS_TILE.SACK_STAND.x},${OBS_TILE.SACK_STAND.z})`);
            return false;
        }
        log('observatory: searching the sack for the lens mould');
        if (!(await sack.interact('Search'))) {
            return false;
        }
        if (!(await driveUntil(() => heldId(OBS_ID.LENS_MOULD) > 0, [], log, 12_000))) {
            return false;
        }
    }
    if (!(await leaveKeep(log))) {
        return false;
    }
    return ascendToReception(log);
}

// Why: the dome's telescope only answers while `observatory_professor2` is within seven tiles of the player, and his copy stands three tiles from it.
// Why: `if_openmain(telescope)` puts the star chart on main and queues the conversation a tick later, so the chat options arrive underneath an open main modal rather than instead of one.

/** Climb into the dome, look through the telescope, and take the constellation. */
export async function useTelescope(log: (m: string) => void): Promise<boolean> {
    const start = Game.tile();
    if (!start || !inDome(start)) {
        if (!(await descend(log))) {
            return false;
        }
        if (!(await walk(OBS_TILE.DOME_LADDER_FOOT, log, 0))) {
            return false;
        }
        await settleScene();
        const ladder = Locs.query().name(OBS_LOC_NAME.LADDER).action('Climb-up').within(4).nearest();
        if (!ladder) {
            log(`observatory: no dome ladder at (${OBS_TILE.DOME_LADDER_FOOT.x},${OBS_TILE.DOME_LADDER_FOOT.z})`);
            return false;
        }
        log('observatory: climbing into the observatory dome');
        if (!(await ladder.interact('Climb-up'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && inDome(t);
        }, 10_000))) {
            return false;
        }
        await settleScene();
    }
    if (!(await walk(OBS_TILE.TELESCOPE_STAND, log, 1))) {
        return false;
    }
    await settleScene();
    const telescope = locById(OBS_LOC.TELESCOPE, 6);
    if (!telescope) {
        log(`observatory: no telescope at (${OBS_TILE.TELESCOPE_STAND.x},${OBS_TILE.TELESCOPE_STAND.z})`);
        return false;
    }
    log('observatory: looking through the telescope');
    if (!(await telescope.interact('Use'))) {
        return false;
    }
    // Why: the professor's "Well done, well done!!" is a chat that has to be driven before `if_openmain(telescope)` puts the star chart up.
    await driveUntil(() => Modals.isOpen(), [], log, 20_000);
    // Why: `canAccess()` is `!delayed && !containsModalInterface()`, and the constellation conversation is an engine queue — it cannot run while the chart the click opened is still on screen, so the queue sits there and the leg waits out its own success.
    if (Modals.isOpen()) {
        log('observatory: closing the star chart so the constellation conversation can run');
        await Modals.close();
    }
    return driveUntil(
        () => Quests.status(OBS_QUEST) === 'complete',
        ['I can see a constellation.'],
        log,
        90_000
    );
}
