import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Game } from '../../../../game/Game.js';
import { Equipment } from '../../../../equipment/Equipment.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
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
/** Only the walk; talkOziach picks the questions. */
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

// Why: oziach.rs2 lines 100/107/124/131/138 each move the quest on: the rune-plate chain sets %dragonquest = spoken_to_oziach, the first piece hands over melzarkey, the second sets %dragon_oracle, the third %dragon_goblin, the shield %dragon_shield.
// Why: none of those varps are client-readable and the journal can't be read with a dialogue open, so goals are judged on what he says, which is distinct per branch.
// Why: tracking clicked options looped, since his menus re-offer answered questions and the first and second map piece swap places.
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
    // decide() re-runs this step until the journal agrees, so a partial pass costs one more conversation.
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
    // gotoNpc would try to stand next to him; the bars block that, and the server answers the click from 3 tiles out on line of sight.
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
    // Enter from west stand; leave from east of the door tile.
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
    // #379: the room has no nav edge out, so open the door west before returning true and letting coinsShort/bank run.
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
        // Once you've been through, the door opens for nothing, so try it even with a charm missing.
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
    // Walk out now so the next decide (coins / Wormbrain) isn't planned from inside a sealed room.
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

// Why: gangplank and ladder are scripted teleports off the nav graph, and the gangplank only reaches the deck, so boarding falls through to the ladder.

/** Board the ship and drop into the hold. */
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
    // Why: locs read blank for about a tick after the teleport into the hold, and nothing on the ship is walkable, so wait the snapshot out.
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

/** Every leg that starts ashore walks off first; the gangplank and ladders are scripted teleports off the nav graph. */
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

// Why: one loc on the Crandor row serves both directions, matched by tile since every other wall down here is called "Wall" too.

/** Click the secret wall, from whichever side the bot is standing on. */
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

// Why: $entering is false from this row, so the server teleports you onto the wall's own tile.

/** Cross back into Crandor from the Karamja side. */
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
    // From this side it answers "nothing interesting happens" until %dragon_wall is set, and only the Crandor side can set it.
    log('the wall will not open from Karamja — it was never opened from Crandor, and there is no other way back in');
    return false;
}

// Why: the rock opening, pot hole and wall are scripted teleports off the nav graph, so each leg is one walk plus one interaction.

/** Every way into Crandor's dungeon, by where the bot is standing. */
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
    // Why: from anywhere else, including the Lumbridge respawn, the ship has crash-landed, so the wall is the only way in; the volcano pot hole and rope are on the nav graph.
    return crossSecretWall(log);
}

// Why: a death against Elvarg with the wall still shut strands the quest, since the ship crash-lands and the island has no boat.
// Why: the wall spawns angle 3 (m44_150.jm2), so check_axis_locactive reads "entering" as z == 9600, the Crandor row; from Karamja it answers "nothing interesting happens" until %dragon_wall is set.
// Why: opening it teleports you through, so coming back is half of this leg.

/** Open the Karamja wall from the Crandor side and come straight back. */
async function unlockShortcut(log: (m: string) => void): Promise<boolean> {
    const wall = DS_LOC.CRANDOR_SECRET_DOOR;
    const here = Game.tile();
    // Already through: walking back proves the shortcut is open, and it's the same walk a death makes later.
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
    // Landing on the Karamja row proves %dragon_wall took. The next pass walks back in.
    await Execution.delayUntil(() => (Game.tile()?.z ?? 9999) < wall.z, 8000);
    return false;
}

/** The lair gate is locked until the ship has sailed and isn't on the nav graph. */
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

// Why: Crandor has no bank and no boat after the kill, so the wall is the way home.
// Why: both gate leaves are angle 0, so check_axis_locactive reads the lair's own column as "entering" and the lock only guards the way in.

/** Get off the island once Elvarg is dead. */
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

/** Inventory, worn or bank. The quest is resumable from any of the three. */
function anywhere(snap: QuestSnapshot, id: number): boolean {
    return (snap.invIds?.get(id) ?? 0) > 0
        || (snap.bankIds?.get(id) ?? 0) > 0
        || (snap.wornIds?.has(id) ?? false);
}

const MAP_PIECES = [DS_ID.MAP_MELZAR, DS_ID.MAP_WORMBRAIN, DS_ID.MAP_ORACLE];

// Why: Wormbrain's 10k and Klarense's 2k must be in the pack before the dialogue opens; fetching them per leg lets the record ask for a single coin.

/** A step that fetches the coins one leg is about to spend, or null. */
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

// Why: Elvarg is level 83 with no bank on the island, and by now the shield is worn and the shopping spent, so the pack has the slots.
const ELVARG_FOOD = 18;

/** Port Sarim to Karamja is 30gp each way; this covers the round trip and slack. */
const KARAMJA_FARE = 100;

// Why: Crandor is one-way, so anything not aboard when the ship sails is out of reach; killElvarg can only report a missing shield.

