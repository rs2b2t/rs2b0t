import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import Tile from '../../../api/Tile.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Equipment } from '../../../api/hud/Equipment.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Quests } from '../../../api/hud/Quests.js';
import { Skills } from '../../../api/hud/Skills.js';
import { Prayer } from '../../../api/Prayer.js';
import { GroundItems } from '../../../api/queries/GroundItems.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { Sustain } from '../../../api/Sustain.js';
import { Traversal } from '../../../api/Traversal.js';
import { QUESTS } from '../../data/quests.js';
import {
    hasFlag,
    type QuestModule,
    type QuestSnapshot,
    type QuestStep
} from '../../engine/types.js';
import { driveDialog, talkThrough } from '../../exec/primitives.js';
import { QuestFood } from '../../food.js';
import {
    ARENA_ENTRANCE,
    BOOT_COST,
    COIN_FLOAT,
    COMBAT_FOODS,
    DAD_ARENA,
    DEATH_ROCKS,
    DENULTH,
    DUNSTAN,
    EADGAR_CELL,
    FALADOR_WEST_BANK,
    FOOD_TARGET,
    GENERAL_CAMP,
    GODRIC_CELL,
    ITEM,
    PRISON_DOOR_AREA,
    PRISON_FLOOR,
    STRONGHOLD_DOOR,
    TENZING_BUY_BOOTS,
    TENZING_TILE,
    trollArea,
    type TrollArea
} from './areas.js';
import {
    TROLL_FLAG,
    TROLL_QUEST,
    TROLL_STAGE,
    readTrollStrongholdProgress
} from './journal.js';

// Re-exports for tests.
export {
    parseTrollStrongholdJournal,
    readTrollStrongholdProgress,
    TROLL_FLAG,
    TROLL_QUEST,
    TROLL_STAGE
} from './journal.js';
export { trollArea, ITEM, COMBAT_FOODS, FOOD_TARGET, FALADOR_WEST_BANK } from './areas.js';

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

const heldCount = (snap: QuestSnapshot, name: string): number => snap.inv.get(name.toLowerCase()) ?? 0;
const held = (snap: QuestSnapshot, name: string): boolean => heldCount(snap, name) > 0;
const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());
const banked = (snap: QuestSnapshot, name: string): number => snap.bank?.get(name.toLowerCase()) ?? 0;
const hasBoots = (snap: QuestSnapshot): boolean => held(snap, ITEM.CLIMBING_BOOTS) || worn(snap, ITEM.CLIMBING_BOOTS);

function foodNames(): string[] {
    const configured = QuestFood.name?.trim();
    const names = [configured, ...COMBAT_FOODS].filter((name): name is string => Boolean(name));
    return [...new Map(names.map(name => [name.toLowerCase(), name])).values()];
}

function foodHeld(snap: QuestSnapshot): number {
    return foodNames().reduce((total, name) => total + heldCount(snap, name), 0);
}

function exactKeep(): string[] {
    return [
        ITEM.COINS.toLowerCase(),
        ITEM.CLIMBING_BOOTS.toLowerCase(),
        ITEM.PRISON_KEY.toLowerCase(),
        ITEM.CELL_KEY_1.toLowerCase(),
        ITEM.CELL_KEY_2.toLowerCase(),
        'prayer potion(4)',
        'prayer potion(3)',
        'prayer potion(2)',
        'prayer potion(1)',
        ...foodNames().map(name => name.toLowerCase())
    ];
}

function scanBank(): QuestStep {
    return { kind: 'scanBank', bank: FALADOR_WEST_BANK };
}

function withdraw(items: { name: string; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: FALADOR_WEST_BANK };
}

