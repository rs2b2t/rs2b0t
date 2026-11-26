import { actions, reader, type WorldTile } from '../../../../../adapter/ClientAdapter.js';
import { WalkExecutor } from '../../../../../event/webwalk/WalkExecutor.js';
import { Reachability } from '../../../../../event/webwalk/geometry/Reachability.js';
import Tile from '../../../../../geometry/Tile.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { bodyOrigin, engageRangeFor, gapTo } from '../../../../combat/hunting/logic.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { heldId } from '../../exec/prompts.js';
import { ANTIPOISON_IDS, FC_ID, FC_NPC, inChronozonLair } from './areas.js';

const WEAKENS = /chronozon weakens/i;
const POISONED = /you have been poisoned/i;
const GATE_APPROACH = new Tile(3099, 9958, 0);
const GATE_BEND = new Tile(3093, 9952, 0);
const SPIDER_SPAWNS = [new Tile(3088, 9945, 0), new Tile(3089, 9943, 0), new Tile(3090, 9944, 0)];
export const SAFESPOT = new Tile(3089, 9932, 0);
const STANDS = [SAFESPOT, new Tile(3085, 9930, 0), new Tile(3085, 9931, 0), new Tile(3086, 9931, 0), new Tile(3090, 9932, 0)];
export const BLASTS = ['Wind blast', 'Water blast', 'Earth blast', 'Fire blast'] as const;

function spiders(): Tile[] {
    return reader.npcs().filter(n => n.id === 134 && n.tile.level === 0).map(n => Tile.from(n.networkTile ?? n.tile));
}

function clearance(tile: Tile, threats: readonly Tile[]): number {
    return Math.min(...threats.map(spider => tile.distanceTo(spider)));
}

function canCastFrom(stand: Tile, demon: Npc): boolean {
    const tile = demon.tile();
    const gap = gapTo(stand, tile, demon.size);
    return gap > 1 && gap <= engageRangeFor('mage') && Reachability.lineOfSight(stand, { ...bodyOrigin(tile, demon.size), level: tile.level }, demon.size);
}

function standFor(demon: Npc | null, threats: Tile[]): Tile | undefined {
    const here = Game.tile();
    const clear = STANDS.filter(stand => clearance(stand, threats) > 2);
    const firing = demon ? clear.filter(stand => canCastFrom(stand, demon)) : clear;
    if (!clear.length) return [...STANDS].sort((a, b) => clearance(b, threats) - clearance(a, threats))[0];
    const choices = firing.length ? firing : clear;
    if (here) {
        const current = choices.find(stand => stand.equals(here));
        if (current) return current;
    }
    return choices.sort((a, b) => clearance(b, threats) - clearance(a, threats))[0];
}

async function walkClear(tile: Tile, log: (m: string) => void): Promise<boolean> {
    let margin = 1;
    for (let attempt = 0; attempt < 3 && !EventSignal.pending(); attempt++) {
        const live = spiders();
        const avoidZones = [
            ...SPIDER_SPAWNS.filter(t => !t.equals(tile)).map(t => ({ minX: t.x, maxX: t.x, minZ: t.z, maxZ: t.z, level: 0 })),
            ...live.map(t => ({ minX: t.x - margin, maxX: t.x + margin, minZ: t.z - margin, maxZ: t.z + margin, level: 0 }))
        ];
        const walked = await WalkExecutor.walkTo(tile, { radius: 0, timeoutMs: 30_000, avoidZones, log });
        const here = Game.tile();
        if (walked && here && tile.equals(here)) return true;
        if (!walked && WalkExecutor.lastOutcome !== 'unreachable') return false;
        margin = 0;
        await Sustain.run();
        await Execution.delayTicks(1);
    }
    return false;
}

let lastDose = -Infinity;
async function drinkAntipoison(poisoned: boolean, log: (m: string) => void): Promise<boolean> {
    if (!poisoned && performance.now() - lastDose < 80_000) return true;
    const items = Inventory.items();
    const doses = (id: number) => {
        const index = ANTIPOISON_IDS.findIndex(dose => dose === id);
        return index < 0 ? 0 : 4 - index;
    };
    const dose = items.find(i => doses(i.id) > 0);
    if (!dose) return false;
    const before = items.reduce((sum, i) => sum + doses(i.id), 0);
    if (!(await dose.interact('Drink')) || !(await Execution.delayUntilTicks(
        () => Inventory.items().reduce((sum, i) => sum + doses(i.id), 0) < before, 4))) return false;
    lastDose = performance.now();
    log('drank antipoison for the spider passage');
    return true;
}

function inPassage(tile: WorldTile | null): boolean {
    return tile !== null && tile.level === 0 && tile.x >= 3080 && tile.x <= 3099 && tile.z >= 9929 && tile.z <= GATE_APPROACH.z;
}

