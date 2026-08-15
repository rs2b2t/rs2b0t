import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { DS_ID } from './areas.js';

// Why: Melzar's Maze is written as a fixed list of legs, and the route is the shortest path the baked collision pack admits from the front door to the chest once each coloured door is opened in key order.
// Why: locs are addressed by exact tile and NPCs by exact id, as the maze is full of decoys — six ordinary Giant rats share the one that drops the red key, and eleven unclimbable "Ladder"s share a name with the three that work.
// Why: a key does not open a door in place — `open_and_close_door` teleports the player through and eats the key, so a leg is done when the key is gone and the player has landed on the far side.

/** Only these ids drop keys; the same-named neighbours never do. */
export const MAZE_NPC = {
    GIANT_RAT: 748,
    GHOST: 749,
    SKELETON: 750,
    ZOMBIE: 751,
    DEMON: 752,
    MELZAR: 753
} as const;

type MazeLeg =
    | { kind: 'kill'; what: string; npcId: number; at: Tile; keyId: number }
    | { kind: 'door'; what: string; stand: Tile; door: Tile; keyId: number; land: Tile }
    | { kind: 'climb'; what: string; stand: Tile; ladder: Tile; op: string; land: Tile }
    | { kind: 'chest'; what: string; stand: Tile };

export const MAZE_LEGS: readonly MazeLeg[] = [
    { kind: 'door', what: 'the front door', stand: new Tile(2941, 3248, 0), door: new Tile(2941, 3248, 0), keyId: DS_ID.MAZE_KEY, land: new Tile(2940, 3248, 0) },
    { kind: 'kill', what: 'the giant rat', npcId: MAZE_NPC.GIANT_RAT, at: new Tile(2930, 3252, 0), keyId: DS_ID.RED_KEY },
    { kind: 'door', what: 'the red door', stand: new Tile(2926, 3253, 0), door: new Tile(2926, 3253, 0), keyId: DS_ID.RED_KEY, land: new Tile(2925, 3253, 0) },
    { kind: 'climb', what: 'the ladder to the first floor', stand: new Tile(2927, 3256, 0), ladder: new Tile(2928, 3256, 0), op: 'Climb-up', land: new Tile(2928, 3256, 1) },
    { kind: 'kill', what: 'the ghost', npcId: MAZE_NPC.GHOST, at: new Tile(2929, 3249, 1), keyId: DS_ID.ORANGE_KEY },
    { kind: 'door', what: 'the orange door', stand: new Tile(2930, 3253, 1), door: new Tile(2931, 3253, 1), keyId: DS_ID.ORANGE_KEY, land: new Tile(2931, 3253, 1) },
    { kind: 'climb', what: 'the ladder to the second floor', stand: new Tile(2933, 3254, 1), ladder: new Tile(2934, 3254, 1), op: 'Climb-up', land: new Tile(2934, 3254, 2) },
    { kind: 'kill', what: 'the skeleton', npcId: MAZE_NPC.SKELETON, at: new Tile(2923, 3251, 2), keyId: DS_ID.YELLOW_KEY },
    { kind: 'door', what: 'the yellow door', stand: new Tile(2924, 3250, 2), door: new Tile(2924, 3249, 2), keyId: DS_ID.YELLOW_KEY, land: new Tile(2924, 3249, 2) },
    { kind: 'climb', what: 'the ladder back to the first floor', stand: new Tile(2939, 3240, 2), ladder: new Tile(2940, 3240, 2), op: 'Climb-down', land: new Tile(2940, 3240, 1) },
    { kind: 'climb', what: 'the ladder back to the ground floor', stand: new Tile(2938, 3240, 1), ladder: new Tile(2937, 3240, 1), op: 'Climb-down', land: new Tile(2937, 3240, 0) },
    { kind: 'climb', what: 'the ladder to the basement', stand: new Tile(2933, 3240, 0), ladder: new Tile(2932, 3240, 0), op: 'Climb-down', land: new Tile(2933, 9640, 0) },
    { kind: 'kill', what: 'the zombie', npcId: MAZE_NPC.ZOMBIE, at: new Tile(2932, 9642, 0), keyId: DS_ID.BLUE_KEY },
    { kind: 'door', what: 'the blue door', stand: new Tile(2931, 9643, 0), door: new Tile(2931, 9643, 0), keyId: DS_ID.BLUE_KEY, land: new Tile(2930, 9643, 0) },
    { kind: 'kill', what: 'Melzar the mad', npcId: MAZE_NPC.MELZAR, at: new Tile(2929, 9649, 0), keyId: DS_ID.MAGENTA_KEY },
    { kind: 'door', what: 'the magenta door', stand: new Tile(2929, 9651, 0), door: new Tile(2929, 9652, 0), keyId: DS_ID.MAGENTA_KEY, land: new Tile(2929, 9652, 0) },
    { kind: 'kill', what: 'the lesser demon', npcId: MAZE_NPC.DEMON, at: new Tile(2936, 9650, 0), keyId: DS_ID.GREEN_KEY },
    { kind: 'door', what: 'the green door', stand: new Tile(2936, 9655, 0), door: new Tile(2936, 9655, 0), keyId: DS_ID.GREEN_KEY, land: new Tile(2936, 9656, 0) },
    { kind: 'chest', what: 'the map chest', stand: new Tile(2935, 9656, 0) }
];

