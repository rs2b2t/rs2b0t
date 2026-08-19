// docs/QUESTS.md
import { DirectNavigator } from '../../../../../event/webwalk/DirectNavigator.js';
import type Tile from '../../../../../geometry/Tile.js';
import { Equipment } from '../../../../equipment/Equipment.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import {
    ARROWS_WANTED,
    ICE_CHESTS,
    IKOV_LOC,
    IKOV_NAME,
    IKOV_OBJ,
    IKOV_TILE,
    LAVA_BRIDGE_ZONE,
    inDarkRoom,
    inTrapPit,
    pastSouthGate,
    westOfBridge
} from './areas.js';
import { heldOrBanked, lightCandle } from './supplies.js';

const WALK_MS = 300_000;
/** Circuits of the six chests per invocation, before the tick goes back to the engine. */
const CHEST_ROUNDS = 3;
/** What an empty chest answers with, and the only thing that separates it from a find in flight. */
const CHEST_EMPTY = /search the chest, but find nothing/i;

// Why: `%ikov_dungeon` is untransmitted and no journal line moves for the lever, so having stood in the ice cavern is the only evidence the client keeps that the south gate is unlocked — and that is what tells the crossing leg apart from the armoured one.

/** Set once a walk has put the bot past the south gate. */
let southGateSeenOpen = false;

/** Whether this session has seen the south gate open; false sends the next descent across the lava. */
export function southGateOpen(): boolean {
    return southGateSeenOpen;
}

// Why: the bridge is not a baked edge and its tiles are walkable, so any route the pathfinder draws across them ferries the bot to the wrong side.
export function templeWalk(dest: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    return Traversal.walkResilient(dest, {
        radius,
        attempts: 3,
        timeoutMs: WALK_MS,
        avoidZones: [LAVA_BRIDGE_ZONE],
        log
    });
}

function locById(id: number, within = 8): Loc | null {
    return Locs.query().where(l => l.id === id).within(within).nearest();
}

// Why: `~mesbox` blocks on `p_pausebutton`, so the script that raised it has not run its `inv_del` or its `setbit` yet, and the next op is swallowed while the box is up.

/** Click through whatever message box the last op raised. */
async function clearBox(): Promise<void> {
    for (let i = 0; i < 12; i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (!ChatDialog.isOpen()) {
            return;
        }
        await Execution.delayTicks(1);
    }
}

export function wearingBoots(): boolean {
    return Equipment.contains(IKOV_NAME.BOOTS);
}

/** The Door of Fear only opens northward for a character wearing Lucien's pendant. */
export async function wearFearPendant(log: (m: string) => void): Promise<boolean> {
    if (Equipment.contains(IKOV_NAME.PENDANT_LUCIEN)) {
        return true;
    }
    if (heldId(IKOV_OBJ.PENDANT_LUCIEN) === 0) {
        log('ikov: no pendant of lucien to wear — the Door of Fear stays shut');
        return false;
    }
    return Equipment.equip(IKOV_NAME.PENDANT_LUCIEN);
}

async function climbDarkStairsUp(log: (m: string) => void): Promise<boolean> {
    if (!(await templeWalk(IKOV_TILE.DARK_STAIRS_UP, 1, log))) {
        return false;
    }
    const stairs = locById(IKOV_LOC.DARK_STAIRS_UP, 4);
    if (!stairs || !(await stairs.interact('Climb-up'))) {
        log('ikov: no dark stairs out of the boots room');
        return false;
    }
    const out = await Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && !inDarkRoom(t);
    }, 10_000);
    if (out) {
        await settleScene();
    }
    return out;
}

async function climbTrapLadder(log: (m: string) => void): Promise<boolean> {
    if (!(await templeWalk(IKOV_TILE.TRAP_PIT_LADDER, 1, log))) {
        return false;
    }
    const ladder = locById(IKOV_LOC.TRAP_LADDER, 4);
    if (!ladder || !(await ladder.interact('Climb-up'))) {
        log('ikov: no ladder out of the trap pit');
        return false;
    }
    const out = await Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && !inTrapPit(t);
    }, 10_000);
    if (out) {
        await settleScene();
    }
    return out;
}

