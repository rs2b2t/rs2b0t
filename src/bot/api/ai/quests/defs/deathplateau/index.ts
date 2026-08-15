import { MiniMenuAction } from '#/client/shell/MiniMenuAction.js';
import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import Tile from '../../../../../geometry/Tile.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestProgress, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { hasFlag } from '../../engine/types.js';
import { driveDialog, openDialogue, talkThrough, type NpcStop } from '../../exec/primitives.js';
import { settleScene } from '../../exec/prompts.js';
import {
    ALL_BALL_IDS,
    ALE_PRICE,
    BALL_PICKUP,
    COIN_FLOAT,
    DEATH_DICE_CONTINUE_COM,
    DEATH_DICE_MAIN,
    DEATH_DICE_ROLL_COM,
    DEATH_ITEM,
    DENULTH_FINISH,
    DENULTH_START,
    DUNSTAN_SPIKES,
    EOHRIC_GUARD,
    EOHRIC_HAROLD_REFUSED,
    FALADOR_WEST_BANK,
    GAMBLE_BET,
    HAROLD_DUTY,
    PEDESTALS,
    SABA_PATH,
    TENZING_HELP,
    TENZING_SUPPLIES,
    TILE,
    TOSTIG_SHOP
} from './areas.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import {
    DP_FLAG,
    DP_STAGE,
    readDeathPlateauProgress
} from './journal.js';

export {
    DEATH_PLATEAU_QUEST,
    DP_FLAG,
    DP_STAGE,
    parseDeathPlateauJournal,
    readDeathPlateauProgress,
    normalizeJournal
} from './journal.js';
export {
    ALL_BALL_IDS,
    DEATH_ITEM,
    FALADOR_WEST_BANK,
    PEDESTALS,
    TILE
} from './areas.js';

// ─── snapshot helpers ────────────────────────────────────────────────────────

const heldName = (snap: QuestSnapshot, name: string): number =>
    snap.inv.get(name.toLowerCase()) ?? 0;
const heldId = (snap: QuestSnapshot, id: number): number =>
    snap.invIds?.get(id) ?? 0;
const bankedName = (snap: QuestSnapshot, name: string): number =>
    snap.bank?.get(name.toLowerCase()) ?? 0;
const bankedId = (snap: QuestSnapshot, id: number): number =>
    snap.bankIds?.get(id) ?? 0;

function liveId(id: number): number {
    return Inventory.items().filter(i => i.id === id).reduce((n, i) => n + i.count, 0);
}

function anyBallHeld(snap: QuestSnapshot): number {
    return ALL_BALL_IDS.reduce((n, id) => n + heldId(snap, id), 0);
}


function inSabaCave(tile: QuestSnapshot['tile']): boolean {
    return tile !== null
        && tile !== undefined
        && tile.x >= 2255
        && tile.x <= 2285
        && tile.z >= 4740
        && tile.z <= 4775;
}

/** Inventory-aware equip-room floor (can outrank a stale journal mid-step). */
export function equipFloor(snap: QuestSnapshot, progress: QuestProgress | undefined): number {
    let stage = progress?.stage ?? DP_STAGE.NOT_STARTED;
    if (heldId(snap, DEATH_ITEM.COMBINATION.id) > 0 && stage < DP_STAGE.FOUND_COMBO) {
        stage = DP_STAGE.FOUND_COMBO;
    }
    if (heldId(snap, DEATH_ITEM.IOU.id) > 0 && stage < DP_STAGE.GIVEN_IOU) {
        stage = DP_STAGE.GIVEN_IOU;
    }
    if (anyBallHeld(snap) > 0 && stage < DP_STAGE.FOUND_COMBO) {
        stage = DP_STAGE.FOUND_COMBO;
    }
    return stage;
}

function mapFlag(progress: QuestProgress | undefined, name: string): boolean {
    return hasFlag(progress, name);
}

/** Inventory can prove map milestones the journal has not yet rewritten. */
export function effectiveMap(snap: QuestSnapshot, progress: QuestProgress | undefined): {
    saba: boolean;
    tenzing: boolean;
    smithy: boolean;
    entrancecert: boolean;
    given_cert: boolean;
    supplies: boolean;
    got_map: boolean;
    scouted: boolean;
} {
    const f = (name: string) => mapFlag(progress, name);
    const climbing = heldId(snap, DEATH_ITEM.CLIMBING_BOOTS.id) > 0;
    const spiked = heldId(snap, DEATH_ITEM.SPIKED_BOOTS.id) > 0;
    const cert = heldId(snap, DEATH_ITEM.ENTRANCE_CERT.id) > 0;
    const secretMap = heldId(snap, DEATH_ITEM.SECRET_MAP.id) > 0;

    const scouted = f(DP_FLAG.SCOUTED);
    const got_map = scouted || f(DP_FLAG.GOT_MAP) || secretMap;
    const supplies = got_map || f(DP_FLAG.SUPPLIES);
    const given_cert = supplies || f(DP_FLAG.GIVEN_CERT) || spiked;
    const entrancecert = given_cert || f(DP_FLAG.ENTRANCE_CERT) || cert;
    const smithy = entrancecert || f(DP_FLAG.SMITHY);
    const tenzing = smithy || f(DP_FLAG.TENZING) || climbing || spiked;
    const saba = tenzing || f(DP_FLAG.SABA);

    return { saba, tenzing, smithy, entrancecert, given_cert, supplies, got_map, scouted };
}

// ─── banking / loadout ───────────────────────────────────────────────────────

const KEEP = [
    'coins',
    DEATH_ITEM.ASGARNIAN_ALE.name.toLowerCase(),
    DEATH_ITEM.IOU.name.toLowerCase(),
    DEATH_ITEM.COMBINATION.name.toLowerCase(),
    DEATH_ITEM.SECRET_MAP.name.toLowerCase(),
    DEATH_ITEM.CLIMBING_BOOTS.name.toLowerCase(),
    DEATH_ITEM.SPIKED_BOOTS.name.toLowerCase(),
    DEATH_ITEM.ENTRANCE_CERT.name.toLowerCase(),
    DEATH_ITEM.BREAD.name.toLowerCase(),
    DEATH_ITEM.TROUT.name.toLowerCase(),
    DEATH_ITEM.IRON_BAR.name.toLowerCase(),
    'stone ball'
];

function scanBank(): QuestStep {
    return { kind: 'scanBank', bank: FALADOR_WEST_BANK };
}

function withdraw(items: { name: string; qty: number; id?: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: FALADOR_WEST_BANK };
}

