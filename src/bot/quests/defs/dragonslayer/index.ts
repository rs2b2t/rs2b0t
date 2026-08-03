import { EventSignal } from '../../../api/EventSignal.js';
import { Execution } from '../../../api/Execution.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Game } from '../../../api/Game.js';
import { Equipment } from '../../../api/hud/Equipment.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { Traversal } from '../../../api/Traversal.js';
import Tile from '../../../api/Tile.js';
import { hasFlag } from '../../engine/types.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { QUESTS } from '../../data/quests.js';
import { QuestFood } from '../../food.js';
import { gotoNpc, openDialogue, talkThrough, type NpcStop } from '../../exec/primitives.js';
import { DS_ID, DS_ITEM, DS_LOC, DS_NPC, SHIP_PRICE, SHIP_REPAIR, WORMBRAIN_PRICE } from './areas.js';
import { DRAGON_STAGE, describeJournal, readDragonProgress } from './journal.js';
import { MazeRun, heldById, inMaze, leaveMaze, lootChest, mazeSceneLoaded } from './maze.js';
import { SUPPLY_GATHERS, SUPPLY_TOOLS, smithNails } from './supplies.js';

const GUILDMASTER: NpcStop = {
    npc: 'Guild master', anchor: DS_NPC.GUILDMASTER, leash: 8,
    prefer: ['Do you know where I could get a Rune Plate mail body?']
};
/** Only the walk; the goal loop below decides what he is actually asked. */
const OZIACH: NpcStop = { npc: 'Oziach', anchor: DS_NPC.OZIACH, leash: 6, prefer: [] };

const DUKE: NpcStop = {
    npc: 'Duke Horacio', anchor: DS_NPC.DUKE, leash: 6,
    prefer: ["I seek a shield that will protect me from the dragon's breath."]
};
const ORACLE: NpcStop = {
    npc: 'Oracle', anchor: DS_NPC.ORACLE, leash: 6,
    prefer: ['I seek a piece of the map to the island of Crandor.']
};
const KLARENSE: NpcStop = {
    npc: 'Klarense', anchor: DS_NPC.KLARENSE, leash: 6,
    prefer: ["I don't suppose I could buy it?", 'Yep, sounds good.']
};
/** Hires Ned. He only takes the map on a second visit, once the hull is patched. */
const NED_HIRE: NpcStop = {
    npc: 'Ned', anchor: DS_NPC.NED, leash: 6,
    prefer: [
        "You're a sailor? Could you take me to the island of Crandor?",
        'So are you going to take me to Crandor Island now then?'
    ]
};
const NED_ABOARD: NpcStop = {
    npc: 'Ned', anchor: DS_NPC.NED_ABOARD, leash: 8,
    prefer: ['Yep lets go!']
};

const ORACLE_DOOR_ITEMS = [DS_ID.MIND_BOMB, DS_ID.UNFIRED_BOWL, DS_ID.LOBSTER_POT, DS_ID.SILK];

/**
 * Everything Oziach has to be asked, and how to tell he has answered.
 *
 * Exactly four branches move this quest on, and each one does it in a different
 * way — `oziach.rs2` lines 100/107/124/131/138:
 *
 *   the rune-plate chain   -> %dragonquest = spoken_to_oziach
 *   first piece            -> hands over melzarkey
 *   second piece           -> %dragon_oracle
 *   third piece            -> %dragon_goblin
 *   antidragon shield      -> %dragon_shield
 *
 * None of those varps are readable from the client, and the quest journal — the
 * one thing that reflects them — cannot be read while a dialogue is open. So the
 * goals are judged on what he SAYS, which is distinctive per branch and arrives
 * in the same tick as the varp. Tracking which options were clicked instead is
 * what looped: his menus re-offer questions already answered, so the first and
 * second map piece trade places forever and the conversation never ends.
 */
const OZIACH_OPENING: readonly string[] = [
    'Can you sell me some Rune plate mail?',
    "The guildmaster of the Champions' Guild told me.",
    'So how am I meant to prove that?',
    'A dragon, that sounds like fun!',
    'And will I need anything to defeat this dragon?'
];

const FIND_DRAGON = 'So where can I find this dragon?';
const FAREWELL = "Ok I'll try and get everything together.";

interface OziachGoal {
    readonly ask: string;
    /** A phrase only this branch's reply contains. */
    readonly heard: string;
}

export const OZIACH_GOALS: readonly OziachGoal[] = [
    { ask: 'Where is the first piece of the map?', heard: "melzar's maze" },
    { ask: 'Where is the second piece of the map?', heard: 'oracle on the ice mountain' },
    { ask: 'Where is the third piece of the map?', heard: 'goblins from the goblin village' },
    { ask: 'Where can I get an antidragon shield?', heard: 'duke of lumbridge castle' }
];