// Why: the crossing is a zone timer rather than a loc, so there is no op to send — stepping onto the bridge is the action, and the far side is the only oracle.
async function crossBridge(goWest: boolean, log: (m: string) => void): Promise<boolean> {
    const start = goWest ? IKOV_TILE.BRIDGE_EAST : IKOV_TILE.BRIDGE_WEST;
    const step = goWest ? IKOV_TILE.BRIDGE_ZONE_EAST : IKOV_TILE.BRIDGE_ZONE_WEST;
    const landed = (): boolean => {
        const t = Game.tile();
        return t !== null && westOfBridge(t) === goWest;
    };
    if (landed()) {
        return true;
    }
    if (!wearingBoots()) {
        log('ikov: refusing the lava bridge without the boots of lightness');
        return false;
    }
    // Why: the server tests `weight >= 0` in grams and the client is sent truncated kilograms, so anything that reads 0 could still be a hundred grams over.
    if (Game.weight() >= 0) {
        log(`ikov: the pack reads ${Game.weight()}kg — the bridge gives way at anything but negative weight`);
        return false;
    }
    if (!(await templeWalk(start, 1, log))) {
        return false;
    }
    log(`ikov: stepping onto the lava bridge, heading ${goWest ? 'west' : 'east'}`);
    await DirectNavigator.walkTo(step, 0, 8000);
    const crossed = await Execution.delayUntil(landed, 12_000);
    if (!crossed) {
        log('ikov: the bridge did not carry us across — retrying');
        return false;
    }
    await settleScene();
    return true;
}

/**
 * Climb, cross or clamber out of whichever sealed part of the temple the bot woke up in.
 * @see docs/decisions/quest-pitfalls-24.md
 */
export async function escapePocket(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!here) {
        return false;
    }
    if (inDarkRoom(here)) {
        log('ikov: climbing out of the boots room');
        return climbDarkStairsUp(log);
    }
    if (inTrapPit(here)) {
        log('ikov: climbing out of the trap pit');
        return climbTrapLadder(log);
    }
    if (westOfBridge(here)) {
        log('ikov: crossing back over the lava');
        return crossBridge(false, log);
    }
    return true;
}

async function slashWeb(log: (m: string) => void): Promise<boolean> {
    if (locById(IKOV_LOC.WEB, 6) === null) {
        return true;
    }
    const knife = Inventory.items().find(i => i.id === IKOV_OBJ.KNIFE);
    if (!knife) {
        log('ikov: the web needs a knife and the pack has none');
        return false;
    }
    // Why: `slash_checker` only reads the equipped weapon, so `Slash` refuses a packed knife; the `oplocu` branch names the knife explicitly.
    for (let attempt = 0; attempt < 8; attempt++) {
        const web = locById(IKOV_LOC.WEB, 6);
        if (!web) {
            return true;
        }
        const held = Inventory.items().find(i => i.id === IKOV_OBJ.KNIFE);
        if (!held || !(await held.useOn(web))) {
            return false;
        }
        if (await Execution.delayUntil(() => locById(IKOV_LOC.WEB, 6) === null, 5000)) {
            log(`ikov: slashed the web after ${attempt + 1} cut(s)`);
            return true;
        }
    }
    log('ikov: eight cuts and the web still holds');
    return false;
}