function depositKeep(keep: string[] = KEEP): QuestStep {
    return { kind: 'deposit', keep, bank: FALADOR_WEST_BANK, exactKeep: true };
}

function makeSpace(snap: QuestSnapshot, slots: number): QuestStep | null {
    if (snap.freeSlots !== undefined && snap.freeSlots >= slots) {
        return null;
    }
    const junk = [...snap.inv.keys()].some(n => !KEEP.includes(n));
    if (junk) {
        return depositKeep();
    }
    return { kind: 'deposit', keep: ['coins'], bank: FALADOR_WEST_BANK, exactKeep: true };
}

function sourceCoins(snap: QuestSnapshot, need: number): QuestStep | null {
    if (heldName(snap, 'Coins') >= need) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const inBank = bankedName(snap, 'Coins');
    if (inBank <= 0) {
        return { kind: 'wait', reason: 'need coins for Death Plateau' };
    }
    return makeSpace(snap, heldName(snap, 'Coins') === 0 ? 1 : 0)
        ?? withdraw([{ name: 'Coins', qty: Math.min(COIN_FLOAT, inBank) }]);
}

function sourceNamed(
    snap: QuestSnapshot,
    name: string,
    id: number,
    qty: number
): QuestStep | null {
    const have = Math.max(heldName(snap, name), heldId(snap, id));
    if (have >= qty) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const short = qty - have;
    const inBank = Math.max(bankedName(snap, name), bankedId(snap, id));
    if (inBank <= 0) {
        return { kind: 'wait', reason: `need ${qty}× ${name} in bank for Death Plateau` };
    }
    return makeSpace(snap, short) ?? withdraw([{ name, qty: Math.min(short, inBank), id }]);
}

function normalizePack(snap: QuestSnapshot): QuestStep | null {
    return [...snap.inv.keys()].some(n => !KEEP.includes(n)) ? depositKeep() : null;
}

// ─── custom runners ──────────────────────────────────────────────────────────

// Why: Burthorpe floor plan — Eohric is castle L1 via "Stairs" at about (2897,3566), Harold is Toad & Chicken L1 via "Staircase" at about (2914,3539), and Tostig, Denulth and Dunstan are on the ground.
// Why: castle L1 and inn L1 are unconnected, so any L1-to-L1 hop between them has to Climb-down, walk the ground, then Climb-up the other building.
// Why: walkResilient can plan that multi-hop only while the stair loc names match the scene.

/** Inn is south of z≈3552; castle courtyard/stairs are north. */
function inInnBand(tile: { z: number }): boolean {
    return tile.z < 3552;
}

function stairsBottomFor(dest: { z: number }): Tile {
    return inInnBand(dest) ? TILE.INN_STAIRS_BOTTOM : TILE.CASTLE_STAIRS_BOTTOM;
}

function stairsTopFor(dest: { z: number }): Tile {
    return inInnBand(dest) ? TILE.INN_STAIRS_TOP : TILE.CASTLE_STAIRS_TOP;
}

async function climbOneFlight(
    op: 'Climb-up' | 'Climb-down',
    stand: Tile,
    targetLevel: number,
    log: (m: string) => void
): Promise<boolean> {
    const here = Game.tile();
    if (!here) {
        return false;
    }
    if (here.level === targetLevel) {
        return true;
    }
    // Approach stand on the current level.
    if (stand.distanceTo(here) > 2 || here.level !== stand.level) {
        const approach = new Tile(stand.x, stand.z, here.level);
        if (!(await Traversal.walkResilient(approach, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            log(`could not approach stairs stand (${stand.x},${stand.z},L${here.level})`);
        }
    }
    // Castle = "Stairs"; inn = "Staircase". Never grab wall Ladders.
    const stair = Locs.query().name('Stairs', 'Staircase').action(op).within(8).nearest()
        ?? Locs.query()
            .action(op)
            .where(l => /^stairs?$/i.test(l.name ?? ''))
            .within(8)
            .nearest();
    if (!stair) {
        log(`no Stairs/Staircase to ${op} near (${Game.tile()?.x},${Game.tile()?.z},L${Game.tile()?.level})`);
        return false;
    }
    log(`${op} ${stair.name ?? 'stairs'} at ${stair.tile()}`);
    if (!(await stair.interact(op))) {
        return false;
    }
    return Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && t.level === targetLevel;
    }, 8000);
}

/** Drop to ground in the building we currently occupy. */
async function descendToGround(log: (m: string) => void): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const here = Game.tile();
        if (!here || here.level === 0) {
            return true;
        }
        const stand = stairsTopFor(here);
        if (await climbOneFlight('Climb-down', stand, 0, log)) {
            return true;
        }
    }
    return (Game.tile()?.level ?? -1) === 0;
}

/** Climb from ground into the building that contains `dest` (level ≥ 1). */
async function ascendToDestFloor(dest: Tile, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!here) {
        return false;
    }
    if (here.level === dest.level) {
        return true;
    }
    if (here.level > 0) {
        // Wrong building upstairs — go down first.
        if (!(await descendToGround(log))) {
            return false;
        }
    }
    const bottom = stairsBottomFor(dest);
    if (!(await Traversal.walkResilient(bottom, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        log(`could not reach stairs bottom (${bottom.x},${bottom.z})`);
        return false;
    }
    return climbOneFlight('Climb-up', bottom, dest.level, log);
}

async function walkTo(dest: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here0 = Game.tile();
    if (here0 && here0.level === dest.level && dest.distanceTo(here0) <= radius) {
        return true;
    }

    // Elevated long hops or castle L1 ↔ inn L1: force ground transfer.
    const here1 = Game.tile();
    if (here1 && here1.level > 0) {
        const crossBuildings = dest.level > 0 && inInnBand(here1) !== inInnBand(dest);
        const longOrGround = dest.level === 0 || dest.distanceTo(here1) > 10 || crossBuildings;
        if (longOrGround && !(await descendToGround(log))) {
            return false;
        }
    }

    // Need upper floor of dest building.
    const here2 = Game.tile();
    if (here2 && dest.level > 0 && here2.level !== dest.level) {
        if (!(await ascendToDestFloor(dest, log))) {
            return false;
        }
    }

    const now = Game.tile();
    if (now && now.level === dest.level && dest.distanceTo(now) <= radius) {
        return true;
    }
    // Same-level finish (or walkResilient multi-hop if still elevated).
    return Traversal.walkResilient(dest, { radius, attempts: 4, timeoutMs: 180_000, log });
}

async function talkAt(stop: NpcStop, log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(stop.anchor, 2, log))) {
        return false;
    }
    const here = Game.tile();
    if (here && here.level !== stop.anchor.level) {
        if (!(await ascendToDestFloor(stop.anchor, log))) {
            return false;
        }
        if (!(await walkTo(stop.anchor, 2, log))) {
            return false;
        }
    }
    return talkThrough(stop.npc, stop.prefer, log);
}

