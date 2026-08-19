import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import Tile from '../../../../../geometry/Tile.js';
import { Equipment } from '../../../../equipment/Equipment.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import { Skills } from '../../../../skills/Skills.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { QUESTS } from '../../data/quests.js';
import { hasFlag, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { talkChoosingBy } from '../../exec/primitives.js';
import { QuestFood } from '../../food.js';
import { QuestLoadout } from '../../gear.js';
import { gearOf, weaponOf } from '../../../../loadout/loadoutPlan.js';
import {
    BOOT_COST,
    COIN_FLOAT,
    COMBAT_FOODS,
    PRAYER_POTIONS,
    PRAYER_POTION_TARGET,
    DENULTH_START,
    DUNSTAN_FINISH,
    FALADOR_WEST_BANK,
    FOOD_FLOOR,
    FOOD_TARGET,
    ITEM,
    TENZING_BOOTS,
    TENZING_DONE_RULES,
    TILE,
    committed,
    trollZone,
    type TrollZone
} from './areas.js';
import { attackable, fight, protectedWalk } from './combat.js';
import { TROLL_FLAG, TROLL_STAGE, readTrollStrongholdProgress } from './journal.js';

export {
    parseTrollStrongholdJournal,
    readTrollStrongholdProgress,
    TROLL_FLAG,
    TROLL_QUEST,
    TROLL_STAGE
} from './journal.js';
export { trollZone, committed, ITEM, COMBAT_FOODS, FOOD_TARGET, FALADOR_WEST_BANK } from './areas.js';

// Snapshot helpers

const heldCount = (snap: QuestSnapshot, name: string): number => snap.inv.get(name.toLowerCase()) ?? 0;
const held = (snap: QuestSnapshot, name: string): boolean => heldCount(snap, name) > 0;
const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());
const banked = (snap: QuestSnapshot, name: string): number => snap.bank?.get(name.toLowerCase()) ?? 0;

function foodNames(): string[] {
    const configured = QuestFood.name?.trim();
    const names = [configured, ...COMBAT_FOODS].filter((n): n is string => Boolean(n));
    return [...new Map(names.map(n => [n.toLowerCase(), n])).values()];
}

function foodHeld(snap: QuestSnapshot): number {
    return foodNames().reduce((total, name) => total + heldCount(snap, name), 0);
}

// Loadout

/** Refusals are silent — `equip` returns false — so a re-picked item burns the run. */
const unwearable = new Set<string>();

const TIERS = ['rune', 'adamant', 'mithril', 'black', 'steel', 'iron', 'bronze'] as const;

const GEAR_SLOTS: readonly { slot: string; kinds: readonly string[] }[] = [
    // Troll General slash defence is 60 against 35 for stab and crush, so a
    // longsword out-damages the same tier of scimitar here.
    { slot: 'weapon', kinds: ['2h sword', 'longsword', 'scimitar', 'battleaxe', 'warhammer', 'mace', 'sword'] },
    { slot: 'body', kinds: ['platebody', 'chainbody'] },
    { slot: 'legs', kinds: ['platelegs', 'plateskirt'] },
    { slot: 'helm', kinds: ['full helm', 'med helm'] },
    { slot: 'shield', kinds: ['kiteshield', 'sq shield'] }
];

function bestInBank(snap: QuestSnapshot, kinds: readonly string[]): string | null {
    for (const tier of TIERS) {
        for (const kind of kinds) {
            const name = `${tier} ${kind}`;
            if (unwearable.has(name)) {
                continue;
            }
            if (banked(snap, name) > 0 || held(snap, name)) {
                // Display casing: every log line and step label carries this name.
                return name[0]!.toUpperCase() + name.slice(1);
            }
        }
    }
    return null;
}

function wearingSlot(snap: QuestSnapshot, kinds: readonly string[]): boolean {
    for (const name of snap.worn) {
        if (kinds.some(kind => name.endsWith(kind))) {
            return true;
        }
    }
    return false;
}

