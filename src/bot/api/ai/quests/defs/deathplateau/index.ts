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
import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestProgress, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { hasFlag } from '../../engine/types.js';
import { driveDialog, openDialogue } from '../../exec/primitives.js';
import { settleScene } from '../../exec/prompts.js';
import {
    ALL_BALL_IDS,
    ALE_PRICE,
    BALL_PICKUP,
    COIN_FLOAT,
    DEATH_ITEM,
    DENULTH_FINISH,
    DENULTH_START,
    DUNSTAN_SPIKES,
    EOHRIC_GUARD,
    EOHRIC_HAROLD_REFUSED,
    FALADOR_WEST_BANK,
    GAMBLE_STAKE_FLOAT,
    HAROLD_DUTY,
    PEDESTALS,
    SABA_PATH,
    TENZING_HELP,
    TENZING_SUPPLIES,
    TILE,
    TOSTIG_SHOP
} from './areas.js';
import {
    gambleWithHarold,
    giveAleToHarold,
    reclaimIouFromHarold,
    talkInHaroldRoom
} from './harold.js';
import { talkAt, walkTo } from './nav.js';
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
export { closeDiceIfOpen, insideHaroldRoom } from './harold.js';

// snapshot helpers

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

// banking / loadout

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

// custom runners

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
    // After Saba: knock, "No milk today!", auto "I'm not the milkman", open.
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

async function readIou(log: (m: string) => void): Promise<boolean> {
    if (liveId(DEATH_ITEM.COMBINATION.id) > 0) {
        return true;
    }
    const iou = Inventory.items().find(i => i.id === DEATH_ITEM.IOU.id);
    if (!iou) {
        log('no IOU to read');
        return false;
    }
    // opheld1 death_iou: Read replaces the IOU with the Combination plus chat/objbox.
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
    log(`read IOU done, combo=${liveId(DEATH_ITEM.COMBINATION.id)}`);
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
// Why: the balls are placed one at a time from the ground or the pack, so all 5 needn't be held at once.

/** Place the 5 coloured balls on the mechanism. */
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
        // Source the ball: inv, then the ground pile, then anywhere nearby.
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
        // Exact loc_coord match, content drops the ball on the mechanism tile; nearest() within 1 hit the wrong pedestal (6 mechanisms in a 2x3 grid).
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
            // Content drops at loc_coord, accept any ball of this id within 1 of ped.
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
        log('stone mechanism complete, door should unlock');
        await Execution.delayTicks(2);
        return true;
    }
    return false;
}

async function scoutSecretPath(log: (m: string) => void): Promise<boolean> {
    if (!(await openTenzingBackDoor(log))) {
        // Still try the walk, path may already be open.
        log('tenzing back door open failed, walking scout path anyway');
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
        log('pack full, cannot take entrance certificate from the ground');
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
        // decide() should have made space; refuse to talk while full so the cert doesn't drop again.
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
                log(`entrance cert, held=${liveId(DEATH_ITEM.ENTRANCE_CERT.id)}`);
                return true;
            }
            // Server dumped it underfoot despite free-slot check (race / inv_add).
            if (await takeEntranceCertFromGround(log)) {
                return true;
            }
        }
    }
    log(`entrance cert, held=${liveId(DEATH_ITEM.ENTRANCE_CERT.id)}`);
    if (liveId(DEATH_ITEM.ENTRANCE_CERT.id) > 0) {
        return true;
    }
    return takeEntranceCertFromGround(log);
}

/** Give cert to Dunstan, map flag given_cert; may immediately offer the spiked boots bargain. */
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
    log(`gave cert, cert=${liveId(DEATH_ITEM.ENTRANCE_CERT.id)} spiked=${liveId(DEATH_ITEM.SPIKED_BOOTS.id)}`);
    return liveId(DEATH_ITEM.ENTRANCE_CERT.id) < before || liveId(DEATH_ITEM.SPIKED_BOOTS.id) > 0;
}

// decide

function custom(name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep {
    return { kind: 'custom', name, run };
}

/** Pure decide from journal stage, map flags and inventory. The equip-room track runs before the map track so pack space is free for balls. */
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

    // finish: both tracks done
    if (stage >= DP_STAGE.UNLOCKED_DOOR && map.scouted) {
        if (heldId(snap, DEATH_ITEM.SECRET_MAP.id) === 0 && !map.scouted) {
            // should not happen
        }
        // Need map + combination in pack for the hand-in bits.
        if (heldId(snap, DEATH_ITEM.COMBINATION.id) === 0) {
            // Already unlocked without the paper, Denulth still asks for it; reclaim from Harold.
            return custom('reclaim combination from Harold', reclaimIouFromHarold);
        }
        if (heldId(snap, DEATH_ITEM.SECRET_MAP.id) === 0) {
            return custom('reclaim secret way map from Tenzing', async log => {
                if (!(await openTenzingDoor(log))) return false;
                return talkAt(TENZING_SUPPLIES, log);
            });
        }
        return custom('give map and combination to Denulth', handInToDenulth);
    }

    // equip-room track
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
            return custom("confront Harold about last night's duty", log => talkInHaroldRoom(HAROLD_DUTY, log));
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
            return sourceCoins(snap, GAMBLE_STAKE_FLOAT)
                ?? custom('gamble with Harold until the IOU', gambleWithHarold);
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
            // One custom step picks and places; balls already on correct pedestals aren't in the pack, so don't require all 5 held.
            return makeSpace(snap, 5)
                ?? custom('solve the stone ball mechanism', solveStoneMechanism);
        }
    }

    // map track
    if (!map.scouted) {
        if (!map.saba) {
            return custom('ask Saba about another path', async log => {
                if (!(await enterSabaCave(log))) return false;
                if (!(await talkAt(SABA_PATH, log))) return false;
                return leaveSabaCave(log);
            });
        }
        if (!map.tenzing) {
            // Tenzing hands climbing boots, need 1 free slot or they hit the floor.
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
            // Denulth grants the certificate via inv_add, full pack drops it.
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
            // Supplies flag without map, talk again for the map hand-over.
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
