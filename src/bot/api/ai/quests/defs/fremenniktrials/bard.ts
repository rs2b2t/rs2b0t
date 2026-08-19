import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Reach } from '../../../../walking/Reach.js';
import { hasFlag, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { driveDialog, talkThrough } from '../../exec/primitives.js';
import { settleScene, useOnLoc } from '../../exec/prompts.js';
import {
    ASKELADDEN,
    FT_ID,
    FT_LOC,
    FT_TILE,
    LALLI,
    OLAF,
    onStage,
    pastBackstage
} from './areas.js';
import { combine, gatherAxe, gatherKnife, gatherShark, heldId, talkUntil, walkTo } from './supplies.js';

const TRIAL_WON = /completed the Bard's Trial/i;

// Why: Askeladden only parts with a pet rock once Lalli has named him, and no journal line separates those two states.
// Why: the latch is process state on purpose — a fresh session re-asks Lalli, which the content treats as a no-op.
let lalliAsked = false;

export function resetBardLatch(): void {
    lalliAsked = false;
}

/**
 * Olaf's trial: cut the musical tree, carve and string a lyre, have Fossegrimen
 * enchant it, then play it on the longhall stage.
 */
export function bardStep(snap: QuestSnapshot): QuestStep | null {
    if (hasFlag(snap.progress, 'bard-done')) {
        return null;
    }
    if (!hasFlag(snap.progress, 'bard-started')) {
        return { kind: 'talk', stop: OLAF(['Yes']) };
    }
    if (heldId(snap, FT_ID.ENCHANTED_LYRE) > 0) {
        return { kind: 'custom', name: 'play the lyre on the longhall stage', run: perform };
    }
    if (heldId(snap, FT_ID.LYRE) > 0) {
        return gatherShark(snap)
            ?? { kind: 'custom', name: 'offer the shark to Fossegrimen', run: offerShark };
    }
    if (heldId(snap, FT_ID.UNSTRUNG_LYRE) > 0 && heldId(snap, FT_ID.GOLDEN_WOOL) > 0) {
        return combine(FT_ID.GOLDEN_WOOL, FT_ID.UNSTRUNG_LYRE, FT_ID.LYRE, 'string the lyre with golden wool');
    }
    if (heldId(snap, FT_ID.GOLDEN_FLEECE) > 0) {
        return { kind: 'custom', name: 'spin the fleece at the Seers spinning wheel', run: spinFleece };
    }
    if (heldId(snap, FT_ID.UNSTRUNG_LYRE) === 0) {
        if (heldId(snap, FT_ID.BRANCH) > 0) {
            return gatherKnife(snap)
                ?? combine(FT_ID.KNIFE, FT_ID.BRANCH, FT_ID.UNSTRUNG_LYRE, 'carve the branch into an unstrung lyre');
        }
        return gatherAxe(snap)
            ?? { kind: 'pickLoc', loc: 'Swaying tree', op: 'Cut-branch', item: 'Branch', anchor: FT_TILE.MUSICAL_TREE };
    }
    return fleeceStep(snap);
}

// Why: Lalli only trades the fleece for a bowl of stone soup, and the stone is Askeladden's pet rock.
function fleeceStep(snap: QuestSnapshot): QuestStep {
    if (heldId(snap, FT_ID.PET_ROCK) === 0) {
        if (!lalliAsked) {
            return { kind: 'custom', name: 'ask Lalli who traded him the wool', run: askLalli };
        }
        return { kind: 'custom', name: 'take a pet rock from Askeladden', run: takePetRock };
    }
    for (const crop of SOUP_CROPS) {
        if (!snap.inv.has(crop.name.toLowerCase())) {
            return { kind: 'pickLoc', loc: crop.name, op: 'Pick', item: crop.name, anchor: crop.patch };
        }
    }
    return { kind: 'custom', name: 'cook stone soup and take the golden fleece', run: stoneSoup };
}

async function askLalli(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(LALLI([]).anchor, 2, log))) {
        return false;
    }
    if (!(await talkThrough('Lalli', ['Other human?'], log))) {
        return false;
    }
    lalliAsked = true;
    return true;
}

async function takePetRock(log: (m: string) => void): Promise<boolean> {
    const got = await talkUntil(
        'Askeladden',
        ASKELADDEN([]).anchor,
        [],
        () => Inventory.countById(FT_ID.PET_ROCK) > 0,
        log,
        45_000
    );
    if (!got) {
        log('Askeladden kept his rocks — going back to Lalli first');
        lalliAsked = false;
    }
    return got;
}