async function leaveSabaCave(log: (m: string) => void): Promise<boolean> {
    if (!inSabaCave(Game.tile())) {
        return true;
    }
    if (!(await walkTo(TILE.SABA_EXIT, 3, log))) {
        return false;
    }
    const exit = Locs.query().name('Cave Exit').action('Exit').within(8).nearest()
        ?? Locs.query().name('Cave Exit').within(8).nearest();
    if (!exit) {
        log('no Cave Exit in Saba cave');
        return false;
    }
    const op = exit.actions().find(a => /exit|climb|enter/i.test(a)) ?? exit.actions()[0];
    if (!op || !(await exit.interact(op))) {
        return false;
    }
    return Execution.delayUntil(() => !inSabaCave(Game.tile()), 8000);
}

async function enterSabaCave(log: (m: string) => void): Promise<boolean> {
    if (inSabaCave(Game.tile())) {
        return true;
    }
    if (!(await walkTo(TILE.SABA_ENTRANCE, 2, log))) {
        return false;
    }
    await settleScene();
    const entrance = Locs.query().name('Cave Entrance').within(8).nearest();
    if (!entrance) {
        log('no Cave Entrance near Saba');
        return false;
    }
    const op = entrance.actions().find(a => /enter|climb|search/i.test(a)) ?? entrance.actions()[0];
    if (!op || !(await entrance.interact(op))) {
        return false;
    }
    return Execution.delayUntil(() => inSabaCave(Game.tile()), 8000);
}

/**
 * Inside Harold's bedroom (south of the door at z=3543). Harold is visible
 * through the wall from the hallway — never treat mere NPC visibility as entry.
 */
function insideHaroldRoom(tile: { x: number; z: number; level: number } | null | undefined): boolean {
    return tile !== null
        && tile !== undefined
        && tile.level === 1
        && tile.z <= 3542
        && tile.x >= 2902
        && tile.x <= 2910;
}

/** Drain knock mesbox / "Come in!" / multi-page chat until quiet. */
async function drainChat(log: (m: string) => void, maxSteps = 24): Promise<void> {
    for (let i = 0; i < maxSteps; i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (ChatDialog.isOpen()) {
            if (ChatDialog.options().length > 0) {
                await driveDialog([], log);
            } else if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
            }
            await Execution.delayTicks(1);
            continue;
        }
        if (!(await Execution.delayUntil(
            () => ChatDialog.isOpen() || ChatDialog.canContinue(),
            600
        ))) {
            return;
        }
    }
}

// Why: `death_harold_door` runs entering as mesbox "You knock on the door.", then Harold's "Come in!", then the door opens; leaving is a free open.
// Why: the step has to stand outside and drive the knock dialogue.
// Why: Harold being in Locs/Npcs query range is not arrival, as he is visible through the door.

/** Enter Harold's bedroom. */
async function openHaroldDoor(log: (m: string) => void): Promise<boolean> {
    if (insideHaroldRoom(Game.tile())) {
        return true;
    }

    // Hallway outside (reachable). Never path to Harold's tile first.
    if (!(await walkTo(TILE.HAROLD_DOOR, 2, log))) {
        const t = Game.tile();
        if (!t || Tile.from(t).distanceTo(TILE.HAROLD_DOOR_LOC) > 4) {
            return false;
        }
    }

    // Finish dialogue if a prior Open already started the knock chain.
    await drainChat(log);
    if (insideHaroldRoom(Game.tile())) {
        return true;
    }

    for (let attempt = 0; attempt < 4; attempt++) {
        if (insideHaroldRoom(Game.tile())) {
            return true;
        }

        const door = Locs.query()
            .name('Door')
            .action('Open')
            .where(l => l.tile().distanceTo(TILE.HAROLD_DOOR_LOC) <= 2)
            .within(10)
            .nearest();

        if (!door) {
            // Already open (Close leaf) — step south into the room.
            log('Harold door open/missing — stepping into the room');
            await Traversal.walkResilient(TILE.HAROLD, { radius: 2, attempts: 2, timeoutMs: 30_000, log });
            await drainChat(log);
            if (insideHaroldRoom(Game.tile())) {
                return true;
            }
            continue;
        }

        log(`knocking on Harold's door at ${door.tile()} (attempt ${attempt + 1})`);
        if (!(await door.interact('Open'))) {
            await Execution.delayTicks(1);
            continue;
        }
        // mesbox "You knock…" then chatnpc "Come in!" then server opens the door.
        await drainChat(log);
        await Execution.delayTicks(2);

        // After "Come in!" the door opens — walk into the bedroom.
        if (!insideHaroldRoom(Game.tile())) {
            await Traversal.walkResilient(TILE.HAROLD, { radius: 2, attempts: 3, timeoutMs: 45_000, log });
            await drainChat(log);
        }
        if (insideHaroldRoom(Game.tile())) {
            log('entered Harold\'s room');
            return true;
        }
    }

    log(`still outside Harold's room at ${Game.tile()}`);
    return insideHaroldRoom(Game.tile());
}

async function openTenzingDoor(log: (m: string) => void): Promise<boolean> {
    if (Npcs.query().name('Tenzing').within(6).nearest()) {
        return true;
    }
    if (!(await walkTo(TILE.TENZING_DOOR, 2, log))) {
        return false;
    }
    const door = Locs.query().name('Door').within(6).nearest();
    if (!door) {
        return true;
    }
    if (!(await door.interact('Open'))) {
        return false;
    }
    // After Saba: knock → "No milk today!" → auto "I'm not the milkman" → open.
    if (await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 3000)) {
        await driveDialog(["I'm not the milkman", 'I need your help'], log);
    }
    await Execution.delayTicks(2);
    return true;
}

async function openTenzingBackDoor(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(TILE.TENZING_BACK, 2, log))) {
        return false;
    }
    const door = Locs.query().name('Door').within(6).nearest();
    if (!door) {
        return true;
    }
    if (!(await door.interact('Open'))) {
        return false;
    }
    await Execution.delayTicks(2);
    return true;
}

