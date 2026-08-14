import { EventSignal } from '../../../execution/EventSignal.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import { GroundItems } from '../../../grounditems/GroundItems.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Npcs, type Npc } from '../../../npcs/Npcs.js';
import { Reachability } from '../../../../event/webwalk/geometry/Reachability.js';
import { Sustain } from '../../../sustain/Sustain.js';
import { Traversal } from '../../../walking/Traversal.js';
import type { GroundItem } from '../../../model/GroundItem.js';
import Tile from '../../../../geometry/Tile.js';
import { QUESTS } from '../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import type { NpcStop } from '../exec/primitives.js';

interface ImpBead {
    name: string;
    id: number;
}

export const IMP_BEADS: readonly ImpBead[] = [
    { name: 'Red bead', id: 1470 },
    { name: 'Yellow bead', id: 1472 },
    { name: 'Black bead', id: 1474 },
    { name: 'White bead', id: 1476 }
];

const DRAYNOR_BANK = new Tile(3093, 3243, 0);

// Why: the polite line is preferred first because Mizgog's third option ends with the string "Give me a quest!", and a substring match would hand that sarcastic branch the quest-start click.
export const MIZGOG: NpcStop = {
    npc: 'Wizard Mizgog',
    anchor: new Tile(3103, 3163, 2),
    leash: 6,
    prefer: ['Give me a quest please.', 'Give me a quest!']
};

/** The three Falador south-gate imp spawns, from the map squares. */
export const IMP_SPAWNS: readonly Tile[] = [
    new Tile(3009, 3307, 0),
    new Tile(3011, 3314, 0),
    new Tile(3015, 3314, 0)
];

/** Where the bot stands when nothing is in range, central to all three spawns. */
const IMP_STAND = new Tile(3012, 3311, 0);

// Why: `wanderrange=27` plus a `map_findsquare(npc_coord, 0, 20)` teleport puts an imp anywhere in this box, and one outside it belongs to a different spawn cluster.

/** The ground an imp from these spawns can be standing on. */
export const IMP_FIELD = { minX: 2986, maxX: 3040, minZ: 3284, maxZ: 3336 };

const IMP = 'Imp';
const SEARCH_RADIUS = 40;
const BEAD_RADIUS = 30;
const ENGAGE_RADIUS = 6;
/** Past this the imp teleported out of the fight rather than moved. */
const LOST_RADIUS = 12;
const HOLD_RADIUS = 12;
/** Scene-BFS budget: enough open ground to answer for anything inside `SEARCH_RADIUS`. */
const REACH_STEPS = 8000;
const KILL_MS = 30_000;
const TAKE_MS = 6000;
/** `respawnrate=100` ticks, with headroom for a slow tick rate. */
const RESPAWN_MS = 90_000;

function heldCount(snap: QuestSnapshot, bead: ImpBead): number {
    if (snap.invIds !== undefined && snap.invIds.size > 0) {
        return snap.invIds.get(bead.id) ?? 0;
    }
    return snap.inv.get(bead.name.toLowerCase()) ?? 0;
}

function bankedCount(snap: QuestSnapshot, bead: ImpBead): number {
    if (snap.bankIds !== undefined && snap.bankIds.size > 0) {
        return snap.bankIds.get(bead.id) ?? 0;
    }
    return snap.bank?.get(bead.name.toLowerCase()) ?? 0;
}

function missingBeads(snap: QuestSnapshot): ImpBead[] {
    return IMP_BEADS.filter(bead => heldCount(snap, bead) === 0);
}

function inField(tile: { x: number; z: number; level: number }): boolean {
    return tile.level === IMP_STAND.level
        && tile.x >= IMP_FIELD.minX && tile.x <= IMP_FIELD.maxX
        && tile.z >= IMP_FIELD.minZ && tile.z <= IMP_FIELD.maxZ;
}

function wantedBeadIds(): Set<number> {
    return new Set(IMP_BEADS.filter(bead => Inventory.countById(bead.id) === 0).map(bead => bead.id));
}

interface FieldTarget {
    tile: { x: number; z: number; level: number };
    distance: number;
}

export interface ImpCandidate extends FieldTarget {
    index: number;
    contested: boolean;
}

type Reachable = (tile: { x: number; z: number; level: number }) => boolean;

// Why: an imp teleports up to 20 tiles on its own timer, which lands some of them and their drops inside the Falador wall, where every walk answers "unreachable" and costs the step its budget.

/** The closest candidate the scene can path to, skipping the nearer ones it cannot. */
export function nearestReachable<T extends FieldTarget>(candidates: readonly T[], reachable: Reachable): T | null {
    return [...candidates].sort((a, b) => a.distance - b.distance).find(item => reachable(item.tile)) ?? null;
}

/** The nearest imp in the field that nobody else is fighting and the scene can path to. */
export function pickImp<T extends ImpCandidate>(candidates: readonly T[], reachable: Reachable): T | null {
    return nearestReachable(candidates.filter(imp => inField(imp.tile) && !imp.contested), reachable);
}

function sceneReachable(tile: { x: number; z: number; level: number }): boolean {
    return Reachability.canReach(tile, { adjacentOk: true, maxSteps: REACH_STEPS });
}

function beadOnGround(wanted: Set<number>): GroundItem | null {
    const drops = GroundItems.query().where(item => wanted.has(item.id)).action('Take').within(BEAD_RADIUS).results();
    return nearestReachable(drops.map(drop => ({ item: drop, tile: drop.tile(), distance: drop.distance() })), sceneReachable)?.item ?? null;
}

