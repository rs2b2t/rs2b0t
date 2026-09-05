import { CANT_REACH, GameMessages } from '../../api/chatbox/gameMessages.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Locs } from '../../api/locs/Locs.js';
import { Players } from '../../api/players/Players.js';
import { Traversal } from '../../api/walking/Traversal.js';
import type Tile from '../../geometry/Tile.js';
import type { DragonSite } from '../JiveDragons/sites.js';
import { escapeRunesFor, teleportOut, waitFed, type JiveHost } from '../JiveDragons/supply.js';
import { doseDue } from './logic.js';
import type { LairRoute, LocStop } from './sites.js';

/** What the way in and out needs from the bot on top of what supply needs. */
export interface EntryHost extends JiveHost {
    /** The tick the last antipoison dose went down, null before the first. */
    lastDoseTick: number | null;
    /** Drink one dose. False with none in the pack. */
    drinkAntipoison(): Promise<boolean>;
}

/** The wilderness walk is 369 tiles of path, most of it at walking pace once the run energy goes. */
const WALK_MS = 600_000;
const HOP_MS = 8000;
const PLAYER_RADIUS = 15;

const say = (h: JiveHost) => (m: string): void => h.log(`  ${m}`);

function within(t: Tile, radius: number): boolean {
    const me = Game.tile();
    return me !== null && me.level === t.level && t.distanceTo(me) <= radius;
}

// Why: another player near the ladder is the one hazard the run cannot handle, so it is named in the log where the operator will look for it.

function warnOfPlayers(h: JiveHost, where: string): void {
    const names = Players.query().within(PLAYER_RADIUS).results().filter(p => p.distance() > 0).map(p => p.name ?? '?');
    if (names.length > 0) {
        h.log(`WARNING: ${names.length} player(s) within ${PLAYER_RADIUS} tiles at the ${where}: ${names.join(', ')}`);
    }
}

// Why: walkResilient's arrival probe accepts the closest reachable point, and a lever is legal only from its own tile, so the stand is read back before the op goes.

/** Stand at the stop and send its op, true once `arrived` holds. */
async function useStop(h: JiveHost, stop: LocStop, what: string, status: string, arrived: () => boolean): Promise<boolean> {
    if (!within(stop.tile, stop.radius)) {
        h.setStatus(`walking to the ${what}`);
        await Traversal.walkResilient(stop.tile, { radius: stop.radius, attempts: 4, timeoutMs: WALK_MS, log: say(h) });
    }
    if (!within(stop.tile, stop.radius)) {
        h.log(`could not stand at the ${what} (${stop.tile.x},${stop.tile.z}). Retrying.`);
        return false;
    }
    await Execution.delayTicks(2);
    const loc = Locs.query().where(l => l.id === stop.locId).within(3).nearest();
    if (!loc) {
        h.log(`the ${what} is not in the scene yet. Retrying.`);
        return false;
    }
    h.setStatus(status);
    const mark = GameMessages.mark();
    if (!(await loc.interact(stop.op))) {
        h.log(`the ${what} refused the ${stop.op}. Retrying.`);
        return false;
    }
    if (!(await waitFed(() => arrived() || GameMessages.sawSince(mark, CANT_REACH), HOP_MS))) {
        h.log(`the ${what} did not take us through. Retrying.`);
        return false;
    }
    if (!arrived()) {
        h.log(`the server could not reach the ${what} from ${Game.tile()?.x},${Game.tile()?.z}. Retrying.`);
        return false;
    }
    return true;
}

// Why: the poison spiders spawn on the tiles round the lever, so the dose goes down on the surface where nothing bites, inside its own window.

export async function enterKbdLair(h: EntryHost, site: DragonSite, route: LairRoute): Promise<boolean> {
    if (site.inArea(Game.tile())) {
        return true;
    }
    if (!route.inDungeon(Game.tile())) {
        if (!within(route.ladder.tile, route.ladder.radius)) {
            h.setStatus('walking to the Lava Maze ladder');
            await Traversal.walkResilient(route.ladder.tile, { radius: route.ladder.radius, attempts: 4, timeoutMs: WALK_MS, log: say(h) });
        }
        if (!within(route.ladder.tile, route.ladder.radius)) {
            h.log('the walk to the Lava Maze ladder stopped short. Retrying.');
            return false;
        }
        warnOfPlayers(h, 'ladder');
        if (doseDue(h.lastDoseTick, Game.tick())) {
            if (await h.drinkAntipoison()) {
                h.log('drank a Superantipoison before the lever spiders');
            } else {
                h.log('WARNING: no Superantipoison to drink before the lever spiders. Going in uncured.');
            }
        }
        if (!(await useStop(h, route.ladder, 'ladder', 'climbing down into the Lava Maze dungeon', () => route.inDungeon(Game.tile())))) {
            return false;
        }
        h.log('down the ladder into the Lava Maze dungeon');
    }
    if (!(await useStop(h, route.lever, 'lever', 'pulling the lever into the lair', () => site.inArea(Game.tile())))) {
        return false;
    }
    h.log('inside the King Black Dragon lair');
    return true;
}

// Why: the dungeon is level-42 wilderness where no teleport fires, and the lair two tiles away is not, so a trip that starts by the lever goes in before it goes home.

/** Teleport home from the lair, or pull the exit lever and climb out when the cast will not fire. */
export async function leaveKbdLair(h: EntryHost, site: DragonSite, route: LairRoute): Promise<boolean> {
    if (route.inDungeon(Game.tile()) && !(await useStop(h, route.lever, 'lever', 'pulling the lever into the lair to teleport', () => site.inArea(Game.tile())))) {
        return false;
    }
    if (!site.inArea(Game.tile())) {
        return true;
    }
    const why = await teleportOut(h, site);
    if (why === null) {
        return true;
    }
    h.log(`the ${escapeRunesFor(site.escapeTeleportId).label} will not fire (${why}). Walking out by the exit lever and the ladder instead.`);
    if (!(await useStop(h, route.outLever, 'exit lever', 'pulling the exit lever', () => route.inDungeon(Game.tile())))) {
        return false;
    }
    if (!(await useStop(h, route.upLadder, 'ladder', 'climbing out of the Lava Maze dungeon', () => !route.inDungeon(Game.tile())))) {
        return false;
    }
    warnOfPlayers(h, 'ladder');
    h.log('out of the Lava Maze dungeon on foot. Walking to the bank.');
    return true;
}