async function giveAleToHarold(log: (m: string) => void): Promise<boolean> {
    if (liveId(DEATH_ITEM.ASGARNIAN_ALE.id) <= 0) {
        log('no Asgarnian ale to give Harold');
        return false;
    }
    if (!(await openHaroldDoor(log))) {
        return false;
    }
    if (!(await walkTo(TILE.HAROLD, 2, log))) {
        return false;
    }
    // Talk "Can I buy you a drink?" consumes the ale when held.
    if (!(await openDialogue('Harold', log))) {
        // Fallback: use ale on him.
        const ale = Inventory.items().find(i => i.id === DEATH_ITEM.ASGARNIAN_ALE.id);
        const harold = Npcs.query().name('Harold').within(6).nearest();
        if (!ale || !harold || !(await ale.useOn(harold))) {
            return false;
        }
        await Execution.delayTicks(4);
        if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
            await driveDialog(['Would you like to gamble?'], log);
        }
        return liveId(DEATH_ITEM.ASGARNIAN_ALE.id) === 0;
    }
    return driveDialog(['Can I buy you a drink?', 'Would you like to gamble?'], log);
}

// Why: Harold starts with 100gp, and a 100gp win bankrupts him and grants the IOU.
// Why: losses need more rounds, so the caller keeps calling until the IOU or the combination lands.

/** One full dice round: pick gamble, enter bet, wait for Harold's roll, roll, settle. */
async function gambleHaroldRound(log: (m: string) => void): Promise<boolean> {
    if (!(await openDialogue('Harold', log))) {
        return false;
    }

    // Drive chat to the amount dialog (p_countdialog after "Would you like to gamble?").
    for (let i = 0; i < 40; i++) {
        if (reader.countDialogOpen() || reader.modals().main === DEATH_DICE_MAIN) {
            break;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            const gamble = opts.find(o => /gamble/i.test(o));
            if (!gamble) {
                // Avoid "buy a drink" / combo chatter mid-gamble loop.
                const other = opts.find(o => !/drink|combination/i.test(o)) ?? opts[opts.length - 1];
                await ChatDialog.chooseOption(other);
            } else {
                await ChatDialog.chooseOption(gamble);
            }
            await Execution.delayTicks(2);
            continue;
        }
        // Never re-open talk while a count dialog might be about to appear.
        await Execution.delayTicks(1);
    }

    if (reader.modals().main !== DEATH_DICE_MAIN) {
        // Why: the bet amount arrives as p_countdialog after "How much do you want to offer?".
        // Why: chat keeps draining alongside it, as pages close briefly between lines and the count dialog can flash open for only a tick at 2x speed.
        let betSent = false;
        const betDeadline = performance.now() + 12_000;
        while (performance.now() < betDeadline && reader.modals().main !== DEATH_DICE_MAIN) {
            if (reader.countDialogOpen()) {
                if (!actions.answerCountDialog(GAMBLE_BET)) {
                    log('Harold gamble: failed to enter bet');
                    return false;
                }
                betSent = true;
                log(`Harold gamble: bet ${GAMBLE_BET}`);
                await Execution.delayUntil(() => !reader.countDialogOpen(), 3000);
                continue;
            }
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
                await Execution.delayTicks(1);
                continue;
            }
            if (ChatDialog.isOpen() && ChatDialog.options().length > 0) {
                const gamble = ChatDialog.options().find(o => /gamble/i.test(o));
                if (gamble) {
                    await ChatDialog.chooseOption(gamble);
                    await Execution.delayTicks(2);
                    continue;
                }
            }
            await Execution.delayTicks(1);
        }

        // After bet: "OK I'll roll first!" then stake warning, THEN if_openmain(death_dice).
        // Do not abort when chat is briefly closed between those pages.
        const diceDeadline = performance.now() + 15_000;
        while (performance.now() < diceDeadline && reader.modals().main !== DEATH_DICE_MAIN) {
            if (reader.countDialogOpen() && !betSent) {
                if (actions.answerCountDialog(GAMBLE_BET)) {
                    betSent = true;
                    log(`Harold gamble: bet ${GAMBLE_BET} (late)`);
                }
                await Execution.delayUntil(() => !reader.countDialogOpen(), 3000);
                continue;
            }
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
                await Execution.delayTicks(1);
                continue;
            }
            await Execution.delayTicks(1);
        }

        if (reader.modals().main !== DEATH_DICE_MAIN) {
            log(`Harold gamble: dice never opened (main=${reader.modals().main} betSent=${betSent})`);
            return false;
        }
    }

    log('Harold gamble: dice open — waiting for player roll button');
    // Harold rolls first (~6t), then death_dice:com_28 ("Roll Dice!") unhides.
    let rolled = false;
    for (let t = 0; t < 30 && !rolled; t++) {
        await Execution.delayTicks(1);
        if (reader.modals().main !== DEATH_DICE_MAIN) {
            log('Harold gamble: dice closed before roll');
            return false;
        }
        const texts = reader.mainModalTexts().join(' ').toLowerCase();
        // Button is hidden until "Your roll..." — only then IF_BUTTON is live.
        if (texts.includes('your roll') || t >= 8) {
            rolled = actions.ifButton(DEATH_DICE_ROLL_COM);
        }
    }
    if (!rolled) {
        log('Harold gamble: could not click Roll Dice!');
        return false;
    }
    log('Harold gamble: rolled — waiting for Continue…');

    // After roll: win/lose text, then com_30 "Continue..." (buttontype=pause → RESUME_PAUSEBUTTON).
    let paused = false;
    for (let i = 0; i < 40 && !paused; i++) {
        await Execution.delayTicks(1);
        if (liveId(DEATH_ITEM.IOU.id) > 0 || liveId(DEATH_ITEM.COMBINATION.id) > 0) {
            break;
        }
        if (reader.modals().main !== DEATH_DICE_MAIN) {
            // Dice already closed — fall through to objbox/chat drain.
            break;
        }
        const texts = reader.mainModalTexts().join(' ').toLowerCase();
        if (texts.includes('win') || texts.includes('lose') || texts.includes('continue') || i >= 6) {
            paused = actions.menuAction(MiniMenuAction.PAUSE_BUTTON, 0, 0, DEATH_DICE_CONTINUE_COM);
            if (!paused) {
                // Fallback: IF_BUTTON on the same com (some clients treat it as OK).
                paused = actions.ifButton(DEATH_DICE_CONTINUE_COM);
            }
        }
    }

    // Objbox ("winnings" / IOU) + any chat after if_close.
    for (let i = 0; i < 40; i++) {
        if (liveId(DEATH_ITEM.IOU.id) > 0 || liveId(DEATH_ITEM.COMBINATION.id) > 0) {
            break;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (ChatDialog.isOpen() && ChatDialog.options().length > 0) {
            await driveDialog([], log);
            continue;
        }
        if (reader.modals().main !== -1 && reader.modals().main !== DEATH_DICE_MAIN) {
            // Generic objbox — pause/continue or close.
            const cont = reader.mainModalButtonNearText('Click here to continue');
            if (cont > 0) {
                if (!actions.menuAction(MiniMenuAction.PAUSE_BUTTON, 0, 0, cont)) {
                    actions.ifButton(cont);
                }
            } else {
                actions.closeModal();
            }
            await Execution.delayTicks(2);
            continue;
        }
        if (reader.modals().main === -1 && !ChatDialog.isOpen()) {
            break;
        }
        await Execution.delayTicks(1);
    }

    if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
        await driveDialog([], log);
    }
    return true;
}