function fieldImp(): Npc | null {
    const imps = Npcs.query().name(IMP).action('Attack').within(SEARCH_RADIUS).results();
    const candidates = imps.map(npc => ({
        item: npc,
        index: npc.index,
        tile: npc.tile(),
        distance: npc.distance(),
        contested: npc.targetsAnotherPlayer()
    }));
    return pickImp(candidates, sceneReachable)?.item ?? null;
}

async function takeBead(bead: GroundItem, log: (m: string) => void): Promise<boolean> {
    if (Inventory.free() === 0) {
        log('the pack is full, so a dropped bead cannot be taken');
        return false;
    }
    const id = bead.id;
    const where = bead.tile();
    if (bead.distance() > 1 && !(await Traversal.walkResilient(where, { radius: 1, attempts: 2, timeoutMs: 60_000, log }))) {
        return false;
    }
    const drop = GroundItems.query().where(item => item.id === id).action('Take').within(BEAD_RADIUS).nearest();
    if (!drop) {
        log(`the ${bead.name ?? id} at (${where.x},${where.z}) was taken by someone else`);
        return false;
    }
    const before = Inventory.countById(id);
    if (!(await drop.interact('Take'))) {
        return false;
    }
    const took = await Execution.delayUntil(() => Inventory.countById(id) > before, TAKE_MS);
    if (took) {
        log(`picked up ${drop.name ?? id}`);
    }
    return took;
}

async function killImp(imp: Npc, log: (m: string) => void): Promise<boolean> {
    const index = imp.index;
    const live = (): Npc | null => Npcs.all().find(npc => npc.index === index && npc.name === IMP) ?? null;

    if (imp.distance() > ENGAGE_RADIUS && !(await Traversal.walkResilient(imp.tile(), { radius: 2, attempts: 2, timeoutMs: 90_000, log }))) {
        return false;
    }
    const target = live();
    if (!target) {
        return false;
    }
    if (!(await target.interact('Attack'))) {
        log(`Attack on imp ${index} was rejected`);
        return false;
    }

    // Why: `ai_queue2,imp` rolls a 1-in-10 teleport on every hit the imp survives, so a fight that stops making progress is the normal case and not a stuck step.
    const deadline = performance.now() + KILL_MS;
    while (performance.now() < deadline) {
        await Sustain.run();
        if (EventSignal.pending()) {
            return false;
        }
        const npc = live();
        if (!npc) {
            log(`imp ${index} died`);
            return true;
        }
        if (npc.distance() > LOST_RADIUS) {
            log(`imp ${index} teleported out of the fight`);
            return false;
        }
        if (npc.targetsAnotherPlayer()) {
            log(`imp ${index} was taken over by another player`);
            return false;
        }
        await Execution.delayTicks(1);
    }
    log(`imp ${index} outlived ${KILL_MS / 1000}s of combat`);
    return false;
}

async function holdForRespawn(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!here || here.level !== IMP_STAND.level || IMP_STAND.distanceTo(here) > HOLD_RADIUS) {
        return Traversal.walkResilient(IMP_STAND, { radius: 2, attempts: 3, timeoutMs: 180_000, log });
    }
    log(`no imp within ${SEARCH_RADIUS} tiles of the Falador south gate — holding for a respawn`);
    const appeared = await Execution.delayUntil(() => fieldImp() !== null || EventSignal.pending(), RESPAWN_MS);
    return appeared && !EventSignal.pending();
}

/** One unit of bead farming: take a drop, kill an imp, or close on the field. */
async function farmBeads(log: (m: string) => void): Promise<boolean> {
    const wanted = wantedBeadIds();
    if (wanted.size === 0) {
        return true;
    }
    const bead = beadOnGround(wanted);
    if (bead) {
        return takeBead(bead, log);
    }
    const imp = fieldImp();
    if (imp) {
        return killImp(imp, log);
    }
    return holdForRespawn(log);
}

export function gatherBead(snap: QuestSnapshot): QuestStep {
    const missing = missingBeads(snap);
    if (missing.length === 0) {
        return { kind: 'wait', reason: 'every bead is already held' };
    }
    // Why: an unread bank is not an empty bank, and a bead banked by an earlier run is 50 imp kills cheaper than another farm.
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: DRAYNOR_BANK };
    }
    const banked = missing.filter(bead => bankedCount(snap, bead) > 0);
    if (banked.length > 0) {
        return {
            kind: 'withdraw',
            items: banked.map(bead => ({ name: bead.name, id: bead.id, qty: 1 })),
            bank: DRAYNOR_BANK
        };
    }
    return {
        kind: 'custom',
        name: `kill imps for ${missing.map(bead => bead.name).join(', ')}`,
        run: farmBeads
    };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.journal === 'notStarted') {
        return { kind: 'talk', stop: MIZGOG };
    }
    if (missingBeads(snap).length > 0) {
        return gatherBead(snap);
    }
    return { kind: 'talk', stop: MIZGOG };
}

export const impcatcher: QuestModule = {
    record: QUESTS.find(record => record.id === 'imp')!,
    bank: DRAYNOR_BANK,
    grind: [IMP],
    gather: Object.fromEntries(IMP_BEADS.map(bead => [bead.name.toLowerCase(), gatherBead])),
    decide
};