const walk = (to: Tile, log: (m: string) => void, radius = 1): Promise<boolean> =>
    Traversal.walkResilient(to, { radius, attempts: 3, timeoutMs: 120_000, log });

/** Locs read blank for about a tick after a level change. */
export function mazeSceneLoaded(): Promise<boolean> {
    return Execution.delayUntil(() => Locs.query().within(10).exists(), 6000);
}

export function heldById(id: number): boolean {
    return Inventory.countById(id) > 0;
}

const KEY_IDS: readonly number[] = [
    DS_ID.MAZE_KEY, DS_ID.RED_KEY, DS_ID.ORANGE_KEY, DS_ID.YELLOW_KEY,
    DS_ID.BLUE_KEY, DS_ID.MAGENTA_KEY, DS_ID.GREEN_KEY
];

// Why: the east bound stops at 2940 deliberately, as the front door stands on 2941 and that tile is the doorstep outside.
// Why: including it makes "am I still in the maze?" true the moment the bot lets itself out, and it walks straight back in.

/** True while standing anywhere inside the maze, on any of its four floors. */
export function inMaze(t: { x: number; z: number; level: number } | null | undefined): boolean {
    if (!t) {
        return false;
    }
    const upstairs = t.x >= 2920 && t.x <= 2940 && t.z >= 3236 && t.z <= 3262;
    const basement = t.x >= 2915 && t.x <= 2945 && t.z >= 9630 && t.z <= 9665;
    return upstairs || basement;
}

/**
 * Where in the route the player currently is, from position alone. Used to pick
 * up an interrupted run; within a run the index is carried forward.
 */
export function legFromPosition(t: { x: number; z: number; level: number }): number {
    // Why: every test below reads a floor or a cellar as a place in this route, and none of them mean anything outside the building.
    // Why: unguarded, the Dwarven Mine anvil (z=9813) is "the maze basement" and the run resumes at a zombie it has no path to.
    if (!inMaze(t)) {
        return 0;
    }
    if (t.z >= 9600) {
        return 12;
    }
    if (t.level === 2) {
        return 7;
    }
    if (t.level === 1) {
        return 4;
    }
    // The two ground-floor pockets: the entrance hall, and the dead-end the
    // descent from the second floor drops into.
    if (t.z <= 3242 && t.x >= 2929) {
        return 11;
    }
    return inMaze(t) ? 1 : 0;
}

async function takeKey(keyId: number, log: (m: string) => void): Promise<boolean> {
    const drop = GroundItems.query().where(g => g.id === keyId).within(14).nearest();
    if (!drop) {
        return false;
    }
    log('picking the key up off the floor');
    if (drop.distance() > 1 && !(await walk(drop.tile(), log, 1))) {
        return false;
    }
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => heldById(keyId), 6000);
}