/** What ran before loadouts existed. */
function scavengedGear(snap: QuestSnapshot): string[] {
    const out: string[] = [];
    for (const { slot, kinds } of GEAR_SLOTS) {
        if (wearingSlot(snap, kinds) || (slot === 'shield' && out.some(n => n.endsWith('2h sword')))) {
            continue;
        }
        const pick = bestInBank(snap, kinds);
        if (pick) {
            out.push(pick);
        }
    }
    return out;
}

/** A declared loadout is taken literally; declaring nothing falls back to scavenging. */
export function plannedGear(snap: QuestSnapshot): string[] {
    const declared = gearOf(QuestLoadout.current);
    const names = declared.length > 0 ? declared : scavengedGear(snap);
    return names.filter(name => !unwearable.has(name.toLowerCase()) && !worn(snap, name));
}

function potionsHeld(snap: QuestSnapshot): number {
    return PRAYER_POTIONS.reduce((total, name) => total + heldCount(snap, name), 0);
}

function keepSet(snap: QuestSnapshot): string[] {
    return [
        ...PRAYER_POTIONS,
        ITEM.COINS,
        ITEM.CLIMBING_BOOTS,
        ITEM.PRISON_KEY,
        ITEM.CELL_KEY_1,
        ITEM.CELL_KEY_2,
        ...foodNames(),
        ...plannedGear(snap)
    ].map(n => n.toLowerCase());
}

function scanBank(): QuestStep {
    return { kind: 'scanBank', bank: FALADOR_WEST_BANK };
}

/**
 * The kit in one step — a step per piece pays a task hand-off each, and
 * `equip` already waits for the item to land. Refusals are shed, not retried.
 */
export function wearAll(names: readonly string[]): QuestStep {
    return {
        kind: 'custom',
        name: `wear ${names.join(', ')}`,
        run: async log => {
            for (const name of names) {
                if (Equipment.contains(name) || (await Equipment.equip(name))) {
                    continue;
                }
                log(`cannot wear ${name} — level or quest requirement; banking it and moving on`);
                unwearable.add(name.toLowerCase());
            }
            return true;
        }
    };
}

const wearOrShed = (name: string): QuestStep => wearAll([name]);

// Why: the boots are not optional, so a refusal is a dead end rather than something to shed and route around.
// Why: `opheld2,death_climbingboots` only lets them on once Death Plateau is complete, so the step says so and parks instead of retrying.

/** Wear the climbing boots. */
function wearBoots(): QuestStep {
    if (unwearable.has(ITEM.CLIMBING_BOOTS.toLowerCase())) {
        return {
            kind: 'wait',
            reason: 'the server will not let these Climbing boots on — Death Plateau is not actually complete'
        };
    }
    return wearOrShed(ITEM.CLIMBING_BOOTS);
}

function withdraw(items: { name: string; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: FALADOR_WEST_BANK };
}

// Why: this runs on every decide() tick while the character is still on the mainland, so each branch has to be idempotent.
// Why: a step that does not change the snapshot would spin here forever rather than progress the quest.

