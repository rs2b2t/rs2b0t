// docs/QUESTS.md
import { actions, reader } from '../../../../adapter/ClientAdapter.js';
import Tile from '../../../../geometry/Tile.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import { GroundItems, type GroundItem } from '../../../grounditems/GroundItems.js';
import { Locs, type Loc } from '../../../locs/Locs.js';
import { Npcs } from '../../../npcs/Npcs.js';
import { Sustain } from '../../../sustain/Sustain.js';
import { ChatDialog } from '../../../ui/dialogue/ChatDialog.js';
import { Quests } from '../../../ui/questlog/Quests.js';
import { Reach } from '../../../walking/Reach.js';
import { Traversal } from '../../../walking/Traversal.js';
import { QUESTS } from '../data/quests.js';
import { hasFlag, type QuestModule, type QuestProgress, type QuestSnapshot, type QuestStep } from '../engine/types.js';
import { gotoNpc, isUnderground, talkStrict, walkWithHops, type LadderHop, type NpcStop } from '../exec/primitives.js';
import { driveChoice, driveUntil, heldId, settleScene } from '../exec/prompts.js';

const QUEST = 'Hazeel Cult';

/** `%hazeelcultquest`. 5 is the poison the Carnillean side never pours, and 8 is unused. */
export const HC_STAGE = {
    NOT_STARTED: 0,
    STARTED: 2,
    SPOKEN_CLIVET: 3,
    REFUSED_CULT: 4,
    POURED_POISON: 5,
    KILLED_ALOMONE: 6,
    RETURNED_ARMOUR: 7,
    COMPLETE: 9
} as const;

export const ARMOUR_OBJ = 2405;
const ARMOUR_NAME = 'Carnillean armour';

const RAFT_LOC = 2849;
const CUPBOARD_SHUT = 2850;
const CUPBOARD_OPEN = 2851;

const BANK = new Tile(2655, 3283, 0);
const CAVE_MOUTH = new Tile(2585, 3233, 0);
const SEWER_LANDING = new Tile(2570, 9682, 0);
const FOREST_TOP = new Tile(2587, 3237, 0);
const RAFT_IN = new Tile(2567, 9680, 0);
const RAFT_OUT = new Tile(2606, 9692, 0);
const ALOMONE_TILE = new Tile(2609, 9669, 0);
const CUPBOARD = new Tile(2573, 3267, 1);

// Why: the cave mouth is a teleport rather than a ladder and the hideout has no walking exit at all, so these two are the only crossings the walker may pick for itself.
const HOPS: LadderHop[] = [
    { stand: CAVE_MOUTH, locName: 'Cave entrance', op: 'Enter', arrive: SEWER_LANDING },
    { stand: SEWER_LANDING, locName: 'Stairs', op: 'Climb-up', arrive: FOREST_TOP }
];

const CERIL_START: NpcStop = {
    npc: 'Ceril Carnillean',
    anchor: new Tile(2565, 3269, 0),
    leash: 6,
    prefer: ["what's wrong", 'yes, of course']
};

// Why: "You're crazy" and "No. I won't do it." both reach `clivet_hazeel_cultist_fool`, which is what locks the Carnillean side in; "Ok, count me in" is the one answer no later step can undo.
const CLIVET: NpcStop = {
    npc: 'Clivet',
    anchor: new Tile(2566, 9682, 0),
    leash: 10,
    prefer: ['what do you mean', "you're crazy", "no. i won't do it"]
};

const CERIL_RETURN: NpcStop = {
    npc: 'Ceril Carnillean',
    anchor: new Tile(2574, 3268, 1),
    leash: 6,
    prefer: []
};

interface Valve {
    id: number;
    op: string;
    tile: Tile;
}

