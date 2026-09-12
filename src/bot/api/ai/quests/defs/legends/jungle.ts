import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import type { Loc } from '../../../../model/Loc.js';
import type { Npc } from '../../../../model/Npc.js';
import { Reach } from '../../../../walking/Reach.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type Tile from '../../../../../geometry/Tile.js';
import { JUNGLE_BAND, LQ_ID, LQ_LOC, LQ_NPC, LQ_TILE, inJungleBand, jungleSection, legendsArea } from './areas.js';
import { clearBoxes, driveBoxes, driveToEnd, driveUntil, heldId, here, modalText, offerTo, settleScene } from './scene.js';
import { leaveCaves } from './viyeldi.js';

const CHOP_ATTEMPTS = 14;
const CHOP_MS = 180_000;

// Why: every plant felled through the band leaves its logs in a pack with no slot to spare, and the reed at the pool fails for want of one.
// Why: The final `inv_add` lands on the crossing tick, so wait before reading the pack count.

const isLogs = (name: string | null | undefined): boolean => (name ?? '').toLowerCase().endsWith('logs');

/** Drop whatever the band's plants left behind. */
async function dropLogs(): Promise<void> {
    for (let pass = 0; pass < 3; pass++) {
        await settleScene();
        const logs = Inventory.items().filter(item => isLogs(item.name));
        if (logs.length === 0) {
            return;
        }
        for (const log of logs) {
            await log.interact('Drop');
            await Execution.delayTicks(1);
        }
    }
}

// Why: the dense band that seals the Kharazi Jungle is map-blocked ground with a jungle plant standing on each tile, and `chop_jungle` teleports the chopper 2 tiles towards the plant it fells.
// Why: (2816,2940) is the one mainland tile with an unbroken 2-plant column south of it, landing on open jungle at (2816,2936).

/** The choppable jungle plant to take next, straight ahead before any diagonal. */
function pickPlant(dz: number): Loc | null {
    const me = Game.tile();
    if (!me) {
        return null;
    }
    const candidates = Locs.query()
        .name(LQ_LOC.JUNGLE_BUSH, LQ_LOC.JUNGLE_TREE)
        .action('Chop-down')
        .where(l => {
            const t = l.tile();
            return t.level === me.level && Math.sign(t.z - me.z) === dz && Math.abs(t.z - me.z) <= 2 && Math.abs(t.x - me.x) <= 1;
        })
        .results();
    // Why: Diagonal chops move onto blocked ground, so approach jungle plants cardinally.
    return candidates.sort((a, b) =>
        Math.abs(a.tile().x - me.x) - Math.abs(b.tile().x - me.x)
        || Math.abs(a.tile().z - me.z) - Math.abs(b.tile().z - me.z))[0] ?? null;
}

async function chopThroughBand(dz: number, done: () => boolean, log: (m: string) => void): Promise<boolean> {
    const deadline = performance.now() + CHOP_MS;
    // Why: the crossing that succeeds leaves through this condition, so the drop below has to be on its way out too.
    for (let i = 0; i < CHOP_ATTEMPTS && performance.now() < deadline && !done(); i++) {
        const plant = pickPlant(dz);
        if (!plant) {
            log(`no choppable jungle plant ${dz > 0 ? 'north' : 'south'} of (${Game.tile()?.x},${Game.tile()?.z}) — waiting for a respawn`);
            await Execution.delayTicks(6);
            continue;
        }
        const before = Game.tile();
        if (!(await plant.interact('Chop-down'))) {
            continue;
        }
        await Execution.delayUntil(() => done() || (Game.tile()?.z ?? before?.z ?? 0) !== (before?.z ?? 0), 20_000);
    }
    await dropLogs();
    return done();
}

// Why: `start_chop_jungle` checks the machete, an axe and the notes before the first swing, and a missing one answers with a message box the walker can't see.

const throughSouth = (): boolean => (Game.tile()?.z ?? 9999) <= JUNGLE_BAND.south;
const throughNorth = (): boolean => (Game.tile()?.z ?? 0) >= JUNGLE_BAND.north;

/** Hack south through the dense band into the Kharazi Jungle. */
export async function enterJungle(log: (m: string) => void): Promise<boolean> {
    if (throughSouth() && here() === 'jungle') {
        return true;
    }
    if (!inJungleBand(Game.tile())) {
        // Why: the mouth is a mainland tile, so a leg resumed inside the caves has to climb out of them before it can be walked to.
        if (!(await leaveCaves(log))) {
            return false;
        }
        if (throughSouth() && here() === 'jungle') {
            return true;
        }
        if (!(await Traversal.walkResilient(LQ_TILE.JUNGLE_MOUTH, { radius: 0, attempts: 4, timeoutMs: 240_000, log }))) {
            return false;
        }
    }
    await settleScene();
    const ok = await chopThroughBand(-1, throughSouth, log);
    if (!ok) {
        log('could not cut through the dense jungle band');
    }
    return ok;
}

