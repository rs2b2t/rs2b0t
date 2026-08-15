import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { driveChoice, promptLoc, settleScene, useOnLoc } from '../../exec/prompts.js';
import { PT_ID, PT_LOC, PT_TILE } from './areas.js';

const held = (id: number): number => Inventory.countById(id);

// Why: `[oploc1,grocerycrate]` hands the rum back before it raises a Yes/No banana prompt, so the answer has to be driven or the modal sits there.
// Why: the `store-job` journal page also renders while the rum is still in the plantation crate, and an empty back room is the only thing that tells the two apart — so a miss crosses to Karamja rather than reporting a failure the engine would retry forever.

/** Search Wydin's back-room crate for the shipped rum. */
export async function collectRum(log: (m: string) => void): Promise<boolean> {
    if (held(PT_ID.RUM) > 0) {
        return true;
    }
    await Sustain.run();
    const got = await promptLoc({
        name: 'Crate',
        op: 'Search',
        near: PT_TILE.GROCERY_CRATE,
        within: 6,
        id: PT_LOC.GROCERY_CRATE,
        prefer: ['No'],
        expect: () => held(PT_ID.RUM) > 0,
        expectMs: 15_000
    }, log);
    if (got && held(PT_ID.RUM) > 0) {
        return true;
    }
    await driveChoice(['No'], log);
    log('the back-room crate held no rum — it has not shipped yet, crossing to Karamja');
    await Traversal.walkResilient(PT_TILE.BANANA_CRATE, { radius: 4, attempts: 3, timeoutMs: 300_000, log });
    return false;
}

// Why: the chest consumes the key and hands over the message in one script, so the message is the only honest oracle for the leg.

/** Unlock the Blue Moon chest with the key. */
export async function openChest(log: (m: string) => void): Promise<boolean> {
    if (held(PT_ID.PIRATE_MESSAGE) > 0) {
        return true;
    }
    if (held(PT_ID.CHEST_KEY) === 0) {
        log('no chest key in the pack');
        return false;
    }
    await Sustain.run();
    return useOnLoc(
        PT_ID.CHEST_KEY,
        { name: 'Chest', near: PT_TILE.PIRATE_CHEST, within: 6, id: PT_LOC.PIRATE_CHEST },
        [],
        () => held(PT_ID.PIRATE_MESSAGE) > 0,
        log
    );
}

// Why: `~scroll_pirate_message` is an `if_settext` main modal, not a chat box — leaving it up makes every later journal read come back empty.

/** Read the pirate message, then close the scroll it opens. */
export async function readMessage(log: (m: string) => void): Promise<boolean> {
    const note = Inventory.items().find(item => item.id === PT_ID.PIRATE_MESSAGE);
    if (!note) {
        log('no pirate message in the pack to read');
        return false;
    }
    if (!(await note.interact('Read'))) {
        return false;
    }
    await Execution.delayUntil(() => reader.modals().main !== -1, 6000);
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return true;
}

const DUG = /you dig a hole in the ground/i;
const GARDENER_RANGE = 10;

/** Clear the gardener if he is inside the dig's refusal radius. */
async function clearGardener(log: (m: string) => void): Promise<void> {
    const near = () => Npcs.query().where(n => n.id === PT_ID.GARDENER).within(GARDENER_RANGE).nearest();
    const first = near();
    if (!first) {
        log('no gardener within the dig radius');
        return;
    }
    log(`gardener ${first.distance()} tiles off — clearing him before the dig`);
    Game.setCombatStyle('strength');
    for (let attempt = 0; attempt < 6; attempt++) {
        const gardener = near();
        if (!gardener) {
            log('gardener down');
            return;
        }
        await Sustain.run();
        if (await gardener.interact('Attack')) {
            await Execution.delayUntil(() => near() === null, 20_000);
        } else {
            await Execution.delayTicks(2);
        }
    }
    log('the gardener would not go down — digging anyway');
}

// Why: `dig.rs2` aborts on `npc_find(coord, falador_gardener, 10, 0)` and his `maxrange` keeps him permanently inside that radius, so he cannot be waited out.
// Why: proximity is a hint that saves a wasted click, never a gate — the dig message is the oracle and the pair is retried.

/** Dig at the X in Falador park. */
export async function digTreasure(log: (m: string) => void): Promise<boolean> {
    if (held(PT_ID.SPADE) === 0) {
        log('no spade in the pack — cannot dig');
        return false;
    }
    for (let attempt = 0; attempt < 4; attempt++) {
        await Sustain.run();
        if (!(await Traversal.walkResilient(PT_TILE.DIG_SITE, { radius: 1, attempts: 3, timeoutMs: 180_000, log }))) {
            log('could not reach the dig site');
            return false;
        }
        await settleScene();
        await clearGardener(log);
        // Why: the attack walks the character to the gardener, and `spade.rs2` fires only within one tile of the X — digging where the fight ended answers "Nothing interesting happens." and the retry kills and walks away again.
        if (!(await Traversal.walkResilient(PT_TILE.DIG_SITE, { radius: 0, attempts: 3, timeoutMs: 60_000, log }))) {
            log('could not get back onto the dig tile after the gardener');
            continue;
        }
        const spade = Inventory.items().find(item => item.id === PT_ID.SPADE);
        if (!spade) {
            return false;
        }
        const mark = GameMessages.mark();
        if (!(await spade.interact('Dig'))) {
            continue;
        }
        if (await Execution.delayUntil(() => GameMessages.sawSince(mark, DUG), 8000)) {
            // Why: `queue(hunt_quest_complete, 0, 0)` lands four ticks after the dig line, so the leg is not finished when the message is.
            await Execution.delayTicks(8);
            return true;
        }
        log(`the dig landed nothing — said: [${GameMessages.since(mark).map(m => m.text).join(' | ')}]`);
    }
    return false;
}