function makeSpace(snap: QuestSnapshot, slots: number): QuestStep | null {
    if (snap.freeSlots === undefined || snap.freeSlots >= slots) {
        return null;
    }
    const keep = exactKeep();
    if ([...snap.inv.keys()].some(name => !keep.includes(name))) {
        return { kind: 'deposit', keep, bank: FALADOR_WEST_BANK, exactKeep: true };
    }
    return { kind: 'deposit', keep: [ITEM.COINS.toLowerCase()], bank: FALADOR_WEST_BANK, exactKeep: true };
}

function normalizePack(snap: QuestSnapshot): QuestStep | null {
    const keep = exactKeep();
    return [...snap.inv.keys()].some(name => !keep.includes(name))
        ? { kind: 'deposit', keep, bank: FALADOR_WEST_BANK, exactKeep: true }
        : null;
}

function sourceCoins(snap: QuestSnapshot, need: number = COIN_FLOAT): QuestStep | null {
    if (heldCount(snap, ITEM.COINS) >= need) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const inBank = banked(snap, ITEM.COINS);
    if (inBank <= 0) {
        return { kind: 'wait', reason: 'need coins for Climbing boots / supplies' };
    }
    const missing = need - heldCount(snap, ITEM.COINS);
    return makeSpace(snap, 1) ?? withdraw([{ name: ITEM.COINS, qty: Math.min(missing, inBank) }]);
}

function sourceFood(snap: QuestSnapshot): QuestStep | null {
    const have = foodHeld(snap);
    if (have >= FOOD_TARGET) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    for (const name of foodNames()) {
        const available = banked(snap, name);
        if (available <= 0) {
            continue;
        }
        const qty = Math.min(FOOD_TARGET - have, available);
        return makeSpace(snap, qty) ?? withdraw([{ name, qty }]);
    }
    return { kind: 'wait', reason: `need ${FOOD_TARGET} combat food for Troll Stronghold` };
}

function sourceBoots(snap: QuestSnapshot): QuestStep | null {
    if (hasBoots(snap)) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    if (banked(snap, ITEM.CLIMBING_BOOTS) > 0) {
        return makeSpace(snap, 1) ?? withdraw([{ name: ITEM.CLIMBING_BOOTS, qty: 1 }]);
    }
    const coins = sourceCoins(snap, BOOT_COST + 50);
    if (coins) {
        return coins;
    }
    return { kind: 'custom', name: 'buy Climbing boots from Tenzing (12gp)', run: buyBootsFromTenzing };
}

function combatLoadoutReady(snap: QuestSnapshot): boolean {
    return hasBoots(snap) && foodHeld(snap) >= Math.min(8, FOOD_TARGET);
}

// ---------------------------------------------------------------------------
// Combat / prayer
// ---------------------------------------------------------------------------

async function restoreWithFood(target: number): Promise<void> {
    for (let i = 0; i < FOOD_TARGET && Skills.hpFraction() < target; i++) {
        const before = Skills.effective('hitpoints');
        await Sustain.run();
        if (Skills.effective('hitpoints') <= before) {
            return;
        }
    }
}

async function sipPrayerIfNeeded(): Promise<void> {
    if (Prayer.max() < 43 || Prayer.points() > Math.max(5, Prayer.max() * 0.25)) {
        return;
    }
    const pot = Inventory.items().find(i => {
        const n = (i.name ?? '').toLowerCase();
        return n.includes('prayer potion') && i.actions().some(a => a.toLowerCase() === 'drink');
    });
    if (!pot) {
        return;
    }
    const before = Prayer.points();
    await pot.interact('Drink');
    await Execution.delayUntil(() => Prayer.points() > before, 3000);
}