/** The three rows of the field at Rellekka's south gate. */
const SOUP_CROPS: readonly { id: number; name: string; patch: typeof FT_TILE.CABBAGE_PATCH }[] = [
    { id: FT_ID.CABBAGE, name: 'Cabbage', patch: FT_TILE.CABBAGE_PATCH },
    { id: FT_ID.POTATO, name: 'Potato', patch: FT_TILE.POTATO_PATCH },
    { id: FT_ID.ONION, name: 'Onion', patch: FT_TILE.ONION_PATCH }
];

const SOUP: readonly { id: number; name: string }[] = [
    { id: FT_ID.PET_ROCK, name: 'Pet rock' },
    ...SOUP_CROPS.map(crop => ({ id: crop.id, name: crop.name }))
];

async function stoneSoup(log: (m: string) => void): Promise<boolean> {
    for (const part of SOUP) {
        if (Inventory.countById(part.id) === 0) {
            continue;
        }
        const dropped = await useOnLoc(
            part.id,
            { name: "Lalli's Stew", near: FT_TILE.TROLL_CAULDRON, id: FT_LOC.TROLL_CAULDRON },
            [],
            () => Inventory.countById(part.id) === 0,
            log
        );
        if (!dropped) {
            log(`the cauldron would not take the ${part.name}`);
            return false;
        }
    }
    return talkUntil('Lalli', FT_TILE.TROLL_CAULDRON, [], () => Inventory.countById(FT_ID.GOLDEN_FLEECE) > 0, log, 45_000);
}

// Why: Rellekka's own wheel refuses anyone who is not yet a Fremennik, so the fleece is spun in Seers' Village.
async function spinFleece(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(FT_TILE.SPINNING_WHEEL, 2, log))) {
        return false;
    }
    await settleScene();
    const wheel = Locs.query().name('Spinning wheel').within(8).nearest();
    const fleece = Inventory.items().find(i => i.id === FT_ID.GOLDEN_FLEECE);
    if (!wheel || !fleece) {
        log('no spinning wheel or no fleece in range');
        return false;
    }
    if (!(await fleece.useOn(wheel))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(FT_ID.GOLDEN_WOOL) > 0, 10_000);
}

async function offerShark(log: (m: string) => void): Promise<boolean> {
    return useOnLoc(
        FT_ID.RAW_SHARK,
        { name: 'Strange altar', near: FT_TILE.LAKE_ALTAR, id: FT_LOC.LAKE_ALTAR },
        [],
        () => Inventory.countById(FT_ID.ENCHANTED_LYRE) > 0,
        log
    );
}

// Why: the door tile is the loc's own tile, so the approach stops beside it and the first Open lands before the walk has settled.
async function openBackstage(log: (m: string) => void): Promise<boolean> {
    for (let i = 0; i < 3; i++) {
        await settleScene();
        const opened = await Reach.locOp({
            name: 'Door',
            op: 'Open',
            near: FT_TILE.BACKSTAGE_DOOR,
            id: FT_LOC.BACKSTAGE_DOOR,
            expect: () => pastBackstage(Game.tile()),
            log
        });
        if (opened === 'done' || pastBackstage(Game.tile())) {
            return true;
        }
    }
    return false;
}

async function perform(log: (m: string) => void): Promise<boolean> {
    if (!onStage(Game.tile())) {
        // Why: the approach walk sometimes lands west of the door already, and clicking Open from there fails a step the crossing has finished.
        if (!pastBackstage(Game.tile())) {
            if (!(await openBackstage(log))) {
                log('the bouncer would not let the lyre past');
                return false;
            }
            // Why: the door queues the bouncer's line, and an open chat modal swallows the walk onto the stage.
            await driveDialog([], log);
        }
        if (!(await walkTo(FT_TILE.STAGE, 1, log))) {
            return false;
        }
    }
    await settleScene();
    const lyre = Inventory.items().find(i => i.id === FT_ID.ENCHANTED_LYRE);
    if (!lyre) {
        return false;
    }
    const mark = GameMessages.mark();
    if (!(await lyre.interact('Play'))) {
        return false;
    }
    // Why: the performance is four verses of `say` with three-tick gaps, and the vote lands only on the last one.
    return Execution.delayUntil(() => GameMessages.sawSince(mark, TRIAL_WON), 60_000);
}
