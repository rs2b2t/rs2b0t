import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { reader } from '../../../../../adapter/ClientAdapter.js';
import type Tile from '../../../../../geometry/Tile.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { settleScene } from '../../exec/prompts.js';
import { CB_ID, CB_LOC_ID, CB_NAME, CB_NPC, CB_TILE } from './areas.js';
import { walkTo } from './arrows.js';
import { boxText, clearBox, talkBoxes } from './dialogue.js';
import { heldId } from './supplies.js';

const held = (id: number): number => Inventory.countById(id);

/** The kids' choices live in a varbit the client never sees, so asking them is tracked here. */
export const CookState = { kidsAsked: false };

// Why: Rantz rolls his own flavour when the carcass is shown and the kids roll theirs when asked, and none of the three is on the wire — so all six candidates are carried.
// Why: the order is the round trip east of Rantz and then west of him, since taking them in pairs alternates across three hundred tiles of Feldip.
const SEASONINGS: readonly { id: number; name: string; loc?: number; tile: Tile }[] = [
    { id: CB_ID.POTATO, name: CB_NAME.POTATO, loc: 312, tile: CB_TILE.POTATO },
    { id: CB_ID.CABBAGE, name: CB_NAME.CABBAGE, loc: 1161, tile: CB_TILE.CABBAGE },
    { id: CB_ID.EQUA, name: CB_NAME.EQUA, tile: CB_TILE.EQUA },
    { id: CB_ID.ONION, name: CB_NAME.ONION, loc: 3366, tile: CB_TILE.ONION },
    { id: CB_ID.TOMATO, name: CB_NAME.TOMATO, tile: CB_TILE.TOMATO },
    { id: CB_ID.DOOGLE, name: CB_NAME.DOOGLE, tile: CB_TILE.DOOGLE }
];

// Why: the cabbage loc carries no `name=` at all, so the client menu reads "null" and a name query finds nothing — every patch is matched by loc id instead.

/** Pick one vegetable off its patch. */
function pickPatch(locId: number, name: string, itemId: number, tile: Tile): (log: (m: string) => void) => Promise<boolean> {
    return async log => {
        if (!(await walkTo(tile, 4, log))) {
            return false;
        }
        await settleScene();
        const patch = Locs.query().where(l => l.id === locId).action('Pick').within(10).nearest();
        if (!patch) {
            log(`no ${name} patch in reach of (${tile.x},${tile.z})`);
            return false;
        }
        const before = held(itemId);
        if (!(await patch.interact('Pick'))) {
            return false;
        }
        return Execution.delayUntil(() => held(itemId) > before, 10_000);
    };
}

/** The next seasoning to fetch, or null once all six are carried. */
export function seasoningStep(snap: QuestSnapshot): QuestStep | null {
    const missing = SEASONINGS.find(s => heldId(snap, s.id) === 0);
    if (!missing) {
        return null;
    }
    if (missing.loc !== undefined) {
        return {
            kind: 'custom',
            name: `pick a ${missing.name.toLowerCase()}`,
            run: pickPatch(missing.loc, missing.name, missing.id, missing.tile)
        };
    }
    return { kind: 'grabGround', item: missing.name, anchor: missing.tile, waitIfMissing: true };
}

/** Ask both children what they want on the chompy, which is what sets their varbits. */
export async function askKids(log: (m: string) => void): Promise<boolean> {
    for (const npc of [CB_NPC.BUGS, CB_NPC.FYCIE]) {
        if (!(await walkTo(npc === CB_NPC.BUGS ? CB_TILE.BUGS : CB_TILE.FYCIE, 4, log))) {
            return false;
        }
        await settleScene();
        if (!(await talkBoxes(npc, { ms: 30_000 }, log))) {
            log(`${npc} did not answer`);
            return false;
        }
    }
    CookState.kidsAsked = true;
    return true;
}

const NEEDS_KIDS = /what (bugs|fycie) wants/i;
const NEEDS_INGREDIENTS = /don't have all the ingredients/i;

// Why: the spit is six locs sharing one display name and only the empty one carries the `oplocu` a raw chompy needs.

/** Roast the chompy with all three seasonings on the ogre spit. */
export async function cookChompy(log: (m: string) => void): Promise<boolean> {
    if (held(CB_ID.SEASONED_CHOMPY) > 0) {
        return true;
    }
    if (!(await walkTo(CB_TILE.SPIT, 2, log))) {
        return false;
    }
    await settleScene();
    await clearBox();
    const spit = Locs.query().where(l => l.id === CB_LOC_ID.SPIT_EMPTY).within(8).nearest();
    const chompy = Inventory.items().find(i => i.id === CB_ID.RAW_CHOMPY);
    if (!spit || !chompy) {
        log(spit ? 'no Raw chompy to roast' : 'the ogre spit-roast is still busy');
        return false;
    }
    if (!(await chompy.useOn(spit))) {
        return false;
    }
    const settled = await Execution.delayUntil(
        () => held(CB_ID.SEASONED_CHOMPY) > 0
            || held(CB_ID.RUINED_CHOMPY) > 0
            || (reader.modals().main !== -1 && (NEEDS_KIDS.test(boxText()) || NEEDS_INGREDIENTS.test(boxText()))),
        25_000
    );
    if (reader.modals().main !== -1 && NEEDS_KIDS.test(boxText())) {
        log('the spit wants the kids asked first');
        CookState.kidsAsked = false;
    }
    await clearBox();
    if (held(CB_ID.RUINED_CHOMPY) > 0 && held(CB_ID.SEASONED_CHOMPY) === 0) {
        log('the chompy burnt — another bird is needed');
        const ruined = Inventory.items().find(i => i.id === CB_ID.RUINED_CHOMPY);
        await ruined?.interact('Drop');
    }
    return settled && held(CB_ID.SEASONED_CHOMPY) > 0;
}
