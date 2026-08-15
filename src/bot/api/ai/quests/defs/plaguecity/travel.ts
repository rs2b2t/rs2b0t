import { Execution } from '../../../../execution/Execution.js';
import { Equipment } from '../../../../equipment/Equipment.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type Tile from '../../../../../geometry/Tile.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { PC_ITEM, PC_LOC, PC_TILE, plagueArea, type PlagueArea } from './areas.js';

export function area(): PlagueArea {
    return plagueArea(Game.tile());
}

export function locById(ids: readonly number[] | number, op: string | null, within = 10): Loc | null {
    const wanted = new Set(typeof ids === 'number' ? [ids] : ids);
    const base = Locs.query().where(loc => wanted.has(loc.id));
    return (op === null ? base : base.action(op)).within(within).nearest();
}

export async function walkTo(to: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === to.level && to.distanceTo(here) <= radius) {
        return true;
    }
    return Traversal.walkResilient(to, { radius, attempts: 3, timeoutMs: 180_000, log });
}

// Why: the garden dig hands the spade objbox before it teleports, so a plain tile poll
// times out while the crossing waits on a click nobody made.
export async function arrive(want: PlagueArea, log: (m: string) => void, ms = 20_000): Promise<boolean> {
    const landed = await driveUntil(() => area() === want, [], log, ms);
    if (landed) {
        await settleScene();
    }
    return landed;
}

async function digIntoSewer(log: (m: string) => void): Promise<boolean> {
    if (area() === 'sewer') {
        return true;
    }
    if (!(await walkTo(PC_TILE.GARDEN, 1, log))) {
        return false;
    }
    await settleScene();
    const spade = Inventory.items().find(item => item.id === PC_ITEM.SPADE.id);
    const patch = locById(PC_LOC.MUD_PATCH, null, 6);
    if (!spade || !patch) {
        log(`no ${spade ? 'Mud patch' : 'Spade'} for the dig into the sewer`);
        return false;
    }
    if (!(await spade.useOn(patch))) {
        return false;
    }
    return arrive('sewer', log);
}

async function climbMudPile(log: (m: string) => void): Promise<boolean> {
    if (area() === 'east') {
        return true;
    }
    if (!(await walkTo(PC_TILE.MUD_PILE, 1, log))) {
        return false;
    }
    await settleScene();
    const pile = locById(PC_LOC.MUD_PILE, 'Climb', 8);
    if (!pile || !(await pile.interact('Climb'))) {
        log('no Mud pile offering Climb in the sewer');
        return false;
    }
    return arrive('east', log);
}

async function squeezePipe(log: (m: string) => void): Promise<boolean> {
    if (area() === 'west') {
        return true;
    }
    if (!(await Equipment.equip(PC_ITEM.GAS_MASK.name))) {
        log('the Gas mask has to be worn to squeeze through the sewer pipe');
        return false;
    }
    if (!(await walkTo(PC_TILE.SEWER_PIPE, 1, log))) {
        return false;
    }
    await settleScene();
    const pipe = locById(PC_LOC.SEWER_PIPE, 'Search', 8);
    if (!pipe || !(await pipe.interact('Search'))) {
        log('no Sewer pipe offering Search at the west end of the sewer');
        return false;
    }
    return arrive('west', log);
}

// Why: the manhole reverts to its cover 500 ticks after the pipe opened it, and the closed loc offers Open rather than Climb-down.
async function dropManhole(log: (m: string) => void): Promise<boolean> {
    if (area() === 'sewer') {
        return true;
    }
    if (!(await walkTo(PC_TILE.MANHOLE, 1, log))) {
        return false;
    }
    await settleScene();
    const shut = locById(PC_LOC.MANHOLE_SHUT, 'Open', 8);
    if (shut) {
        if (!(await shut.interact('Open'))) {
            return false;
        }
        await Execution.delayUntil(() => locById(PC_LOC.MANHOLE_OPEN, 'Climb-down', 8) !== null, 6000);
    }
    const open = locById(PC_LOC.MANHOLE_OPEN, 'Climb-down', 8);
    if (!open || !(await open.interact('Climb-down'))) {
        log('no open Manhole to climb down in West Ardougne');
        return false;
    }
    return arrive('sewer', log);
}

async function leaveUpstairs(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(PC_TILE.REHNISON_TOP, 2, log))) {
        return false;
    }
    const stairs = locById(PC_LOC.REHNISON_STAIRS_DOWN, 'Walk-down', 8);
    if (!stairs || !(await stairs.interact('Walk-down'))) {
        log('no Rehnison stairs down in range');
        return false;
    }
    return arrive('west', log);
}

async function leaveCellar(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(PC_TILE.HOUSE_STAIRS_UP, 2, log))) {
        return false;
    }
    const stairs = locById(PC_LOC.HOUSE_STAIRS_UP, 'Walk-Up', 8);
    if (!stairs || !(await stairs.interact('Walk-Up'))) {
        log('no plague house stairs up in the cellar');
        return false;
    }
    return arrive('west', log);
}

export async function goUpstairs(log: (m: string) => void): Promise<boolean> {
    if (area() === 'upstairs') {
        return true;
    }
    if (!(await walkTo(PC_TILE.REHNISON_STAIRS, 1, log))) {
        return false;
    }
    await settleScene();
    const stairs = locById(PC_LOC.REHNISON_STAIRS_UP, 'Walk-up', 8);
    if (!stairs || !(await stairs.interact('Walk-up'))) {
        log('no Rehnison stairs up in range');
        return false;
    }
    return arrive('upstairs', log);
}

export async function goCellar(log: (m: string) => void): Promise<boolean> {
    if (area() === 'cellar') {
        return true;
    }
    if (!(await walkTo(PC_TILE.HOUSE_STAIRS_DOWN, 2, log))) {
        return false;
    }
    await settleScene();
    const stairs = locById(PC_LOC.HOUSE_STAIRS_DOWN, 'Walk-Down', 8);
    if (!stairs || !(await stairs.interact('Walk-Down'))) {
        log('no plague house stairs down in range');
        return false;
    }
    return arrive('cellar', log);
}

/** Walk out of whatever pocket the bot is standing in and back onto the mainland. */
export async function goEast(log: (m: string) => void): Promise<boolean> {
    switch (area()) {
        case 'east':
            return true;
        case 'upstairs':
            return leaveUpstairs(log);
        case 'cellar':
            return leaveCellar(log);
        case 'west':
            return (await dropManhole(log)) && climbMudPile(log);
        case 'sewer':
            return climbMudPile(log);
        default:
            return false;
    }
}

/** Reach the sewer from wherever the bot is standing; the garden dig needs a Spade. */
export async function goSewer(log: (m: string) => void): Promise<boolean> {
    switch (area()) {
        case 'sewer':
            return true;
        case 'east':
            return digIntoSewer(log);
        case 'west':
            return dropManhole(log);
        case 'upstairs':
            return leaveUpstairs(log);
        case 'cellar':
            return leaveCellar(log);
        default:
            return false;
    }
}

/** Garden dig, then the sewer pipe. Needs a Spade in the pack and a Gas mask to wear. */
export async function goWest(log: (m: string) => void): Promise<boolean> {
    switch (area()) {
        case 'west':
            return true;
        case 'upstairs':
            return leaveUpstairs(log);
        case 'cellar':
            return leaveCellar(log);
        case 'sewer':
            return squeezePipe(log);
        case 'east':
            return (await digIntoSewer(log)) && squeezePipe(log);
        default:
            return false;
    }
}