/** The loadout, in one pure pass; null when the pack is ready. */
export function prepare(snap: QuestSnapshot, zone: TrollZone = 'mainland'): QuestStep | null {
    const bootsReady = held(snap, ITEM.CLIMBING_BOOTS) || worn(snap, ITEM.CLIMBING_BOOTS);
    // Past the stile a bank trip means climbing back down the secret way. Only a
    // spent pack or missing boots is worth that; anything less rides on.
    if (committed(zone) && bootsReady && foodHeld(snap) >= FOOD_FLOOR) {
        if (!worn(snap, ITEM.CLIMBING_BOOTS)) {
            return wearBoots();
        }
        // Only the bank is out of reach up here.
        const carried = plannedGear(snap).filter(name => held(snap, name));
        if (carried.length > 0) {
            return wearAll(carried);
        }
        return null;
    }

    if (!snap.bankKnown) {
        return scanBank();
    }

    const keep = keepSet(snap);
    if ([...snap.inv.keys()].some(name => !keep.includes(name))) {
        return { kind: 'deposit', keep, bank: FALADOR_WEST_BANK, exactKeep: true };
    }

    // One visit: Tenzing is forty tiles west and the bank is east.
    const fromBank: { name: string; qty: number }[] = [];
    // One purchase — a standing float would mean a bank trip for 12gp of change.
    const needsBootMoney = !bootsReady && banked(snap, ITEM.CLIMBING_BOOTS) === 0;
    if (needsBootMoney && heldCount(snap, ITEM.COINS) < COIN_FLOAT && banked(snap, ITEM.COINS) > 0) {
        fromBank.push({
            name: ITEM.COINS,
            qty: Math.min(COIN_FLOAT - heldCount(snap, ITEM.COINS), banked(snap, ITEM.COINS))
        });
    }
    if (!bootsReady && banked(snap, ITEM.CLIMBING_BOOTS) > 0) {
        fromBank.push({ name: ITEM.CLIMBING_BOOTS, qty: 1 });
    }
    // A loadout names what the player wants, not what the bank has.
    const missing: string[] = [];
    for (const name of plannedGear(snap)) {
        if (held(snap, name)) {
            continue;
        }
        if (banked(snap, name) > 0) {
            fromBank.push({ name, qty: 1 });
        } else {
            missing.push(name);
        }
    }
    // Optional — the quest is winnable on food alone.
    let wantPotions = PRAYER_POTION_TARGET - potionsHeld(snap);
    for (const name of PRAYER_POTIONS) {
        if (wantPotions <= 0) {
            break;
        }
        const available = banked(snap, name);
        if (available > 0) {
            const take = Math.min(wantPotions, available);
            fromBank.push({ name, qty: take });
            wantPotions -= take;
        }
    }

    const have = foodHeld(snap);
    if (have < FOOD_TARGET) {
        for (const name of foodNames()) {
            const available = banked(snap, name);
            if (available > 0) {
                fromBank.push({ name, qty: Math.min(FOOD_TARGET - have, available) });
                break;
            }
        }
    }
    if (fromBank.length > 0) {
        return withdraw(fromBank);
    }

    // Wear it here; the detour to Tenzing is forty tiles of carrying it.
    const toWear = plannedGear(snap).filter(name => held(snap, name));
    if (toWear.length > 0) {
        return wearAll(toWear);
    }

    if (!bootsReady) {
        if (heldCount(snap, ITEM.COINS) < BOOT_COST) {
            return { kind: 'wait', reason: `need ${BOOT_COST} gp for Climbing boots — bank has none` };
        }
        return { kind: 'custom', name: 'buy Climbing boots from Tenzing (12gp)', run: buyBoots };
    }
    if (!worn(snap, ITEM.CLIMBING_BOOTS)) {
        return wearBoots();
    }

    if (foodHeld(snap) === 0) {
        return { kind: 'wait', reason: `no combat food in the bank (tried ${foodNames().join(', ')})` };
    }
    // Missing armour is survivable; a missing weapon is not worth walking up for.
    const weapon = weaponOf(QuestLoadout.current);
    if (weapon !== null && missing.some(name => name.toLowerCase() === weapon.toLowerCase())) {
        return { kind: 'wait', reason: `loadout weapon '${weapon}' is not in the bank` };
    }
    if (!wearingSlot(snap, GEAR_SLOTS[0]!.kinds)) {
        return { kind: 'wait', reason: 'no melee weapon — put one in your loadout, or bank one' };
    }
    return null;
}

// Custom steps

const WALK = { radius: 4, attempts: 4, timeoutMs: 300_000 } as const;

async function walkTo(tile: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === tile.level && tile.distanceTo(here) <= radius) {
        return true;
    }
    return Traversal.walkResilient(tile, { ...WALK, radius, log });
}

/** Mountain side of the troll pass — where the thrower gauntlet begins. */
const CAVE_MOUTH = new Tile(2908, 3654, 0);
/** troll_thrower attackrange is 8; arm a little before they can start. */
const THROWER_RANGE = 11;

// Why: five thrower trolls stand between the cave exit and the stronghold door and open on sight at eight tiles, and nothing in a walk fights back, so the crossing is pure damage that Protect from Missiles refuses outright.
// Why: the prayer drains per tick rather than per tile — held from Falador it emptied the bar before the level-113 general was in sight and killed the run.
// Why: the crossing is therefore its own leg, with the prayer following the throwers rather than the map: up while one is in range, down the moment the last is behind us, which on this route is a good forty tiles before the door.