async function waitOutCombat(timeoutMs: number, opts?: { protectMelee?: boolean }): Promise<boolean> {
    if (opts?.protectMelee && Prayer.available('Protect from Melee') && !Prayer.active('Protect from Melee')) {
        await Prayer.set('Protect from Melee', true);
    }
    const deadline = performance.now() + timeoutMs;
    while (Game.inCombat() && performance.now() < deadline) {
        await Sustain.run();
        if (opts?.protectMelee) {
            await sipPrayerIfNeeded();
            if (Prayer.available('Protect from Melee') && !Prayer.active('Protect from Melee')) {
                await Prayer.set('Protect from Melee', true);
            }
        }
        // Dad forfeits near death — drain the surrender dialogue so the stage advances.
        if (await driveDadForfeitIfOpen()) {
            return true;
        }
        await Execution.delayTicks(1);
    }
    return !Game.inCombat();
}

async function driveDadForfeitIfOpen(): Promise<boolean> {
    if (!ChatDialog.isOpen() && !ChatDialog.canContinue() && ChatDialog.options().length === 0) {
        return false;
    }
    await driveDialog(["I'll be going now.", "I'll be going"], () => undefined);
    return true;
}

/** Leave the arena through Arena Exit toward Burthorpe for re-supply. */
async function leaveArena(log: (m: string) => void): Promise<boolean> {
    if (trollArea(Game.tile()) !== 'arena') {
        return true;
    }
    const exit = Locs.query().name('Arena Exit').action('Open').within(14).nearest()
        ?? Locs.query().name('Arena Entrance').action('Open').within(14).nearest();
    if (exit) {
        await exit.interact('Open');
        await Execution.delayTicks(3);
    }
    // Walk south toward Death rocks / Burthorpe.
    await walkNear(DEATH_ROCKS, 6, log);
    return trollArea(Game.tile()) !== 'arena';
}

// ---------------------------------------------------------------------------
// Path / loc helpers
// ---------------------------------------------------------------------------

async function walkNear(tile: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    return Traversal.walkResilient(tile, { radius, attempts: 4, timeoutMs: 180_000, log });
}

/** Climb nearby "Rocks" (secret path / mountain shortcuts) when walk is blocked. */
async function climbNearestRocks(log: (m: string) => void): Promise<boolean> {
    const rocks = Locs.query().name('Rocks').action('Climb').within(10).nearest();
    if (!rocks) {
        return false;
    }
    log(`climbing Rocks at ${rocks.tile()}`);
    if (!(await rocks.interact('Climb'))) {
        return false;
    }
    await Execution.delayTicks(4);
    return true;
}

async function ensureBootsWorn(log: (m: string) => void): Promise<boolean> {
    if (Equipment.contains(ITEM.CLIMBING_BOOTS)) {
        return true;
    }
    if (!Inventory.contains(ITEM.CLIMBING_BOOTS)) {
        log('no Climbing boots to wear');
        return false;
    }
    const boots = Inventory.items().find(i => i.name === ITEM.CLIMBING_BOOTS);
    if (!boots) {
        return false;
    }
    const op = boots.actions().find(a => /^(wear|wield|equip)$/i.test(a));
    if (!op || !(await boots.interact(op))) {
        return false;
    }
    return Execution.delayUntil(() => Equipment.contains(ITEM.CLIMBING_BOOTS), 4000);
}

async function buyBootsFromTenzing(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(ITEM.CLIMBING_BOOTS) || Equipment.contains(ITEM.CLIMBING_BOOTS)) {
        return true;
    }
    if (Inventory.count(ITEM.COINS) < BOOT_COST) {
        log('need 12 coins for Climbing boots');
        return false;
    }
    if (!(await walkNear(TENZING_TILE, 4, log))) {
        return false;
    }
    const before = Inventory.count(ITEM.CLIMBING_BOOTS);
    if (!(await talkThrough(TENZING_BUY_BOOTS.npc, TENZING_BUY_BOOTS.prefer, log))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.count(ITEM.CLIMBING_BOOTS) > before, 8000);
}

/**
 * Walk the secret way past Death Plateau rocks up to Dad's arena.
 * Boots must be worn for the southern rock climb (coordz = 3611 gate).
 */