async function gambleHarold(log: (m: string) => void): Promise<boolean> {
    if (liveId(DEATH_ITEM.IOU.id) > 0 || liveId(DEATH_ITEM.COMBINATION.id) > 0) {
        return true;
    }
    if (Inventory.count('Coins') < GAMBLE_BET) {
        log(`need ${GAMBLE_BET} coins to gamble with Harold`);
        return false;
    }
    if (!(await openHaroldDoor(log))) {
        return false;
    }
    if (!(await walkTo(TILE.HAROLD, 2, log))) {
        return false;
    }

    // Harold starts at 100gp; bet 101 so the first win triggers lostall → IOU.
    // Losses inflate his purse — keep rolling (up to 40) until the IOU drops.
    for (let round = 0; round < 40; round++) {
        if (liveId(DEATH_ITEM.IOU.id) > 0 || liveId(DEATH_ITEM.COMBINATION.id) > 0) {
            break;
        }
        if (Inventory.count('Coins') < GAMBLE_BET) {
            log(`out of coins mid-gamble (round ${round + 1})`);
            return false;
        }
        log(`Harold gamble round ${round + 1} (bet ${GAMBLE_BET})`);
        if (!(await gambleHaroldRound(log))) {
            // Soft fail this tick — outer decide will re-enter if still GIVEN_ALE.
            if (liveId(DEATH_ITEM.IOU.id) > 0 || liveId(DEATH_ITEM.COMBINATION.id) > 0) {
                break;
            }
            return false;
        }
        await Execution.delayTicks(2);
    }

    log(`Harold gamble done — iou=${liveId(DEATH_ITEM.IOU.id)} coins=${Inventory.count('Coins')}`);
    return liveId(DEATH_ITEM.IOU.id) > 0 || liveId(DEATH_ITEM.COMBINATION.id) > 0;
}

/**
 * Content auto-runs harold_reclaim_iou when equiproom ≥ given_iou and neither
 * IOU nor combination is held — talk and drain.
 */
