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

// Why: `[zone,0_40_51_24_32]` — Arianwyn steps out of the trees at (2584,3296) on the road to Ardougne castle, and only while the message is in the pack. The walk to King Lathas passes through it either way, but the stop is explicit so a run that took another line into the castle is not left short a stage.
const ARIANWYN_ZONE = new Tile(2586, 3299, 0);
// Why: `[zone,0_40_51_24_32]` is the eight-by-eight square from (2584,3296), so this is a tile off its west edge — near enough that stepping out and back is two short walks, far enough that the walk back is an entry.
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
    // Why: five different NPCs render as "Tyras guard", and only this one takes the rabbit.
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

// Why: the firing is a two-minute cutscene — the player is walked round the catapult, teleported into an instanced copy of the camp to watch the tent burn, and put back at (2183,3185) — so the oracle is the bomb leaving the pack, not the tile or the dialogue.

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
    // Why: the cutscene teleports twice and ends with a three-tick animation lock, so the next leg waits for the player to be back on the forest floor rather than starting mid-flight.
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
    // Why: `[zone,0_40_51_24_32]` queues Arianwyn only while `inv_total(inv, regicide_iorwerth_message) > 0`, so a pack without the letter stands in the zone forever and the step has nothing to report. Say it once rather than time out in silence eleven times.
    if (heldId(RG_ITEM.MESSAGE.id) === 0) {
        log(`no ${RG_ITEM.MESSAGE.name} in the pack — the Ardougne road zone only calls Arianwyn out while the letter is held`);
        return false;
    }
    const elfNear = (): boolean =>
        Npcs.query().where(npc => npc.id === RG_NPC.ARIANWYN).within(8).nearest() !== null;
    const showing = (): boolean => ChatDialog.isOpen() || ChatDialog.canContinue() || elfNear();
    // Why: `[zone,…]` fires on ENTRY, and a leg that is already standing in it has nothing to trigger — `walkResilient` at radius 1 returns without moving, the sixty-second wait runs out, and the step reports a timeout for a zone it is standing in. So each attempt steps out to the mustering tile first and walks back in.
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
    // Why: `[queue,arianwyn_dialogue]` re-queues itself sixteen times with a `p_walk(coord)` between beats, and one of them is an objbox rather than a chat line — so the goal is the elf leaving, not the dialogue closing.
    return driveUntil(() => !elfNear() && !ChatDialog.isOpen(), [], log, 120_000);
}

/** King Lathas takes the letter and pays out. */
export async function reportToLathas(log: (m: string) => void): Promise<boolean> {
    // Why: his reward branch reads the letter out of the pack, so without it the conversation opens, says nothing new and closes — which the step could only report as "no inventory change".
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