async function pathToArena(log: (m: string) => void): Promise<boolean> {
    if (!(await ensureBootsWorn(log))) {
        return false;
    }
    const here = Game.tile();
    if (here && trollArea(here) === 'arena') {
        return true;
    }

    // Nudge north along the secret path; climb Rocks when present.
    const waypoints = [DEATH_ROCKS, ARENA_ENTRANCE, DAD_ARENA];
    for (const wp of waypoints) {
        const tile = Game.tile();
        if (tile && trollArea(tile) === 'arena') {
            break;
        }
        if (!(await walkNear(wp, 4, log))) {
            // Walk may fail on unbaked edges — try climbing any nearby Rocks then retry.
            if (await climbNearestRocks(log)) {
                continue;
            }
            log(`path to arena stalled near (${wp.x},${wp.z})`);
            return false;
        }
        await climbNearestRocks(log);
    }

    // Open arena entrance if still outside.
    const entrance = Locs.query().name('Arena Entrance').action('Open').within(12).nearest();
    if (entrance) {
        log('opening Arena Entrance');
        await entrance.interact('Open');
        await Execution.delayTicks(3);
        // Dad chat on first open — accept challenge if offered.
        await driveDialog(['I accept your challenge!', 'I accept'], log);
    }
    return true;
}

async function fightDad(log: (m: string) => void): Promise<boolean> {
    const area = trollArea(Game.tile());
    if (area !== 'arena') {
        await pathToArena(log);
        return false;
    }

    await restoreWithFood(0.7);
    let dad = Npcs.query()
        .name('Dad')
        .where(n => !n.targetsAnotherPlayer())
        .action('Attack')
        .within(16)
        .nearest();
    if (!dad) {
        // Opening the entrance / talking spawns Dad if missing.
        const entrance = Locs.query().name('Arena Entrance').action('Open').within(14).nearest();
        if (entrance) {
            await entrance.interact('Open');
            await Execution.delayTicks(2);
            await driveDialog(['I accept your challenge!', 'I accept'], log);
        }
        const talk = Npcs.query().name('Dad').action('Talk-to').within(16).nearest();
        if (talk) {
            await talk.interact('Talk-to');
            await driveDialog(['I accept your challenge!', 'I accept'], log);
        }
        await Execution.delayUntil(
            () => Npcs.query().name('Dad').action('Attack').within(16).nearest() !== null,
            8000
        );
        dad = Npcs.query()
            .name('Dad')
            .where(n => !n.targetsAnotherPlayer())
            .action('Attack')
            .within(16)
            .nearest();
    }
    if (!dad) {
        log('Dad is not in the arena');
        return false;
    }

    if (!Game.inCombat() && !(await dad.interact('Attack'))) {
        return false;
    }
    await Execution.delayUntil(() => Game.inCombat() || !dad!.valid(), 5000);
    // Protect from Melee when prayer ≥ 43; Dad forfeits near death.
    await waitOutCombat(240_000, { protectMelee: true });
    await driveDadForfeitIfOpen();
    // Stage advances to 20 on forfeit or kill — next journal read confirms.
    return true;
}

async function enterStronghold(log: (m: string) => void): Promise<boolean> {
    if (trollArea(Game.tile()) === 'stronghold') {
        return true;
    }
    // Leave arena if still inside (north exit after Dad).
    if (trollArea(Game.tile()) === 'arena') {
        const exit = Locs.query().name('Arena Exit').action('Open').within(14).nearest();
        if (exit) {
            await exit.interact('Open');
            await Execution.delayTicks(3);
        }
    }
    if (!(await walkNear(STRONGHOLD_DOOR, 4, log))) {
        // Mountain shortcut rocks toward the stronghold.
        await climbNearestRocks(log);
        if (!(await walkNear(STRONGHOLD_DOOR, 4, log))) {
            return false;
        }
    }
    const door = Locs.query().name('Stronghold').action('Enter').within(8).nearest();
    if (!door) {
        log('no Stronghold entrance to Enter');
        return false;
    }
    if (!(await door.interact('Enter'))) {
        return false;
    }
    return Execution.delayUntil(() => trollArea(Game.tile()) === 'stronghold', 12_000);
}