/** Walk to the stronghold under a threat-tracking protection prayer. */
async function walkToStronghold(tile: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const zone = trollZone(Game.tile());
    if (zone === 'stronghold') {
        return walkTo(tile, radius, log);
    }
    if (zone !== 'mountain' && !(await walkTo(CAVE_MOUTH, 3, log))) {
        return false;
    }
    const throwerNear = (): boolean =>
        Npcs.query().name('Thrower Troll').within(THROWER_RANGE).nearest() !== null;
    return protectedWalk('missiles', throwerNear, () => walkTo(tile, radius, log), log);
}

async function buyBoots(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(ITEM.CLIMBING_BOOTS) || Equipment.contains(ITEM.CLIMBING_BOOTS)) {
        return true;
    }
    if (Inventory.count(ITEM.COINS) < BOOT_COST) {
        log(`need ${BOOT_COST} coins for Climbing boots`);
        return false;
    }
    // One, not four: Tenzing is inside his hut, and any wider radius is
    // satisfied standing on the doorstep with the shut door still in the way.
    if (!(await walkTo(TILE.TENZING, 1, log))) {
        return false;
    }
    const before = Inventory.count(ITEM.CLIMBING_BOOTS);
    // Why: the classification is on the boots rather than on the dialogue, as Tenzing's shop loop leaves an objbox up often enough that `talkChoosingBy` reports failure for a talk that already handed the boots over, and the retry walks the leg twice.
    await talkChoosingBy(TENZING_BOOTS.npc, TENZING_DONE_RULES, TENZING_BOOTS.prefer, log);
    return Execution.delayUntil(() => Inventory.count(ITEM.CLIMBING_BOOTS) > before, 8000);
}

// Why: Dad does not die — below twenty hitpoints `defeat_dad` fires, setting the quest stage, healing him back to full and offering a forfeit dialogue.
// Why: draining that dialogue is the win condition, and leaving it up loses the fight won.

/** Fight Dad to his forfeit and drain the dialogue. */
async function fightDad(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(TILE.DAD, 6, log))) {
        return false;
    }
    let forfeited = false;
    let seen = false;
    const find = (): ReturnType<typeof attackable> => {
        const npc = attackable('Dad', 20);
        if (npc) {
            seen = true;
        }
        return npc;
    };
    return fight(
        {
            what: 'Dad',
            target: find,
            // Why: he is re-added by the Arena Exit whenever the quest is still below stage 20, which is the only reliable way to get him back after a resume, as the Arena Entrance only ever spawns him once.
            onMissing: async () => {
                log('Dad is not in the arena — poking the Arena Exit to bring him back');
                if (!(await walkTo(new Tile(2916, 3628, 0), 1, log))) {
                    return false;
                }
                const exit = Locs.query().name('Arena Exit').action('Open').within(6).nearest();
                if (exit) {
                    await exit.interact('Open');
                    await Execution.delayTicks(3);
                }
                return true;
            },
            // He forfeits rather than dies, but the death path also sets the
            // stage — treat a Dad who has vanished after we engaged as a win.
            won: () => forfeited || (seen && attackable('Dad', 24) === null && !Game.inCombat()),
            onDialogue: () => {
                forfeited = true;
            },
            dialogue: ["I'll be going now."],
            protect: 'melee',
            guard: 600
        },
        log
    );
}

async function takeGround(name: string, log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(name)) {
        return true;
    }
    const drop = GroundItems.query().name(name).within(12).nearest();
    if (!drop) {
        return false;
    }
    log(`taking ${name}`);
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.contains(name), 8000);
}