async function reclaimIouFromHarold(log: (m: string) => void): Promise<boolean> {
    if (liveId(DEATH_ITEM.IOU.id) > 0 || liveId(DEATH_ITEM.COMBINATION.id) > 0) {
        return true;
    }
    if (!(await openHaroldDoor(log))) {
        return false;
    }
    if (!(await walkTo(TILE.HAROLD, 2, log))) {
        return false;
    }
    if (!(await openDialogue('Harold', log))) {
        return false;
    }
    // Reclaim injects before the multi-menu; drain chat + objbox.
    for (let i = 0; i < 30; i++) {
        if (liveId(DEATH_ITEM.IOU.id) > 0 || liveId(DEATH_ITEM.COMBINATION.id) > 0) {
            break;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (ChatDialog.isOpen() && ChatDialog.options().length > 0) {
            // No need to pick options — reclaim already fired; close out.
            await driveDialog([], log);
            continue;
        }
        if (reader.modals().main !== -1) {
            const cont = reader.mainModalButtonNearText('Click here to continue');
            if (cont > 0) {
                if (!actions.menuAction(MiniMenuAction.PAUSE_BUTTON, 0, 0, cont)) {
                    actions.ifButton(cont);
                }
            } else {
                actions.closeModal();
            }
            await Execution.delayTicks(2);
            continue;
        }
        if (!ChatDialog.isOpen()) {
            break;
        }
        await Execution.delayTicks(1);
    }
    log(`reclaim IOU done — iou=${liveId(DEATH_ITEM.IOU.id)} combo=${liveId(DEATH_ITEM.COMBINATION.id)}`);
    return liveId(DEATH_ITEM.IOU.id) > 0 || liveId(DEATH_ITEM.COMBINATION.id) > 0;
}

async function readIou(log: (m: string) => void): Promise<boolean> {
    if (liveId(DEATH_ITEM.COMBINATION.id) > 0) {
        return true;
    }
    const iou = Inventory.items().find(i => i.id === DEATH_ITEM.IOU.id);
    if (!iou) {
        log('no IOU to read');
        return false;
    }
    // opheld1 death_iou → Read replaces IOU with Combination + chat/objbox.
    const op = iou.actions().find(a => /read/i.test(a)) ?? iou.actions()[0];
    if (!op || !(await iou.interact(op))) {
        log(`could not ${op ?? 'use'} IOU`);
        return false;
    }
    for (let i = 0; i < 30; i++) {
        if (liveId(DEATH_ITEM.COMBINATION.id) > 0 && !ChatDialog.isOpen() && !ChatDialog.canContinue()) {
            // Combination granted; close leftover handwriting scroll if open.
            await Modals.closeIfOpen();
            break;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (ChatDialog.isOpen()) {
            await driveDialog([], log);
            continue;
        }
        if (reader.modals().main !== -1) {
            // objbox "You have found the combination!" or leftover scroll.
            const cont = reader.mainModalButtonNearText('Click here to continue');
            if (cont > 0) {
                if (!actions.menuAction(MiniMenuAction.PAUSE_BUTTON, 0, 0, cont)) {
                    actions.ifButton(cont);
                }
            } else {
                actions.closeModal();
            }
            await Execution.delayTicks(2);
            continue;
        }
        await Execution.delayTicks(1);
    }
    log(`read IOU done — combo=${liveId(DEATH_ITEM.COMBINATION.id)}`);
    return liveId(DEATH_ITEM.COMBINATION.id) > 0;
}

function ballOnTile(at: Tile, ballId?: number): boolean {
    return GroundItems.query()
        .where(item => {
            const t = item.tile();
            if (t.x !== at.x || t.z !== at.z || t.level !== at.level) {
                return false;
            }
            return ballId === undefined ? ALL_BALL_IDS.includes(item.id) : item.id === ballId;
        })
        .within(20)
        .nearest() !== null;
}

function allPedestalsCorrect(): boolean {
    return PEDESTALS.every(p => ballOnTile(p.at, p.ballId));
}

async function takeGroundBall(ballId: number, near: Tile, log: (m: string) => void): Promise<boolean> {
    if (liveId(ballId) > 0) {
        return true;
    }
    if (!(await walkTo(near, 2, log))) {
        return false;
    }
    await settleScene();
    const g = GroundItems.query()
        .where(item => item.id === ballId)
        .within(10)
        .nearest();
    if (!g) {
        log(`stone ball ${ballId} not on the ground near (${near.x},${near.z})`);
        return false;
    }
    if (!(await g.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => liveId(ballId) > 0, 6000);
}

// Why: the content order is blue (2894,3562), yellow (2895,3562), red (2894,3563), purple (2895,3563), green (2895,3564).
// Why: all five are not needed in the pack at once, as they are placed one at a time from the ground or the inventory.

/** Place the five coloured balls on the mechanism. */
async function solveStoneMechanism(log: (m: string) => void): Promise<boolean> {
    if (allPedestalsCorrect()) {
        log('all stone balls already correctly placed');
        return true;
    }

    // Clear wrong balls off pedestals first.
    for (const ped of PEDESTALS) {
        if (ballOnTile(ped.at, ped.ballId) || !ballOnTile(ped.at)) {
            continue;
        }
        if (!(await walkTo(ped.at, 2, log))) {
            return false;
        }
        const wrong = GroundItems.query()
            .where(item => ALL_BALL_IDS.includes(item.id)
                && item.tile().x === ped.at.x
                && item.tile().z === ped.at.z)
            .within(8)
            .nearest();
        if (wrong) {
            log(`removing wrong ball from (${ped.at.x},${ped.at.z})`);
            await wrong.interact('Take');
            await Execution.delayUntil(() => !ballOnTile(ped.at) || liveId(wrong.id) > 0, 5000);
        }
    }

    for (const ped of PEDESTALS) {
        if (ballOnTile(ped.at, ped.ballId)) {
            continue;
        }
        // Source the ball: inv → ground pile → anywhere nearby.
        if (liveId(ped.ballId) <= 0) {
            const pile = BALL_PICKUP.find(b => b.id === ped.ballId);
            if (!(await takeGroundBall(ped.ballId, pile?.at ?? ped.at, log))) {
                // Maybe sitting on another pedestal after a previous wrong place.
                const stray = GroundItems.query().where(item => item.id === ped.ballId).within(16).nearest();
                if (stray) {
                    if (!(await walkTo(new Tile(stray.tile().x, stray.tile().z, stray.tile().level), 2, log))) {
                        return false;
                    }
                    await stray.interact('Take');
                    if (!(await Execution.delayUntil(() => liveId(ped.ballId) > 0, 6000))) {
                        return false;
                    }
                } else {
                    log(`cannot find ${ped.color} ball to place`);
                    return false;
                }
            }
        }

        if (!(await walkTo(ped.at, 2, log))) {
            return false;
        }
        await settleScene();
        // Exact loc_coord match — content drops the ball on the mechanism tile.
        // nearest() within 1 was hitting the wrong pedestal (six mechanisms in a 2×3 grid).
        const mech = Locs.query()
            .name('Stone Mechanism')
            .where(loc => {
                const t = loc.tile();
                return t.x === ped.at.x && t.z === ped.at.z && t.level === ped.at.level;
            })
            .within(10)
            .nearest();
        const ball = Inventory.items().find(i => i.id === ped.ballId);
        if (!mech || !ball) {
            log(`no Stone Mechanism or ${ped.color} ball at (${ped.at.x},${ped.at.z})`);
            return false;
        }
        log(`placing ${ped.color} ball on mechanism at ${mech.tile()}`);
        if (!(await ball.useOn(mech))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => ballOnTile(ped.at, ped.ballId), 8000))) {
            // Content drops at loc_coord — accept any ball of this id within 1 of ped.
            const ok = GroundItems.query()
                .where(item => item.id === ped.ballId && item.tile().distanceTo(ped.at) <= 1)
                .within(8)
                .nearest() !== null;
            if (!ok) {
                log(`${ped.color} ball did not land on pedestal`);
                return false;
            }
        }
    }

    if (allPedestalsCorrect()) {
        log('stone mechanism complete — door should unlock');
        await Execution.delayTicks(2);
        return true;
    }
    return false;
}

async function scoutSecretPath(log: (m: string) => void): Promise<boolean> {
    if (!(await openTenzingBackDoor(log))) {
        // Still try the walk — path may already be open.
        log('tenzing back door open failed — walking scout path anyway');
    }
    if (!(await walkTo(TILE.SCOUT, 3, log))) {
        return false;
    }
    await settleScene();
    // Zone script fires chat once the tile is entered with got_map.
    if (await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 5000)) {
        await driveDialog([], log);
    }
    return true;
}

async function handInToDenulth(log: (m: string) => void): Promise<boolean> {
    if (inSabaCave(Game.tile()) && !(await leaveSabaCave(log))) {
        return false;
    }
    return talkAt(DENULTH_FINISH, log);
}