async function lootPrisonKey(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(ITEM.PRISON_KEY)) {
        return true;
    }
    const drop = GroundItems.query().name(ITEM.PRISON_KEY).within(12).nearest();
    if (!drop) {
        log('waiting for Prison key drop');
        await Execution.delayTicks(2);
        return false;
    }
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.contains(ITEM.PRISON_KEY), 8000);
}

async function killGeneralForKey(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(ITEM.PRISON_KEY)) {
        return true;
    }
    if (trollArea(Game.tile()) !== 'stronghold') {
        await enterStronghold(log);
        return false;
    }

    // Prefer top floor generals.
    if (Game.tile()?.level !== 2) {
        const up = Locs.query().name('Stone Staircase').action('Climb-up').within(12).nearest();
        if (up) {
            await up.interact('Climb-up');
            await Execution.delayTicks(3);
        } else if (!(await walkNear(GENERAL_CAMP, 6, log))) {
            return false;
        }
    } else {
        await walkNear(GENERAL_CAMP, 6, log);
    }

    if (await lootPrisonKey(log)) {
        return true;
    }

    await restoreWithFood(0.7);
    const general = Npcs.query()
        .name('Troll General')
        .where(n => !n.targetsAnotherPlayer() && !n.inCombat)
        .action('Attack')
        .within(18)
        .nearest()
        ?? Npcs.query()
            .name('Troll General')
            .where(n => !n.targetsAnotherPlayer())
            .action('Attack')
            .within(18)
            .nearest();
    if (!general) {
        log('waiting for a Troll General');
        await Execution.delayTicks(3);
        return false;
    }
    if (!Game.inCombat() && !(await general.interact('Attack'))) {
        return false;
    }
    await Execution.delayUntil(() => Game.inCombat() || !general.valid(), 5000);
    await waitOutCombat(300_000, { protectMelee: true });
    // Key drops only when quest < entered_prison and player got kill credit.
    await Execution.delayUntil(() => GroundItems.query().name(ITEM.PRISON_KEY).within(12).nearest() !== null, 10_000);
    return lootPrisonKey(log);
}

async function enterPrison(log: (m: string) => void): Promise<boolean> {
    if (trollArea(Game.tile()) !== 'stronghold') {
        await enterStronghold(log);
        return false;
    }
    // Descend to prison floor (level 0 of stronghold map).
    const tile = Game.tile();
    if (tile && tile.level > 0) {
        const down = Locs.query().name('Stone Staircase').action('Climb-down').within(14).nearest();
        if (down) {
            await down.interact('Climb-down');
            await Execution.delayTicks(3);
            return false;
        }
    }
    if (!(await walkNear(PRISON_DOOR_AREA, 5, log))) {
        return false;
    }
    if (!Inventory.contains(ITEM.PRISON_KEY) && Quests.status(TROLL_QUEST) === 'inProgress') {
        // Stage may still be defeated_dad without key in pack (banked or lost).
        log('need Prison key before unlocking the prison');
        return false;
    }
    const door = Locs.query().name('Prison Door').action('Unlock').within(8).nearest();
    if (!door) {
        log('no Prison Door to Unlock');
        return false;
    }
    if (!(await door.interact('Unlock'))) {
        return false;
    }
    await Execution.delayTicks(3);
    return true;
}

