// docs/QUESTS.md
import { actions, reader } from '../../../../adapter/ClientAdapter.js';
import Tile from '../../../../geometry/Tile.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import { GroundItems } from '../../../grounditems/GroundItems.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../locs/Locs.js';
import { Quests } from '../../../ui/questlog/Quests.js';
import { Traversal } from '../../../walking/Traversal.js';
import { QUESTS } from '../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { isUnderground, talkStrict, walkWithHops, type LadderHop, type NpcStop } from '../exec/primitives.js';
import { heldId, settleScene, useOnLoc } from '../exec/prompts.js';

const QUEST = "Monk's Friend";

/** `%drunkmonkquest`. 50 (given water) and 60 (fixing cart) render one journal page, so they share a name. */
export const MF_STAGE = {
    NOT_STARTED: 0,
    SPOKEN_TO_OMAD: 10,
    RETRIEVED_BLANKET: 20,
    LOOKING_CEDRIC: 30,
    FINDING_WATER: 40,
    MENDING_CART: 50,
    FIXED_CART: 70,
    COMPLETE: 80
} as const;

export const BLANKET_OBJ = 90;
const JUG_OBJ = 1935;
const JUG_WATER_OBJ = 1937;
/** `sink2` stands eight tiles off at (2608,3187) and shares the display name. */
const SINK_LOC = 873;

const BLANKET = "Child's blanket";
const JUG = 'Jug';
const JUG_WATER = 'Jug of water';
const LOGS = 'Logs';

// Why: "axe" alone also matches battleaxe and pickaxe, and neither chops.
const AXES = ['Rune axe', 'Adamant axe', 'Mithril axe', 'Black axe', 'Steel axe', 'Iron axe', 'Bronze axe'];

const ARDOUGNE_BANK = new Tile(2655, 3283, 0);

// Why: the ladder is `loc_add`ed by the `blanket_ladder` timer once the player stands within two tiles, so the stand is a neighbour of the ladder's own tile rather than a spot the baked graph knows.
const RING_STAND = new Tile(2562, 3222, 0);
const CAVE_FOOT = new Tile(2561, 9621, 0);
const CAVE_LADDER = new Tile(2561, 9622, 0);
const BLANKET_SPAWN = new Tile(2570, 9604, 0);

const SINK = new Tile(2610, 3195, 0);
const TREE = new Tile(2613, 3252, 0);
const KHAZARD_SHOP = { npc: 'Shop keeper', anchor: new Tile(2641, 3171, 0) };
const ARDOUGNE_SHOP = { npc: 'Kortan', anchor: new Tile(2615, 3292, 0) };

// Why: `ladder_cellar` stands five tiles away at (2566,3227) and also offers Climb-down, and `hopLadder` keeps it out by requiring the loc within three tiles of the stand.
const HOPS: LadderHop[] = [
    { stand: RING_STAND, locName: 'Ladder', op: 'Climb-down', arrive: CAVE_FOOT },
    { stand: CAVE_LADDER, locName: 'Ladder', op: 'Climb-up', arrive: new Tile(2561, 3222, 0) }
];

function omad(prefer: string[]): NpcStop {
    return { npc: 'Brother Omad', anchor: new Tile(2604, 3209, 0), leash: 6, prefer };
}

const CEDRIC: NpcStop = {
    npc: 'Brother Cedric',
    anchor: new Tile(2614, 3259, 0),
    leash: 8,
    prefer: ["Yes, I'd be happy to!"]
};

const START = omad(["Why can't you sleep, what's wrong?", 'Can I help at all?']);
const HAND_IN_BLANKET = omad([]);
const ASK_FOR_CEDRIC = omad(["Who's Brother Cedric?", 'Where should I look?']);

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: every page from stage 20 on repeats the blanket line, so the newest marker has to be tested first.
const JOURNAL_MARKERS: [string, number][] = [
    ['quest complete!', MF_STAGE.COMPLETE],
    ['he is on the way', MF_STAGE.FIXED_CART],
    ['he needs some wood for his cart', MF_STAGE.MENDING_CART],
    ['i need to take him a jug of water', MF_STAGE.FINDING_WATER],
    ['i agreed to find brother cedric', MF_STAGE.LOOKING_CEDRIC],
    ['i found the secret cave and gave back the blanket', MF_STAGE.RETRIEVED_BLANKET],
    ['i need to find a secret cave', MF_STAGE.SPOKEN_TO_OMAD],
    ['i can start this quest by speaking to brother omad', MF_STAGE.NOT_STARTED]
];