/** Hack north out of the jungle onto open Karamja. */
export async function leaveJungle(log: (m: string) => void): Promise<boolean> {
    if (here() !== 'jungle') {
        return true;
    }
    if (!inJungleBand(Game.tile())
        && !(await Traversal.walkResilient(LQ_TILE.JUNGLE_INSIDE, { radius: 0, attempts: 4, timeoutMs: 240_000, log }))) {
        return false;
    }
    await settleScene();
    return chopThroughBand(1, throughNorth, log);
}

const MAP_ANCHORS: readonly { section: 'west' | 'middle' | 'east'; tile: Tile }[] = [
    { section: 'west', tile: LQ_TILE.MAP_WEST },
    { section: 'middle', tile: LQ_TILE.MAP_MIDDLE },
    { section: 'east', tile: LQ_TILE.MAP_EAST }
];

const MAPPED = /neatly add a new section|already completed this part/;
const SHORT = /additional papyrus|additional charcoal|need some papyrus and charcoal/;
// Why: `stat_random(crafting, 100, 250)` misses often at the quest's own requirement, and each miss prints one of these 4.
const MISSED = /make a mess but are able to rescue|snap your stick of charcoal|make a mess of the map|landing on your charcoal and papyrus/;
const MAP_ATTEMPTS = 20;

// Why: the roll is announced by "You prepare to start mapping this area..." and the result lands a box later, so drive the first box or every attempt times out.

/** One "Complete" on the notes, and what the message box said about it. */
async function drawSection(log: (m: string) => void): Promise<'done' | 'retry' | 'short'> {
    const notes = Inventory.items().find(item => item.id === LQ_ID.MAP);
    if (!notes) {
        return heldId(LQ_ID.MAP_COMPLETE) > 0 ? 'done' : 'short';
    }
    if (!(await notes.interact('Complete'))) {
        return 'retry';
    }
    let said = '';
    await driveUntil(
        () => {
            const text = modalText();
            if (MAPPED.test(text) || SHORT.test(text) || MISSED.test(text)) {
                said = text;
                return true;
            }
            return heldId(LQ_ID.MAP_COMPLETE) > 0;
        },
        [],
        log,
        20_000
    );
    await clearBoxes();
    if (heldId(LQ_ID.MAP_COMPLETE) > 0 || MAPPED.test(said)) {
        return 'done';
    }
    if (SHORT.test(said)) {
        log('out of papyrus or charcoal mid-map');
        return 'short';
    }
    return 'retry';
}

// Why: the 3 section bits are `%legends_bits` and never reach the client, so the loop visits all 3 every pass and lets an already-drawn section say so.
// Why: the notes turning into the completed copy is the leg's only oracle.

/** Map all 3 thirds of the jungle. */
export async function mapJungle(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.MAP_COMPLETE) > 0) {
        return true;
    }
    if (!(await enterJungle(log))) {
        return false;
    }
    for (const anchor of MAP_ANCHORS) {
        if (heldId(LQ_ID.MAP_COMPLETE) > 0) {
            return true;
        }
        if (jungleSection(Game.tile()) !== anchor.section
            && !(await Traversal.walkResilient(anchor.tile, { radius: 3, attempts: 3, timeoutMs: 240_000, log }))) {
            return false;
        }
        await settleScene();
        let drawn = false;
        for (let i = 0; i < MAP_ATTEMPTS && !drawn; i++) {
            const result = await drawSection(log);
            if (result === 'short') {
                return false;
            }
            drawn = result === 'done' || heldId(LQ_ID.MAP_COMPLETE) > 0;
            await Execution.delayTicks(1);
        }
        if (!drawn) {
            log(`the ${anchor.section} section would not draw`);
            return false;
        }
        log(`mapped the ${anchor.section} third of the Kharazi Jungle`);
    }
    return heldId(LQ_ID.MAP_COMPLETE) > 0;
}

const FORESTER_PREFER = ['Yes, go ahead make a copy!', 'What will you give me in return?'];

// Why: the forester lives on open Karamja, north of the band, so this leg starts by cutting back out.

