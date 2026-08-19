import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Reach } from '../../../../walking/Reach.js';
import { hasFlag, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { FT_ID, FT_LOC, FT_TILE, MANNI, inLonghall } from './areas.js';
import { gatherCoins, gatherTinderbox, heldId, talkUntil, walkTo } from './supplies.js';

const KEG_PRICE = 250;
const BEER_PRICE = 100;
const CONTEST_WON = /completed the Revellers' trial/i;

const holding = (id: number): boolean => Inventory.countById(id) > 0;

// Why: the contest is unwinnable straight — `viking_reveller_drinkcontest` only concedes when the `keg_lowalc` bit is set.
// Why: that bit is only set by swapping the kegs, and the swap is refused while Manni can see you, so the firecracker in the drain pipe is not optional.

/** Manni's drinking contest: swap the keg for Peter Potter's alcohol-free brew behind a firecracker, then drink. */
export function revellerStep(snap: QuestSnapshot): QuestStep | null {
    if (hasFlag(snap.progress, 'reveller-done')) {
        return null;
    }
    if (!hasFlag(snap.progress, 'reveller-started')) {
        return { kind: 'talk', stop: MANNI(['Yes']) };
    }

    const lowAlcohol = heldId(snap, FT_ID.LOW_ALCOHOL_KEG) > 0;
    const keg = heldId(snap, FT_ID.BEER_KEG) > 0;

    if (!lowAlcohol && keg) {
        return { kind: 'custom', name: 'drink Manni under the table', run: drinkingContest };
    }
    if (!lowAlcohol) {
        return gatherCoins(snap, KEG_PRICE)
            ?? { kind: 'custom', name: 'buy a low alcohol keg (250gp)', run: buyLowAlcoholKeg };
    }

    // Why: this order is the road — the keg and the beer are both bought in the Forester's Arms, then Catherby, then the workman on the bridge north of it, then Rellekka.
    const cracker = heldId(snap, FT_ID.FIRECRACKER) > 0 || heldId(snap, FT_ID.FIRECRACKER_LIT) > 0;
    if (!cracker && !snap.inv.has('beer')) {
        return gatherCoins(snap, BEER_PRICE)
            ?? { kind: 'custom', name: "buy a beer at the Forester's Arms", run: buyBeer };
    }
    const tinderbox = gatherTinderbox(snap);
    if (tinderbox) {
        return tinderbox;
    }
    if (!cracker) {
        return { kind: 'useOn', item: 'Beer', targetKind: 'npc', target: 'Council workman', anchor: FT_TILE.COUNCIL_WORKMAN, product: 'Strange object' };
    }
    if (!keg) {
        return { kind: 'grabGround', item: 'Keg of beer', anchor: FT_TILE.KEG_TABLE };
    }
    return { kind: 'custom', name: 'swap the keg for low alcohol beer', run: swapKeg };
}

// Why: the salesman runs his pitch before he will sell, and only offers the keg once Manni's trial is live, so this is a goal-driven drive rather than a talk step.
function buyLowAlcoholKeg(log: (m: string) => void): Promise<boolean> {
    return talkUntil(
        'Poison salesman',
        FT_TILE.POISON_SALESMAN,
        ['Talk about the Fremennik Trials', 'Yes'],
        () => holding(FT_ID.LOW_ALCOHOL_KEG),
        log,
        90_000
    );
}

// Why: the Forester's Arms bartender is a dialogue, not a shop — `Shop.open` finds no Trade op on him.
function buyBeer(log: (m: string) => void): Promise<boolean> {
    return talkUntil('Bartender', FT_TILE.FORESTERS_ARMS, ['Beer please.'], () => Inventory.count('Beer') > 0, log);
}

async function swapKeg(log: (m: string) => void): Promise<boolean> {
    if (!holding(FT_ID.FIRECRACKER_LIT) && holding(FT_ID.FIRECRACKER)) {
        if (!(await walkTo(FT_TILE.PIPE_STAND, 1, log))) {
            return false;
        }
        const tinderbox = Inventory.first('Tinderbox');
        const cracker = Inventory.items().find(i => i.id === FT_ID.FIRECRACKER);
        if (!tinderbox || !cracker) {
            log('no tinderbox or strange object to light');
            return false;
        }
        log('lighting the strange object beside the drain pipe — its fuse runs 140-200 ticks');
        if (!(await tinderbox.useOn(cracker))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => holding(FT_ID.FIRECRACKER_LIT), 6000))) {
            return false;
        }
    }
    if (holding(FT_ID.FIRECRACKER_LIT)) {
        const status = await Reach.locOp({
            name: 'Pipe',
            op: 'Put-inside',
            near: FT_TILE.PIPE_STAND,
            id: FT_LOC.PIPE,
            expect: () => !holding(FT_ID.FIRECRACKER_LIT),
            log
        });
        if (status !== 'done') {
            return false;
        }
        await driveUntil(() => !holding(FT_ID.FIRECRACKER_LIT), [], log, 10_000);
    }
    if (!(await walkTo(FT_TILE.LONGHALL, 2, log))) {
        return false;
    }
    await settleScene();
    if (!inLonghall(Game.tile())) {
        log('the keg swap only works inside the longhall');
        return false;
    }
    const keg = Inventory.items().find(i => i.id === FT_ID.BEER_KEG);
    const lowAlcohol = Inventory.items().find(i => i.id === FT_ID.LOW_ALCOHOL_KEG);
    if (!keg || !lowAlcohol) {
        return false;
    }
    if (!(await keg.useOn(lowAlcohol))) {
        return false;
    }
    const swapped = await Execution.delayUntil(() => !holding(FT_ID.LOW_ALCOHOL_KEG), 8000);
    if (!swapped) {
        log('Manni refused the swap — the firecracker never reached the pipe');
    }
    return swapped;
}

// Why: the contest is a chain of `p_delay`s with the chat shut between beats, which outlasts driveDialog's own gap.
function drinkingContest(log: (m: string) => void): Promise<boolean> {
    const mark = GameMessages.mark();
    return talkUntil(
        'Manni the Reveller',
        FT_TILE.LONGHALL,
        ['Yes'],
        () => GameMessages.sawSince(mark, CONTEST_WON),
        log,
        90_000
    );
}