/** Drain chat + objbox until quiet or `done()` is true. */
async function drainUntil(done: () => boolean, log: (m: string) => void, max = 40): Promise<boolean> {
    for (let i = 0; i < max; i++) {
        if (done()) {
            return true;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (ChatDialog.isOpen() && ChatDialog.options().length > 0) {
            await driveDialog([], log);
            continue;
        }
        if (reader.modals().main !== -1) {
            const cont = reader.mainModalButtonNearText('Click here to continue');
            if (cont > 0) {
                if (!actions.menuAction(MiniMenuAction.PAUSE_BUTTON, 0, 0, cont)) {
                    actions.ifButton(cont);
                }
            } else {
                actions.closeModal();
            }
            await Execution.delayTicks(2);
            continue;
        }
        if (!ChatDialog.isOpen()) {
            await Execution.delayTicks(1);
            if (done() || (!ChatDialog.isOpen() && reader.modals().main === -1)) {
                return done();
            }
        }
        await Execution.delayTicks(1);
    }
    return done();
}

/** Certificate dropped underfoot when Denulth grants it into a full pack. */
async function takeEntranceCertFromGround(log: (m: string) => void): Promise<boolean> {
    if (liveId(DEATH_ITEM.ENTRANCE_CERT.id) > 0) {
        return true;
    }
    if (Inventory.isFull()) {
        log('pack full — cannot take entrance certificate from the ground');
        return false;
    }
    const drop = GroundItems.query()
        .where(item => item.id === DEATH_ITEM.ENTRANCE_CERT.id)
        .within(8)
        .nearest()
        ?? GroundItems.query().name(DEATH_ITEM.ENTRANCE_CERT.name).within(8).nearest();
    if (!drop) {
        return false;
    }
    log(`taking entrance certificate from the ground at ${drop.tile()}`);
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => liveId(DEATH_ITEM.ENTRANCE_CERT.id) > 0, 8000);
}

/** Denulth auto-runs denulth_cert when map is spoken_smithy..got_entrancecert. */
async function getEntranceCertFromDenulth(log: (m: string) => void): Promise<boolean> {
    if (liveId(DEATH_ITEM.ENTRANCE_CERT.id) > 0) {
        return true;
    }
    // Prior full-pack grant leaves the cert on the floor near Denulth.
    if (await takeEntranceCertFromGround(log)) {
        return true;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
        if (!(await walkTo(TILE.DENULTH, 2, log))) {
            return false;
        }
        await settleScene();
        // Retry floor loot after walking over (drop may only stream in scene).
        if (await takeEntranceCertFromGround(log)) {
            return true;
        }
        // Caller should have made space via decide(); refuse to talk if still full
        // so the cert does not drop again.
        if (Inventory.isFull() || Inventory.free() < 1) {
            log('need a free inventory slot before Denulth gives the certificate');
            return false;
        }
        if (!(await openDialogue('Denulth', log))) {
            await Execution.delayTicks(2);
            continue;
        }
        if (await drainUntil(
            () => liveId(DEATH_ITEM.ENTRANCE_CERT.id) > 0
                || GroundItems.query().where(i => i.id === DEATH_ITEM.ENTRANCE_CERT.id).within(6).nearest() !== null,
            log
        )) {
            if (liveId(DEATH_ITEM.ENTRANCE_CERT.id) > 0) {
                log(`entrance cert — held=${liveId(DEATH_ITEM.ENTRANCE_CERT.id)}`);
                return true;
            }
            // Server dumped it underfoot despite free-slot check (race / inv_add).
            if (await takeEntranceCertFromGround(log)) {
                return true;
            }
        }
    }
    log(`entrance cert — held=${liveId(DEATH_ITEM.ENTRANCE_CERT.id)}`);
    if (liveId(DEATH_ITEM.ENTRANCE_CERT.id) > 0) {
        return true;
    }
    return takeEntranceCertFromGround(log);
}

/** Give cert to Dunstan → map given_cert; may immediately offer spiked boots bargain. */
async function giveCertToDunstan(log: (m: string) => void): Promise<boolean> {
    if (liveId(DEATH_ITEM.ENTRANCE_CERT.id) <= 0) {
        return getEntranceCertFromDenulth(log);
    }
    if (!(await walkTo(TILE.DUNSTAN, 2, log))) {
        return false;
    }
    if (!(await openDialogue('Dunstan', log))) {
        return false;
    }
    // Cert is consumed on talk when map is got_entrancecert.
    const before = liveId(DEATH_ITEM.ENTRANCE_CERT.id);
    await drainUntil(
        () => liveId(DEATH_ITEM.ENTRANCE_CERT.id) < before || liveId(DEATH_ITEM.SPIKED_BOOTS.id) > 0,
        log
    );
    log(`gave cert — cert=${liveId(DEATH_ITEM.ENTRANCE_CERT.id)} spiked=${liveId(DEATH_ITEM.SPIKED_BOOTS.id)}`);
    return liveId(DEATH_ITEM.ENTRANCE_CERT.id) < before || liveId(DEATH_ITEM.SPIKED_BOOTS.id) > 0;
}

// ─── decide ──────────────────────────────────────────────────────────────────