const flatten = (lines: string[]): string =>
    lines.join(' ').replace(/@[a-z0-9]{3}@/gi, ' ').replace(/[|\s]+/g, ' ').trim().toLowerCase();

const optionFor = (options: string[], want: string): string | undefined =>
    options.find(o => o.toLowerCase().includes(want.toLowerCase()));

/** Drives Oziach until every goal has been answered, then leaves. */
async function talkOziach(log: (m: string) => void): Promise<boolean> {
    if (!(await gotoNpc(OZIACH, [], log))) {
        return false;
    }
    if (!(await openDialogue(OZIACH.npc, log))) {
        return false;
    }
    const answered = new Set<string>();
    for (let i = 0; i < 200; i++) {
        if (EventSignal.pending()) {
            return false;
        }
        const options = ChatDialog.options();
        if (options.length === 0 && ChatDialog.isOpen()) {
            const said = flatten(ChatDialog.texts());
            for (const goal of OZIACH_GOALS) {
                if (said.includes(goal.heard) && !answered.has(goal.ask)) {
                    answered.add(goal.ask);
                    log(`Oziach answered: ${goal.ask}`);
                }
            }
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (options.length > 0) {
            const outstanding = OZIACH_GOALS.filter(g => !answered.has(g.ask));
            const pick =
                OZIACH_OPENING.map(o => optionFor(options, o)).find(o => o !== undefined)
                ?? outstanding.map(g => optionFor(options, g.ask)).find(o => o !== undefined)
                ?? (outstanding.length > 0 ? optionFor(options, FIND_DRAGON) : undefined)
                ?? optionFor(options, FAREWELL);
            if (!pick) {
                log(`nothing useful in [${options.join(' | ')}]`);
                return false;
            }
            await ChatDialog.chooseOption(pick);
            await Execution.delayTicks(2);
            continue;
        }
        if (!ChatDialog.isOpen()) {
            break;
        }
        await Execution.delayTicks(1);
    }
    // The journal is readable again now the dialogue has closed; decide() re-runs
    // this step until it agrees, so a partial pass costs one more conversation.
    return answered.size === OZIACH_GOALS.length;
}

const walk = (to: Tile, log: (m: string) => void, radius = 2): Promise<boolean> =>
    Traversal.walkResilient(to, { radius, attempts: 3, timeoutMs: 180_000, log });

const maze = new MazeRun();

/** Wormbrain is caged: the talk is an ap-op, taken from outside through the bars. */
async function buyMapFromWormbrain(log: (m: string) => void): Promise<boolean> {
    if (heldById(DS_ID.MAP_WORMBRAIN)) {
        return true;
    }
    if (Inventory.count('Coins') < WORMBRAIN_PRICE) {
        log(`Wormbrain wants ${WORMBRAIN_PRICE} coins and the pack is short`);
        return false;
    }
    if (!(await walk(DS_NPC.WORMBRAIN_STAND, log, 1))) {
        return false;
    }
    // gotoNpc would try to stand next to him; the bars make that impossible and
    // the server answers the click from three tiles out on line of sight alone.
    const ok = await talkThrough('Wormbrain', [
        "I believe you've got a piece of map that I need.",
        'I suppose I could pay you for the map piece',
        'Alright then, 10,000 it is.'
    ], log);
    if (!ok) {
        return false;
    }
    return Execution.delayUntil(() => heldById(DS_ID.MAP_WORMBRAIN), 6000);
}

/** Open the magic door (both ways). Stand west to enter, east to leave (#379). */
async function openOracleMagicDoor(log: (m: string) => void, wantEast: boolean): Promise<boolean> {
    if (!(await mazeSceneLoaded())) {
        return false;
    }
    const stand = wantEast ? DS_LOC.ORACLE_DOOR_STAND : new Tile(3051, 9840, 0);
    // Enter from west stand; leave from just east of the door tile.
    const leaveStand = new Tile(3052, 9840, 0);
    if (!(await walk(wantEast ? stand : leaveStand, log, 0))) {
        return false;
    }
    const door = Locs.query().name('Door').where(l => {
        const t = l.tile();
        return t.x === DS_LOC.ORACLE_DOOR.x && t.z === DS_LOC.ORACLE_DOOR.z;
    }).first();
    if (!door) {
        log('the magic door is not in the scene yet');
        return false;
    }
    log(wantEast ? 'opening the magic door with the four charms' : 'opening the magic door to leave the oracle chest room');
    if (!(await door.interact('Open'))) {
        return false;
    }
    return Execution.delayUntil(() => {
        const t = Game.tile();
        if (!t || t.z < 9800) {
            return false;
        }
        return wantEast ? t.x >= 3051 : t.x < 3051;
    }, 8000);
}

/** The Oracle's door eats a mind bomb, unfired bowl, lobster pot and silk. */
async function oracleChest(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    const pastDoor = here !== null && here.z >= 9800 && here.x >= 3051;
    // #379: after the piece is looted, the room has no nav edge out — open the
    // door west and only then return true so coinsShort/bank can run.
    if (heldById(DS_ID.MAP_ORACLE)) {
        if (pastDoor) {
            log('map piece in hand — leaving the oracle chest room');
            return openOracleMagicDoor(log, false);
        }
        return true;
    }
    if (!pastDoor) {
        if (!(await walk(DS_LOC.ORACLE_DOOR_STAND, log, 0))) {
            return false;
        }
        // Once it has been through, the door opens for nothing. Try it either
        // way rather than refusing on a charm the door already ate.
        if (!ORACLE_DOOR_ITEMS.every(id => Inventory.countById(id) > 0)) {
            log('not carrying all four charms — the door may already be open to me');
        }
        return openOracleMagicDoor(log, true);
    }
    if (!(await walk(DS_LOC.ORACLE_CHEST_STAND, log, 1)) || !(await mazeSceneLoaded())) {
        return false;
    }
    if (!(await lootChest(DS_ID.MAP_ORACLE, log))) {
        return false;
    }
    // Immediately walk out so the next decide (coins / Wormbrain) is not planned
    // from inside a sealed room.
    log('looted oracle map piece — leaving through the magic door');
    return openOracleMagicDoor(log, false);
}

async function combineMap(log: (m: string) => void): Promise<boolean> {
    const first = Inventory.items().find(i => i.id === DS_ID.MAP_MELZAR);
    const second = Inventory.items().find(i => i.id === DS_ID.MAP_WORMBRAIN);
    if (!first || !second) {
        return false;
    }
    log('joining the three map pieces');
    if (!(await first.useOn(second))) {
        return false;
    }
    return Execution.delayUntil(() => heldById(DS_ID.MAP), 8000);
}

/** True while below decks on the Lady Lumbridge, at any of its three holds. */
const inShipHold = (t: { x: number; z: number } | null | undefined): boolean =>
    !!t && t.x >= 3040 && t.x <= 3055 && t.z >= 9630 && t.z <= 9650;

/**
 * Boards the ship and drops into the hold. Both hops are scripted teleports, so
 * neither is on the navigation graph; the gangplank only reaches the deck, and
 * the caller wants the hold, so boarding falls straight through to the ladder.
 */
async function goBelowDecks(log: (m: string) => void, boarded = false): Promise<boolean> {
    const here = Game.tile();
    if (inShipHold(here)) {
        return true;
    }
    if (onDeck(here)) {
        const ladder = Locs.query().name('Ladder').action('Climb-down').within(6).nearest();
        if (!ladder) {
            log('no ladder down on deck yet');
            return false;
        }
        log('climbing down into the hold');
        if (!(await ladder.interact('Climb-down'))) {
            return false;
        }
        return Execution.delayUntil(() => inShipHold(Game.tile()), 8000);
    }
    if (boarded) {
        return false;
    }
    if (!(await walk(DS_LOC.GANGPLANK_STAND, log, 0)) || !(await mazeSceneLoaded())) {
        return false;
    }
    const plank = Locs.query().name('Gangplank').action('Cross').within(5).nearest();
    if (!plank) {
        log('no gangplank beside the dock');
        return false;
    }
    log('boarding the Lady Lumbridge');
    if (!(await plank.interact('Cross'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => onDeck(Game.tile()), 8000))) {
        return false;
    }
    await mazeSceneLoaded();
    return goBelowDecks(log, true);
}

/** Three planks, four nails each, driven in with a hammer. */
async function repairShip(log: (m: string) => void): Promise<boolean> {
    if (!(await goBelowDecks(log))) {
        return false;
    }
    await mazeSceneLoaded();
    const findHole = () => Locs.query().name('Hole').within(8).nearest();
    // The hold is reached by a scripted teleport, and locs read blank for about
    // a tick after any level change. Walking is not an option down here — none
    // of the ship is on the navigation graph — so wait the snapshot out.
    let hole = findHole();
    if (!hole) {
        await Execution.delayTicks(2);
        hole = findHole();
    }
    const plank = Inventory.items().find(i => i.id === DS_ID.PLANK);
    if (!hole) {
        log('no hole in the hold yet');
        return false;
    }
    if (!plank) {
        log('out of planks with the hull still open');
        return false;
    }
    const before = Inventory.countById(DS_ID.PLANK);
    log('patching a hole in the hull');
    if (!(await plank.useOn(hole))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(DS_ID.PLANK) < before, 10_000);
}

/** Ned waits on the top deck once he has the map; the hold ladder now goes there. */
async function boardForCrandor(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level >= 3) {
        return true;
    }
    return goBelowDecks(log);
}