/** Trade a copy of the finished map for the bullroarer. */
export async function getBullroarer(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.BULLROARER) > 0) {
        return true;
    }
    if (!(await leaveJungle(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.FORESTER, { radius: 4, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    const forester = Npcs.query().name(LQ_NPC.FORESTER).within(12).nearest();
    if (!forester) {
        log('no forester in range for the map');
        return false;
    }
    if (!(await offerTo(LQ_ID.MAP_COMPLETE, forester, log))) {
        return false;
    }
    // Why: the forester hands the roarer through `~objbox`, and the `inv_add` behind it only runs once the box is clicked; a chat-only driver holds the script shut.
    return driveBoxes(() => heldId(LQ_ID.BULLROARER) > 0, 60_000, FORESTER_PREFER, log);
}

const GUJUO_LEASH = 14;

// Why: he spawns up to 7 tiles off and walks in, so the wait covers the approach with room over.
const GUJUO_APPROACH_MS = 6000;

function findGujuo(): Npc | null {
    return Npcs.query().name(LQ_NPC.GUJUO).within(GUJUO_LEASH).nearest();
}

// Why: every Gujuo conversation ends in `npc_del`, so he's re-summoned for each one.
// Why: the roarer only answers inside the jungle zone, and it carries an 8-tick cooldown of its own.

/** Swing the bullroarer until Gujuo walks out of the trees. */
export async function summonGujuo(log: (m: string) => void): Promise<boolean> {
    if (findGujuo()) {
        return true;
    }
    if (!(await enterJungle(log))) {
        return false;
    }
    if (legendsArea(Game.tile()) === 'jungle'
        && (Game.tile()?.z ?? 0) > 2932
        && !(await Traversal.walkResilient(LQ_TILE.BULLROARER_SPOT, { radius: 4, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    for (let i = 0; i < 12; i++) {
        if (findGujuo()) {
            return true;
        }
        const roarer = Inventory.items().find(item => item.id === LQ_ID.BULLROARER);
        if (!roarer) {
            log('no bull roarer in the pack');
            return false;
        }
        if (await roarer.interact('Swing')) {
            await Execution.delayUntil(() => findGujuo() !== null, 12_000);
        }
        await Execution.delayTicks(4);
    }
    log('twelve swings and no native answered');
    return false;
}

// Why: Gujuo starts the conversation himself once summoned (`ai_opplayer2`), so opening one is a race the driver has to tolerate.

// Why: half his conversations end themselves, he says goodbye and `npc_del`s, so those have no goal to wait on and `driveUntil` would burn its budget after the chat had closed.

/** Summon Gujuo and drive his conversation, to a goal or to its own end. */
export function talkGujuo(prefer: string[], goal?: () => boolean, ms = 90_000, required?: string): (log: (m: string) => void) => Promise<boolean> {
    const talk = talkGujuoStatus(prefer, goal, ms, required);
    return async log => (await talk(log)) === 'goal';
}

// Why: A missing topic and no dialogue require different recovery; conflating them repeats a cave trip without changing state.

/** Why a talk with Gujuo ended: the goal landed, he never opened a dialogue, or he talked without reaching it. */
export type GujuoTalk = 'goal' | 'nodialog' | 'nogoal';

/** Talk to Gujuo, reporting which of the 3 ways it ended. */
export function talkGujuoStatus(
    prefer: string[],
    goal?: () => boolean,
    ms = 90_000,
    required?: string
): (log: (m: string) => void) => Promise<GujuoTalk> {
    return async log => {
        if (goal?.()) {
            return 'goal';
        }
        // Why: not reaching him and reaching a shaman who says nothing both mean try again where we stand, but they're different failures, and one word for both hides which.
        if (!(await summonGujuo(log))) {
            log('never got to Gujuo — the walk in or the summon failed, not the talk');
            return 'nodialog';
        }
        // Why: the roarer leaves him in `opplayer2`, and `[ai_opplayer2,gujuo]` walks him over and opens `gujuo_start` on its own. A Talk-to click sent into that approach sets you walking too, so both move and neither talks.
        const spoke = (): boolean => ChatDialog.isOpen() || ChatDialog.canContinue();
        if (!(await Execution.delayUntil(spoke, GUJUO_APPROACH_MS))) {
            const status = await Reach.npcDialog({ name: LQ_NPC.GUJUO, near: Game.tile() ?? LQ_TILE.BULLROARER_SPOT, log });
            if (status !== 'done') {
                log('Gujuo never opened a dialogue');
                return 'nodialog';
            }
        }
        // Why: `gujuo_vessel` hands the sketch through `~objbox`, which renders in the main modal and suspends the script until clicked. `driveUntil` clicks the chat modal alone, so the box would stand and the sketch never come.
        const ok = goal ? await driveBoxes(goal, ms, prefer, log) : await driveToEnd(prefer, log, ms, required);
        return ok ? 'goal' : 'nogoal';
    };
}