async function takeCellKey(
    guardName: string,
    keyName: string,
    log: (m: string) => void
): Promise<boolean> {
    if (Inventory.contains(keyName)) {
        return true;
    }
    const ground = GroundItems.query().name(keyName).within(10).nearest();
    if (ground) {
        if (!(await ground.interact('Take'))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.contains(keyName), 8000);
    }

    await walkNear(PRISON_FLOOR, 8, log);
    const sleeping = Npcs.query()
        .name(guardName)
        .action('Pickpocket')
        .within(14)
        .nearest();
    if (sleeping && Skills.effective('thieving') >= 30) {
        log(`pickpocketing ${guardName} for ${keyName}`);
        const before = Inventory.count(keyName);
        if (!(await sleeping.interact('Pickpocket'))) {
            return false;
        }
        if (await Execution.delayUntil(() => Inventory.count(keyName) > before, 5000)) {
            return true;
        }
        // Failed pickpocket wakes the guard — fall through to combat.
    }

    const guard = Npcs.query()
        .name(guardName)
        .where(n => !n.targetsAnotherPlayer())
        .action('Attack')
        .within(14)
        .nearest();
    if (!guard) {
        log(`waiting for ${guardName}`);
        await Execution.delayTicks(2);
        return false;
    }
    await restoreWithFood(0.65);
    if (!Game.inCombat() && !(await guard.interact('Attack'))) {
        return false;
    }
    await Execution.delayUntil(() => Game.inCombat() || !guard.valid(), 5000);
    await waitOutCombat(180_000, { protectMelee: true });
    await Execution.delayUntil(() => GroundItems.query().name(keyName).within(12).nearest() !== null, 10_000);
    return takeCellKey(guardName, keyName, log);
}

async function unlockCell(keyName: string, cellTile: Tile, log: (m: string) => void): Promise<boolean> {
    if (!Inventory.contains(keyName)) {
        return false;
    }
    if (!(await walkNear(cellTile, 3, log))) {
        return false;
    }
    // Prefer Unlock on the matching cell door near the stand tile.
    const door = Locs.query()
        .name('Cell Door')
        .action('Unlock')
        .where(l => l.tile().distanceTo(cellTile) <= 4)
        .nearest()
        ?? Locs.query().name('Cell Door').action('Unlock').within(8).nearest();
    if (!door) {
        log('no Cell Door to Unlock');
        return false;
    }
    const before = Inventory.count(keyName);
    if (!(await door.interact('Unlock'))) {
        return false;
    }
    // Key is consumed; dialogue with freed prisoner follows.
    await Execution.delayUntil(() => Inventory.count(keyName) < before || !Inventory.contains(keyName), 8000);
    await driveDialog([], log);
    return true;
}

async function freePrisoners(log: (m: string) => void): Promise<boolean> {
    if (trollArea(Game.tile()) !== 'stronghold') {
        await enterStronghold(log);
        return false;
    }

    // Twig → Cell key 1 (Godric); Berry → Cell key 2 (Eadgar). Free both; Godric advances stage.
    if (!Inventory.contains(ITEM.CELL_KEY_1)) {
        if (!(await takeCellKey('Twig', ITEM.CELL_KEY_1, log))) {
            return false;
        }
    }
    if (!(await unlockCell(ITEM.CELL_KEY_1, GODRIC_CELL, log))) {
        return false;
    }

    // Eadgar is optional for varp but journal tracks it — free him while here.
    if (!Inventory.contains(ITEM.CELL_KEY_2)) {
        await takeCellKey('Berry', ITEM.CELL_KEY_2, log);
    }
    if (Inventory.contains(ITEM.CELL_KEY_2)) {
        await unlockCell(ITEM.CELL_KEY_2, EADGAR_CELL, log);
    }
    return true;
}

async function leaveStronghold(_log: (m: string) => void): Promise<boolean> {
    if (trollArea(Game.tile()) !== 'stronghold') {
        return true;
    }
    // Prefer the back Exit once opened, else top Exit, else wait for nav.
    const exit = Locs.query().name('Exit').action('Open').within(14).nearest()
        ?? Locs.query().name('Exit').action('Leave').within(14).nearest()
        ?? Locs.query().name('Exit').action('Use').within(14).nearest();
    if (exit) {
        await exit.interact(exit.actions().find(a => /open|leave|use/i.test(a)) ?? 'Open');
        await Execution.delayTicks(4);
    }
    return trollArea(Game.tile()) !== 'stronghold';
}

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------