const onDeck = (t: { x: number; z: number; level: number } | null | undefined): boolean =>
    !!t && t.level >= 1 && t.x >= 3044 && t.x <= 3052 && t.z >= 3204 && t.z <= 3212;

/** Anywhere aboard the Lady Lumbridge, deck or hold. */
const aboard = (t: { x: number; z: number; level: number } | null | undefined): boolean =>
    onDeck(t) || inShipHold(t);

/**
 * The ship is not on the navigation graph — its gangplank and ladders are all
 * scripted teleports — so every leg that starts ashore has to walk off first.
 */
async function leaveShip(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!aboard(here)) {
        return true;
    }
    if (inShipHold(here)) {
        const ladder = Locs.query().name('Ladder').action('Climb-up').within(6).nearest();
        if (!ladder) {
            log('no ladder up out of the hold');
            return false;
        }
        log('climbing out of the hold');
        if (!(await ladder.interact('Climb-up'))) {
            return false;
        }
        return Execution.delayUntil(() => onDeck(Game.tile()), 8000);
    }
    const plank = Locs.query().name('Gangplank').action('Cross').within(6).nearest();
    if (!plank) {
        log('no gangplank off the deck');
        return false;
    }
    log('going ashore');
    if (!(await plank.interact('Cross'))) {
        return false;
    }
    return Execution.delayUntil(() => !aboard(Game.tile()), 8000);
}

