// docs/QUESTS.md
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { ensureBarcrawl } from '../../barcrawl/RunBarcrawl.js';
import { curePoison, poisonMark, stockAntipoison } from './antipoison.js';
import { gotoNpc, openDialogue, pickPreferred, talkThrough } from '../../exec/primitives.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import {
    ABBOT, EVERY_CAGE, SC_ID, SC_TILE, SCORPION_NPC, SEER, caughtIn, type ScorpionKey
} from './areas.js';
import { crossSecretWall, enterDeepDungeon, leaveDeepDungeon } from './dungeon.js';

const WALK_MS = 300_000;
const CATCH_MS = 10_000;
const CLIMB_MS = 8000;
const SEER_MS = 45_000;

/** The seer's closing line, once the looking glass has placed the first scorpion. */
const HINT_GIVEN = 'see if you can find that scorpion';

function spoken(lines: readonly string[]): string {
    return lines.join(' ').replace(/@[a-z0-9]{3}@/gi, ' ').replace(/[|\s]+/g, ' ').trim().toLowerCase();
}

// Why: `seer_looking_glass` runs `if_close` and then three `mes` lines a `p_delay(3)` apart before it reopens the chat, and the shared driver gives a shut dialogue 1.5 seconds before it calls the conversation over.
// Why: it then reports success with the hint ungiven, so the leg re-walks to Seers' Village and bails at the same gap for as long as the engine will retry it.

/** Ask a Seer where the first scorpion is, sitting through the looking-glass pauses. */
export async function askTheSeer(log: (m: string) => void): Promise<boolean> {
    if (!(await gotoNpc(SEER, [], log))) {
        return false;
    }
    if (!(await openDialogue(SEER.npc, log))) {
        return false;
    }
    let heard = false;
    const deadline = performance.now() + SEER_MS;
    while (performance.now() < deadline) {
        const texts = ChatDialog.texts();
        if (texts.length > 0 && spoken(texts).includes(HINT_GIVEN)) {
            heard = true;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const options = ChatDialog.options();
        if (options.length > 0) {
            const pick = pickPreferred(options, SEER.prefer);
            if (!pick) {
                log(`scorpcatcher: the Seer offered [${options.join(' | ')}] and none of it asks about the scorpions`);
                return false;
            }
            await ChatDialog.chooseOption(pick);
            await Execution.delayTicks(2);
            continue;
        }
        if (heard && !ChatDialog.isOpen()) {
            break;
        }
        await Execution.delayTicks(1);
    }
    log(heard
        ? 'scorpcatcher: the Seer has placed the first scorpion'
        : 'scorpcatcher: the Seer never got as far as the hint');
    return heard;
}

/** The cage in the pack, whichever of the eight it is. */
function heldCageId(): number | undefined {
    return Inventory.items().find(item => EVERY_CAGE.includes(item.id))?.id;
}

// Why: all three scorpions render "Kharid Scorpion" and the cage's own name never changes, so both sides of the use are addressed by id.

async function cageScorpion(key: ScorpionKey, log: (m: string) => void): Promise<boolean> {
    const cageId = heldCageId();
    if (cageId === undefined) {
        log('scorpcatcher: no scorpion cage in the pack to catch with');
        return false;
    }
    if (caughtIn(cageId).has(key)) {
        return true;
    }
    await settleScene();
    const npcId = SCORPION_NPC[key];
    const scorpion = Npcs.query().where(npc => npc.id === npcId).within(10).nearest();
    const cage = Inventory.items().find(item => item.id === cageId);
    if (!scorpion || !cage) {
        log(`scorpcatcher: no Kharid Scorpion ${npcId} within 10 tiles`);
        return false;
    }
    // Why: a scorpion with no `wanderrange` drifts five tiles, which in the monastery is through a door into the next room — and the use-on is then queued against a walk the server cannot make, so it sits silent until its 10s runs out.
    // Why: the walk is unconditional because tile distance counts through walls, so "already adjacent" is not "already reachable".
    if (!(await Traversal.walkResilient(scorpion.tile(), { radius: 1, attempts: 2, timeoutMs: 60_000, log }))) {
        log(`scorpcatcher: could not reach the ${key.toUpperCase()} scorpion at (${scorpion.tile().x},${scorpion.tile().z})`);
        return false;
    }
    const target = Npcs.query().where(npc => npc.id === npcId).within(10).nearest();
    if (!target || !(await cage.useOn(target))) {
        log(`scorpcatcher: the ${key.toUpperCase()} scorpion refused the cage`);
        return false;
    }
    // Why: the catch swaps the cage for a heavier obj rather than adding one, so the id changing is the only proof it landed.
    const caught = await driveUntil(() => {
        const now = heldCageId();
        return now !== undefined && caughtIn(now).has(key);
    }, [], log, CATCH_MS);
    log(caught
        ? `scorpcatcher: caught the ${key.toUpperCase()} scorpion`
        : `scorpcatcher: the cage never closed on the ${key.toUpperCase()} scorpion — it has wandered off`);
    return caught;
}

/** Barbarian Outpost: the barcrawl opens the gate, then the scorpion is in Ivor's hut. */
async function catchOutpostScorpion(log: (m: string) => void): Promise<boolean> {
    if (!(await leaveDeepDungeon(log))) {
        return false;
    }
    if (!(await ensureBarcrawl(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(SC_TILE.OUTPOST_HUT, { radius: 1, attempts: 3, timeoutMs: WALK_MS, log }))) {
        log('scorpcatcher: could not get into Ivor\'s hut at the Barbarian Outpost');
        return false;
    }
    return cageScorpion('b', log);
}

/** Taverley: the dusty key, the dragon corridor, then the wall by the two coffins. */
async function catchTaverleyScorpion(log: (m: string) => void): Promise<boolean> {
    await stockAntipoison(log);
    const mark = poisonMark();
    if (!(await enterDeepDungeon(log))) {
        return false;
    }
    if (!(await crossSecretWall(true, log))) {
        return false;
    }
    if (!(await cageScorpion('a', log))) {
        return false;
    }
    if (!(await crossSecretWall(false, log))) {
        return false;
    }
    if (!(await leaveDeepDungeon(log))) {
        return false;
    }
    await curePoison(mark, log);
    return true;
}

function upstairs(): boolean {
    const at = Game.tile();
    return at !== null && at.level === 1 && at.x >= 3040 && at.x <= 3062 && at.z >= 3480 && at.z <= 3495;
}

// Why: `oploc1,monasteryladder` refuses anyone outside the order, and a refused climb is a mesbox the walker reads as a quest lock — which blacklists the ladder for the rest of the session.

async function joinTheOrder(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(SC_TILE.ABBOT, { radius: 3, attempts: 3, timeoutMs: WALK_MS, log }))) {
        return false;
    }
    await Execution.delayTicks(2);
    log('scorpcatcher: asking Abbot Langley to join the order');
    return talkThrough(ABBOT.npc, ABBOT.prefer, log);
}