function provisionForMountain(snap: QuestSnapshot): QuestStep | null {
    if (!snap.bankKnown) {
        return scanBank();
    }
    const normalize = normalizePack(snap);
    if (normalize) {
        return normalize;
    }
    const boots = sourceBoots(snap);
    if (boots) {
        return boots;
    }
    if (held(snap, ITEM.CLIMBING_BOOTS) && !worn(snap, ITEM.CLIMBING_BOOTS)) {
        return { kind: 'equip', item: ITEM.CLIMBING_BOOTS };
    }
    const food = sourceFood(snap);
    if (food) {
        return food;
    }
    const coins = sourceCoins(snap, BOOT_COST + 50);
    if (coins) {
        return coins;
    }
    return null;
}

function stageStarted(snap: QuestSnapshot, area: TrollArea): QuestStep {
    if (area === 'stronghold') {
        return { kind: 'custom', name: 'leave the stronghold before fighting Dad', run: leaveStronghold };
    }
    if (area === 'arena') {
        return combatLoadoutReady(snap)
            ? { kind: 'custom', name: 'defeat Dad in the troll arena', run: fightDad }
            : { kind: 'custom', name: 'leave the arena for supplies', run: leaveArena };
    }
    if (area === 'secretPath' || area === 'trollheim' || area === 'burthorpe' || area === 'mainland') {
        const provision = provisionForMountain(snap);
        if (provision && area !== 'secretPath' && area !== 'trollheim') {
            return provision;
        }
        if (!hasBoots(snap)) {
            return sourceBoots(snap) ?? { kind: 'wait', reason: 'need Climbing boots' };
        }
        if (held(snap, ITEM.CLIMBING_BOOTS) && !worn(snap, ITEM.CLIMBING_BOOTS)) {
            return { kind: 'equip', item: ITEM.CLIMBING_BOOTS };
        }
        if (area === 'mainland' || area === 'burthorpe') {
            const food = sourceFood(snap);
            if (food) {
                return food;
            }
        }
        return { kind: 'custom', name: 'path the secret way and defeat Dad', run: async log => {
            if (!(await pathToArena(log))) {
                return false;
            }
            return fightDad(log);
        } };
    }
    return { kind: 'wait', reason: 'return to Burthorpe to resume Troll Stronghold' };
}

function stageAfterDad(snap: QuestSnapshot, area: TrollArea): QuestStep {
    const hasKey = held(snap, ITEM.PRISON_KEY) || hasFlag(snap.progress, TROLL_FLAG.HAS_PRISON_KEY);
    if (area === 'stronghold') {
        if (!hasKey && !held(snap, ITEM.PRISON_KEY)) {
            return { kind: 'custom', name: 'kill a Troll General for the Prison key', run: killGeneralForKey };
        }
        if (held(snap, ITEM.PRISON_KEY)) {
            return { kind: 'custom', name: 'unlock the prison door', run: enterPrison };
        }
        // Key only in bank / journal — leave to withdraw.
        return { kind: 'custom', name: 'leave stronghold for Prison key', run: leaveStronghold };
    }
    if (!held(snap, ITEM.PRISON_KEY)) {
        if (banked(snap, ITEM.PRISON_KEY) > 0) {
            return makeSpace(snap, 1) ?? withdraw([{ name: ITEM.PRISON_KEY, qty: 1 }]);
        }
        const provision = provisionForMountain(snap);
        if (provision && (area === 'mainland' || area === 'burthorpe')) {
            return provision;
        }
        return { kind: 'custom', name: 'enter the stronghold and loot a Prison key', run: async log => {
            if (!(await enterStronghold(log))) {
                return false;
            }
            return killGeneralForKey(log);
        } };
    }
    return { kind: 'custom', name: 'enter the stronghold prison', run: async log => {
        if (!(await enterStronghold(log))) {
            return false;
        }
        return enterPrison(log);
    } };
}