const inElvargLair = (t: { x: number; z: number } | null | undefined): boolean =>
    !!t && t.x >= 2847 && t.x <= 2863 && t.z >= 9628 && t.z <= 9646;

/** Crandor's dungeon, from the secret wall in the south to the lair. */
const inCrandorDungeon = (t: { x: number; z: number } | null | undefined): boolean =>
    !!t && t.x >= 2810 && t.x <= 2880 && t.z >= 9600 && t.z <= 9670;

/** The island itself. Ned lands the ship on (2851,3235); the rock opening is here. */
const onCrandorSurface = (t: { x: number; z: number } | null | undefined): boolean =>
    !!t && t.x >= 2810 && t.x <= 2880 && t.z >= 3225 && t.z <= 3300;

const onCrandor = (t: { x: number; z: number } | null | undefined): boolean =>
    inCrandorDungeon(t) || onCrandorSurface(t);

/** Set once the wall has been through-and-back, in case the journal read lags. */
let shortcutOpened = false;

/**
 * Clicks the secret wall, from whichever side the bot is standing on.
 *
 * There is one loc and it sits on the Crandor row; the Karamja side is a stand,
 * not a second door. Both directions therefore address the same tile — and it
 * has to be addressed by tile, because every other wall down here is called
 * "Wall" too.
 */
async function openWall(log: (m: string) => void): Promise<boolean> {
    const at = DS_LOC.CRANDOR_SECRET_DOOR;
    const leaf = Locs.query().name('Wall').action('Open').where(l => {
        const t = l.tile();
        return t.x === at.x && t.z === at.z && t.level === at.level;
    }).first();
    if (!leaf) {
        log('the secret wall is not in the scene');
        return false;
    }
    return leaf.interact('Open');
}

/**
 * Back into Crandor from the Karamja side. `$entering` is false from this row,
 * so the server teleports the player onto the wall's own tile rather than one
 * past it.
 */
async function crossSecretWall(log: (m: string) => void): Promise<boolean> {
    if (!(await walk(DS_LOC.SECRET_WALL_KARAMJA_STAND, log, 0)) || !(await mazeSceneLoaded())) {
        return false;
    }
    log('back through the secret wall into Crandor');
    if (!(await openWall(log))) {
        return false;
    }
    if (await Execution.delayUntil(() => inCrandorDungeon(Game.tile()), 8000)) {
        return true;
    }
    // From this side it answers "nothing interesting happens" until %dragon_wall
    // is set, and only the Crandor side can set it. There is no other crossing.
    log('the wall will not open from Karamja — it was never opened from Crandor, and there is no other way back in');
    return false;
}

/**
 * Every way into Crandor's dungeon, by where the bot is standing.
 *
 * None of these hops are on the navigation graph — the rock opening, the pot
 * hole and the wall are all scripted teleports — but everything between them is,
 * so each leg is a walk the pathfinder can do plus one interaction.
 */
async function descendCrandor(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!here) {
        return false;
    }
    if (inCrandorDungeon(here)) {
        return true;
    }
    if (onCrandorSurface(here)) {
        if (!(await walk(DS_LOC.CRANDOR_ROCK, log, 1)) || !(await mazeSceneLoaded())) {
            return false;
        }
        const opening = Locs.query().name('Rock opening').action('Climb-down').within(5).nearest();
        if (!opening) {
            log('no rock opening in reach');
            return false;
        }
        log('climbing down into Crandor');
        if (!(await opening.interact('Climb-down'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => (Game.tile()?.z ?? 0) >= 9000, 8000))) {
            return false;
        }
        return mazeSceneLoaded();
    }
    // Everywhere else, including the Lumbridge respawn after a death. The ship
    // crash-landed and is not coming back, so the only way in is the wall — and
    // the walk to the far side of it is now one leg, because Karamja's volcano
    // pot hole and rope are both on the navigation graph.
    return crossSecretWall(log);
}

