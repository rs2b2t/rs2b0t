import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { formatTile } from '../../engine/trace.js';
import { talkStrict } from '../../exec/primitives.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import { RG_ITEM, RG_LOC, RG_NPC, RG_TILE } from './areas.js';
import { RG_STAGE } from './journal.js';
import { walkTo } from './isafdar.js';

// Why: Arianwyn appears at (2584,3296) only while the message is held, so stop there explicitly before entering the castle.
const ARIANWYN_ZONE = new Tile(2586, 3299, 0);
// Why: `[zone,0_40_51_24_32]` is the 8x8 square from (2584,3296), so this is a tile off its west edge: near enough that stepping out and back is 2 short walks, far enough that the walk back counts as an entry.
const ARIANWYN_OUTSIDE = new Tile(2580, 3299, 0);
const ARIANWYN_TRIES = 3;

function inArianwynZone(tile: { x: number; z: number } | null): boolean {
    return tile !== null && tile.x >= 2584 && tile.x <= 2591 && tile.z >= 3296 && tile.z <= 3303;
}

/** The cooked rabbit that gets the catapult's guard to look the other way. */
export async function feedLazyGuard(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(RG_TILE.LAZY_GUARD, 3, RG_STAGE.SPOKEN_IORWERTH2, log))) {
        return false;
    }
    await settleScene();
    // Why: 5 NPCs render as "Tyras guard", and only this one takes the rabbit.
    const guard = Npcs.query().where(npc => npc.id === RG_NPC.LAZY_GUARD).within(10).nearest();
    const rabbit = Inventory.items().find(item => item.id === RG_ITEM.COOKED_RABBIT.id);
    if (!guard || !rabbit) {
        log(`missing ${guard ? 'the cooked rabbit' : 'the lazy guard'} at the catapult`);
        return false;
    }
    if (!(await rabbit.useOn(guard))) {
        return false;
    }
    return driveUntil(() => heldId(RG_ITEM.COOKED_RABBIT.id) === 0, [], log, 30_000);
}

// Why: the firing is a 2-minute cutscene that walks you round the catapult, teleports you into an instanced copy of the camp to watch the tent burn and puts you back at (2183,3185), so the oracle is the bomb leaving the pack.

/** The barrel bomb loaded and fired over the trees into King Tyras's tent. */
export async function fireCatapult(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(RG_TILE.CATAPULT, 3, RG_STAGE.SPOKEN_IORWERTH2, log))) {
        return false;
    }
    await settleScene();
    const catapult = Locs.query().where(loc => loc.id === RG_LOC.CATAPULT).within(10).nearest();
    const bomb = Inventory.items().find(item => item.id === RG_ITEM.BARREL_FUSED.id);
    if (!catapult || !bomb) {
        log(`missing ${catapult ? 'the fused barrel bomb' : 'the catapult'}`);
        return false;
    }
    if (!(await bomb.useOn(catapult))) {
        return false;
    }
    if (!(await driveUntil(() => heldId(RG_ITEM.BARREL_FUSED.id) === 0, [], log, 30_000))) {
        log('the catapult would not take the bomb');
        return false;
    }
    // Why: the cutscene teleports twice and ends with a 3-tick animation lock, so the next leg waits for the forest floor before it starts.
    return Execution.delayUntil(() => (Game.tile()?.z ?? 9999) < 4000, 60_000);
}

/** Lord Iorwerth takes the news and hands over the letter for King Lathas. */
export async function reportToIorwerth(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(RG_TILE.IORWERTH, 3, RG_STAGE.KILLED_TYRAS, log))) {
        return false;
    }
    await settleScene();
    if (!(await talkStrict('Lord Iorwerth', [], log))) {
        return false;
    }
    return heldId(RG_ITEM.MESSAGE.id) > 0;
}

/** Arianwyn's ambush on the Ardougne road, which breaks the seal on the letter. */
export async function meetArianwyn(log: (m: string) => void): Promise<boolean> {
    // Why: `[zone,0_40_51_24_32]` queues Arianwyn only while `inv_total(inv, regicide_iorwerth_message) > 0`, so a pack without the letter stands in the zone forever. Say it once, with a reason.
    if (heldId(RG_ITEM.MESSAGE.id) === 0) {
        log(`no ${RG_ITEM.MESSAGE.name} in the pack — the Ardougne road zone only calls Arianwyn out while the letter is held`);
        return false;
    }
    const elfNear = (): boolean =>
        Npcs.query().where(npc => npc.id === RG_NPC.ARIANWYN).within(8).nearest() !== null;
    const showing = (): boolean => ChatDialog.isOpen() || ChatDialog.canContinue() || elfNear();
    // Why: `[zone,...]` fires on entry, so a leg already standing in it has nothing to trigger: `walkResilient` at radius 1 returns without moving and the step reports a timeout for a zone it's standing in. Each attempt steps out to the mustering tile first and walks back in.
    for (let attempt = 0; attempt < ARIANWYN_TRIES && !showing(); attempt++) {
        if (inArianwynZone(Game.tile()) && !(await Traversal.walkResilient(ARIANWYN_OUTSIDE, { radius: 1, attempts: 2, timeoutMs: 90_000, log }))) {
            log(`could not step out of the zone at ${formatTile(Game.tile())} to re-enter it`);
            return false;
        }
        if (!(await Traversal.walkResilient(ARIANWYN_ZONE, { radius: 0, attempts: 3, timeoutMs: 300_000, log }))) {
            return false;
        }
        log(`waiting on the Ardougne road for Arianwyn at ${formatTile(Game.tile())}, letter held (entry ${attempt + 1}/${ARIANWYN_TRIES})`);
        await Execution.delayUntil(showing, 30_000);
    }
    if (!showing()) {
        log(`Arianwyn did not step out after ${ARIANWYN_TRIES} entries into the zone at ${formatTile(Game.tile())}`);
        return false;
    }
    // Why: `[queue,arianwyn_dialogue]` re-queues itself 16 times with a `p_walk(coord)` between beats, and one beat is an objbox, so the goal is the elf leaving.
    return driveUntil(() => !elfNear() && !ChatDialog.isOpen(), [], log, 120_000);
}

/** King Lathas takes the letter and pays out. */
export async function reportToLathas(log: (m: string) => void): Promise<boolean> {
    // Why: his reward branch reads the letter out of the pack, so without it the conversation opens, says nothing new and closes, which the step could only report as "no inventory change".
    if (heldId(RG_ITEM.MESSAGE.id) === 0) {
        log(`no ${RG_ITEM.MESSAGE.name} in the pack — King Lathas pays out on the letter, so there is nothing to hand him`);
        return false;
    }
    if (!(await Traversal.walkResilient(RG_TILE.LATHAS, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    await settleScene();
    return talkStrict('King Lathas', [], log);
}