async function takeBoots(log: (m: string) => void): Promise<boolean> {
    if (heldId(IKOV_OBJ.BOOTS) > 0) {
        return true;
    }
    if (!(await templeWalk(IKOV_TILE.BOOTS_WEB, 0, log))) {
        return false;
    }
    if (!(await slashWeb(log))) {
        return false;
    }
    await DirectNavigator.walkTo(IKOV_TILE.BOOTS_SPAWN, 1, 8000);
    const boots = GroundItems.query().where(g => g.id === IKOV_OBJ.BOOTS).within(6).nearest();
    if (!boots) {
        log(`ikov: no boots of lightness at (${IKOV_TILE.BOOTS_SPAWN.x},${IKOV_TILE.BOOTS_SPAWN.z})`);
        return false;
    }
    if (!(await boots.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(IKOV_OBJ.BOOTS) > 0, 8000);
}

/** Fetch and wear the boots; everything past the lava bridge depends on the negative weight. */
async function fetchBoots(log: (m: string) => void): Promise<boolean> {
    if (wearingBoots()) {
        return true;
    }
    if (heldId(IKOV_OBJ.BOOTS) > 0) {
        return Equipment.equip(IKOV_NAME.BOOTS);
    }
    const here = Game.tile();
    if (here && inDarkRoom(here)) {
        if (!(await takeBoots(log))) {
            return false;
        }
        if (!(await Equipment.equip(IKOV_NAME.BOOTS))) {
            log('ikov: took the boots but could not wear them');
        }
        return climbDarkStairsUp(log);
    }
    if (!(await escapePocket(log))) {
        return false;
    }
    if (!(await lightCandle(log))) {
        return false;
    }
    if (!(await templeWalk(IKOV_TILE.DARK_STAIRS_DOWN, 1, log))) {
        return false;
    }
    const stairs = locById(IKOV_LOC.DARK_STAIRS_DOWN, 6);
    if (!stairs || !(await stairs.interact('Climb-down'))) {
        log('ikov: no dark stairs down at the temple corridor');
        return false;
    }
    const arrived = await Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && inDarkRoom(t);
    }, 10_000);
    if (!arrived) {
        // Why: without a lit source the stairs drop you into a walled dead end and raise a box, which reads as "did not arrive".
        await clearBox();
        log('ikov: the dark stairs left us short — the candle was not lit');
        return false;
    }
    await settleScene();
    return true;
}

/** Disarm and pull the trap lever. Both ops are no-ops once their stage has passed. */
export async function pullTrapLever(log: (m: string) => void): Promise<boolean> {
    if (!(await escapePocket(log))) {
        return false;
    }
    if (!(await wearFearPendant(log))) {
        return false;
    }
    if (!(await templeWalk(IKOV_TILE.TRAP_LEVER, 1, log))) {
        return false;
    }
    const lever = locById(IKOV_LOC.TRAP_LEVER, 6);
    if (!lever) {
        log(`ikov: no trap lever at (${IKOV_TILE.TRAP_LEVER.x},${IKOV_TILE.TRAP_LEVER.z})`);
        return false;
    }
    log('ikov: searching the trap lever for traps');
    if (!(await lever.interact('Search for traps'))) {
        return false;
    }
    await Execution.delayTicks(3);
    await clearBox();
    const again = locById(IKOV_LOC.TRAP_LEVER, 6);
    if (!again || !(await again.interact('Pull'))) {
        return false;
    }
    await Execution.delayTicks(4);
    await clearBox();
    // Why: an undisarmed pull drops the player down a shaft, and the ladder out is the only way back.
    const here = Game.tile();
    if (here && inTrapPit(here)) {
        log('ikov: the trap fired — climbing back out');
        return climbTrapLadder(log);
    }
    return true;
}