/**
 * Opens the Karamja wall from the Crandor side, and comes straight back.
 *
 * This is the only second crossing that exists. Ned's ship crash-lands here, so
 * a death against Elvarg with the wall still shut leaves the quest at a stage it
 * can never advance — the lair is on an island with no boat.
 *
 * The spawn is angle 3, south (m44_150.jm2), so `check_axis_locactive` reads
 * "entering" as z == 9600 — the Crandor row. That is the side allowed to open it
 * before the quest completes; from the Karamja row it answers "nothing
 * interesting happens" until %dragon_wall is already set. Opening it teleports
 * the player through, which is why coming back is half of this leg.
 */
async function unlockShortcut(log: (m: string) => void): Promise<boolean> {
    const wall = DS_LOC.CRANDOR_SECRET_DOOR;
    const here = Game.tile();
    // Already through it: coming back is what proves the shortcut is open, and
    // it is the same walk a death will make later.
    if (here && here.z >= 9000 && !inCrandorDungeon(here)) {
        shortcutOpened = await crossSecretWall(log);
        return shortcutOpened;
    }
    if (!(await descendCrandor(log))) {
        return false;
    }
    if (!(await walk(wall, log, 0)) || !(await mazeSceneLoaded())) {
        return false;
    }
    log('opening the secret wall so there is a way back in');
    if (!(await openWall(log))) {
        return false;
    }
    // It teleports the player through; landing on the Karamja row is the proof
    // that %dragon_wall took. The next pass walks back in.
    await Execution.delayUntil(() => (Game.tile()?.z ?? 9999) < wall.z, 8000);
    return false;
}

/**
 * Crandor's dungeon connects to the lair through a gate that is locked until the
 * ship has sailed. It is not on the navigation graph either.
 */
async function reachElvarg(log: (m: string) => void): Promise<boolean> {
    if (inElvargLair(Game.tile())) {
        return true;
    }
    if (!(await descendCrandor(log))) {
        return false;
    }
    if (!(await walk(DS_LOC.ELVARG_GATE_STAND, log, 0)) || !(await mazeSceneLoaded())) {
        return false;
    }
    const gate = Locs.query().name('Gate').action('Open').within(4).nearest();
    if (!gate) {
        log('no gate into the lair in reach');
        return false;
    }
    log('opening the lair gate');
    if (!(await gate.interact('Open'))) {
        return false;
    }
    return Execution.delayUntil(() => inElvargLair(Game.tile()), 8000);
}

async function killElvarg(log: (m: string) => void): Promise<boolean> {
    // Her breath maxes 70 without the shield and 10 with it worn.
    if (!Equipment.contains(DS_ITEM.SHIELD)) {
        if (!Inventory.contains(DS_ITEM.SHIELD)) {
            log('no anti-dragonbreath shield — she will burn straight through');
            return false;
        }
        log('wearing the shield before going in');
        await Equipment.equip(DS_ITEM.SHIELD);
        return false;
    }
    if (!(await reachElvarg(log))) {
        return false;
    }
    if (Game.inCombat()) {
        await Execution.delayTicks(2);
        return false;
    }
    const elvarg = Npcs.query().name('Elvarg').action('Attack').within(16).nearest();
    if (!elvarg) {
        log('no Elvarg in the lair yet');
        await Execution.delayTicks(3);
        return false;
    }
    log('attacking Elvarg');
    if (!(await elvarg.interact('Attack'))) {
        return false;
    }
    await Execution.delayUntil(() => Game.inCombat() || !elvarg.valid(), 4000);
    return false;
}

/**
 * Off the island once Elvarg is dead.
 *
 * Crandor has no bank, and after the kill it has no boat either — Ned's ship
 * crash-landed getting here. A run that simply stopped would leave the character
 * standing in the lair of the thing it just killed, on an island, until
 * something wandered in. The gate always opens from the inside (both leaves are
 * angle 0, so `check_axis_locactive` reads the lair's own column as "entering",
 * and the lock only guards the way in), and the wall is the way home.
 */
async function leaveCrandor(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!here || !onCrandor(here)) {
        return true;
    }
    if (inElvargLair(here)) {
        if (!(await walk(DS_LOC.ELVARG_GATE_INSIDE, log, 0)) || !(await mazeSceneLoaded())) {
            return false;
        }
        const gate = Locs.query().name('Gate').action('Open').within(4).nearest();
        if (!gate) {
            log('no gate out of the lair');
            return false;
        }
        log('letting myself out of the lair');
        if (!(await gate.interact('Open'))) {
            return false;
        }
        return Execution.delayUntil(() => !inElvargLair(Game.tile()), 8000);
    }
    if (onCrandorSurface(here)) {
        return descendCrandor(log);
    }
    if (!(await walk(DS_LOC.CRANDOR_SECRET_DOOR, log, 0)) || !(await mazeSceneLoaded())) {
        return false;
    }
    log('leaving Crandor through the secret wall');
    if (!(await openWall(log))) {
        return false;
    }
    return Execution.delayUntil(() => !onCrandor(Game.tile()), 8000);
}

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