async function killFor(leg: MazeLeg & { kind: 'kill' }, log: (m: string) => void): Promise<boolean> {
    if (heldById(leg.keyId)) {
        return true;
    }
    if (await takeKey(leg.keyId, log)) {
        return true;
    }
    const find = () => Npcs.query().where(n => n.id === leg.npcId).action('Attack').nearest();
    if (!find() && !(await walk(leg.at, log, 3))) {
        return false;
    }
    await mazeSceneLoaded();
    const target = find();
    if (!target) {
        log(`no ${leg.what} in the scene — it may still be respawning`);
        await Execution.delayTicks(3);
        return false;
    }
    // Why: every floor of this maze is stocked with aggressive same-named monsters that never drop a key.
    // Why: Game.inCombat() reads our own health bar, so one of them landing a hit would park this leg forever — only being locked onto the right NPC is a reason to wait.
    if (target.targetsMe()) {
        await Execution.delayTicks(2);
        return heldById(leg.keyId);
    }
    if (target.distance() > 8 && !(await walk(target.tile(), log, 2))) {
        return false;
    }
    log(`killing ${leg.what} for its key`);
    if (!(await target.interact('Attack'))) {
        return false;
    }
    await Execution.delayUntil(() => heldById(leg.keyId) || !target.valid(), 60_000);
    if (heldById(leg.keyId)) {
        return true;
    }
    // The key lands on the floor where it died, which is rarely underfoot.
    return takeKey(leg.keyId, log);
}

function locAt(name: string, tile: Tile): Loc | null {
    return Locs.query().name(name).where(l => {
        const t = l.tile();
        return t.x === tile.x && t.z === tile.z && t.level === tile.level;
    }).first();
}

async function openDoor(leg: MazeLeg & { kind: 'door' }, log: (m: string) => void): Promise<boolean> {
    const key = Inventory.items().find(i => i.id === leg.keyId);
    if (!key) {
        return false;
    }
    if (!(await walk(leg.stand, log, 0))) {
        return false;
    }
    if (!(await mazeSceneLoaded())) {
        return false;
    }
    const door = locAt('Door', leg.door);
    if (!door) {
        log(`${leg.what} is not in the scene yet`);
        return false;
    }
    log(`unlocking ${leg.what}`);
    if (!(await key.useOn(door))) {
        return false;
    }
    // The coloured doors eat their key as they swing; the front door does not,
    // so landing on the far side is the only signal both share.
    return Execution.delayUntil(() => !heldById(leg.keyId) || onTile(leg.land), 10_000);
}

async function climb(leg: MazeLeg & { kind: 'climb' }, log: (m: string) => void): Promise<boolean> {
    if (!(await walk(leg.stand, log, 0))) {
        return false;
    }
    if (!(await mazeSceneLoaded())) {
        return false;
    }
    const ladder = locAt('Ladder', leg.ladder);
    if (!ladder) {
        log(`${leg.what} is not in the scene`);
        return false;
    }
    log(`taking ${leg.what}`);
    if (!(await ladder.interact(leg.op))) {
        return false;
    }
    return Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && t.level === leg.land.level && Math.abs(t.z - leg.land.z) < 100;
    }, 8000);
}

/**
 * Both map chests are two-stage locs: Open lifts the lid and swaps in a loc
 * whose first option is Search, and only the Search hands over the piece.
 */