async function takeIkovLever(log: (m: string) => void): Promise<boolean> {
    if (!(await templeWalk(IKOV_TILE.IKOV_LEVER_SPAWN, 1, log))) {
        return false;
    }
    const lever = GroundItems.query().where(g => g.id === IKOV_OBJ.LEVER).within(8).nearest();
    if (!lever) {
        log(`ikov: no Lever at (${IKOV_TILE.IKOV_LEVER_SPAWN.x},${IKOV_TILE.IKOV_LEVER_SPAWN.z})`);
        return false;
    }
    if (!(await lever.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(IKOV_OBJ.LEVER) > 0, 8000);
}

/** Cross the lava, take the Lever, cross back. */
async function fetchIkovLever(log: (m: string) => void): Promise<boolean> {
    if (heldId(IKOV_OBJ.LEVER) > 0) {
        const held = Game.tile();
        return held !== null && westOfBridge(held) ? crossBridge(false, log) : true;
    }
    const here = Game.tile();
    if (!here) {
        return false;
    }
    if (!westOfBridge(here)) {
        if (!(await escapePocket(log))) {
            return false;
        }
        if (!(await wearFearPendant(log))) {
            return false;
        }
        if (!(await crossBridge(true, log))) {
            return false;
        }
    }
    if (!(await takeIkovLever(log))) {
        return false;
    }
    return crossBridge(false, log);
}

/** Fit the Lever into its bracket and pull it; the south gate opens off the bit it sets. */
async function mendAndPullLever(log: (m: string) => void): Promise<boolean> {
    if (!(await escapePocket(log))) {
        return false;
    }
    if (!(await templeWalk(IKOV_TILE.LEVER_BRACKET, 1, log))) {
        return false;
    }
    await settleScene();
    if (heldId(IKOV_OBJ.LEVER) > 0) {
        const bracket = locById(IKOV_LOC.LEVER_BRACKET, 6);
        const lever = Inventory.items().find(i => i.id === IKOV_OBJ.LEVER);
        if (!bracket || !lever) {
            log('ikov: no lever bracket in reach');
            return false;
        }
        log('ikov: fitting the lever into the bracket');
        if (!(await lever.useOn(bracket))) {
            return false;
        }
        // Why: the fit runs `~mesbox` before its `inv_del`, so the lever is still in the pack until the box is answered.
        if (!(await driveUntil(() => heldId(IKOV_OBJ.LEVER) === 0, [], log, 15_000))) {
            log('ikov: the bracket never took the lever');
            return false;
        }
        await settleScene();
    }
    const mended = locById(IKOV_LOC.MENDED_LEVER, 6);
    if (!mended) {
        log('ikov: the bracket carries no lever to pull');
        return false;
    }
    log('ikov: pulling the mended lever');
    if (!(await mended.interact('Pull'))) {
        return false;
    }
    await Execution.delayTicks(6);
    await clearBox();
    return true;
}

async function searchChest(chest: { loc: Tile; stand: Tile }, log: (m: string) => void): Promise<boolean> {
    if (!(await templeWalk(chest.stand, 0, log))) {
        return false;
    }
    await settleScene();
    const openLoc = (): Loc | null => Locs.query().where(l => l.id === IKOV_LOC.CHEST_OPEN).within(4).nearest();
    const shut = Locs.query().where(l => l.id === IKOV_LOC.CHEST_SHUT).within(4).nearest();
    if (shut) {
        if (!(await shut.interact('Open'))) {
            return false;
        }
        // Why: a loc that transforms keeps its old id for a tick, so the open chest has to be polled rather than read once.
        await Execution.delayUntil(() => openLoc() !== null, 5000);
    }
    const open = openLoc();
    if (!open) {
        log(`ikov: the chest at (${chest.loc.x},${chest.loc.z}) never opened`);
        return false;
    }
    const before = Inventory.count(IKOV_NAME.ICE_ARROWS);
    const mark = GameMessages.mark();
    if (!(await open.interact('Search'))) {
        return false;
    }
    // Why: a find raises an `~objbox`, which is a chat modal that has to be answered before anything else lands.
    // Why: five of the six chests are empty and answer with one `mes` line and no modal, so without it as an oracle every circuit pays the full timeout five times over.
    await driveUntil(
        () => Inventory.count(IKOV_NAME.ICE_ARROWS) > before || GameMessages.sawSince(mark, CHEST_EMPTY),
        [],
        log,
        6000
    );
    const found = Inventory.count(IKOV_NAME.ICE_ARROWS) > before;
    await clearBox();
    if (found) {
        log(`ikov: ${Inventory.count(IKOV_NAME.ICE_ARROWS)} ice arrows`);
    }
    return found;
}

// Why: one chest holds the arrows and it is re-rolled after every find, so the search is a circuit rather than a chest — and returning on the first find would restart the circuit from the west every time.
// Why: `~randomize_ice_arrow_chest` is a bare `random(6)` over all six coords, so the re-roll can land back on the chest that last paid out — and re-opening the one already underfoot costs a click where walking to the next costs the same odds plus ten tiles.
async function searchIceChests(log: (m: string) => void): Promise<boolean> {
    const before = Inventory.count(IKOV_NAME.ICE_ARROWS);
    const enough = (): boolean => Inventory.count(IKOV_NAME.ICE_ARROWS) >= ARROWS_WANTED;
    for (let round = 0; round < CHEST_ROUNDS; round++) {
        for (const chest of ICE_CHESTS) {
            await Sustain.run();
            if (enough()) {
                return true;
            }
            while ((await searchChest(chest, log)) && !enough()) {
                await Sustain.run();
            }
        }
    }
    return Inventory.count(IKOV_NAME.ICE_ARROWS) > before;
}

// Why: `%ikov_dungeon` is untransmitted, so whether the south gate opens is the only client-visible answer to "has the lever been pulled".
async function enterIceCavern(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && pastSouthGate(here)) {
        return gateIsOpen();
    }
    if (!(await templeWalk(IKOV_TILE.SOUTH_GATE_NORTH, 0, log))) {
        return false;
    }
    await DirectNavigator.walkTo(IKOV_TILE.SOUTH_GATE_SOUTH, 0, 8000);
    if (crossedIntoCavern()) {
        await settleScene();
        return gateIsOpen();
    }
    const gate = locById(IKOV_LOC.SOUTH_GATE_LEFT, 4) ?? locById(IKOV_LOC.SOUTH_GATE_RIGHT, 4);
    if (gate && (await gate.interact('Open'))) {
        await Execution.delayTicks(2);
        // Why: the refusal is a `~mesbox`, and a box left up swallows every op the next leg sends.
        await clearBox();
        await DirectNavigator.walkTo(IKOV_TILE.SOUTH_GATE_SOUTH, 0, 8000);
    }
    if (!crossedIntoCavern()) {
        await clearBox();
        return false;
    }
    await settleScene();
    return gateIsOpen();
}