// Why: `_hazeelcult_valve` sets its bit on Turn-left for `sewervalve3` alone and on Turn-right for the other four, and `count_correct_valves` counts a prefix — so all five have to be set before the raft moves at all.
const VALVES: readonly Valve[] = [
    { id: 2844, op: 'Turn-right', tile: new Tile(2562, 3247, 0) },
    { id: 2845, op: 'Turn-right', tile: new Tile(2572, 3263, 0) },
    { id: 2846, op: 'Turn-left', tile: new Tile(2585, 3245, 0) },
    { id: 2847, op: 'Turn-right', tile: new Tile(2597, 3263, 0) },
    { id: 2848, op: 'Turn-right', tile: new Tile(2609, 3243, 0) }
];

// Why: `%hazeelcult_valves` is `scope=perm` with no transmit, so where the raft stops is the only oracle — this holds what the last ride proved rather than what the varp says.
let valvesTurned = false;

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

const EVIL = 'evil';

// Why: the page is cumulative, so the most advanced line has to win; the cult-side lines are read only so the module can name why it will not run.
const STAGE_LINES: readonly [string, number, boolean][] = [
    ['quest complete!', HC_STAGE.COMPLETE, false],
    ["i returned the armour, but ceril didn't believe", HC_STAGE.RETURNED_ARMOUR, false],
    ['i found the scroll needed to revive hazeel', HC_STAGE.RETURNED_ARMOUR, true],
    ['i managed to enter the hideout, kill the cult leader', HC_STAGE.KILLED_ALOMONE, false],
    ['told me to find a spell scroll', HC_STAGE.KILLED_ALOMONE, true],
    ['i spoke to clivet and he told me that i had failed', HC_STAGE.POURED_POISON, true],
    ['having decided to assist the cult', HC_STAGE.POURED_POISON, true],
    ['told me the truth about the', HC_STAGE.REFUSED_CULT, true],
    ['he jumped onto a raft and headed into the', HC_STAGE.REFUSED_CULT, false],
    ['he told me a pack of lies about the carnilleans', HC_STAGE.SPOKEN_CLIVET, false],
    ['who were responsible live in a cave', HC_STAGE.STARTED, false],
    ['i can start this quest by talking to', HC_STAGE.NOT_STARTED, false]
];

export function parseHazeelJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const hit = STAGE_LINES.find(([needle]) => text.includes(needle));
    if (hit === undefined) {
        return undefined;
    }
    return { stage: hit[1], flags: new Set(hit[2] ? [EVIL] : []) };
}