function stagePrison(_snap: QuestSnapshot, area: TrollArea): QuestStep {
    if (area !== 'stronghold') {
        return { kind: 'custom', name: 'return to the stronghold prison', run: enterStronghold };
    }
    return { kind: 'custom', name: 'free Godric (and Mad Eadgar) from the cells', run: freePrisoners };
}

function stageReport(_snap: QuestSnapshot, area: TrollArea): QuestStep {
    if (area === 'stronghold') {
        return { kind: 'custom', name: 'leave the stronghold to tell Dunstan', run: leaveStronghold };
    }
    return { kind: 'talk', stop: DUNSTAN };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete' || (snap.stage ?? snap.progress?.stage ?? 0) >= TROLL_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }

    // Soft gate: Death Plateau must be complete (eligibility also parks on requirements.quests).
    if (snap.journal === 'notStarted' || (snap.stage ?? 0) === TROLL_STAGE.NOT_STARTED) {
        if (Quests.status('Death Plateau') !== 'complete') {
            return { kind: 'wait', reason: 'Death Plateau must be complete before Troll Stronghold' };
        }
    }

    const stage = snap.progress?.stage ?? snap.stage;
    if (stage === undefined) {
        return { kind: 'wait', reason: 'Troll Stronghold journal stage unavailable' };
    }

    const area = trollArea(snap.tile);

    if (stage === TROLL_STAGE.NOT_STARTED) {
        if (!snap.bankKnown) {
            return scanBank();
        }
        const normalize = normalizePack(snap);
        if (normalize) {
            return normalize;
        }
        return { kind: 'talk', stop: DENULTH };
    }

    if (stage === TROLL_STAGE.STARTED) {
        return stageStarted(snap, area);
    }
    if (stage === TROLL_STAGE.DEFEATED_DAD) {
        return stageAfterDad(snap, area);
    }
    if (stage === TROLL_STAGE.ENTERED_PRISON) {
        return stagePrison(snap, area);
    }
    if (stage === TROLL_STAGE.FREED_GODRIC) {
        return stageReport(snap, area);
    }

    return { kind: 'wait', reason: `unrecognized Troll Stronghold stage ${stage}` };
}

export function warnTrollStrongholdReadiness(): string | null {
    const combat = Math.min(Skills.level('attack'), Skills.level('strength'), Skills.level('defence'));
    const hp = Skills.level('hitpoints');
    const prayer = Skills.level('prayer');
    const bits: string[] = [];
    if (combat < 50 || hp < 50) {
        bits.push(`combat/HP look light for Dad + lvl-113 generals (att/str/def≈${combat}, hp=${hp})`);
    }
    if (prayer < 43) {
        bits.push('Protect from Melee (prayer 43) strongly recommended for Dad and generals');
    }
    if (Skills.level('agility') < 15) {
        bits.push('Agility 15 is required for the secret-path rocks');
    }
    return bits.length > 0 ? `Troll Stronghold: ${bits.join('; ')}` : null;
}

export const trollstronghold: QuestModule = {
    record: QUESTS.find(r => r.id === 'troll')!,
    bank: FALADOR_WEST_BANK,
    grind: ['Dad', 'Troll General', 'Twig', 'Berry'],
    tools: ['climbing boots', 'prison key', 'cell key 1', 'cell key 2', 'coins'],
    ownsInventory: true,
    readProgress: readTrollStrongholdProgress,
    sustain: { foods: foodNames(), eatBelowHp: 0.5 },
    coinFloat: COIN_FLOAT,
    warnReadiness: warnTrollStrongholdReadiness,
    decide
};
