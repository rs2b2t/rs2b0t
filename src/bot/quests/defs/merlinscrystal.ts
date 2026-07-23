import { EventSignal } from '../../api/EventSignal.js';
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Equipment } from '../../api/hud/Equipment.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Skills } from '../../api/hud/Skills.js';
import { stealCakes } from '../../scripts/CakeStall.js';
import { FLEE_TILE, LOCKOUT_TICKS, STAND as BAKER_STALL_STAND } from '../../scripts/CakeStallLogic.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Reach } from '../../api/Reach.js';
import { Sustain } from '../../api/Sustain.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { gotoNpc, pickPreferred, talkThrough, type NpcStop } from '../exec/primitives.js';
import { gpShort } from '../engine/provisioning.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

const EXCALIBUR = 'Excalibur';
const UNLIT_CANDLE = 'Black candle';
const LIT_CANDLE = 'Lit black candle';
const BAT_BONES = 'Bat bones';
const WAX = 'Bucket of wax';
const BUCKET = 'Bucket';
const REPELLENT = 'Insect repellent';
const BREAD = 'Bread';
const TINDERBOX = 'Tinderbox';
const WEAPON = 'Rune mace';

const KING_ARTHUR: NpcStop = { npc: 'King Arthur', anchor: new Tile(2764, 3515, 0), leash: 6, prefer: ['I want to become a Knight of the Round Table!'] };
const GAWAIN: NpcStop = { npc: 'Sir Gawain', anchor: new Tile(2761, 3508, 0), leash: 4, prefer: ['Do you know how Merlin got trapped?', 'Thank you for the information.'] };
const LANCELOT: NpcStop = { npc: 'Sir Lancelot', anchor: new Tile(2755, 3511, 1), leash: 4, prefer: ['Any ideas on how to get into Morgan Le Faye', "You're a little full of yourself"] };
const LADY_LAKE: NpcStop = { npc: 'The Lady of the Lake', anchor: new Tile(2924, 3405, 0), leash: 6, prefer: ['I seek the sword Excalibur.'] };
const CANDLE_MAKER: NpcStop = { npc: 'Candle maker', anchor: new Tile(2800, 3439, 0), leash: 6, prefer: ['Have you got any black candles?'] };

const CATHERBY_CRATE_STAND = new Tile(2801, 3443, 0);
function insideKeep(t: { x: number; z: number }): boolean {
    return t.x >= 2762 && t.x <= 2782 && t.z >= 3396 && t.z <= 3410;
}
const MORDRED_TILE = new Tile(2769, 3403, 2);
const KEEP_STAIR_L0 = new Tile(2769, 3404, 0);
const KEEP_STAIR_L1_UP = new Tile(2769, 3398, 1);
const KEEP_STAIR_L2_DOWN = new Tile(2769, 3399, 2);
const RETURN_CRATE_STAND = new Tile(2779, 3402, 1);
const MAGIC_SYMBOL = new Tile(2780, 3515, 0);
const CHAOS_ALTAR_STAND = new Tile(3239, 3607, 0);
const TOWER_LADDER_0 = new Tile(2769, 3493, 0);
const TOWER_LADDER_1 = new Tile(2767, 3491, 1);
const CRYSTAL_STAND = new Tile(2767, 3494, 2);
const JEWELLER_DOOR_STAND = new Tile(3016, 3247, 0);
const BEEHIVE_STAND = new Tile(2758, 3444, 0);
const REPELLENT_SPAWN = new Tile(2807, 3450, 0);
const BAT_ANCHOR = new Tile(2589, 3478, 0);
const WYDIN_SHOP = { npc: 'Wydin', anchor: new Tile(3014, 3204, 0) };
const RIMMINGTON_SHOP = { npc: 'Shop keeper', anchor: new Tile(2947, 3216, 0) };

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name.toLowerCase()) ?? 0) > 0;

async function wieldWeapon(log: (m: string) => void): Promise<void> {
    if (Equipment.contains(WEAPON) || !Inventory.contains(WEAPON)) {
        return;
    }
    if (await Equipment.equip(WEAPON)) {
        log(`wielded ${WEAPON}`);
    }
}

function buyOrWait(snap: QuestSnapshot, step: Extract<QuestStep, { kind: 'buy' }>): QuestStep {
    if (gpShort(snap, step.estGp) > 0) {
        return { kind: 'wait', reason: `need ~${step.estGp} gp for ${step.item}` };
    }
    return step;
}

const BAKER_STALL_THIEVING = 5;
const BREAD_STEAL_PASSES = 3;
let breadStealPasses = 0;