function gateIsOpen(): boolean {
    southGateSeenOpen = true;
    return true;
}

function crossedIntoCavern(): boolean {
    const t = Game.tile();
    return t !== null && pastSouthGate(t);
}

// Why: a stack of two to five arrows carries its own object id, and all five share one display name — so arrows are counted by name, never by id.
export function arrowsSecured(snap: QuestSnapshot): boolean {
    const key = IKOV_NAME.ICE_ARROWS.toLowerCase();
    if (snap.worn.has(key)) {
        return true;
    }
    return (snap.inv.get(key) ?? 0) + (snap.bank?.get(key) ?? 0) >= ARROWS_WANTED;
}

/** The boots errand on its own; it takes a leg of the descent per call and holds nothing until the last. */
export function bootsStep(snap: QuestSnapshot): QuestStep | null {
    if (wearingBoots() || heldOrBanked(snap, IKOV_OBJ.BOOTS) > 0) {
        return null;
    }
    return { kind: 'custom', name: 'fetch the boots of lightness', run: fetchBoots };
}

/**
 * Cross the lava for the Lever and pull it, which is what the south gate reads.
 * @see docs/decisions/quest-pitfalls-25.md
 */
export async function unlockSouthGate(log: (m: string) => void): Promise<boolean> {
    if (!(await escapePocket(log))) {
        return false;
    }
    // Why: the boots are the crossing's weight budget, and their own leg runs to completion before this one starts.
    if (!wearingBoots()) {
        await fetchBoots(log);
    }
    // Why: `fetchBoots` answers true for a leg of progress rather than for the boots, and one of those legs ends standing in the dark room — which the ice-cavern half-plane covers, so a gate check sent from there reads unlocked without a walk.
    if (!wearingBoots()) {
        log('ikov: the boots are not on yet — the gate check waits for them');
        return false;
    }
    if (await enterIceCavern(log)) {
        return true;
    }
    log('ikov: the south gate is still locked — fetching the lever across the lava');
    if (!(await fetchIkovLever(log))) {
        return false;
    }
    if (!(await mendAndPullLever(log))) {
        return false;
    }
    if (await enterIceCavern(log)) {
        return true;
    }
    log('ikov: the south gate refused even after the lever was pulled');
    return false;
}

// Why: the lava is behind the bot by the time this runs, so this is the first leg of the quest that can carry weight — and the ice spiders on the circuit are what the armour is for.

/** The chest circuit, which crosses nothing and so runs in whatever armour the bank dressed. */
export async function stockIceArrows(log: (m: string) => void): Promise<boolean> {
    if (!(await escapePocket(log))) {
        return false;
    }
    if (!(await enterIceCavern(log))) {
        log('ikov: the south gate is shut again — the lever has to be pulled before the chests');
        southGateSeenOpen = false;
        return false;
    }
    return searchIceChests(log);
}