/** Where an item is, for logs that have to explain a decision. */
function where(snap: QuestSnapshot, id: number): 'carried' | 'worn' | 'banked' | 'nowhere' {
    if ((snap.invIds?.get(id) ?? 0) > 0) return 'carried';
    if (snap.wornIds?.has(id)) return 'worn';
    if ((snap.bankIds?.get(id) ?? 0) > 0) return 'banked';
    return 'nowhere';
}

/** Inventory, worn or bank — the quest is resumable from any of the three. */
function anywhere(snap: QuestSnapshot, id: number): boolean {
    return (snap.invIds?.get(id) ?? 0) > 0
        || (snap.bankIds?.get(id) ?? 0) > 0
        || (snap.wornIds?.has(id) ?? false);
}

const MAP_PIECES = [DS_ID.MAP_MELZAR, DS_ID.MAP_WORMBRAIN, DS_ID.MAP_ORACLE];

/**
 * The two big spends are Wormbrain's 10k and Klarense's 2k, and both must be in
 * the pack before the dialogue opens. Fetching them here, once each, is what
 * lets the record ask for a single coin — see the comment on that requirement.
 */
function coinsShort(snap: QuestSnapshot, price: number): QuestStep | null {
    const held = snap.inv.get('coins') ?? 0;
    if (held >= price) {
        return null;
    }
    return { kind: 'withdraw', items: [{ name: 'Coins', qty: price + 1000 - held }] };
}


/** A piece left in the bank reads to the journal as never found; fetch it back. */
function bankedPieces(snap: QuestSnapshot): { name: string; qty: number; id: number }[] {
    const want = [...MAP_PIECES, DS_ID.MAP].filter(id => (snap.bankIds?.get(id) ?? 0) > 0 && (snap.invIds?.get(id) ?? 0) === 0);
    return want.map(id => ({ name: id === DS_ID.MAP ? DS_ITEM.MAP : DS_ITEM.MAP_PART, qty: 1, id }));
}

/**
 * How much food sails to Crandor. Elvarg is level 83 and there is no bank on the
 * island; the shield is worn by the time this is drawn and the shopping has all
 * been spent, so a pack this full still has slots to spare.
 */
const ELVARG_FOOD = 18;

/** Port Sarim to Karamja is 30gp each way; this covers the round trip and slack. */
const KARAMJA_FARE = 100;

/**
 * The last thing done ashore. Crandor is one-way: whatever is not aboard when
 * the ship sails is an ocean away for the rest of the quest, and `killElvarg`
 * cannot fetch a shield out of a bank in Falador — it can only keep reporting it
 * missing, on an island with no way back.
 */
function gearUp(snap: QuestSnapshot): QuestStep | null {
    if (!snap.wornIds?.has(DS_ID.SHIELD)) {
        if ((snap.invIds?.get(DS_ID.SHIELD) ?? 0) > 0) {
            return { kind: 'equip', item: DS_ITEM.SHIELD };
        }
        if ((snap.bankIds?.get(DS_ID.SHIELD) ?? 0) > 0) {
            return { kind: 'withdraw', items: [{ name: DS_ITEM.SHIELD, qty: 1, id: DS_ID.SHIELD }] };
        }
        return { kind: 'talk', stop: DUKE };
    }
    // Worn, so the slot it was taking is free: fill the pack with lunch. The
    // three-fish provisioning float is sized for walking between banks, and
    // there is no bank on Crandor.
    const food = QuestFood.name;
    if (food) {
        const want = Math.min(ELVARG_FOOD - (snap.inv.get(food.toLowerCase()) ?? 0), snap.bank?.get(food.toLowerCase()) ?? 0);
        if (want > 0) {
            return { kind: 'withdraw', items: [{ name: food, qty: want }] };
        }
    }
    return null;
}