let breadCombatEndTick = 0;

async function stealBread(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(BREAD)) { return true; }
    if (Game.inCombat()) {
        log('stealBread: guard combat — kiting to the flee tile');
        await Traversal.walkResilient(FLEE_TILE, { radius: 1, attempts: 3, timeoutMs: 60_000, log });
        await Execution.delayUntil(() => !Game.inCombat(), 15_000);
        if (!Game.inCombat()) { breadCombatEndTick = Game.tick(); }
        return false;
    }
    if (!(await Traversal.walkResilient(BAKER_STALL_STAND, { radius: 2, attempts: 4, timeoutMs: 240_000, log }))) {
        return false;
    }
    const res = await stealCakes({
        fillTo: 27,
        abort: () => Inventory.contains(BREAD),
        lockedOutUntil: () => breadCombatEndTick + LOCKOUT_TICKS,
        setStatus: () => {},
        log
    });
    if (res !== 'combat') {
        breadStealPasses++;
    }
    log(`stealBread: pass ${breadStealPasses}/${BREAD_STEAL_PASSES} -> ${res}, bread=${Inventory.contains(BREAD)}`);
    return Inventory.contains(BREAD);
}

export function breadPlan(snap: QuestSnapshot, thievingLevel: number, passesUsed: number): QuestStep {
    if (thievingLevel >= BAKER_STALL_THIEVING && passesUsed < BREAD_STEAL_PASSES) {
        return { kind: 'custom', name: "steal Bread from the Baker's stall", run: stealBread };
    }
    return buyOrWait(snap, { kind: 'buy', item: 'Bread', qty: 1, shop: WYDIN_SHOP, estGp: 20 });
}

async function driveDialogue(prefer: string[], log: (m: string) => void, maxPages = 60): Promise<void> {
    for (let i = 0; i < maxPages && (ChatDialog.isOpen() || ChatDialog.canContinue()); i++) {
        if (EventSignal.pending()) {
            return;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            const pick = pickPreferred(opts, prefer);
            if (!pick) {
                log(`  driveDialogue: no preferred option in [${opts.join(' | ')}] — taking the last`);
            }
            await ChatDialog.chooseOption(pick ?? opts[opts.length - 1]);
            await Execution.delayTicks(1);
            continue;
        }
        await Execution.delayTicks(1);
    }
}

async function climbAt(stand: Tile, op: string, log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(stand, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const stair = Locs.query().action(op).within(4).nearest();
    if (!stair) {
        log(`climbAt: no '${op}' near (${stand.x},${stand.z}) — LIVE-VERIFY the stair`);
        return false;
    }
    const before = Game.tile()?.level ?? stand.level;
    if (!(await stair.interact(op))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => (Game.tile()?.level ?? before) !== before, 6000))) {
        return false;
    }
    await Execution.delayTicks(2);
    return true;
}

async function descendTower(log: (m: string) => void): Promise<boolean> {
    for (let guard = 0; guard < 4 && (Game.tile()?.level ?? 0) > 0; guard++) {
        const find = () => Locs.query().name('Ladder').action('Climb-down').within(6).nearest();
        await Execution.delayUntil(() => find() !== null, 2000);
        const down = find();
        if (!down) {
            log('descendTower: no Climb-down ladder in range');
            return false;
        }
        const before = Game.tile()?.level ?? 0;
        if (!(await down.interact('Climb-down'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => (Game.tile()?.level ?? before) < before, 6000))) {
            return false;
        }
        await Execution.delayTicks(2);
    }
    return (Game.tile()?.level ?? 0) === 0;
}

async function talkKnights(log: (m: string) => void): Promise<void> {
    for (const knight of [GAWAIN, LANCELOT]) {
        for (let attempt = 0; attempt < 4; attempt++) {
            const status = await Reach.npcDialog({ name: knight.npc, near: knight.anchor, log });
            if (status === 'unreachable') {
                log(`talkKnights: '${knight.npc}' unreachable this pass`);
                break;
            }
            if (status !== 'done') {
                continue;
            }
            const npc = Npcs.query().name(knight.npc).action('Talk-to').nearest();
            const here = Game.tile();
            if (!npc || !here || npc.tile().distanceTo(here) > 3) {
                log(`talkKnights: open dialogue is not '${knight.npc}' (not adjacent) — skipping`);
                break;
            }
            log(`talkKnights: '${knight.npc}' dialogue open — driving`);
            await talkThrough(knight.npc, knight.prefer, log);
            break;
        }
    }
}

