import { actions, reader } from '../../../adapter/ClientAdapter.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import Tile from '../../../api/Tile.js';
import { Equipment } from '../../../api/hud/Equipment.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { GroundItems } from '../../../api/queries/GroundItems.js';
import type { GroundItem, Npc } from '../../../api/entities/index.js';
import { Locs, type Loc } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { Traversal } from '../../../api/Traversal.js';
import { GameMessages } from '../../../events/gameMessages.js';
import { heldId, settleScene, useOnLoc } from '../../exec/prompts.js';
import {
    BELLOWS_STAND,
    BOOKCASE,
    CRATE_HUB,
    EW_ITEM,
    FURNACE_STAND,
    ROCK_STAND,
    SMITHY,
    STAIRS_TOP,
    TROUGH_STAND,
    WATER_STAND,
    WORKBENCH_STAND,
    WORKSHOP_ARRIVAL,
    ewArea
} from './areas.js';
import { COAL_NEED } from './supplies.js';

const EARTH_ELEMENTAL = 'Earth elemental';
const BOOK_MODAL_MS = 8_000;

function dist2(a: { x: number; z: number }, b: { x: number; z: number }): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz;
}

async function walkNear(tile: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && tile.distanceTo(here) <= radius) {
        return true;
    }
    return Traversal.walkResilient(tile, { radius, attempts: 4, timeoutMs: 180_000, log });
}

async function closeBookModal(): Promise<void> {
    // Reading the battered book opens a book interface (main modal), not a chat box.
    const deadline = performance.now() + BOOK_MODAL_MS;
    while (performance.now() < deadline) {
        if (reader.modals().main === -1) {
            return;
        }
        actions.closeModal();
        await Execution.delayTicks(1);
    }
}

export async function searchBookcase(log: (m: string) => void): Promise<boolean> {
    if (heldId(EW_ITEM.BATTERED_BOOK.id) > 0) {
        return true;
    }
    if (!(await walkNear(BOOKCASE, 2, log))) {
        return false;
    }
    await settleScene();
    const bookcase = Locs.query().name('Bookcase').action('Search').within(6).nearest();
    if (!bookcase) {
        log('no Bookcase to Search near Seers house');
        return false;
    }
    if (!(await bookcase.interact('Search'))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(EW_ITEM.BATTERED_BOOK.id) > 0, 8_000);
}

export async function readBatteredBook(log: (m: string) => void): Promise<boolean> {
    const book = Inventory.items().find(i => i.id === EW_ITEM.BATTERED_BOOK.id);
    if (!book) {
        log('no Battered book to Read');
        return false;
    }
    log('reading the Battered book to start the quest');
    if (!(await book.interact('Read'))) {
        return false;
    }
    await Execution.delayTicks(2);
    await closeBookModal();
    return true;
}

function isSlashToolName(name: string | null | undefined): boolean {
    const n = name?.toLowerCase() ?? '';
    return n === 'knife'
        || n.includes('scimitar')
        || n.includes('sword')
        || n.includes('longsword')
        || n.includes('dagger')
        || n.includes('battleaxe');
}

function findHeldSlashTool(): ReturnType<typeof Inventory.items>[number] | undefined {
    return Inventory.items().find(i => i.id === EW_ITEM.KNIFE.id)
        ?? Inventory.items().find(i => isSlashToolName(i.name));
}

export async function slashBookForKey(log: (m: string) => void): Promise<boolean> {
    if (heldId(EW_ITEM.BATTERED_KEY.id) > 0) {
        return true;
    }
    const book = Inventory.items().find(i => i.id === EW_ITEM.BATTERED_BOOK.id);
    if (!book) {
        log('need the Battered book to cut the spine');
        return false;
    }

    let knife = findHeldSlashTool();
    // useOn needs a pack item — if the only blade is worn, remove it first.
    if (!knife) {
        const wornBlade = Equipment.items().find(i => isSlashToolName(i.name));
        if (wornBlade?.name) {
            log(`removing ${wornBlade.name} so it can cut the book spine`);
            await Equipment.unequip(wornBlade.name);
            knife = findHeldSlashTool();
        }
    }
    if (!knife) {
        log('need a Knife (or slash weapon) in the pack to cut the book spine');
        return false;
    }
    log('cutting the spine of the Battered book for the key');
    const before = heldId(EW_ITEM.BATTERED_KEY.id);
    if (!(await knife.useOn(book))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(EW_ITEM.BATTERED_KEY.id) > before, 8_000);
}