export function parseMonksFriendJournal(lines: readonly string[] | string): number | undefined {
    const text = normalize(lines);
    for (const [marker, stage] of JOURNAL_MARKERS) {
        if (text.includes(marker)) {
            return stage;
        }
    }
    return undefined;
}

export async function readMonksFriendStage(): Promise<number | undefined> {
    const status = Quests.status(QUEST);
    if (status === 'complete') return MF_STAGE.COMPLETE;
    if (status === 'notStarted') return MF_STAGE.NOT_STARTED;
    if (status !== 'inProgress') return undefined;
    const stage = parseMonksFriendJournal(await Quests.journal(QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return stage;
}

function inCave(tile: { x: number; z: number } | null | undefined): boolean {
    return tile !== null && tile !== undefined && isUnderground(tile) && tile.x >= 2555 && tile.x <= 2580;
}

/** The timer adds the ladder the tick after the player is within two tiles, so it is never in the scene on arrival. */
async function enterCave(log: (m: string) => void): Promise<boolean> {
    if (inCave(Game.tile())) {
        return true;
    }
    if (!(await Traversal.walkResilient(RING_STAND, { radius: 1, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    const ladder = (): Loc | null =>
        Locs.query().name('Ladder').action('Climb-down').where(l => l.tile().distanceTo(RING_STAND) <= 3).nearest();
    if (!(await Execution.delayUntil(() => ladder() !== null, 15_000))) {
        log('monksfriend: no hidden ladder appeared inside the ring of stones');
        return false;
    }
    const found = ladder();
    if (!found || !(await found.interact('Climb-down'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => inCave(Game.tile()), 10_000))) {
        return false;
    }
    await settleScene();
    return true;
}

async function leaveCave(log: (m: string) => void): Promise<boolean> {
    if (!inCave(Game.tile())) {
        return true;
    }
    if (!(await Traversal.walkResilient(CAVE_LADDER, { radius: 1, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    const ladder = Locs.query().name('Ladder').action('Climb-up').within(4).nearest();
    if (!ladder || !(await ladder.interact('Climb-up'))) {
        log(`monksfriend: no way out of the cave at (${CAVE_LADDER.x},${CAVE_LADDER.z})`);
        return false;
    }
    if (!(await Execution.delayUntil(() => !inCave(Game.tile()), 10_000))) {
        return false;
    }
    await settleScene();
    return true;
}

async function fetchBlanket(log: (m: string) => void): Promise<boolean> {
    if (heldId(BLANKET_OBJ) > 0) {
        return leaveCave(log);
    }
    if (!(await enterCave(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(BLANKET_SPAWN, { radius: 1, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    const blanket = GroundItems.query().where(g => g.id === BLANKET_OBJ).within(8).nearest();
    if (!blanket) {
        log(`monksfriend: no ${BLANKET} on the floor at (${BLANKET_SPAWN.x},${BLANKET_SPAWN.z})`);
        return false;
    }
    if (!(await blanket.interact('Take'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => heldId(BLANKET_OBJ) > 0, 8000))) {
        return false;
    }
    return leaveCave(log);
}

// Why: a regular tree drops one log and turns to a stump, and at 600ms ticks a `pickLoc` step's eight-second wait is short enough to lose the race.
async function chopLogs(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(LOGS)) {
        return true;
    }
    if (!(await walkWithHops(TREE, 2, HOPS, log))) {
        return false;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
        const tree = Locs.query().name('Tree').action('Chop down').within(8).nearest();
        if (!tree) {
            log(`monksfriend: no standing tree near (${TREE.x},${TREE.z})`);
            return false;
        }
        if (!(await tree.interact('Chop down'))) {
            return false;
        }
        if (await Execution.delayUntil(() => Inventory.contains(LOGS), 30_000)) {
            return true;
        }
    }
    log('monksfriend: three trees chopped without a log landing');
    return false;
}

// Why: a `useOn` step clicks as soon as the walk returns, and from the sink that lands inside the arrive window and is dropped — every attempt that walked first burned its ten-second wait, while a retry from a standstill filled the jug in 295ms.
function fillJug(log: (m: string) => void): Promise<boolean> {
    return useOnLoc(
        JUG_OBJ,
        { name: 'Sink', near: SINK, id: SINK_LOC, within: 4 },
        [],
        () => heldId(JUG_WATER_OBJ) > 0,
        log
    );
}

// Why: the party is ~23 ticks of `p_delay` and `%drunkmonkquest` only moves in the `drunkmonk_complete` queue, so returning at the end of the dialogue would re-enter `omad_party`.
async function throwParty(log: (m: string) => void): Promise<boolean> {
    if (!(await leaveCave(log))) {
        return false;
    }
    if (!(await walkWithHops(START.anchor, 1, HOPS, log))) {
        return false;
    }
    if (!(await talkStrict('Brother Omad', [], log))) {
        return false;
    }
    log('monksfriend: dancing with the monks — waiting for the quest list to turn green');
    return Execution.delayUntil(() => Quests.status(QUEST) === 'complete', 60_000);
}

function bankedAxe(snap: QuestSnapshot): string | null {
    return AXES.find(axe => (snap.bank?.get(axe.toLowerCase()) ?? 0) > 0) ?? null;
}

function heldAxe(snap: QuestSnapshot): boolean {
    return AXES.some(axe => (snap.inv.get(axe.toLowerCase()) ?? 0) > 0);
}

/** Bank first, then Port Khazard's general store, then the guardhouse sink. */
export function gatherWater(snap: QuestSnapshot): QuestStep {
    if ((snap.inv.get(JUG.toLowerCase()) ?? 0) > 0) {
        return { kind: 'custom', name: 'fill the jug at the guardhouse sink', run: fillJug };
    }
    if (snap.bankKnown !== true) {
        return { kind: 'scanBank' };
    }
    for (const name of [JUG_WATER, JUG]) {
        if ((snap.bank?.get(name.toLowerCase()) ?? 0) > 0) {
            return { kind: 'withdraw', items: [{ name, qty: 1 }] };
        }
    }
    return { kind: 'buy', item: JUG, qty: 1, shop: KHAZARD_SHOP, estGp: 100 };
}

/** Bank first, then Aemad's Adventuring Supplies, then a tree in Cedric's own forest. */
export function gatherLogs(snap: QuestSnapshot): QuestStep {
    if (heldAxe(snap)) {
        return { kind: 'custom', name: 'chop logs for the cart', run: chopLogs };
    }
    if (snap.bankKnown !== true) {
        return { kind: 'scanBank' };
    }
    const banked = bankedAxe(snap);
    if (banked) {
        return { kind: 'withdraw', items: [{ name: banked, qty: 1 }] };
    }
    return { kind: 'buy', item: 'Iron axe', qty: 1, shop: ARDOUGNE_SHOP, estGp: 200 };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    const stage = snap.stage;
    if (stage === undefined) {
        return { kind: 'wait', reason: "Monk's Friend journal stage unavailable" };
    }
    // Why: at stage 10 the journal still reads "find the secret cave" whether or not the blanket is in the pack, so the carried obj is the only evidence the cave has been robbed.
    if (stage <= MF_STAGE.SPOKEN_TO_OMAD && (snap.invIds?.get(BLANKET_OBJ) ?? 0) > 0) {
        return { kind: 'talk', stop: HAND_IN_BLANKET };
    }
    switch (stage) {
        case MF_STAGE.NOT_STARTED:
            return { kind: 'talk', stop: START };
        case MF_STAGE.SPOKEN_TO_OMAD:
            return { kind: 'custom', name: "fetch the child's blanket", run: fetchBlanket };
        case MF_STAGE.RETRIEVED_BLANKET:
            return { kind: 'talk', stop: ASK_FOR_CEDRIC };
        case MF_STAGE.LOOKING_CEDRIC:
            return { kind: 'talk', stop: CEDRIC };
        case MF_STAGE.FINDING_WATER:
            return (snap.inv.get(JUG_WATER.toLowerCase()) ?? 0) > 0
                ? { kind: 'talk', stop: CEDRIC }
                : gatherWater(snap);
        case MF_STAGE.MENDING_CART:
            return (snap.inv.get(LOGS.toLowerCase()) ?? 0) > 0
                ? { kind: 'talk', stop: CEDRIC }
                : gatherLogs(snap);
        case MF_STAGE.FIXED_CART:
            return { kind: 'custom', name: 'tell Omad that Cedric is on his way', run: throwParty };
        default:
            return { kind: 'wait', reason: `Monk's Friend stage ${stage} is not implemented` };
    }
}

export const monksfriend: QuestModule = {
    record: QUESTS.find(record => record.id === 'drunkmonk')!,
    bank: ARDOUGNE_BANK,
    hops: HOPS,
    // Why: the thieves in the cave are `huntmode=cowardly`, so at quest-ready stats nothing here attacks — the float is traversal upkeep alone.
    food: 6,
    tools: [BLANKET.toLowerCase(), 'jug', 'logs', 'axe', 'coins'],
    readStage: readMonksFriendStage,
    decide
};
