import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Reach } from '../../../api/Reach.js';
import { Sustain } from '../../../api/Sustain.js';
import type Tile from '../../../api/Tile.js';
import { Traversal } from '../../../api/Traversal.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { GroundItems } from '../../../api/queries/GroundItems.js';
import { settleScene, useOnLoc } from '../../exec/prompts.js';
import { EC_ID, EC_NAME, EC_TILE } from './areas.js';

const held = (id: number): number => Inventory.countById(id);

/** Walk to a ground spawn and take it. */
async function takeSpawn(id: number, name: string, at: Tile, log: (m: string) => void): Promise<boolean> {
    if (held(id) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(at, { radius: 1, attempts: 4, timeoutMs: 180_000, log }))) {
        log(`could not reach the ${name} spawn at (${at.x},${at.z},${at.level})`);
        return false;
    }
    await settleScene();
    const item = GroundItems.query().name(name).within(6).nearest();
    if (!item) {
        log(`no ${name} on the ground at (${at.x},${at.z},${at.level})`);
        return false;
    }
    if (!(await item.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => held(id) > 0, 8000);
}

/**
 * Dig the compost heap. `op1=Search` answers "I'm not looking through that with
 * my hands!" — the key is an oplocu with a spade, re-issued whenever none is held.
 */
async function digClosetKey(log: (m: string) => void): Promise<boolean> {
    if (held(EC_ID.CLOSET_KEY) > 0) {
        return true;
    }
    return useOnLoc(
        EC_ID.SPADE,
        { name: 'Compost heap', near: EC_TILE.COMPOST_STAND },
        [],
        () => held(EC_ID.CLOSET_KEY) > 0,
        log
    );
}

/** The ten walkable tiles behind the closet door, from a flood of the pack. */
const CLOSET_BOX = { minX: 3108, maxX: 3112, minZ: 3366, maxZ: 3368 };

/** Pure, so `decide()` can branch on the snapshot tile without a client. */
export function inCloset(tile: { x: number; z: number; level: number } | null | undefined): boolean {
    return Boolean(tile) && tile!.level === 0
        && tile!.x >= CLOSET_BOX.minX && tile!.x <= CLOSET_BOX.maxX
        && tile!.z >= CLOSET_BOX.minZ && tile!.z <= CLOSET_BOX.maxZ;
}

/**
 * The closet is a sealed ten-tile room. `open_and_close_door2` shuts the door
 * behind whoever crosses it and `op1=Open` answers "The door is locked", so the
 * key is the only way in *and* the only way back out. It is never consumed.
 */
async function crossClosetDoor(want: 'in' | 'out', log: (m: string) => void): Promise<boolean> {
    const done = (): boolean => inCloset(Game.tile()) === (want === 'in');
    if (done()) {
        return true;
    }
    if (held(EC_ID.CLOSET_KEY) === 0) {
        log(`no key in the pack — cannot get ${want} of the closet`);
        return false;
    }
    return useOnLoc(
        EC_ID.CLOSET_KEY,
        { name: 'Door', near: want === 'in' ? EC_TILE.CLOSET_STAND : EC_TILE.CLOSET_INSIDE, within: 4 },
        [],
        done,
        log
    );
}

/**
 * Nothing routes out of the closet, so any leg that starts in there has to key
 * its way out before it walks anywhere. `decide()` calls this ahead of everything
 * else, including the bank trip.
 */
export async function leaveCloset(log: (m: string) => void): Promise<boolean> {
    await Sustain.run();
    return crossClosetDoor('out', log);
}

export async function fetchRubberTube(log: (m: string) => void): Promise<boolean> {
    if (held(EC_ID.RUBBER_TUBE) > 0) {
        return crossClosetDoor('out', log);
    }
    await Sustain.run();
    if (held(EC_ID.SPADE) === 0) {
        log('no spade in the pack — cannot dig the compost heap');
        return false;
    }
    if (!(await digClosetKey(log))) {
        log('the compost heap did not give up a key');
        return false;
    }
    await Sustain.run();
    if (!(await crossClosetDoor('in', log))) {
        log('the closet door did not open to the key');
        return false;
    }
    await settleScene();
    if (!(await takeSpawn(EC_ID.RUBBER_TUBE, EC_NAME.RUBBER_TUBE, EC_TILE.RUBBER_TUBE_SPAWN, log))) {
        // Leaving matters more than the tube: stranded in here, every later leg
        // spends its whole budget proving the world unreachable.
        await crossClosetDoor('out', log);
        return false;
    }
    return crossClosetDoor('out', log);
}

/** Search the fountain. `false` means the piranhas are still alive. */
async function searchFountain(log: (m: string) => void): Promise<boolean> {
    const status = await Reach.locOp({
        name: 'Fountain',
        op: 'Search',
        near: EC_TILE.FOUNTAIN_STAND,
        expect: () => held(EC_ID.PRESSURE_GAUGE) > 0,
        expectMs: 8000,
        log
    });
    return status === 'done' && held(EC_ID.PRESSURE_GAUGE) > 0;
}

async function poisonFountain(log: (m: string) => void): Promise<boolean> {
    if (held(EC_ID.POISONED_FISH_FOOD) === 0) {
        if (!(await takeSpawn(EC_ID.POISON, EC_NAME.POISON, EC_TILE.POISON_SPAWN, log))) {
            return false;
        }
        await Sustain.run();
        if (!(await takeSpawn(EC_ID.FISH_FOOD, EC_NAME.FISH_FOOD, EC_TILE.FISH_FOOD_SPAWN, log))) {
            return false;
        }
        const poison = Inventory.items().find(i => i.id === EC_ID.POISON);
        const food = Inventory.items().find(i => i.id === EC_ID.FISH_FOOD);
        if (!poison || !food) {
            log('poison or fish food went missing before they could be combined');
            return false;
        }
        if (!(await poison.useOn(food))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => held(EC_ID.POISONED_FISH_FOOD) > 0, 8000))) {
            log('combining the poison and the fish food produced nothing');
            return false;
        }
    }
    await Sustain.run();
    // The pour runs a five-tick message chain before the varp flips.
    return useOnLoc(
        EC_ID.POISONED_FISH_FOOD,
        { name: 'Fountain', near: EC_TILE.FOUNTAIN_STAND },
        [],
        () => held(EC_ID.POISONED_FISH_FOOD) === 0,
        log
    );
}

/**
 * Search first: `%haunted_manor_fountain_poisoned` is unreadable, and a fountain
 * poisoned on an earlier run hands the gauge straight over. The wrong guess
 * costs one hitpoint.
 */
export async function fetchPressureGauge(log: (m: string) => void): Promise<boolean> {
    if (held(EC_ID.PRESSURE_GAUGE) > 0) {
        return true;
    }
    await Sustain.run();
    if (await searchFountain(log)) {
        log('the fountain was already poisoned');
        return true;
    }
    log('piranhas are still alive — poisoning the fountain');
    if (!(await poisonFountain(log))) {
        return held(EC_ID.PRESSURE_GAUGE) > 0;
    }
    // The pour runs a five-tick message chain before the varp flips, and the
    // search that races it comes back bitten. Report on the gauge, not on the
    // op: a false with the gauge in the pack sends the bot round again.
    await Execution.delayTicks(6);
    for (let attempt = 0; attempt < 3 && held(EC_ID.PRESSURE_GAUGE) === 0; attempt++) {
        await searchFountain(log);
    }
    return held(EC_ID.PRESSURE_GAUGE) > 0;
}