export async function enterWorkshop(log: (m: string) => void): Promise<boolean> {
    if (ewArea(Game.tile()) === 'workshop') {
        return true;
    }
    // Stand outside the smithy — do not path onto the wall loc tile (unwalkable).
    if (!(await walkNear(SMITHY, 4, log))) {
        return false;
    }
    await settleScene();

    // The "Odd looking wall" is not a normal door: oplocu with the Battered key opens it.
    // Push only works after it is already unlocked for this player.
    const wall = Locs.query().name('Odd looking wall').within(10).nearest();
    if (!wall) {
        log('no Odd looking wall near the Seers smithy');
        return false;
    }
    if (heldId(EW_ITEM.BATTERED_KEY.id) > 0) {
        const key = Inventory.items().find(i => i.id === EW_ITEM.BATTERED_KEY.id);
        if (!key) {
            log('no Battered key to use on the Odd looking wall');
            return false;
        }
        log('using the Battered key on the Odd looking wall');
        if (!(await key.useOn(wall))) {
            return false;
        }
        await Execution.delayTicks(3);
    } else {
        const pushable = Locs.query().name('Odd looking wall').action('Push').within(10).nearest();
        if (pushable) {
            log('pushing the Odd looking wall');
            await pushable.interact('Push');
            await Execution.delayTicks(2);
        } else {
            log('need the Battered key for the Odd looking wall');
            return false;
        }
    }

    // Stairs are just inside; walk if needed, then Climb-down into the workshop pocket.
    if (!(await walkNear(STAIRS_TOP, 3, log))) {
        // Still try the climb from wherever we are if the stairs are visible.
        await settleScene();
    } else {
        await settleScene();
    }
    const stairs = Locs.query().name('Staircase').action('Climb-down').within(8).nearest();
    if (!stairs) {
        log('no Staircase to Climb-down in the Seers smithy');
        return false;
    }
    log('climbing down into the Elemental Workshop');
    if (!(await stairs.interact('Climb-down'))) {
        return false;
    }
    return Execution.delayUntil(() => ewArea(Game.tile()) === 'workshop', 12_000);
}

export async function leaveWorkshop(log: (m: string) => void): Promise<boolean> {
    if (ewArea(Game.tile()) !== 'workshop') {
        return true;
    }
    if (!(await walkNear(WORKSHOP_ARRIVAL, 3, log))) {
        return false;
    }
    await settleScene();
    const stairs = Locs.query().name('Staircase').action('Climb-up').within(8).nearest();
    if (!stairs) {
        log('no Staircase to Climb-up out of the workshop');
        return false;
    }
    if (!(await stairs.interact('Climb-up'))) {
        return false;
    }
    return Execution.delayUntil(() => ewArea(Game.tile()) !== 'workshop', 12_000);
}

const WATER_STARTED = /water wheel starting up/i;
const WATER_STOPPED = /water wheel coming to a standstill/i;
const WATER_RESET = /flow gates resetting/i;
const VALVE_LOCKED = /valve seems locked off/i;
const VALVE_TURNED = /you turn the handle/i;