function custom(name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep {
    return { kind: 'custom', name, run };
}

/**
 * Pure decide from journal stage + map flags + inventory.
 * Combo (equip room) runs before the map track so inventory space is free for balls.
 */
export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }

    const progress = snap.progress;
    if (progress === undefined && snap.journal === 'inProgress') {
        return { kind: 'wait', reason: 'Death Plateau journal stage unavailable' };
    }

    const stage = equipFloor(snap, progress);
    const map = effectiveMap(snap, progress);

    if (stage >= DP_STAGE.COMPLETE) {
        return { kind: 'done' };
    }

    // ── finish: both tracks done ─────────────────────────────────────────────
    if (stage >= DP_STAGE.UNLOCKED_DOOR && map.scouted) {
        if (heldId(snap, DEATH_ITEM.SECRET_MAP.id) === 0 && !map.scouted) {
            // should not happen
        }
        // Need map + combination in pack for the hand-in bits.
        if (heldId(snap, DEATH_ITEM.COMBINATION.id) === 0) {
            // Already unlocked without the paper — Denulth still asks for it; reclaim from Harold.
            return custom('reclaim combination from Harold', async log => {
                if (!(await openHaroldDoor(log))) return false;
                return talkAt({
                    npc: 'Harold',
                    anchor: TILE.HAROLD,
                    leash: 5,
                    prefer: []
                }, log);
            });
        }
        if (heldId(snap, DEATH_ITEM.SECRET_MAP.id) === 0) {
            return custom('reclaim secret way map from Tenzing', async log => {
                if (!(await openTenzingDoor(log))) return false;
                return talkAt(TENZING_SUPPLIES, log);
            });
        }
        return custom('give map and combination to Denulth', handInToDenulth);
    }

    // ── equip-room track ─────────────────────────────────────────────────────
    if (stage < DP_STAGE.UNLOCKED_DOOR) {
        if (stage === DP_STAGE.NOT_STARTED || snap.journal === 'notStarted') {
            return normalizePack(snap)
                ?? sourceCoins(snap, 200)
                ?? custom('start Death Plateau with Denulth', log => talkAt(DENULTH_START, log));
        }
        if (stage === DP_STAGE.STARTED) {
            return custom('ask Eohric about the night guard', log => talkAt(EOHRIC_GUARD, log));
        }
        if (stage === DP_STAGE.SPOKEN_EOHRIC) {
            return custom("confront Harold about last night's duty", async log => {
                if (!(await openHaroldDoor(log))) return false;
                return talkAt(HAROLD_DUTY, log);
            });
        }
        if (stage === DP_STAGE.SPOKEN_HAROLD) {
            return custom('tell Eohric that Harold will not talk', log => talkAt(EOHRIC_HAROLD_REFUSED, log));
        }
        if (stage === DP_STAGE.SPOKEN_EOHRIC2) {
            if (heldId(snap, DEATH_ITEM.ASGARNIAN_ALE.id) === 0) {
                return sourceCoins(snap, ALE_PRICE + 50)
                    ?? makeSpace(snap, 1)
                    ?? {
                        kind: 'buy',
                        item: DEATH_ITEM.ASGARNIAN_ALE.name,
                        qty: 1,
                        shop: TOSTIG_SHOP,
                        estGp: ALE_PRICE
                    };
            }
            return custom('buy Harold an Asgarnian ale', giveAleToHarold);
        }
        if (stage === DP_STAGE.GIVEN_ALE) {
            return sourceCoins(snap, GAMBLE_BET)
                ?? custom('gamble with Harold until the IOU', gambleHarold);
        }
        if (stage === DP_STAGE.GIVEN_IOU) {
            if (heldId(snap, DEATH_ITEM.IOU.id) === 0 && heldId(snap, DEATH_ITEM.COMBINATION.id) === 0) {
                return custom('reclaim IOU from Harold', reclaimIouFromHarold);
            }
            if (heldId(snap, DEATH_ITEM.COMBINATION.id) === 0) {
                return custom('read the IOU (combination on the back)', readIou);
            }
            // Fall through as FOUND_COMBO.
        }
        if (stage >= DP_STAGE.GIVEN_IOU && stage < DP_STAGE.UNLOCKED_DOOR) {
            if (heldId(snap, DEATH_ITEM.COMBINATION.id) === 0 && heldId(snap, DEATH_ITEM.IOU.id) > 0) {
                return custom('read the IOU (combination on the back)', readIou);
            }
            // One custom step picks+places; do not require all five held at once
            // (balls already on correct pedestals are not in the pack).
            return makeSpace(snap, 5)
                ?? custom('solve the stone ball mechanism', solveStoneMechanism);
        }
    }

    // ── map track ────────────────────────────────────────────────────────────
    if (!map.scouted) {
        if (!map.saba) {
            return custom('ask Saba about another path', async log => {
                if (!(await enterSabaCave(log))) return false;
                if (!(await talkAt(SABA_PATH, log))) return false;
                return leaveSabaCave(log);
            });
        }
        if (!map.tenzing) {
            // Tenzing hands climbing boots — need 1 free slot or they hit the floor.
            return makeSpace(snap, 1)
                ?? custom('ask Tenzing for the secret way', async log => {
                    if (inSabaCave(Game.tile()) && !(await leaveSabaCave(log))) return false;
                    if (!(await openTenzingDoor(log))) return false;
                    return talkAt(TENZING_HELP, log);
                });
        }
        if (!map.smithy) {
            return custom('ask Dunstan to spike the climbing boots', async log => {
                if (inSabaCave(Game.tile()) && !(await leaveSabaCave(log))) return false;
                return talkAt(DUNSTAN_SPIKES, log);
            });
        }
        if (!map.entrancecert || (map.entrancecert && heldId(snap, DEATH_ITEM.ENTRANCE_CERT.id) === 0 && !map.given_cert)) {
            // Denulth grants the certificate via inv_add — full pack drops it.
            return makeSpace(snap, 1)
                ?? custom("get Dunstan's son signed up with Denulth (certificate)", getEntranceCertFromDenulth);
        }
        if (!map.given_cert) {
            return custom('give Dunstan the entrance certificate', giveCertToDunstan);
        }
        // Spiked boots + supplies for Tenzing.
        if (!map.supplies) {
            if (heldId(snap, DEATH_ITEM.SPIKED_BOOTS.id) === 0) {
                const needBar = sourceNamed(snap, DEATH_ITEM.IRON_BAR.name, DEATH_ITEM.IRON_BAR.id, 1);
                if (needBar) return needBar;
                if (heldId(snap, DEATH_ITEM.CLIMBING_BOOTS.id) === 0) {
                    return custom('reclaim climbing boots from Tenzing', async log => {
                        if (!(await openTenzingDoor(log))) return false;
                        return talkAt(TENZING_SUPPLIES, log);
                    });
                }
                return custom('have Dunstan spike the climbing boots', log => talkAt({
                    npc: 'Dunstan',
                    anchor: TILE.DUNSTAN,
                    leash: 8,
                    prefer: ['Yes, but I still want them.']
                }, log));
            }
            const needBread = sourceNamed(snap, DEATH_ITEM.BREAD.name, DEATH_ITEM.BREAD.id, 10);
            if (needBread) return needBread;
            const needTrout = sourceNamed(snap, DEATH_ITEM.TROUT.name, DEATH_ITEM.TROUT.id, 10);
            if (needTrout) return needTrout;
            return custom('deliver supplies and spiked boots to Tenzing', async log => {
                if (!(await openTenzingDoor(log))) return false;
                return talkAt(TENZING_SUPPLIES, log);
            });
        }
        if (!map.got_map) {
            // Supplies flag without map — talk again for the map hand-over.
            if (heldId(snap, DEATH_ITEM.SECRET_MAP.id) === 0) {
                return custom('get the secret way map from Tenzing', async log => {
                    if (!(await openTenzingDoor(log))) return false;
                    return talkAt(TENZING_SUPPLIES, log);
                });
            }
        }
        if (heldId(snap, DEATH_ITEM.SECRET_MAP.id) === 0 && map.got_map) {
            return custom('reclaim secret way map from Tenzing', async log => {
                if (!(await openTenzingDoor(log))) return false;
                return talkAt(TENZING_SUPPLIES, log);
            });
        }
        return custom('scout the secret path north of Tenzing', scoutSecretPath);
    }

    return { kind: 'wait', reason: `Death Plateau unhandled state stage=${stage}` };
}

export const deathplateau: QuestModule = {
    record: QUESTS.find(r => r.id === 'death')!,
    bank: FALADOR_WEST_BANK,
    ownsInventory: true,
    coinFloat: COIN_FLOAT,
    readProgress: readDeathPlateauProgress,
    decide
};
