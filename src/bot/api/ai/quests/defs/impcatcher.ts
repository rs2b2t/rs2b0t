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

// Why: Mizgog's third option ends with "Give me a quest!", so a substring match on that alone clicks the sarcastic branch; the polite line goes first.
export const MIZGOG: NpcStop = {
    npc: 'Wizard Mizgog',
    anchor: new Tile(3103, 3163, 2),
    leash: 6,
    prefer: ['Give me a quest please.', 'Give me a quest!']
};

/** The 9 imp spawns on the scrub south of Ardougne, from the map squares. */
export const IMP_SPAWNS: readonly Tile[] = [
    new Tile(2632, 3202, 0),
    new Tile(2625, 3203, 0),
    new Tile(2639, 3206, 0),
    new Tile(2630, 3210, 0),
    new Tile(2625, 3217, 0),
    new Tile(2633, 3222, 0),
    new Tile(2639, 3230, 0),
    new Tile(2629, 3233, 0),
    new Tile(2633, 3243, 0)
];

const FIELD_LEVEL = 0;

// Why: the 9 spawns lie in a 14x41 strip, so this tile is within 21 of every one and inside `SEARCH_RADIUS` of the lot.

/** Where the bot stands to watch every spawn on the strip. */
export const IMP_STAND = new Tile(2632, 3222, 0);

// Why: the strip-to-tower route crosses Karamja, which has no bank, so a coin top-up there walks the bot off its route.

/** Karamja and the water around it, the bankless transit leg. */
const KARAMJA = { minX: 2740, maxX: 2970, minZ: 3020, maxZ: 3230 };

const SHIP_FARE = 30;
/** Withdrawn in one go so a mid-quest fare never costs another bank trip. */
const COIN_RESERVE = 200;
const COIN_FLOOR = SHIP_FARE * 2;

// Why: `wanderrange=27` plus a `map_findsquare(npc_coord, 0, 20)` teleport puts an imp anywhere in this box; one outside it is another cluster's.
// Why: the z 3180 floor keeps the next cluster south (tops out at z 3134) from pulling the bot 70 tiles off this one.

/** The ground an imp from these spawns can be standing on. */
export const IMP_FIELD = { minX: 2600, maxX: 2665, minZ: 3180, maxZ: 3265 };

const IMP = 'Imp';
/** The client streams a 104-tile scene, so this is most of what it can see. */
const SEARCH_RADIUS = 50;
const BEAD_RADIUS = 30;
const ENGAGE_RADIUS = 6;
/** Past this the imp teleported out of the fight. */
const LOST_RADIUS = 12;
/** Scene-BFS budget covering open ground within `SEARCH_RADIUS`. */
const REACH_STEPS = 20_000;
// Why: imps wander and teleport far enough that standing still watches empty ground, so an idle bot sweeps the strip.

/** How long an empty scene gets to fill before the bot sweeps. */
const SEARCH_IDLE_MS = 6000;
const SEARCH_STEP_MIN = 8;
const SEARCH_STEP_MAX = 20;
/** Headings tried before giving up and returning to the stand. */
const SEARCH_ROLLS = 6;
const KILL_MS = 30_000;
const TAKE_MS = 6000;
/** The strip-to-tower walk is cost 625 across 2 ship hops. */
const FAR_WALK_MS = 420_000;
/** A sweep is a short hop inside the strip; it shouldn't get the 7-minute budget. */
const SWEEP_WALK_MS = 45_000;

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
    return tile.level === FIELD_LEVEL
        && tile.x >= IMP_FIELD.minX && tile.x <= IMP_FIELD.maxX
        && tile.z >= IMP_FIELD.minZ && tile.z <= IMP_FIELD.maxZ;
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
}

// Why: a random point in the box bounces the bot across the strip; a random heading from here sweeps ground it hasn't looked at yet.

// Why: the field rectangle knows no terrain, so a heading can aim at an unreachable tile; 1 sweep in 6 burned 42s on one.