function distinctWaterValves(): Loc[] {
    const seen = new Set<string>();
    const out: Loc[] = [];
    for (const v of Locs.query().name('Water Valve').action('Turn').within(20).results()) {
        const t = v.tile();
        const key = `${t.x},${t.z},${t.level}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(v);
    }
    // Higher x first (guide "east"), then reverse if the lever resets.
    return out.sort((a, b) => b.tile().x - a.tile().x || b.tile().z - a.tile().z);
}

function waterLever(): Loc | null {
    return Locs.query().name('Lever').action('Pull').within(14).results()
        .sort((a, b) => dist2(a.tile(), WATER_STAND) - dist2(b.tile(), WATER_STAND))[0] ?? null;
}

async function clearNearbyWaterThreat(log: (m: string) => void): Promise<void> {
    await ensureMeleeWeapon(log);
    if (!Game.inCombat()) {
        const pest = Npcs.query().name('Water elemental').within(8).nearest();
        if (pest && !pest.targetsAnotherPlayer()) {
            log('clearing a Water elemental before the valves');
            await pest.interact('Attack');
            await Execution.delayUntil(() => Game.inCombat() || !pest.valid(), 4_000);
        }
    }
    if (Game.inCombat()) {
        // Low-combat accounts can take a long time; still bound so death/respawn can resume.
        await Execution.delayUntil(() => !Game.inCombat(), 120_000);
    }
}

async function turnValve(valve: Loc, label: string, log: (m: string) => void): Promise<'ok' | 'locked' | 'fail'> {
    const mark = GameMessages.mark();
    log(`turning the ${label} Water Valve at (${valve.tile().x},${valve.tile().z})`);
    // Stand next to this valve so the op is not dropped mid-path.
    if (!(await walkNear(new Tile(valve.tile().x, valve.tile().z, valve.tile().level), 2, log))) {
        return 'fail';
    }
    await settleScene();
    // Re-query — scene may have resettled after the walk.
    const live = Locs.query().name('Water Valve').action('Turn').within(6).nearest()
        ?? valve;
    if (!(await live.interact('Turn'))) {
        return 'fail';
    }
    await Execution.delayUntil(
        () => GameMessages.sawSince(mark, VALVE_TURNED) || GameMessages.sawSince(mark, VALVE_LOCKED),
        4_000
    );
    if (GameMessages.sawSince(mark, VALVE_LOCKED)) {
        return 'locked';
    }
    if (!GameMessages.sawSince(mark, VALVE_TURNED)) {
        log(`no turn confirmation from the ${label} valve`);
        return 'fail';
    }
    await Execution.delayTicks(2);
    return 'ok';
}

/**
 * Server bits: right (valve_1) may only toggle while left is off; left (valve_2) always
 * toggles. Lever needs both bits set. Wrong order → "flow gates resetting". Running
 * wheel + lever → stop. Only succeed on verified start or locked valves.
 */
async function tryValveOrder(
    first: Loc,
    second: Loc,
    orderLabel: string,
    log: (m: string) => void
): Promise<'started' | 'reset' | 'stopped' | 'locked' | 'fail'> {
    log(`valve order: ${orderLabel}`);
    const a = await turnValve(first, 'first', log);
    if (a === 'locked') {
        return 'locked';
    }
    if (a !== 'ok') {
        return 'fail';
    }
    const b = await turnValve(second, 'second', log);
    if (b === 'locked') {
        return 'locked';
    }
    if (b !== 'ok') {
        return 'fail';
    }

    const lever = waterLever();
    if (!lever) {
        log('no water-chamber Lever to Pull');
        return 'fail';
    }
    const leverMark = GameMessages.mark();
    log('pulling the water-chamber Lever');
    if (!(await lever.interact('Pull'))) {
        return 'fail';
    }
    await Execution.delayUntil(
        () => GameMessages.sawSince(leverMark, WATER_STARTED)
            || GameMessages.sawSince(leverMark, WATER_STOPPED)
            || GameMessages.sawSince(leverMark, WATER_RESET),
        6_000
    );
    if (GameMessages.sawSince(leverMark, WATER_STARTED)) {
        return 'started';
    }
    if (GameMessages.sawSince(leverMark, WATER_STOPPED)) {
        return 'stopped';
    }
    if (GameMessages.sawSince(leverMark, WATER_RESET)) {
        return 'reset';
    }
    return 'fail';
}

export async function startWaterWheel(log: (m: string) => void): Promise<boolean> {
    if (!(await walkNear(WATER_STAND, 3, log))) {
        return false;
    }
    await settleScene();
    await clearNearbyWaterThreat(log);

    const valves = distinctWaterValves();
    if (valves.length < 2) {
        log(`need two Water Valves in the northern chamber (found ${valves.length})`);
        return false;
    }
    const hi = valves[0]!;
    const lo = valves[valves.length - 1]!;
    log(`valves at (${hi.tile().x},${hi.tile().z}) and (${lo.tile().x},${lo.tile().z})`);

    // Guide says east then west. Server needs right-bit first (only toggles while left is off).
    // If compass mapping is inverted, the reverse order is tried after a reset.
    let result = await tryValveOrder(hi, lo, 'higher-x then lower-x', log);
    if (result === 'reset') {
        log('flow gates reset — retrying reverse valve order (valves are off again)');
        result = await tryValveOrder(lo, hi, 'lower-x then higher-x', log);
    }

    if (result === 'started') {
        log('water wheel started');
        return true;
    }
    if (result === 'locked') {
        log('valves are locked — water wheel already running');
        return true;
    }
    if (result === 'stopped') {
        log('water wheel stopped (lever toggled off) — will re-open valves next pass');
        return false;
    }
    if (result === 'reset') {
        log('flow gates reset on both valve orders');
        return false;
    }
    log('water controls did not confirm a start');
    return false;
}

export async function searchCratesFor(
    want: { bowl: boolean; leather: boolean; needle: boolean },
    log: (m: string) => void
): Promise<boolean> {
    if (!(await walkNear(CRATE_HUB, 4, log))) {
        return false;
    }
    await settleScene();

    const needBowl = () => want.bowl && heldId(EW_ITEM.STONE_BOWL.id) === 0 && heldId(EW_ITEM.STONE_BOWL_FULL.id) === 0;
    const needLeather = () => want.leather && heldId(EW_ITEM.LEATHER.id) === 0;
    const needNeedle = () => want.needle && heldId(EW_ITEM.NEEDLE.id) === 0;

    if (!needBowl() && !needLeather() && !needNeedle()) {
        return true;
    }

    const crates = [
        ...Locs.query().name('Crate').action('Search').within(18).results(),
        ...Locs.query().name('Boxes').action('Search').within(18).results()
    ];
    if (crates.length === 0) {
        log('no Crates/Boxes to Search in the workshop');
        return false;
    }

    for (const crate of crates) {
        if (!needBowl() && !needLeather() && !needNeedle()) {
            return true;
        }
        const beforeBowl = heldId(EW_ITEM.STONE_BOWL.id);
        const beforeLeather = heldId(EW_ITEM.LEATHER.id);
        const beforeNeedle = heldId(EW_ITEM.NEEDLE.id);
        log(`searching ${crate.name ?? 'crate'} for workshop supplies`);
        if (!(await crate.interact('Search'))) {
            continue;
        }
        await Execution.delayUntil(
            () => heldId(EW_ITEM.STONE_BOWL.id) > beforeBowl
                || heldId(EW_ITEM.LEATHER.id) > beforeLeather
                || heldId(EW_ITEM.NEEDLE.id) > beforeNeedle,
            3_000
        );
    }

    if (needBowl() || needLeather() || needNeedle()) {
        log(`crate search incomplete (bowl=${needBowl()} leather=${needLeather()} needle=${needNeedle()})`);
        return false;
    }
    return true;
}

export async function fixBellows(log: (m: string) => void): Promise<boolean> {
    if (heldId(EW_ITEM.LEATHER.id) === 0 || heldId(EW_ITEM.NEEDLE.id) === 0 || heldId(EW_ITEM.THREAD.id) === 0) {
        log('need Leather, Needle, and Thread to Fix the Bellows');
        return false;
    }
    if (!(await walkNear(BELLOWS_STAND, 3, log))) {
        return false;
    }
    await settleScene();
    const bellows = Locs.query().name('Bellows').action('Fix').within(10).nearest();
    if (!bellows) {
        log('no Bellows to Fix');
        return false;
    }
    log('stitching leather over the hole in the Bellows');
    if (!(await bellows.interact('Fix'))) {
        return false;
    }
    await Execution.delayTicks(3);
    return heldId(EW_ITEM.LEATHER.id) === 0 || heldId(EW_ITEM.THREAD.id) === 0;
}

export async function lightFurnace(log: (m: string) => void): Promise<boolean> {
    if (heldId(EW_ITEM.STONE_BOWL_FULL.id) === 0) {
        if (heldId(EW_ITEM.STONE_BOWL.id) === 0) {
            log('need a stone bowl to scoop lava');
            return false;
        }
        if (!(await walkNear(TROUGH_STAND, 3, log))) {
            return false;
        }
        log('filling the stone bowl from the Lava trough');
        if (!(await useOnLoc(
            EW_ITEM.STONE_BOWL.id,
            { name: 'Lava trough', near: TROUGH_STAND, within: 10 },
            [],
            () => heldId(EW_ITEM.STONE_BOWL_FULL.id) > 0,
            log
        ))) {
            return false;
        }
    }

    if (!(await walkNear(FURNACE_STAND, 3, log))) {
        return false;
    }
    log('emptying lava into the Furnace');
    return useOnLoc(
        EW_ITEM.STONE_BOWL_FULL.id,
        { name: 'Furnace', near: FURNACE_STAND, within: 10 },
        [],
        () => heldId(EW_ITEM.STONE_BOWL_FULL.id) === 0,
        log
    );
}

const FURNACE_COLD = /furnace is cold/i;
const FURNACE_NEEDS_HEAT = /needs to be hotter/i;
const FURNACE_NEED_COAL = /need four heaps of coal/i;
const AIR_PUMPING = /bellows pump air/i;
const AIR_STOPPED = /bellows stop pumping/i;
const AIR_NOTHING = /nothing happens; the lever resets/i;

async function pullAirLever(log: (m: string) => void): Promise<'on' | 'off' | 'nothing' | 'fail'> {
    if (!(await walkNear(BELLOWS_STAND, 3, log))) {
        return 'fail';
    }
    await settleScene();
    const lever = Locs.query().name('Lever').action('Pull').within(12).results()
        .sort((a, b) => dist2(a.tile(), BELLOWS_STAND) - dist2(b.tile(), BELLOWS_STAND))[0];
    if (!lever) {
        log('no air-chamber Lever to Pull');
        return 'fail';
    }
    const mark = GameMessages.mark();
    log('pulling the air-chamber Lever to pump the bellows');
    if (!(await lever.interact('Pull'))) {
        return 'fail';
    }
    await Execution.delayUntil(
        () => GameMessages.sawSince(mark, AIR_PUMPING)
            || GameMessages.sawSince(mark, AIR_STOPPED)
            || GameMessages.sawSince(mark, AIR_NOTHING),
        5_000
    );
    if (GameMessages.sawSince(mark, AIR_PUMPING)) {
        return 'on';
    }
    if (GameMessages.sawSince(mark, AIR_STOPPED)) {
        return 'off';
    }
    if (GameMessages.sawSince(mark, AIR_NOTHING)) {
        return 'nothing';
    }
    return 'fail';
}

async function waitOutCombat(ms: number): Promise<void> {
    await Execution.delayUntil(() => !Game.inCombat(), ms);
}

/** Prefer a real weapon — unarmed maxed accounts still stall forever on the rock elemental. */
async function ensureMeleeWeapon(log: (m: string) => void): Promise<void> {
    if (Equipment.items().some(i => {
        const n = i.name?.toLowerCase() ?? '';
        return n.includes('scimitar') || n.includes('sword') || n.includes('battleaxe') || n.includes('dagger');
    })) {
        return;
    }
    const weapon = Inventory.items().find(i => {
        const n = i.name?.toLowerCase() ?? '';
        return (n.includes('scimitar') || n.includes('sword') || n.includes('battleaxe') || n.includes('dagger'))
            && i.actions().some(a => /wield|wear|equip/i.test(a));
    });
    if (!weapon?.name) {
        log('no melee weapon in pack — fighting unarmed');
        return;
    }
    log(`wielding ${weapon.name}`);
    await Equipment.equip(weapon.name);
}

/** Earth elementals in the water/air wings do not drop quest ore — only the rock spawn does. */
function nearRockPocket(tile: { x: number; z: number } | null | undefined): boolean {
    if (!tile) {
        return false;
    }
    // West mining wing (live runs drift to ~2690–2712, z ~9880–9905).
    return tile.x >= 2688 && tile.x <= 2714 && tile.z >= 9875 && tile.z <= 9910;
}

function earthAtRock(): Npc | null {
    return Npcs.query()
        .name(EARTH_ELEMENTAL)
        .where(n => !n.targetsAnotherPlayer() && nearRockPocket(n.tile()))
        .within(20)
        .nearest();
}

/** Prefer exact object id — name match alone can miss depending on scene load order. */
function findOreOnGround(): GroundItem | null {
    return GroundItems.query()
        .where(g => g.id === EW_ITEM.ELEMENTAL_ORE.id)
        .within(24)
        .nearest()
        ?? GroundItems.query().name(EW_ITEM.ELEMENTAL_ORE.name).within(24).nearest();
}

/**
 * Loot Elemental ore after the rock-spawn death. Drop can land a few tiles off and
 * appears a tick or two after the NPC is gone — wait, walk, and retry Take.
 */
async function takeElementalOre(log: (m: string) => void): Promise<boolean> {
    if (heldId(EW_ITEM.ELEMENTAL_ORE.id) > 0) {
        return true;
    }
    // Wait for the server loot add after death (stack with swamprocks on same tile).
    await Execution.delayUntil(() => findOreOnGround() !== null || heldId(EW_ITEM.ELEMENTAL_ORE.id) > 0, 10_000);
    if (heldId(EW_ITEM.ELEMENTAL_ORE.id) > 0) {
        return true;
    }

    for (let attempt = 0; attempt < 5; attempt++) {
        const ground = findOreOnGround();
        if (!ground) {
            await Execution.delayTicks(2);
            continue;
        }
        const t = ground.tile();
        log(`taking Elemental ore at (${t.x},${t.z}) attempt ${attempt + 1}`);
        // Stand next to the pile so Take is not dropped mid-path.
        if (Game.tile() && ground.distance() > 2) {
            await walkNear(new Tile(t.x, t.z, t.level), 1, log);
            await settleScene();
        }
        const live = findOreOnGround();
        if (!live) {
            continue;
        }
        const before = heldId(EW_ITEM.ELEMENTAL_ORE.id);
        if (!(await live.interact('Take'))) {
            await Execution.delayTicks(1);
            continue;
        }
        if (await Execution.delayUntil(() => heldId(EW_ITEM.ELEMENTAL_ORE.id) > before, 6_000)) {
            return true;
        }
        // Another pile (e.g. swamprocks) may have been clicked first — try again.
        await Execution.delayTicks(1);
    }
    return heldId(EW_ITEM.ELEMENTAL_ORE.id) > 0;
}

/** Free one pack slot so Take is not silently refused on a full inventory. */
async function freeSlotForOre(log: (m: string) => void): Promise<void> {
    if (!Inventory.isFull()) {
        return;
    }
    // Prefer dropping a spare food; never drop quest tools/ore/key/book.
    const keep = new Set([
        EW_ITEM.BATTERED_BOOK.id, EW_ITEM.BATTERED_KEY.id, EW_ITEM.ELEMENTAL_ORE.id,
        EW_ITEM.ELEMENTAL_METAL.id, EW_ITEM.STONE_BOWL.id, EW_ITEM.STONE_BOWL_FULL.id,
        EW_ITEM.KNIFE.id, EW_ITEM.HAMMER.id, EW_ITEM.NEEDLE.id, EW_ITEM.THREAD.id,
        EW_ITEM.LEATHER.id, EW_ITEM.COAL.id, EW_ITEM.COINS.id,
        1265, 1267, 1269, 1271, 1273, 1275 // pickaxes
    ]);
    const food = Inventory.items().find(i => {
        const n = i.name?.toLowerCase() ?? '';
        return (n.includes('lobster') || n.includes('swordfish') || n.includes('salmon') || n.includes('trout'))
            && i.actions().some(a => a.toLowerCase() === 'drop');
    });
    const junk = food ?? Inventory.items().find(i =>
        i.id !== undefined && !keep.has(i.id) && i.actions().some(a => a.toLowerCase() === 'drop')
    );
    if (!junk) {
        log('inventory full and nothing safe to drop for Elemental ore');
        return;
    }
    log(`dropping ${junk.name ?? junk.id} to free a slot for ore`);
    await junk.interact('Drop');
    await Execution.delayUntil(() => !Inventory.isFull(), 3_000);
}

/**
 * Mine the west-chamber rock (spawns the *rock* Earth elemental) and take ore.
 * Standing "Earth elemental" NPCs in the workshop do **not** drop quest ore —
 * only `earth_elemental_rock_version` after Mine, and only if we are the hero.
 * Always Mine first; never attack a pre-existing earth elemental.
 */
export async function mineElementalOre(log: (m: string) => void): Promise<boolean> {
    if (heldId(EW_ITEM.ELEMENTAL_ORE.id) > 0) {
        return true;
    }

    await ensureMeleeWeapon(log);
    await freeSlotForOre(log);

    if (!(await walkNear(ROCK_STAND, 5, log))) {
        return false;
    }
    await settleScene();

    if (findOreOnGround()) {
        if (await takeElementalOre(log)) {
            return true;
        }
    }

    // Snapshot scene NPCs so we only attack the one that spawns from this Mine.
    const beforeIdx = new Set(
        Npcs.query().name(EARTH_ELEMENTAL).within(20).results().map(n => n.index)
    );

    const rock = Locs.query().name('Pile of Rock').action('Mine').within(12).nearest();
    if (!rock) {
        log('no Pile of Rock to Mine in the west chamber');
        return false;
    }
    log('mining the elemental rock (Earth elemental will spawn)');
    if (!(await rock.interact('Mine'))) {
        return false;
    }

    let elemental: Npc | null = null;
    await Execution.delayUntil(() => {
        if (heldId(EW_ITEM.ELEMENTAL_ORE.id) > 0 || findOreOnGround()) {
            return true;
        }
        elemental = Npcs.query()
            .name(EARTH_ELEMENTAL)
            .where(n => !beforeIdx.has(n.index) && !n.targetsAnotherPlayer())
            .within(16)
            .nearest()
            ?? earthAtRock();
        return elemental !== null;
    }, 12_000);

    if (heldId(EW_ITEM.ELEMENTAL_ORE.id) > 0) {
        return true;
    }
    if (await takeElementalOre(log)) {
        return true;
    }
    if (!elemental) {
        // Rock may have already been "mined" into an aggressive NPC mid-click.
        elemental = earthAtRock();
    }
    if (!elemental) {
        log('Earth elemental did not appear at the rock');
        return false;
    }

    log('killing the rock Earth elemental for Elemental ore');
    if (!(await elemental.interact('Attack'))) {
        return false;
    }
    await Execution.delayUntil(
        () => Game.inCombat() || !elemental!.valid() || findOreOnGround() !== null,
        6_000
    );

    // Stay until the NPC is gone or ore is visible — hero loot only drops on our kill.
    const deathTile = elemental.tile();
    const finished = await Execution.delayUntil(
        () => heldId(EW_ITEM.ELEMENTAL_ORE.id) > 0
            || findOreOnGround() !== null
            || !elemental!.valid(),
        60_000
    );
    if (!finished && Game.inCombat()) {
        log('Earth elemental combat did not finish in time');
        return false;
    }

    // Loot often lands on the death tile a tick after the NPC disappears.
    if (deathTile) {
        await walkNear(new Tile(deathTile.x, deathTile.z, deathTile.level), 1, log);
        await settleScene();
    }
    if (await takeElementalOre(log)) {
        return true;
    }
    log('Earth elemental died but Elemental ore was not on the ground');
    return false;
}

/**
 * Smelt ore + 4 coal. Air is not journal-visible and the air lever toggles —
 * try the furnace first; only pull air when the server says it needs more heat.
 */
export async function smeltElementalBar(log: (m: string) => void): Promise<boolean> {
    if (heldId(EW_ITEM.ELEMENTAL_METAL.id) > 0) {
        return true;
    }
    if (heldId(EW_ITEM.ELEMENTAL_ORE.id) === 0) {
        log('no Elemental ore to smelt');
        return false;
    }
    if (Inventory.countById(EW_ITEM.COAL.id) < COAL_NEED && Inventory.count(EW_ITEM.COAL.name) < COAL_NEED) {
        log(`need ${COAL_NEED} Coal to smelt Elemental ore`);
        return false;
    }

    const trySmelt = async (): Promise<'ok' | 'cold' | 'hotter' | 'coal' | 'fail'> => {
        if (!(await walkNear(FURNACE_STAND, 3, log))) {
            return 'fail';
        }
        await settleScene();
        const before = heldId(EW_ITEM.ELEMENTAL_METAL.id);
        const mark = GameMessages.mark();
        log('placing Elemental ore and Coal into the Furnace');
        const ore = Inventory.items().find(i => i.id === EW_ITEM.ELEMENTAL_ORE.id);
        const furnace = Locs.query().name('Furnace').within(10).nearest();
        if (!ore || !furnace) {
            return 'fail';
        }
        if (!(await ore.useOn(furnace))) {
            return 'fail';
        }
        await Execution.delayUntil(
            () => heldId(EW_ITEM.ELEMENTAL_METAL.id) > before
                || GameMessages.sawSince(mark, FURNACE_COLD)
                || GameMessages.sawSince(mark, FURNACE_NEEDS_HEAT)
                || GameMessages.sawSince(mark, FURNACE_NEED_COAL),
            10_000
        );
        if (heldId(EW_ITEM.ELEMENTAL_METAL.id) > before) {
            return 'ok';
        }
        if (GameMessages.sawSince(mark, FURNACE_NEED_COAL)) {
            return 'coal';
        }
        if (GameMessages.sawSince(mark, FURNACE_COLD)) {
            return 'cold';
        }
        if (GameMessages.sawSince(mark, FURNACE_NEEDS_HEAT)) {
            return 'hotter';
        }
        return 'fail';
    };

    let result = await trySmelt();
    if (result === 'ok') {
        return true;
    }
    if (result === 'coal') {
        log('furnace refused — need 4 Coal in the pack');
        return false;
    }
    if (result === 'cold') {
        log('furnace is cold — light it with lava first');
        return false;
    }
    if (result === 'hotter' || result === 'fail') {
        // Heat off or unknown: try air once (toggle risk handled by message).
        const air = await pullAirLever(log);
        if (air === 'off') {
            // Toggled off a running blast — pull again to restore.
            log('air was on; re-pulling to restore blast');
            await pullAirLever(log);
        } else if (air === 'nothing') {
            log('air lever did nothing — water wheel / bellows may not be ready');
            return false;
        }
        result = await trySmelt();
        return result === 'ok';
    }
    return false;
}

export async function smithElementalShield(log: (m: string) => void): Promise<boolean> {
    if (heldId(EW_ITEM.ELEMENTAL_SHIELD.id) > 0) {
        return true;
    }
    if (heldId(EW_ITEM.ELEMENTAL_METAL.id) === 0) {
        log('no Elemental metal to smith');
        return false;
    }
    if (heldId(EW_ITEM.BATTERED_BOOK.id) === 0) {
        log('need the Battered book as instructions on the workbench');
        return false;
    }
    if (heldId(EW_ITEM.HAMMER.id) === 0) {
        log('need a Hammer to work the metal');
        return false;
    }

    if (!(await walkNear(WORKBENCH_STAND, 3, log))) {
        return false;
    }
    await settleScene();
    const before = heldId(EW_ITEM.ELEMENTAL_SHIELD.id);
    log('smithing an Elemental shield on the Workbench');
    return useOnLoc(
        EW_ITEM.ELEMENTAL_METAL.id,
        { name: 'Workbench', near: WORKBENCH_STAND, within: 10 },
        [],
        () => heldId(EW_ITEM.ELEMENTAL_SHIELD.id) > before,
        log
    );
}