export async function readHazeelProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(QUEST);
    if (status === 'complete') {
        return { stage: HC_STAGE.COMPLETE, flags: new Set() };
    }
    if (status === 'notStarted') {
        return { stage: HC_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const progress = parseHazeelJournal(await Quests.journal(QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}

// Why: both boxes are the exact walkable components from the baked collision pack, because
// the four sewer islands and the mansion cellar sit inside the same mapsquare as these two.

/** The cult hideout, a pocket whose only way out is the raft beside it. */
export function inHideout(t: { x: number; z: number }): boolean {
    return isUnderground(t) && t.x >= 2601 && t.x <= 2612 && t.z >= 9666 && t.z <= 9693;
}

/** Where the cave entrance drops you: Clivet, the stairs back up, and the raft in. */
export function atCaveMouth(t: { x: number; z: number }): boolean {
    return isUnderground(t) && t.x >= 2565 && t.x <= 2571 && t.z >= 9680 && t.z <= 9685;
}

function locById(id: number, within = 6): Loc | null {
    return Locs.query().where(l => l.id === id).within(within).nearest();
}

/** Click through whatever `~mesbox` the last action put on the chat interface. */
function clearBoxes(log: (m: string) => void): Promise<boolean> {
    return driveUntil(() => !ChatDialog.isOpen() && !ChatDialog.canContinue(), [], log, 8000);
}

async function boardRaft(within: number, log: (m: string) => void): Promise<boolean> {
    const from = Game.tile();
    const raft = locById(RAFT_LOC, within);
    if (!from || !raft) {
        log('hazeelcult: no raft within reach');
        return false;
    }
    if (!(await raft.interact('Board'))) {
        return false;
    }
    // Why: with the valves wrong the raft stays put and says so in a plain chat line, so where the character ends up is what separates a ride from a refusal.
    const start = Tile.from(from);
    const rode = await Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && start.distanceTo(t) > 4;
    }, 10_000);
    await clearBoxes(log);
    if (rode) {
        await settleScene();
    }
    return rode;
}

// Why: `Reach.locOp` walks and then gives up in the one call where the loc starts out of the scene, and the five valves stand twenty tiles apart — so a leg that bailed on that would walk from valve to valve and never turn one.
const REACH_TRIES = 3;

async function turnValve(valve: Valve, log: (m: string) => void): Promise<boolean> {
    for (let attempt = 0; attempt < REACH_TRIES; attempt++) {
        // Why: the turn's only oracle is the box it raises, so one left open by the last valve would read as this one's.
        await clearBoxes(log);
        const status = await Reach.locOp({
            name: 'Sewer valve',
            op: valve.op,
            near: valve.tile,
            id: valve.id,
            within: 6,
            expect: () => ChatDialog.isOpen() || ChatDialog.canContinue(),
            log
        });
        if (status === 'done') {
            await clearBoxes(log);
            return true;
        }
        if (status === 'unreachable') {
            break;
        }
    }
    log(`hazeelcult: the valve at (${valve.tile.x},${valve.tile.z}) would not turn`);
    return false;
}

async function turnValves(log: (m: string) => void): Promise<boolean> {
    for (const valve of VALVES) {
        if (!(await turnValve(valve, log))) {
            return false;
        }
    }
    log('hazeelcult: all five sewer valves are set');
    return true;
}

/** Ride in, re-setting the valves whenever the raft proves them wrong. */
async function toHideout(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!here) {
        return false;
    }
    if (inHideout(here)) {
        return true;
    }
    if (isUnderground(here) && !atCaveMouth(here)) {
        log('hazeelcult: stranded on a sewer island — riding back to the cave mouth');
        valvesTurned = false;
        await boardRaft(10, log);
        return false;
    }
    if (!valvesTurned) {
        if (isUnderground(here)) {
            await walkWithHops(CAVE_MOUTH, 3, HOPS, log);
            return false;
        }
        if (!(await turnValves(log))) {
            return false;
        }
        valvesTurned = true;
    }
    // Why: the cave entrance is a teleport, and the walker's client-side pathfind burns five repaths on the tick its scene is still unbuilt — so the hop lands first and the last three tiles are walked after it settles.
    if (!(await walkWithHops(SEWER_LANDING, 5, HOPS, log))) {
        return false;
    }
    await settleScene();
    if (!(await Traversal.walkResilient(RAFT_IN, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    if (!(await boardRaft(4, log))) {
        log('hazeelcult: the raft would not move — the sewer valves are wrong');
        valvesTurned = false;
        return false;
    }
    if (inHideout(Game.tile() ?? SEWER_LANDING)) {
        return true;
    }
    log('hazeelcult: the raft stopped short of the hideout — re-setting the valves');
    valvesTurned = false;
    return false;
}

/** The raft out is the pocket's only exit, so every leg above ground starts here. */
async function leaveHideout(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!here || !inHideout(here)) {
        return true;
    }
    if (!(await Traversal.walkResilient(RAFT_OUT, { radius: 1, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    log('hazeelcult: riding the raft back out of the hideout');
    return boardRaft(4, log);
}

/** Climb out of the sewer, so a leg above ground can let `Reach` own its own approach. */
async function toSurface(log: (m: string) => void): Promise<boolean> {
    if (!(await leaveHideout(log))) {
        return false;
    }
    const here = Game.tile();
    if (!here || !isUnderground(here)) {
        return true;
    }
    return walkWithHops(FOREST_TOP, 3, HOPS, log);
}

function armourOnFloor(): GroundItem | null {
    return GroundItems.query().where(g => g.id === ARMOUR_OBJ).within(16).nearest();
}

async function takeArmour(log: (m: string) => void): Promise<boolean> {
    if (heldId(ARMOUR_OBJ) > 0) {
        return true;
    }
    const drop = armourOnFloor();
    if (!drop) {
        log('hazeelcult: no Carnillean armour on the hideout floor');
        return false;
    }
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(ARMOUR_OBJ) > 0, 8000);
}

// Why: `defeat_alomone_hazeel_cultist` drops the armour again on every kill while no copy exists anywhere, so a drop that despawned is recovered by fighting him again rather than by waiting.
async function slayAlomone(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(ALOMONE_TILE, { radius: 4, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    const alomone = Npcs.query().name('Alomone').action('Attack').within(12).nearest();
    if (!alomone) {
        log(`hazeelcult: no Alomone to attack near (${ALOMONE_TILE.x},${ALOMONE_TILE.z})`);
        return false;
    }
    const index = alomone.index;
    Game.setCombatStyle('strength');
    if (!(await alomone.interact('Attack'))) {
        return false;
    }
    log('hazeelcult: fighting Alomone for the Carnillean armour');
    const deadline = performance.now() + 90_000;
    while (performance.now() < deadline) {
        if (!Npcs.all().some(n => n.index === index && n.name === 'Alomone')) {
            return true;
        }
        // Why: the host's eat hook is pumped by `Sustain.run`, not by the tick loop, so a fight held inside one custom step never eats without this.
        await Sustain.run();
        await Execution.delayTicks(1);
    }
    log('hazeelcult: Alomone outlasted the fight budget');
    return false;
}

async function fetchArmour(log: (m: string) => void): Promise<boolean> {
    if (heldId(ARMOUR_OBJ) > 0) {
        return true;
    }
    if (!(await toHideout(log))) {
        return false;
    }
    if (await takeArmour(log)) {
        return true;
    }
    if (!(await slayAlomone(log))) {
        return false;
    }
    // Why: `ai_queue3` adds the drop a few ticks after the corpse leaves the scene, so the first look at the floor is too early and the leg would report a kill it could not collect.
    await Execution.delayUntil(() => armourOnFloor() !== null, 8000);
    return takeArmour(log);
}

function chat(stop: NpcStop): (log: (m: string) => void) => Promise<boolean> {
    return async log => {
        if (!(await leaveHideout(log))) {
            return false;
        }
        if (!(await gotoNpc(stop, HOPS, log))) {
            return false;
        }
        return talkStrict(stop.npc, stop.prefer, log);
    };
}

const askCeril = chat(CERIL_START);
const refuseClivet = chat(CLIVET);

// Why: `hazeelcult_fake_complete` opens the reward scroll on a main modal part-way through, so the chat driver comes back with the rest of Ceril's lines unread — the stage is already 7 by then.
const returnArmour = chat(CERIL_RETURN);

// Why: the first call climbs the stairs and finds nothing — every loc query reads empty for a tick after a level change — so the climb and the open are two of these, same as the valves.
async function openCupboard(log: (m: string) => void): Promise<boolean> {
    for (let attempt = 0; attempt < REACH_TRIES; attempt++) {
        if (locById(CUPBOARD_OPEN, 6)) {
            return true;
        }
        const status = await Reach.locOp({
            name: 'Cupboard',
            op: 'Open',
            near: CUPBOARD,
            id: CUPBOARD_SHUT,
            within: 6,
            // Why: a loc that transforms keeps its old id for a tick, so this polls for the open half rather than reading once.
            expect: () => locById(CUPBOARD_OPEN, 6) !== null,
            log
        });
        if (status === 'done') {
            return true;
        }
        if (status === 'unreachable') {
            break;
        }
        await settleScene();
    }
    return false;
}

function questDone(): boolean {
    return Quests.status(QUEST) === 'complete';
}

/** How many quiet ticks prove the accusation ran short rather than being mid-page. */
const CHAT_QUIET_TICKS = 4;

// Why: the short branch ends in silence, so a plain `driveUntil` on the journal spends its full budget every time Ceril or Jones is out of range — the chat going quiet is what says the run was the short one.
async function driveToComplete(log: (m: string) => void): Promise<boolean> {
    const deadline = performance.now() + 120_000;
    let quiet = 0;
    while (performance.now() < deadline) {
        if (questDone()) {
            return true;
        }
        if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
            quiet = 0;
            await driveChoice([], log);
            continue;
        }
        if (++quiet >= CHAT_QUIET_TICKS) {
            log('hazeelcult: the accusation stopped short — Ceril or Jones was out of earshot');
            return false;
        }
        await Execution.delayTicks(1);
    }
    return questDone();
}

// Why: `oploc1,hazeelcbopen` bails unless Ceril and Jones are both inside `npc_find(..., 6, 0)` of the player, and it says nothing at all when they are not — so the leg runs again.
async function searchCupboard(log: (m: string) => void): Promise<boolean> {
    if (!(await toSurface(log))) {
        return false;
    }
    if (!(await openCupboard(log))) {
        log(`hazeelcult: no cupboard to open at (${CUPBOARD.x},${CUPBOARD.z},${CUPBOARD.level})`);
        return false;
    }
    const status = await Reach.locOp({
        name: 'Cupboard',
        op: 'Search',
        near: CUPBOARD,
        id: CUPBOARD_OPEN,
        within: 6,
        expect: () => questDone() || ChatDialog.isOpen() || ChatDialog.canContinue(),
        log
    });
    if (status !== 'done') {
        return false;
    }
    return driveToComplete(log);
}

function custom(name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep {
    return { kind: 'custom', name, run };
}

function holdsArmour(snap: QuestSnapshot): boolean {
    return (snap.invIds?.get(ARMOUR_OBJ) ?? 0) > 0 || (snap.wornIds?.has(ARMOUR_OBJ) ?? false);
}

// Why: `~obj_gettotal` counts the bank as well, so a banked suit stops Alomone dropping another and the withdrawal is the only way on from there.
function armourLeg(snap: QuestSnapshot): QuestStep {
    if (holdsArmour(snap)) {
        return custom('return the armour to Ceril upstairs', returnArmour);
    }
    // Why: no bank is reachable from inside the pocket, so the drop on the floor beside us settles it before any question about what is banked.
    if (snap.tile && inHideout(snap.tile)) {
        return custom('take the Carnillean armour from the cult hideout', fetchArmour);
    }
    if (snap.bankKnown !== true) {
        return { kind: 'scanBank' };
    }
    if ((snap.bankIds?.get(ARMOUR_OBJ) ?? 0) > 0) {
        return { kind: 'withdraw', items: [{ name: ARMOUR_NAME, id: ARMOUR_OBJ, qty: 1 }] };
    }
    return custom('take the Carnillean armour from the cult hideout', fetchArmour);
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    const progress = snap.progress;
    if (progress === undefined) {
        return { kind: 'wait', reason: 'Hazeel Cult journal stage unavailable' };
    }
    if (hasFlag(progress, EVIL)) {
        return { kind: 'wait', reason: 'this character joined the cult; the module runs the Carnillean side only' };
    }
    switch (progress.stage) {
        case HC_STAGE.NOT_STARTED:
            return custom('ask Ceril Carnillean about the stolen armour', askCeril);
        case HC_STAGE.STARTED:
        case HC_STAGE.SPOKEN_CLIVET:
            return custom('refuse Clivet at the cult cave', refuseClivet);
        case HC_STAGE.REFUSED_CULT:
            return custom('take the Carnillean armour from the cult hideout', fetchArmour);
        case HC_STAGE.KILLED_ALOMONE:
            return armourLeg(snap);
        case HC_STAGE.RETURNED_ARMOUR:
            return custom("search Jones' cupboard for the evidence", searchCupboard);
        default:
            return { kind: 'wait', reason: `Hazeel Cult stage ${progress.stage} is not implemented` };
    }
}

export const hazeelcult: QuestModule = {
    record: QUESTS.find(r => r.id === 'hazeelcult')!,
    bank: BANK,
    hops: HOPS,
    food: 6,
    tools: [ARMOUR_NAME.toLowerCase()],
    readProgress: readHazeelProgress,
    // Why: the quest ends in the mansion, but a run killed and resumed mid-fight can finish holding the armour inside the hideout, which has no walking exit.
    exit: leaveHideout,
    decide
};