async function candleMakerStageFour(log: (m: string) => void): Promise<boolean> {
    if (!(await gotoNpc(CANDLE_MAKER, [], log))) {
        return false;
    }
    const npc = Npcs.query().name('Candle maker').action('Talk-to').nearest();
    if (!npc || !(await npc.interact('Talk-to'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) {
        return false;
    }
    let stage4 = false;
    let sawOptions = false;
    for (let i = 0; i < 40 && (ChatDialog.isOpen() || ChatDialog.canContinue()); i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            sawOptions = true;
            if (opts.some(o => /black candles/i.test(o))) {
                stage4 = true;
                await ChatDialog.chooseOption('black candles');
            } else {
                await ChatDialog.chooseOption('No thank you');
            }
            await Execution.delayTicks(1);
            continue;
        }
        await Execution.delayTicks(1);
    }
    return stage4 || !sawOptions;
}

async function fortress(log: (m: string) => void): Promise<boolean> {
    const t = Game.tile();
    if (!t) {
        return false;
    }
    if (!insideKeep(t)) {
        if (!(await Traversal.walkResilient(CATHERBY_CRATE_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const crate = Locs.query().name('Crate').action('Hide-in').within(6).nearest();
        if (!crate) {
            log('fortress: no Catherby Crate to Hide-in');
            return false;
        }
        if (!(await crate.interact('Hide-in'))) {
            return false;
        }
        await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 6000);
        await driveDialogue(['Yes.'], log, 40);
        const boarded = await Execution.delayUntil(() => { const g = Game.tile(); return g !== null && insideKeep(g); }, 12_000);
        log(`fortress: crate Hide-in -> insideKeep=${boarded} (needs stage>=spoken_lancelot to teleport)`);
        return false;
    }
    if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
        await driveDialogue(['Tell me how to untrap Merlin and I might.', 'OK I will go do all that.'], log);
        await leaveKeep(log);
        return false;
    }
    const lvl = Game.tile()?.level ?? 0;
    if (lvl < 2) {
        if (lvl < 1) {
            await climbAt(KEEP_STAIR_L0, 'Climb-up', log);
        } else {
            await climbAt(KEEP_STAIR_L1_UP, 'Climb-up', log);
        }
        return false;
    }
    if (!(await Traversal.walkResilient(MORDRED_TILE, { radius: 5, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    await wieldWeapon(log);
    Game.setCombatStyle(1);
    const mordred = Npcs.query().name('Sir Mordred').action('Attack').within(8).nearest();
    if (mordred) {
        const here = Game.tile();
        if (here && mordred.tile().distanceTo(here) > 1) {
            await Traversal.walkResilient(mordred.tile(), { radius: 1, attempts: 2, timeoutMs: 20_000, log });
        }
        await mordred.interact('Attack');
        for (let i = 0; i < 8 && !ChatDialog.isOpen() && !ChatDialog.canContinue() && Game.inCombat(); i++) {
            await Execution.delayTicks(3);
            await Sustain.run();
        }
    }
    return false;
}

async function leaveKeep(log: (m: string) => void): Promise<boolean> {
    if ((Game.tile()?.level ?? 0) >= 2) {
        const down = Locs.query().name('Staircase').action('Climb-down').within(6).nearest();
        if (down) {
            await down.interact('Climb-down');
            await Execution.delayUntil(() => (Game.tile()?.level ?? 2) < 2, 8000);
            return false;
        }
        await Traversal.walkResilient(KEEP_STAIR_L2_DOWN, { radius: 2, attempts: 3, timeoutMs: 60_000, log });
        return false;
    }
    if (!(await Traversal.walkResilient(RETURN_CRATE_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const crate = Locs.query().name('Crate').action('Hide-in').within(6).nearest();
    if (crate) {
        await crate.interact('Hide-in');
        await driveDialogue(['Yes.'], log, 40);
        await Execution.delayUntil(() => { const g = Game.tile(); return g !== null && !insideKeep(g); }, 12_000);
    }
    return true;
}

async function openingLeg(log: (m: string) => void): Promise<boolean> {
    const t = Game.tile();
    if (t && insideKeep(t)) {
        return fortress(log);
    }
    if (t && BAT_ANCHOR.distanceTo(t) <= 25) {
        return killGiantBat(log);
    }
    await talkKnights(log);
    if (await candleMakerStageFour(log)) {
        return killGiantBat(log);
    }
    return fortress(log);
}

async function killGiantBat(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(BAT_BONES)) {
        return true;
    }
    const drop = GroundItems.query().name(BAT_BONES).within(6).nearest();
    if (drop) {
        if (!(await drop.interact('Take'))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.contains(BAT_BONES), 6000);
    }
    if (!(await Traversal.walkResilient(BAT_ANCHOR, { radius: 6, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await wieldWeapon(log);
    Game.setCombatStyle(1);
    const bat = Npcs.query().name('Giant bat').action('Attack').within(10).nearest();
    if (!bat) {
        log('killGiantBat: no Giant bat near the anchor — LIVE-VERIFY the spawn is reachable');
        return false;
    }
    await bat.interact('Attack');
    await Execution.delayUntil(
        () => GroundItems.query().name(BAT_BONES).within(6).nearest() !== null || Npcs.query().name('Giant bat').within(2).nearest() === null,
        5000
    );
    await Sustain.run();
    return false;
}

async function getWax(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(WAX)) {
        return true;
    }
    if (!Inventory.contains(REPELLENT)) {
        const rep = GroundItems.query().name(REPELLENT).within(8).nearest();
        if (rep) {
            if (!(await rep.interact('Take'))) {
                return false;
            }
            return Execution.delayUntil(() => Inventory.contains(REPELLENT), 6000);
        }
        await Traversal.walkResilient(REPELLENT_SPAWN, { radius: 2, attempts: 3, timeoutMs: 90_000, log });
        return false;
    }
    if (!Inventory.contains(BUCKET)) {
        log('getWax: no empty Bucket (should be provisioned) — parking to re-provision');
        return false;
    }
    if (!(await Traversal.walkResilient(BEEHIVE_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    const hive = Locs.query().name('Beehive').action('Take-from').within(8).nearest();
    if (!hive) {
        log('getWax: no Beehive near the anchor');
        return false;
    }
    const rep = Inventory.first(REPELLENT);
    if (rep) {
        await rep.useOn(hive);
        await Execution.delayTicks(2);
    }
    const bucket = Inventory.first(BUCKET);
    if (bucket) {
        await bucket.useOn(hive);
    }
    return Execution.delayUntil(() => Inventory.contains(WAX), 8000);
}

async function lightCandle(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(LIT_CANDLE)) {
        return true;
    }
    const tinder = Inventory.first(TINDERBOX);
    const candle = Inventory.first(UNLIT_CANDLE);
    if (!tinder || !candle) {
        log('lightCandle: missing Tinderbox or Black candle');
        return false;
    }
    if (!(await tinder.useOn(candle))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.contains(LIT_CANDLE), 6000);
}

async function getExcalibur(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(EXCALIBUR)) {
        return true;
    }
    if (await gotoNpc(LADY_LAKE, [], log)) {
        await talkThrough('The Lady of the Lake', LADY_LAKE.prefer, log);
    }
    if (!Inventory.contains(BREAD)) {
        log('getExcalibur: no Bread for the Beggar (should be provisioned)');
        return false;
    }
    if (!(await Traversal.walkResilient(JEWELLER_DOOR_STAND, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const beggar = Npcs.query().name('Beggar').action('Talk-to').within(6).nearest();
    if (beggar) {
        await talkThrough('Beggar', ['Yes, here you go.', 'Yes certainly.'], log);
    } else {
        const door = Locs.query().name('Door').action('Open').within(6).nearest();
        if (!door) {
            log('getExcalibur: no jeweller Door to Open');
            return false;
        }
        if (!(await door.interact('Open'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) {
            log('getExcalibur: jeweller door opened but the Beggar dialogue never appeared — retry');
            return false;
        }
        await driveDialogue(['Yes certainly.', 'Yes, here you go.'], log);
    }
    return Inventory.contains(EXCALIBUR);
}

async function summonAndBreak(log: (m: string) => void): Promise<boolean> {
    const outcome = await tryBreakCrystal(log);
    if (outcome === 'fail') {
        return false;
    }
    await descendTower(log);
    if (outcome === 'broke') {
        if (!(await gotoNpc(KING_ARTHUR, [], log))) {
            return false;
        }
        await talkThrough('King Arthur', KING_ARTHUR.prefer, log);
        return true;
    }
    await summonThrantax(log);
    return false;
}

async function tryBreakCrystal(log: (m: string) => void): Promise<'broke' | 'need-summon' | 'fail'> {
    if ((Game.tile()?.level ?? 0) < 1 && !(await climbAt(TOWER_LADDER_0, 'Climb-up', log))) {
        return 'fail';
    }
    if ((Game.tile()?.level ?? 0) < 2 && !(await climbAt(TOWER_LADDER_1, 'Climb-up', log))) {
        return 'fail';
    }
    if (!(await Traversal.walkResilient(CRYSTAL_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return 'fail';
    }
    const crystalQ = () => Locs.query().name('Giant crystal').within(8).nearest();
    const sceneSynced = () => Locs.query().name('Ladder').action('Climb-down').within(8).nearest() !== null;
    await Execution.delayUntil(() => crystalQ() !== null || sceneSynced(), 3000);
    const crystal = crystalQ();
    if (!crystal) {
        if (!sceneSynced()) {
            log('tryBreakCrystal: scene not synced on L2 — retrying');
            return 'fail';
        }
        return 'broke';
    }
    const excal = Inventory.first(EXCALIBUR);
    if (!excal) {
        log('tryBreakCrystal: no Excalibur to break the crystal');
        return 'fail';
    }
    await excal.useOn(crystal);
    await Execution.delayTicks(3);
    const gone = Locs.query().name('Giant crystal').within(8).nearest() === null
        || Npcs.query().name('Merlin').within(8).nearest() !== null;
    return gone ? 'broke' : 'need-summon';
}

async function summonThrantax(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(CHAOS_ALTAR_STAND, { radius: 2, attempts: 4, timeoutMs: 180_000, log }))) {
        return false;
    }
    const altar = Locs.query().name('Chaos altar').action('Check').within(8).nearest();
    if (altar) {
        await altar.interact('Check');
        await Execution.delayTicks(2);
    }
    if (!(await Traversal.walkResilient(MAGIC_SYMBOL, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    if (!Inventory.contains(LIT_CANDLE) && !(await lightCandle(log))) {
        return false;
    }
    const bones = Inventory.first(BAT_BONES);
    if (!bones) {
        log('summonThrantax: no Bat bones');
        return false;
    }
    if (!(await bones.interact('Drop'))) {
        return false;
    }
    if (!(await Execution.delayUntil(
        () => ChatDialog.isOpen() || ChatDialog.canContinue() || Npcs.query().name('Thrantax').within(6).nearest() !== null,
        6000
    ))) {
        log('summonThrantax: Thrantax did not appear (words not learned, or off the symbol?)');
        return false;
    }
    await driveDialogue(['Snarthon Candtrick Termanto'], log);
    return true;
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { breadStealPasses = 0; breadCombatEndTick = 0; return { kind: 'talk', stop: KING_ARTHUR }; }

    const hasExcalibur = has(snap, EXCALIBUR);
    const hasUnlit = has(snap, UNLIT_CANDLE);
    const hasLit = has(snap, LIT_CANDLE);
    const hasBones = has(snap, BAT_BONES);
    const hasWax = has(snap, WAX);
    const anyProduct = hasExcalibur || hasUnlit || hasLit || hasBones || hasWax;

    if (!anyProduct) {
        return { kind: 'custom', name: 'opening (knights + fortress)', run: openingLeg };
    }

    if (!hasBones) {
        return { kind: 'custom', name: 'kill a Giant bat for bones', run: killGiantBat };
    }
    if (!hasUnlit && !hasLit && !hasWax) {
        return { kind: 'custom', name: 'gather wax for the black candle', run: getWax };
    }
    if (hasWax && !hasUnlit && !hasLit) {
        return { kind: 'talk', stop: CANDLE_MAKER };
    }
    if (hasUnlit && !hasLit) {
        return { kind: 'custom', name: 'light the black candle', run: lightCandle };
    }
    if (!hasExcalibur) {
        return { kind: 'custom', name: 'get Excalibur (Lady of the Lake + Beggar)', run: getExcalibur };
    }
    return { kind: 'custom', name: 'summon Thrantax + break the crystal', run: summonAndBreak };
}

export const merlinscrystal: QuestModule = {
    record: QUESTS.find(r => r.id === 'arthur')!,
    bank: new Tile(2725, 3491, 0),
    food: 15,
    gather: {
        'insect repellent': () => ({ kind: 'grabGround', item: 'Insect repellent', anchor: REPELLENT_SPAWN }),
        'bread': s => breadPlan(s, Skills.level('thieving'), breadStealPasses),
        'tinderbox': s => buyOrWait(s, { kind: 'buy', item: 'Tinderbox', qty: 1, shop: RIMMINGTON_SHOP, estGp: 15 }),
        'bucket': s => buyOrWait(s, { kind: 'buy', item: 'Bucket', qty: 1, shop: RIMMINGTON_SHOP, estGp: 15 })
    },
    tools: ['excalibur', 'black candle', 'lit black candle', 'bat bones', 'bucket of wax', 'bucket', 'insect repellent', 'bread', 'tinderbox', 'coins', 'rune mace'],
    decide
};
