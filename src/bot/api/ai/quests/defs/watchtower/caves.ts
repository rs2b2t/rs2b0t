import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { talkChoosingBy, talkStrict, type LineRule } from '../../exec/primitives.js';
import { hasFlag, type QuestProgress } from '../../engine/types.js';
import { WT_CAVES, WT_ITEM, WT_LOC, WT_NIGHTSHADE, WT_NPC, watchtowerArea } from './areas.js';
import { crossEastGate, leaveEastGate } from './gutanoth.js';
import { settleScene } from './scene.js';

/** Cave index to the one word that skavid understands. */
const SKAVID_REPLIES: Readonly<Record<number, string>> = {
    1: 'Nod.',
    2: 'Ig.',
    3: 'Ar.',
    4: 'Cur.'
};

const WORD_FLAG: Readonly<Record<number, string>> = {
    1: 'learned-nod',
    2: 'learned-ig',
    3: 'learned-ar',
    4: 'learned-cur'
};

const MAD_SKAVID_RULES: readonly LineRule[] = [
    { whenLine: 'ar cur', choose: 'Gor.' },
    { whenLine: 'bidith ig', choose: 'Cur.' },
    { whenLine: 'cur tanath', choose: 'Bidith.' },
    { whenLine: 'gor nod', choose: 'Tanath.' }
];

/** Cave 5 first: the scared skavid is what unlocks talking to the other four. */
export function nextSkavidCave(progress: QuestProgress | undefined): number {
    if (!hasFlag(progress, 'learning-skavid')) {
        return 5;
    }
    for (const index of [1, 2, 3, 4]) {
        if (!hasFlag(progress, WORD_FLAG[index])) {
            return index;
        }
    }
    return 6;
}

function heldId(id: number): number {
    return Inventory.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

function locNear(id: number, op: string, within = 20): Loc | null {
    return Locs.query().where(loc => loc.id === id).action(op).within(within).nearest();
}

async function enterCave(index: number, log: (m: string) => void): Promise<boolean> {
    const cave = WT_CAVES.find(entry => entry.index === index)!;
    const start = Game.tile();
    if (start && watchtowerArea(start) === 'skavidCaves') {
        // The six caves are separate sealed rooms. Being in one of them is only
        // useful if it is this one; otherwise walk out before trying the mouth.
        if (cave.landing.distanceTo(start) <= 5) {
            return true;
        }
        if (!(await leaveCave(log))) {
            return false;
        }
    }
    if (!(await Traversal.walkResilient(cave.stand, { radius: 1, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const mouth = locNear(WT_LOC.CAVE_IN[index - 1], 'Enter', 10);
    if (!mouth || !(await mouth.interact('Enter'))) {
        log(`no cave ${index} entrance in range`);
        return false;
    }
    if (!(await Execution.delayUntil(() => watchtowerArea(Game.tile()) === 'skavidCaves', 12_000))) {
        return false;
    }
    await settleScene();
    // Why: p_teleport lands on the landing tile, so anything further out means the player was dumped in the dark cave.
    // Why: cave 4's landing is only 9 tiles from it, so the tolerance has to be tight.
    const here = Game.tile();
    if (here && cave.landing.distanceTo(here) > 5) {
        log(`landed away from cave ${index} — the map or the lit light source is missing`);
        return false;
    }
    return true;
}

export async function leaveCave(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) !== 'skavidCaves') {
        return true;
    }
    const exit = Locs.query()
        .where(loc => WT_LOC.CAVE_OUT.includes(loc.id))
        .action('Leave')
        .within(24)
        .nearest();
    if (exit) {
        if (!(await exit.interact('Leave'))) {
            return false;
        }
    } else {
        // The dark cave has no ordinary exit, only a climbing rope.
        const rope = locNear(WT_LOC.DARK_CAVE_ESCAPE, 'Climb', 32);
        if (!rope || !(await rope.interact('Climb'))) {
            log('no cave exit in range');
            return false;
        }
    }
    if (!(await Execution.delayUntil(() => watchtowerArea(Game.tile()) !== 'skavidCaves', 12_000))) {
        return false;
    }
    await settleScene();
    return true;
}

async function reachSkavid(index: number, log: (m: string) => void): Promise<boolean> {
    if (!(await enterCave(index, log))) {
        return false;
    }
    const cave = WT_CAVES.find(entry => entry.index === index)!;
    return Traversal.walkResilient(cave.landing, { radius: 8, attempts: 2, timeoutMs: 60_000, log });
}

export async function learnFromScaredSkavid(log: (m: string) => void): Promise<boolean> {
    if (!(await reachSkavid(5, log))) {
        return false;
    }
    if (!(await talkStrict(WT_NPC.SCARED_SKAVID, ["Okay, okay, I'm not going to hurt you."], log))) {
        return false;
    }
    return leaveCave(log);
}

export async function learnWord(index: number, log: (m: string) => void): Promise<boolean> {
    if (!(await reachSkavid(index, log))) {
        return false;
    }
    if (!(await talkStrict(WT_NPC.SKAVID, [SKAVID_REPLIES[index]], log))) {
        return false;
    }
    return leaveCave(log);
}

export async function takeNightshade(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.NIGHTSHADE.id) > 0) {
        return true;
    }
    // Cave 2's mouth is on the main component; cave 6's sits behind the battlement.
    if (!(await enterCave(2, log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(WT_NIGHTSHADE.cave2, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const plant = GroundItems.query().name(WT_ITEM.NIGHTSHADE.name).within(4).nearest();
    if (!plant || !(await plant.interact('Take'))) {
        log('no Nightshade on the cave floor — it respawns, so this is worth retrying');
        return false;
    }
    if (!(await Execution.delayUntil(() => heldId(WT_ITEM.NIGHTSHADE.id) > 0, 6000))) {
        return false;
    }
    return leaveCave(log);
}

export async function answerMadSkavid(log: (m: string) => void): Promise<boolean> {
    // Cave 6 sits on the far side of the gold-bar gate, and the trip is one
    // leg so the crossing state never has to survive a decide() round trip.
    if (watchtowerArea(Game.tile()) !== 'skavidCaves' && !(await crossEastGate(log))) {
        return false;
    }
    if (!(await reachSkavid(6, log))) {
        return false;
    }
    // He says one of four phrases at random, so a wrong guess costs only a retry.
    for (let attempt = 0; attempt < 5; attempt++) {
        await talkChoosingBy(WT_NPC.MAD_SKAVID, MAD_SKAVID_RULES, ["But I've lost it!"], log);
        if (heldId(WT_ITEM.CRYSTAL2.id) > 0) {
            return (await leaveCave(log)) && leaveEastGate(log);
        }
        await Execution.delayTicks(2);
    }
    // Why: the region beyond the east gate overlaps the battlement side, so decide() cannot tell them apart and would send the escape at a battlement it has no path to — hence leaving under our own steam even on failure.
    log('the mad skavid did not hand over a crystal in five attempts');
    await leaveCave(log);
    await leaveEastGate(log);
    return false;
}