export async function fightChronozon(log: (m: string) => void): Promise<boolean> {
    const restore = Game.autoRetaliateOn();
    if (restore && (!Game.setAutoRetaliate(false) || !(await Execution.delayUntilTicks(() => !Game.autoRetaliateOn(), 5)))) return false;
    try {
        return await runFight(log);
    } finally {
        if (restore && !inChronozonLair(Game.tile())) Game.setAutoRetaliate(true);
    }
}

async function runFight(log: (m: string) => void): Promise<boolean> {
    let poisonMark = GameMessages.mark();
    if (!inPassage(Game.tile()) && !(await Traversal.walkResilient(GATE_APPROACH, { radius: 0, attempts: 3, timeoutMs: 300_000, log }))) return false;
    const here = Game.tile();
    if (!here) return false;
    if (here.z > 9941) {
        await drinkAntipoison(false, log);
        if (!Game.runEnabled() && Game.energy() > 0) actions.setRun(true);
        if (here.z > GATE_BEND.z && clearance(GATE_BEND, spiders()) > 2 && !(await walkClear(GATE_BEND, log))) return false;
    }

    let spell = 0;
    let attempts = 0;
    let waitingSince = performance.now();
    while (!EventSignal.pending()) {
        await Sustain.run();
        if (GameMessages.sawSince(poisonMark, POISONED) && await drinkAntipoison(true, log)) poisonMark = GameMessages.mark();
        if (heldId(FC_ID.CREST_FROM_CHRONOZON) > 0) return true;
        if (performance.now() - waitingSince >= 60_000) {
            log('could not get a clear shot or collect the crest from the south side of the chamber');
            return false;
        }
        const threats = spiders();
        const drop = GroundItems.query().where(item => item.id === FC_ID.CREST_FROM_CHRONOZON).within(16).nearest();
        if (drop && clearance(drop.tile(), threats) > 2) {
            const tile = drop.tile();
            const at = Game.tile();
            if (!at || (!tile.equals(at) && !(await walkClear(tile, log)))) return false;
            if (clearance(tile, spiders()) > 2 && await drop.interact('Take')) {
                await Execution.delayUntilTicks(() => heldId(FC_ID.CREST_FROM_CHRONOZON) > 0, 5);
            }
            continue;
        }
        const demon = Npcs.query().where(n => n.id === FC_NPC.CHRONOZON_NPC_ID).within(16).nearest();
        const stand = standFor(demon, threats);
        const at = Game.tile();
        if (!at || !stand) {
            await Execution.delayTicks(1);
            continue;
        }
        if (!stand.equals(at)) {
            if (clearance(Tile.from(at), threats) <= 2) log(`poison spider nearby, moving to ${stand}`);
            if (!(await walkClear(stand, log))) return false;
            continue;
        }
        if (drop || !demon || clearance(stand, threats) <= 2 || !canCastFrom(stand, demon)) {
            await Execution.delayTicks(1);
            continue;
        }
        const weaken = spell < BLASTS.length;
        const name = weaken ? BLASTS[spell] : 'Fire blast';
        const mark = GameMessages.mark();
        if (++attempts > (weaken ? 12 : 60) || !(await Game.castOnNpc(name, demon))) {
            log(`could not finish casting ${name} from the south side of the chamber`);
            return false;
        }
        const interrupted = () => {
            const tile = Game.tile();
            return EventSignal.pending() || !tile || !stand.equals(tile) || clearance(stand, spiders()) <= 2 || GameMessages.sawSince(mark, POISONED);
        };
        await Execution.delayUntilTicks(() => interrupted() || (weaken && GameMessages.sawSince(mark, WEAKENS)), weaken ? 13 : 3);
        waitingSince = performance.now();
        if (weaken && GameMessages.sawSince(mark, WEAKENS)) {
            log(`${name} landed`);
            spell++;
            attempts = 0;
        }
    }
    return false;
}

/** Combine the three fragments. Any pairing runs the same `combine_crest_parts`. */
export async function combineCrest(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(FC_ID.FAMILY_CREST) > 0) {
        return true;
    }
    const first = Inventory.items().find(i => i.id === FC_ID.CREST_FROM_CALEB);
    const second = Inventory.items().find(i => i.id === FC_ID.CREST_FROM_AVAN);
    if (!first || !second) {
        log('need all three fragments in the pack before they combine');
        return false;
    }
    if (!(await first.useOn(second))) {
        return false;
    }
    const made = await Execution.delayUntil(() => Inventory.countById(FC_ID.FAMILY_CREST) > 0, 8000);
    if (made) {
        log('restored the Family Crest');
    }
    return made;
}