async function huntGeneral(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(ITEM.PRISON_KEY) || (await takeGround(ITEM.PRISON_KEY, log))) {
        return true;
    }
    if (!(await walkToStronghold(TILE.GENERAL, 5, log))) {
        return false;
    }
    const keyIsOurs = (): boolean =>
        Inventory.contains(ITEM.PRISON_KEY) || GroundItems.query().name(ITEM.PRISON_KEY).within(12).nearest() !== null;
    const ok = await fight(
        {
            what: 'Troll General',
            target: () => attackable('Troll General', 12),
            won: keyIsOurs,
            // Cowardly hunt mode: they never open on us, so a missing general is
            // a respawn wait, not a lost fight.
            onMissing: async () => walkToStronghold(TILE.GENERAL, 5, log),
            protect: 'melee',
            guard: 900
        },
        log
    );
    if (!ok) {
        return false;
    }
    return takeGround(ITEM.PRISON_KEY, log);
}

/** The prison door is a baked crossing: walking to the cells unlocks it. */
async function enterPrison(log: (m: string) => void): Promise<boolean> {
    return walkToStronghold(TILE.PRISON_LANDING, 3, log);
}

// Why: cell keys sit on the belts of two sleeping guards, and pickpocketing is the quiet way.
// Why: a failed steal wakes the guard and killing the woken guard drops the same key, so neither outcome is a dead end.

/** Take a cell key off a sleeping guard. */
export async function stealCellKey(guard: string, key: string, stand: Tile, log: (m: string) => void): Promise<boolean> {
    for (let attempt = 0; attempt < 25; attempt++) {
        if (Inventory.contains(key) || (await takeGround(key, log))) {
            return true;
        }
        if (!(await walkTo(stand, 2, log))) {
            return false;
        }
        const sleeping = Npcs.query().name(guard).action('Pickpocket').within(6).nearest();
        if (sleeping && Skills.effective('thieving') >= 30) {
            const before = Inventory.count(key);
            if (await sleeping.interact('Pickpocket')) {
                if (await Execution.delayUntil(() => Inventory.count(key) > before, 5000)) {
                    log(`pickpocketed ${guard} for ${key}`);
                    return true;
                }
            }
            await Execution.delayTicks(2);
            continue;
        }
        // Awake (or Thieving too low): put it down and take the key off the floor.
        const woken = attackable(guard, 8);
        if (!woken) {
            await Execution.delayTicks(2);
            continue;
        }
        await fight(
            {
                what: guard,
                target: () => attackable(guard, 8),
                won: () =>
                    Inventory.contains(key) || GroundItems.query().name(key).within(8).nearest() !== null,
                protect: 'melee',
                guard: 400
            },
            log
        );
    }
    log(`could not get ${key} from ${guard}`);
    return false;
}