/** The last preparation done ashore, or null when the pack is ready. */
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
    // Why: the shield is worn so its slot is free for food, and the 3-fish float is sized for walking between banks, which Crandor has none of.
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
        // The maze is one-way in; nothing else can start until the bot walks back out.
        if (inMaze(snap.tile) && anywhere(snap, DS_ID.MAP_MELZAR)) {
            return custom("walk out of Melzar's Maze", leaveMaze);
        }
        // Why: Oziach sets the 3 briefing flags and hands over the maze key across several branches, so this keeps returning until all are set.
        // Why: he won't re-issue the key, so scan and withdraw before calling it nowhere (#379).
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
        // Why: each piece sits behind a one-way trip, so the map comes first and in one pass; errands in between left the maze half-run.
        const banked = bankedPieces(snap);
        if (banked.length > 0 && !heldById(DS_ID.MAP)) {
            return { kind: 'withdraw', items: banked };
        }
        if (!anywhere(snap, DS_ID.MAP)) {
            if (!anywhere(snap, DS_ID.MAP_MELZAR)) {
                return custom("Melzar's Maze", log => maze.step(log));
            }
            if (!anywhere(snap, DS_ID.MAP_ORACLE)) {
                // Why: asking her sets dragon_oracle to 2 (prints the rhyme) and her door sets it to 3 (stops printing), so the journal flag can't gate this alone.
                // Why: the door eats the 4 charms, so holding them is the test.
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
        // Why: lady_lumbridge.rs2 inv_dels 1 plank and 4 nails per hole, so nails owed is 4 per plank still to place; against the hull's 12, a patched hole reads as 8 missing.
        // Why: carried planks set the count, so a spare in the bank can't inflate it back to a full hull.
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
        // Why: smithing is 18 slots of ore and wants the pack the map pieces and the Oracle's 4 charms were using, so it runs on the boat leg.
        if (nails < nailsNeeded) {
            const have = `${snap.invIds?.get(DS_ID.NAILS) ?? 0} carried / ${snap.bankIds?.get(DS_ID.NAILS) ?? 0} banked`;
            return custom(`smith ${nailsNeeded - nails} nails for ${planksWanted} plank${planksWanted === 1 ? '' : 's'}`
                + ` (${have}, bank ${snap.bankKnown ? 'seen' : 'UNSEEN'})`,
            log => smithNails(nailsNeeded - nails, log));
        }
        if (short.length > 0) {
            return { kind: 'withdraw', items: short.map(w => ({ name: w.name, qty: w.qty, id: w.id })) };
        }
        // Why: hiring Ned leaves no journal trace, so the repair, which the journal can confirm, gates it.
        if (!hasFlag(snap.progress, 'ship-repaired')) {
            return custom('patch the Lady Lumbridge', repairShip);
        }
        return { kind: 'talk', stop: NED_HIRE };
    }
    if (stage === DRAGON_STAGE.REPAIRED_SHIP) {
        // The patch leaves the bot a deck below where it boarded, off the nav graph.
        if (aboard(snap.tile)) {
            return custom('go ashore', leaveShip);
        }
        // Hire and hand-over are two dialogues: the first visit gets his promise, the second takes the map.
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
    // Why: off the island at this stage means she killed us; the re-stock includes boat fare since the navigator prunes Pay-fare crossings it can't afford.
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
    // Without the way back in, a death against Elvarg ends the run.
    if (!hasFlag(snap.progress, 'secret-passage') && !shortcutOpened) {
        return custom('open the secret passage out of Crandor', unlockShortcut);
    }
    return custom('kill Elvarg', killElvarg);
}

export const dragonslayer: QuestModule = {
    record: QUESTS.find(r => r.id === 'dragon')!,
    pray: { protect: 'melee', potions: 2 },
    // Port Sarim, Falador, Varrock, the wilderness, Karamja: no one bank is near enough to walk back to.
    bank: 'nearest',
    grind: ['Giant rat', 'Ghost', 'Skeleton', 'Zombie', 'Melzar the mad', 'Lesser demon', 'Elvarg'],
    // Why: the nails leg keeps coins, pickaxe, hammer and maze key and mines 18 slots of ore on top; 6 food made that 28 and every pickup failed silently.
    food: 3,
    tools: [
        'coins', 'maze key', 'key', 'map part', 'crandor map', 'plank', 'nails', 'hammer',
        'dragonfire shield', "wizard's mind bomb", 'unfired bowl', 'lobster pot', 'silk',
        // Food too: the maze, Crandor and the lair are one-way, with no bank trip from inside.
        'shark', 'lobster', 'swordfish', 'tuna', 'salmon', 'trout',
        ...SUPPLY_TOOLS
    ],
    sustain: { foods: ['Shark', 'Lobster', 'Swordfish', 'Tuna', 'Salmon', 'Trout'], eatBelowHp: 0.65 },
    // No coin float. Each spending leg fetches its own money; a restored balance would put a bank trip between purchases.
    coinFloat: 0,
    exit: leaveCrandor,
    readProgress: readDragonProgress,
    gather: SUPPLY_GATHERS,
    decide
};

export { SHIP_PRICE, WORMBRAIN_PRICE, inMaze };