export function decide(snap: QuestSnapshot): QuestStep {
    const stage = snap.progress?.stage;
    if (snap.journal === 'complete' || stage === DRAGON_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (stage === undefined) {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (stage === DRAGON_STAGE.NOT_STARTED) {
        return { kind: 'talk', stop: GUILDMASTER };
    }
    if (stage === DRAGON_STAGE.SPOKEN_GUILDMASTER) {
        return custom('talk to Oziach', talkOziach);
    }

    if (stage === DRAGON_STAGE.SPOKEN_OZIACH) {
        if (aboard(snap.tile)) {
            return custom('go ashore', leaveShip);
        }
        // The maze is one-way in; with the piece in hand nothing else can start
        // until the bot has walked itself back out.
        if (inMaze(snap.tile) && anywhere(snap, DS_ID.MAP_MELZAR)) {
            return custom("walk out of Melzar's Maze", leaveMaze);
        }
        // Oziach sets the three briefing flags and hands over the maze key across
        // several dialogue branches, so keep returning until they are all set.
        // #379: a banked (or unseen-bank) key must not thrash Oziach — he will not
        // re-issue it. Scan/withdraw first; only treat truly missing as nowhere.
        const key = where(snap, DS_ID.MAZE_KEY);
        if (hasFlag(snap.progress, 'needs-briefing')) {
            return custom(`get the briefing from Oziach — ${describeJournal()} mazekey=${key}`, talkOziach);
        }
        if (key === 'banked') {
            return {
                kind: 'withdraw',
                items: [{ name: DS_ITEM.MAZE_KEY, qty: 1, id: DS_ID.MAZE_KEY }]
            };
        }
        if (key === 'nowhere' && !snap.bankKnown) {
            return { kind: 'scanBank' };
        }
        if (key === 'nowhere') {
            return custom(`get the briefing from Oziach — ${describeJournal()} mazekey=${key}`, talkOziach);
        }
        // The map comes first and in one pass. Each piece sits behind a one-way
        // trip, and it was the errands in between — the Duke upstairs in
        // Lumbridge, the anvil at the bottom of the Dwarven Mine — that left the
        // maze half-run and the route reading from the wrong dungeon.
        const banked = bankedPieces(snap);
        if (banked.length > 0 && !heldById(DS_ID.MAP)) {
            return { kind: 'withdraw', items: banked };
        }
        if (!anywhere(snap, DS_ID.MAP)) {
            if (!anywhere(snap, DS_ID.MAP_MELZAR)) {
                return custom("Melzar's Maze", log => maze.step(log));
            }
            if (!anywhere(snap, DS_ID.MAP_ORACLE)) {
                // Asking her sets dragon_oracle to 2, which is what prints the
                // rhyme; going through her door sets it to 3, which stops
                // printing it. The journal flag therefore goes out again the
                // moment the door is used, and cannot gate this on its own.
                // Holding all four charms is the honest test: the door eats them.
                const holdsCharms = ORACLE_DOOR_ITEMS.every(id => (snap.invIds?.get(id) ?? 0) > 0);
                if (holdsCharms && !hasFlag(snap.progress, 'asked-oracle')) {
                    return { kind: 'talk', stop: ORACLE };
                }
                return custom('the chest under Ice Mountain', oracleChest);
            }
            if (!anywhere(snap, DS_ID.MAP_WORMBRAIN)) {
                const short = coinsShort(snap, WORMBRAIN_PRICE);
                if (short) {
                    return short;
                }
                return custom('buy the map piece from Wormbrain', buyMapFromWormbrain);
            }
            return custom('join the map pieces', combineMap);
        }
        // Then the shield, on the way past Lumbridge to the docks.
        if (!hasFlag(snap.progress, 'has-shield') && !anywhere(snap, DS_ID.SHIELD)) {
            return { kind: 'talk', stop: DUKE };
        }
        const forShip = coinsShort(snap, SHIP_PRICE);
        if (forShip) {
            return forShip;
        }
        return { kind: 'talk', stop: KLARENSE };
    }

    if (stage === DRAGON_STAGE.BOUGHT_SHIP) {
        // A hole takes one plank and four nails together — lady_lumbridge.rs2
        // inv_dels both — so what is owed is four nails per plank still to be
        // placed, and never the twelve the whole hull costs. Measured against the
        // total, the first patched hole reads as eight missing nails and the bot
        // walks back to the Dwarven Mine with the hull still open.
        //
        // The pack is the ruler, not the bank: once a plank is carried it is one
        // hole's worth of work, and a spare left in the bank must not inflate the
        // count back to a full hull.
        const planksHeld = snap.invIds?.get(DS_ID.PLANK) ?? 0;
        const planksWanted = planksHeld > 0 ? planksHeld : SHIP_REPAIR.planks;
        const nailsNeeded = planksWanted * SHIP_REPAIR.nailsPerPlank;
        const nails = (snap.invIds?.get(DS_ID.NAILS) ?? 0) + (snap.bankIds?.get(DS_ID.NAILS) ?? 0);
        const short = [
            { id: DS_ID.NAILS, name: DS_ITEM.NAILS, qty: nailsNeeded },
            { id: DS_ID.PLANK, name: DS_ITEM.PLANK, qty: planksWanted },
            { id: DS_ID.HAMMER, name: DS_ITEM.HAMMER, qty: 1 }
        ].filter(w => (snap.invIds?.get(w.id) ?? 0) < w.qty && (snap.bankIds?.get(w.id) ?? 0) > 0);
        if ((nails < nailsNeeded || short.length > 0) && aboard(snap.tile)) {
            return custom('go ashore', leaveShip);
        }
        // Smithing belongs to the boat, not to the shopping: it is eighteen slots
        // of ore, and it wants the pack the map pieces and the Oracle's four
        // charms were using.
        if (nails < nailsNeeded) {
            const have = `${snap.invIds?.get(DS_ID.NAILS) ?? 0} carried / ${snap.bankIds?.get(DS_ID.NAILS) ?? 0} banked`;
            return custom(`smith ${nailsNeeded - nails} nails for ${planksWanted} plank${planksWanted === 1 ? '' : 's'}`
                + ` (${have}, bank ${snap.bankKnown ? 'seen' : 'UNSEEN'})`,
            log => smithNails(nailsNeeded - nails, log));
        }
        if (short.length > 0) {
            return { kind: 'withdraw', items: short.map(w => ({ name: w.name, qty: w.qty, id: w.id })) };
        }
        // Hiring Ned leaves no journal trace, so it is done first and the repair
        // is what the journal can actually confirm.
        if (!hasFlag(snap.progress, 'ship-repaired')) {
            return custom('patch the Lady Lumbridge', repairShip);
        }
        return { kind: 'talk', stop: NED_HIRE };
    }
    if (stage === DRAGON_STAGE.REPAIRED_SHIP) {
        // The patch leaves the bot a deck below where it boarded, and nothing on
        // the ship is on the navigation graph.
        if (aboard(snap.tile)) {
            return custom('go ashore', leaveShip);
        }
        // Hire and hand-over are two separate dialogues with the same NPC: the
        // first visit only gets his promise, the second takes the map.
        return { kind: 'talk', stop: NED_HIRE };
    }
    if (stage === DRAGON_STAGE.NED_GIVEN_MAP) {
        const here = snap.tile;
        if (here && here.level >= 3) {
            return { kind: 'talk', stop: NED_ABOARD };
        }
        if (!aboard(here)) {
            const gear = gearUp(snap);
            if (gear) {
                return gear;
            }
        }
        return custom('board the Lady Lumbridge', boardForCrandor);
    }
    // Off the island at this stage means one thing: she killed us, and the kit
    // is on the floor of her lair. Re-equip and re-stock at the bank before
    // walking back, including the boat fare — the navigator prunes Pay-fare
    // crossings it cannot afford and then calls Karamja unreachable.
    if (!onCrandor(snap.tile)) {
        const gear = gearUp(snap);
        if (gear) {
            return gear;
        }
        const fare = coinsShort(snap, KARAMJA_FARE);
        if (fare) {
            return fare;
        }
    }
    // The way back in is worth the two minutes it costs here: without it a death
    // against Elvarg is the end of the run.
    if (!hasFlag(snap.progress, 'secret-passage') && !shortcutOpened) {
        return custom('open the secret passage out of Crandor', unlockShortcut);
    }
    return custom('kill Elvarg', killElvarg);
}

export const dragonslayer: QuestModule = {
    record: QUESTS.find(r => r.id === 'dragon')!,
    // Port Sarim, Falador, Varrock, the wilderness, Karamja: no one bank is near
    // enough to this quest to be worth walking back to.
    bank: 'nearest',
    grind: ['Giant rat', 'Ghost', 'Skeleton', 'Zombie', 'Melzar the mad', 'Lesser demon', 'Elvarg'],
    // Three, because the nails leg is the tightest the pack ever gets: it keeps
    // coins, pickaxe, hammer and the maze key, then mines eighteen slots of ore
    // on top. Six lunches made that exactly twenty-eight, and at exactly
    // twenty-eight every pickup and every purchase fails silently.
    food: 3,
    tools: [
        'coins', 'maze key', 'key', 'map part', 'crandor map', 'plank', 'nails', 'hammer',
        'dragonfire shield', "wizard's mind bomb", 'unfired bowl', 'lobster pot', 'silk',
        // Food too: the maze, Crandor and the lair are all one-way, and a trip
        // back to a bank to re-stock is not always available from inside them.
        'shark', 'lobster', 'swordfish', 'tuna', 'salmon', 'trout',
        ...SUPPLY_TOOLS
    ],
    sustain: { foods: ['Shark', 'Lobster', 'Swordfish', 'Tuna', 'Salmon', 'Trout'], eatBelowHp: 0.65 },
    // No standing coin float. Every leg that spends fetches its own money, and a
    // balance the engine restores each loop puts a bank trip between purchases.
    coinFloat: 0,
    exit: leaveCrandor,
    readProgress: readDragonProgress,
    gather: SUPPLY_GATHERS,
    decide
};

export { SHIP_PRICE, WORMBRAIN_PRICE, inMaze };