export async function unlockCell(key: string, door: Tile, stand: Tile, log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(stand, 1, log))) {
        return false;
    }
    const cell = Locs.query()
        .name('Cell Door')
        .action('Unlock')
        .where(l => l.tile().x === door.x && l.tile().z === door.z)
        .nearest();
    if (!cell) {
        log(`no Cell Door to Unlock at (${door.x},${door.z})`);
        return false;
    }
    const before = Inventory.count(key);
    if (!(await cell.interact('Unlock'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.count(key) < before, 8000);
}

const GODRIC_DOOR = new Tile(2832, 10078, 0);
const EADGAR_DOOR = new Tile(2832, 10082, 0);

// Why: freeing Godric is what advances the stage, and once it does `decide()` walks out to Dunstan, so anything optional has to happen before it — hence Eadgar first.
// Why: Eadgar is optional for this quest and required for Eadgar's Ruse, which is worth one pickpocket while standing here.

/** Free both prisoners, Eadgar before Godric. */
async function freePrisoners(freedEadgar: boolean, log: (m: string) => void): Promise<boolean> {
    if (!(await walkToStronghold(TILE.PRISON_LANDING, 4, log))) {
        return false;
    }
    if (!freedEadgar) {
        if (await stealCellKey('Berry', ITEM.CELL_KEY_2, TILE.EADGAR_CELL, log)) {
            if (!(await unlockCell(ITEM.CELL_KEY_2, EADGAR_DOOR, TILE.EADGAR_CELL, log))) {
                log("could not open Mad Eadgar's cell — carrying on to Godric");
            }
        } else {
            log('could not free Mad Eadgar — carrying on to Godric');
        }
    }
    if (!(await stealCellKey('Twig', ITEM.CELL_KEY_1, TILE.GODRIC_CELL, log))) {
        return false;
    }
    return unlockCell(ITEM.CELL_KEY_1, GODRIC_DOOR, TILE.GODRIC_CELL, log);
}

// decide

function custom(name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep {
    return { kind: 'custom', name, run };
}

export function decide(snap: QuestSnapshot): QuestStep {
    const stage = snap.progress?.stage ?? snap.stage;
    if (snap.journal === 'complete' || (stage ?? 0) >= TROLL_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (stage === undefined) {
        return { kind: 'wait', reason: 'Troll Stronghold journal stage unavailable' };
    }
    if (stage === TROLL_STAGE.NOT_STARTED && Quests.status('Death Plateau') !== 'complete') {
        return { kind: 'wait', reason: 'Death Plateau must be complete before Troll Stronghold' };
    }

    const zone = trollZone(snap.tile);

    if (stage === TROLL_STAGE.NOT_STARTED) {
        return prepare(snap) ?? { kind: 'talk', stop: DENULTH_START };
    }
    if (stage === TROLL_STAGE.STARTED) {
        return prepare(snap, zone) ?? custom('defeat Dad in the troll arena', fightDad);
    }
    if (stage === TROLL_STAGE.DEFEATED_DAD) {
        const prep = prepare(snap, zone);
        if (prep) {
            return prep;
        }
        return held(snap, ITEM.PRISON_KEY)
            ? custom('unlock the troll prison', enterPrison)
            : custom('kill a Troll General for the Prison key', huntGeneral);
    }
    if (stage === TROLL_STAGE.ENTERED_PRISON) {
        // A resume can land here from anywhere — a death sends the character to
        // Lumbridge, and the prison is unreachable without the boots on.
        const prep = prepare(snap, zone);
        if (prep) {
            return prep;
        }
        const freedEadgar = hasFlag(snap.progress, TROLL_FLAG.FREED_EADGAR);
        return custom(
            freedEadgar ? 'free Godric from his cell' : 'free Mad Eadgar and Godric from their cells',
            log => freePrisoners(freedEadgar, log)
        );
    }
    if (stage === TROLL_STAGE.FREED_GODRIC) {
        return { kind: 'talk', stop: DUNSTAN_FINISH };
    }
    return { kind: 'wait', reason: `unrecognized Troll Stronghold stage ${stage}` };
}

function warnTrollStrongholdReadiness(): string | null {
    const bits: string[] = [];
    const combat = Math.min(Skills.level('attack'), Skills.level('strength'), Skills.level('defence'));
    if (Skills.level('agility') < 15) {
        bits.push('Agility 15 is required for the secret-way rocks');
    }
    if (Skills.level('prayer') < 43) {
        bits.push('Protect from Melee (Prayer 43) turns Dad and the level-113 generals into a formality');
    }
    if (Skills.level('thieving') < 30) {
        bits.push('Thieving 30 steals the cell keys; below it both guards have to be killed');
    }
    if (combat < 50 || Skills.level('hitpoints') < 50) {
        bits.push(`combat looks light for a level-113 general (att/str/def≈${combat}, hp=${Skills.level('hitpoints')})`);
    }
    return bits.length > 0 ? `Troll Stronghold: ${bits.join('; ')}` : null;
}

export const trollstronghold: QuestModule = {
    record: QUESTS.find(r => r.id === 'troll')!,
    bank: FALADOR_WEST_BANK,
    grind: ['Dad', 'Troll General', 'Twig', 'Berry'],
    tools: [
        'coins',
        'climbing boots',
        'prison key',
        'cell key 1',
        'cell key 2',
        ...COMBAT_FOODS.map(f => f.toLowerCase())
    ],
    ownsInventory: true,
    readProgress: readTrollStrongholdProgress,
    sustain: { foods: foodNames(), eatBelowHp: 0.6 },
    coinFloat: COIN_FLOAT,
    warnReadiness: warnTrollStrongholdReadiness,
    decide
};