/** A tile to sweep towards: a random heading from `here`, held inside the field and probed for reach. */
export function searchTarget(
    here: { x: number; z: number; level: number } | null | undefined,
    random: () => number,
    reachable?: Reachable
): Tile {
    if (!here || !inField(here)) {
        return IMP_STAND;
    }
    for (let roll = 0; roll < SEARCH_ROLLS; roll++) {
        const heading = random() * 2 * Math.PI;
        const stride = SEARCH_STEP_MIN + random() * (SEARCH_STEP_MAX - SEARCH_STEP_MIN);
        const target = new Tile(
            clamp(Math.round(here.x + Math.cos(heading) * stride), IMP_FIELD.minX, IMP_FIELD.maxX),
            clamp(Math.round(here.z + Math.sin(heading) * stride), IMP_FIELD.minZ, IMP_FIELD.maxZ),
            FIELD_LEVEL
        );
        if (!reachable || reachable(target)) {
            return target;
        }
    }
    return IMP_STAND;
}

// Why: Returning success without available work loops this step at about 20 ms until the watchdog stops it.
// Why: in-combat is one such condition (an imp `pickImp` refuses can hold it forever), so it's left out.

/** Whether the idle wait found something for the next tick to act on. */
export function idleProgress(target: unknown | null, eventPending: boolean): boolean {
    return target !== null && !eventPending;
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

// Why: Imps teleport up to 20 tiles and may die behind scenery, so skip unreachable drops without consuming the step budget.

/** The closest drop the scene can path to. */
export function nearestReachable<T extends FieldTarget>(candidates: readonly T[], reachable: Reachable): T | null {
    return [...candidates].sort((a, b) => a.distance - b.distance).find(item => reachable(item.tile)) ?? null;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// Why: 20 bots each taking the nearest imp queue on the same one, so the target is drawn at random.
// Why: first reachable of a shuffled list is the same uniform pick as filter-then-choose and usually costs a single scene BFS where a filter costs 1 per candidate.

/** A random imp in the field that nobody else is fighting and the scene can path to. */
export function pickImp<T extends ImpCandidate>(
    candidates: readonly T[],
    reachable: Reachable,
    random: () => number = Math.random
): T | null {
    const free = candidates.filter(imp => inField(imp.tile) && !imp.contested);
    return shuffled(free, random).find(imp => reachable(imp.tile)) ?? null;
}

interface ImpCensus {
    scene: number;
    inField: number;
    free: number;
    reachable: number;
    /** Distance to the closest candidate the scene probe refused, or null when it refused none. */
    nearestRefused: number | null;
}

// Why: zero imps looks the same whether a filter ate them, the spawns are dead or the zone never streamed, and each has a different fix.

/** NPC names in the scene, counted, most numerous first. */
export function tallyNames(names: readonly (string | null)[]): string {
    if (names.length === 0) {
        return 'nothing';
    }
    const counts = new Map<string, number>();
    for (const name of names) {
        const key = name ?? '?';
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort(([aName, aCount], [bName, bCount]) => bCount - aCount || aName.localeCompare(bName))
        .map(([name, count]) => (count > 1 ? `${name} x${count}` : name))
        .join(', ');
}

/** How many imps survive each filter, for the log line when none does. */
export function impCensus(candidates: readonly ImpCandidate[], reachable: Reachable): ImpCensus {
    const inside = candidates.filter(imp => inField(imp.tile));
    const free = inside.filter(imp => !imp.contested);
    const refused = free.filter(imp => !reachable(imp.tile)).map(imp => imp.distance);
    return {
        scene: candidates.length,
        inField: inside.length,
        free: free.length,
        reachable: free.length - refused.length,
        nearestRefused: refused.length === 0 ? null : Math.min(...refused)
    };
}

function sceneReachable(tile: { x: number; z: number; level: number }): boolean {
    return Reachability.canReach(tile, { adjacentOk: true, maxSteps: REACH_STEPS });
}

function beadOnGround(wanted: Set<number>): GroundItem | null {
    const drops = GroundItems.query().where(item => wanted.has(item.id)).action('Take').within(BEAD_RADIUS).results();
    return nearestReachable(drops.map(drop => ({ item: drop, tile: drop.tile(), distance: drop.distance() })), sceneReachable)?.item ?? null;
}

function impCandidates(): (ImpCandidate & { item: Npc })[] {
    return Npcs.query().name(IMP).action('Attack').within(SEARCH_RADIUS).results().map(npc => ({
        item: npc,
        index: npc.index,
        tile: npc.tile(),
        distance: npc.distance(),
        contested: npc.targetsAnotherPlayer()
    }));
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

    // Why: `ai_queue2,imp` rolls a 1-in-10 teleport on every hit the imp survives, so a fight that stalls is normal.
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

// Why: the volcano blocks the middle, so standing still watches one arc; walking the ring is the respawn wait.
async function searchForImps(census: ImpCensus, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    const neighbours = census.scene === 0
        ? ` · scene holds ${tallyNames(Npcs.query().within(SEARCH_RADIUS).results().map(npc => npc.name))}`
        : '';
    const seen = `no imp to fight within ${SEARCH_RADIUS} tiles`
        + ` (${census.scene} in scene, ${census.inField} in the field, ${census.free} free, ${census.reachable} reachable`
        + `${census.nearestRefused === null ? '' : `, closest refused ${census.nearestRefused} tiles off`})${neighbours}`;

    if (!here || !inField(here)) {
        log(`${seen} — walking to the south-Ardougne strip at (${IMP_STAND.x},${IMP_STAND.z})`);
        return Traversal.walkResilient(IMP_STAND, { radius: 2, attempts: 3, timeoutMs: FAR_WALK_MS, log });
    }

    // Why: a short wait catches an imp about to respawn or wander in, cheaper than a walk.
    await Execution.delayUntil(
        () => pickImp(impCandidates(), sceneReachable) !== null || EventSignal.pending(),
        SEARCH_IDLE_MS
    );
    if (idleProgress(pickImp(impCandidates(), sceneReachable), EventSignal.pending())) {
        return true;
    }
    const target = searchTarget(here, Math.random, sceneReachable);
    log(`${seen} — sweeping to (${target.x},${target.z})`);
    return Traversal.walkResilient(target, { radius: 2, attempts: 2, timeoutMs: SWEEP_WALK_MS, log });
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
    const candidates = impCandidates();
    const imp = pickImp(candidates, sceneReachable);
    if (imp) {
        return killImp(imp.item, log);
    }
    return searchForImps(impCensus(candidates, sceneReachable), log);
}

function onKaramja(tile: QuestSnapshot['tile']): boolean {
    return tile !== null && tile !== undefined
        && tile.x >= KARAMJA.minX && tile.x <= KARAMJA.maxX
        && tile.z >= KARAMJA.minZ && tile.z <= KARAMJA.maxZ;
}

const BEAD_IDS: readonly number[] = IMP_BEADS.map(bead => bead.id);

export function gatherBead(snap: QuestSnapshot): QuestStep {
    const missing = missingBeads(snap);
    if (missing.length === 0) {
        return { kind: 'wait', reason: 'every bead is already held' };
    }
    // Why: an unread bank may hold a bead from an earlier run, which is 50 imp kills cheaper than farming another.
    if (!snap.bankKnown) {
        return { kind: 'scanBank' };
    }
    if (snap.freeSlots !== undefined && snap.freeSlots < missing.length) {
        return { kind: 'deposit', keep: ['coins'], keepIds: BEAD_IDS, exactKeep: true };
    }
    const banked = missing.filter(bead => bankedCount(snap, bead) > 0);
    if (banked.length > 0) {
        return {
            kind: 'withdraw',
            items: banked.map(bead => ({ name: bead.name, id: bead.id, qty: 1 }))
        };
    }
    // Why: fetch the fare before boarding; a top-up on Karamja sails home for coins and never kills an imp.
    const coins = snap.inv.get('coins') ?? 0;
    if (coins < COIN_FLOOR && !onKaramja(snap.tile) && snap.bankCoins > 0) {
        return {
            kind: 'withdraw',
            items: [{ name: 'Coins', qty: Math.min(COIN_RESERVE - coins, snap.bankCoins) }]
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
    // Why: the imp drop table is unconditional, so beads can be farmed before talking to Mizgog.
    // Why: the strip is 625 of walking and 2 ship fares from him, so gathering first pays that once.
    if (missingBeads(snap).length > 0) {
        return gatherBead(snap);
    }
    return { kind: 'talk', stop: MIZGOG };
}

export const impcatcher: QuestModule = {
    record: QUESTS.find(record => record.id === 'imp')!,
    // Why: the strip is south of Ardougne and the hand-in is at the Wizards' Tower, so the useful bank depends on the leg.
    bank: 'nearest',
    // Why: the engine restores its coin float every provisioning tick, which turns the 30-coin fare into a round trip across the sea.
    ownsInventory: true,
    grind: [IMP],
    gather: Object.fromEntries(IMP_BEADS.map(bead => [bead.name.toLowerCase(), gatherBead])),
    decide
};