async function climbToTheRobes(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(SC_TILE.MONASTERY_LADDER, { radius: 1, attempts: 3, timeoutMs: WALK_MS, log }))) {
        return false;
    }
    await settleScene();
    const ladder = Locs.query().where(loc => loc.id === SC_ID.MONASTERY_LADDER).action('Climb-up').within(5).nearest();
    if (!ladder || !(await ladder.interact('Climb-up'))) {
        log('scorpcatcher: no monastery ladder to climb');
        return false;
    }
    if (!(await driveUntil(upstairs, [], log, CLIMB_MS))) {
        log('scorpcatcher: the monastery ladder did not let us up');
        return false;
    }
    await settleScene();
    return true;
}

/** The monastery: join the order, climb, and the scorpion is by the robes on the table. */
async function catchMonasteryScorpion(log: (m: string) => void): Promise<boolean> {
    if (!(await leaveDeepDungeon(log))) {
        return false;
    }
    if (!upstairs()) {
        if (!(await joinTheOrder(log))) {
            return false;
        }
        if (!(await climbToTheRobes(log))) {
            return false;
        }
    }
    if (!(await Traversal.walkResilient(SC_TILE.MONASTERY_ROOM, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    return cageScorpion('c', log);
}

export const CATCH_LEG: Record<ScorpionKey, (log: (m: string) => void) => Promise<boolean>> = {
    a: catchTaverleyScorpion,
    b: catchOutpostScorpion,
    c: catchMonasteryScorpion
};