export async function lootChest(mapId: number, log: (m: string) => void): Promise<boolean> {
    const shut = Locs.query().name('Chest').action('Open').within(5).nearest();
    if (shut) {
        log('opening the chest');
        if (!(await shut.interact('Open'))) {
            return false;
        }
        await Execution.delayUntil(() => Locs.query().name('Chest').action('Search').within(5).exists(), 6000);
    }
    const open = Locs.query().name('Chest').action('Search').within(5).nearest();
    if (!open || !(await open.interact('Search'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(mapId) > 0, 10_000);
}

function onTile(t: Tile): boolean {
    const here = Game.tile();
    return here !== null && here.x === t.x && here.z === t.z && here.level === t.level;
}

// Why: Oziach's maze key is not eaten by the front door, as its `oplocu` handler never calls `inv_del`, so holding it says nothing about which side we are on and only position does.
// Why: every coloured key is deleted as its door swings, so its absence is itself the proof.

/** Whether a door leg has been crossed. */
export function doorCrossed(
    leg: MazeLeg & { kind: 'door' },
    here: { x: number; z: number; level: number },
    holdsKey: boolean
): boolean {
    if (leg.keyId === DS_ID.MAZE_KEY) {
        return inMaze(here) && here.x < leg.door.x;
    }
    return !holdsKey;
}

/** Has this leg already been walked past? */
function legDone(leg: MazeLeg, here: { x: number; z: number; level: number }): boolean {
    switch (leg.kind) {
        case 'kill':
            return heldById(leg.keyId);
        case 'door':
            return doorCrossed(leg, here, heldById(leg.keyId));
        case 'climb':
            return here.level === leg.land.level && Math.abs(here.z - leg.land.z) < 100;
        case 'chest':
            return heldById(DS_ID.MAP_MELZAR);
    }
}

// Why: Melzar's Maze is one-way — every ladder in is broken from below and every coloured key is spent.
// Why: the only way back out of the chest room is the cellar ladder in the north-east, then the `funexit` door, which opens from the inside only, and finally the front door.
// Why: the maze key still opens that front door, as it was never consumed.

/** Walk the one route out of the maze. */
export async function leaveMaze(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!here || !inMaze(here)) {
        return true;
    }
    if (here.z >= 9000) {
        if (!(await walk(new Tile(2938, 9657, 0), log, 0)) || !(await mazeSceneLoaded())) {
            return false;
        }
        const ladder = locAt('Ladder', new Tile(2939, 9657, 0));
        if (!ladder) {
            log('no cellar ladder out of the basement');
            return false;
        }
        log('climbing out of the cellar');
        if (!(await ladder.interact('Climb-up'))) {
            return false;
        }
        return Execution.delayUntil(() => (Game.tile()?.z ?? 9999) < 9000, 8000);
    }
    // The exit door drops into the pocket the entrance hall opens onto.
    if (here.z > 3251 && here.x > 2937) {
        if (!(await walk(new Tile(2938, 3252, 0), log, 0)) || !(await mazeSceneLoaded())) {
            return false;
        }
        const door = locAt('Door', new Tile(2938, 3252, 0));
        if (!door) {
            log('no exit door in the scene');
            return false;
        }
        log('opening the one-way exit door');
        if (!(await door.interact('Open'))) {
            return false;
        }
        return Execution.delayUntil(() => (Game.tile()?.x ?? 9999) <= 2937, 8000);
    }
    const front = MAZE_LEGS[0];
    if (front.kind !== 'door') {
        return false;
    }
    if (!(await walk(front.land, log, 0)) || !(await mazeSceneLoaded())) {
        return false;
    }
    const key = Inventory.items().find(i => i.id === DS_ID.MAZE_KEY);
    const door = locAt('Door', front.door);
    if (!key || !door) {
        log('cannot re-open the front door from the inside');
        return false;
    }
    log('letting myself back out of the front door');
    if (!(await key.useOn(door))) {
        return false;
    }
    return Execution.delayUntil(() => !inMaze(Game.tile()), 8000);
}

export class MazeRun {
    private index = -1;

    /** Runs one leg per call; the engine loop drives it to the chest. */
    async step(log: (m: string) => void): Promise<boolean> {
        if (heldById(DS_ID.MAP_MELZAR)) {
            return true;
        }
        const here = Game.tile();
        if (!here) {
            return false;
        }
        // Why: a coloured key in the pack exists only between its kill and its door, so it re-syncs the route after any interruption.
        // Why: the maze key is no such marker, as it is kept for the quest.
        const keyLeg = MAZE_LEGS.findIndex(l => l.kind === 'door' && l.keyId !== DS_ID.MAZE_KEY && heldById(l.keyId));
        if (keyLeg >= 0) {
            this.index = keyLeg;
        } else if (this.index < 0) {
            this.index = legFromPosition(here);
            log(`picking the maze up at leg ${this.index}`);
        }
        while (this.index < MAZE_LEGS.length && legDone(MAZE_LEGS[this.index], here)) {
            this.index++;
        }
        if (this.index >= MAZE_LEGS.length) {
            return heldById(DS_ID.MAP_MELZAR);
        }
        const leg = MAZE_LEGS[this.index];
        switch (leg.kind) {
            case 'kill':
                return killFor(leg, log);
            case 'door':
                return openDoor(leg, log);
            case 'climb':
                return climb(leg, log);
            case 'chest':
                if (!(await walk(leg.stand, log, 1)) || !(await mazeSceneLoaded())) {
                    return false;
                }
                return lootChest(DS_ID.MAP_MELZAR, log);
        }
    }

    /** Keys are worthless outside the maze and squat pack slots. */
    static keyIds(): readonly number[] {
        return KEY_IDS;
    }
}
