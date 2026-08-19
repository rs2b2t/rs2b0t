import type Tile from '../../../../../geometry/Tile.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import type { QuestStep } from '../../engine/types.js';
import { driveChoice, settleScene } from '../../exec/prompts.js';
import { DIG_ID, DIG_LOC, DIG_NPC, DIG_TILE, inAltarCave, inShaftEast, inShaftWest } from './areas.js';
import {
    climbOutOfCave,
    driveUntilHeld,
    locByIdAction,
    locByIds,
    talkToNpcId,
    useOnLocIds,
    walkTo
} from './common.js';

const DESCEND_MS = 15_000;

/** The cave workman gives the chest key up only to a character who begs four times. */
const KEY_PREFER: readonly string[] = [
    'I have been invited to research here.',
    'Do you know where to find a chest key?',
    "I don't suppose I could use it?",
    'Aww... go on.',
    'Pretty please with sugar on top!',
    'Pretty please!',
    'Please?'
];

// Why: the rope on each winch is a `%itexam_bits` flag the client never sees, so the Operate click is the oracle — a shaft that swallows you was roped, and one that answers with a chat line was not.

/** Operate a winch, tying a rope to its bucket first if the shaft answers instead of swallowing you. */
export async function descendWinch(
    winchLocId: number,
    stand: Tile,
    arrived: () => boolean,
    log: (m: string) => void
): Promise<boolean> {
    if (arrived()) {
        return true;
    }
    if (!(await walkTo(stand, 1, log))) {
        return false;
    }
    for (let attempt = 0; attempt < 3 && !arrived(); attempt++) {
        await Modals.closeIfOpen();
        await settleScene();
        const winch = locByIdAction([winchLocId], 'Operate', 8);
        if (!winch) {
            log(`no winch ${winchLocId} within eight tiles of (${stand.x},${stand.z})`);
            return false;
        }
        if (!(await winch.interact('Operate'))) {
            await Execution.delayTicks(1);
            continue;
        }
        await Execution.delayUntil(() => arrived() || ChatDialog.isOpen() || ChatDialog.canContinue(), DESCEND_MS);
        if (arrived()) {
            await settleScene();
            return true;
        }
        // The bucket stopped short: the shaft has no rope on it yet.
        await driveChoice([], log);
        await Modals.closeIfOpen();
        const rope = Inventory.items().find(i => i.id === DIG_ID.ROPE);
        if (!rope) {
            log('the winch needs a rope tied to its bucket and the pack has none');
            return false;
        }
        const ropesBefore = Inventory.countById(DIG_ID.ROPE);
        const mark = GameMessages.mark();
        const target = locByIds([winchLocId], 8);
        if (!target || !(await rope.useOn(target))) {
            await Execution.delayTicks(1);
            continue;
        }
        const tied = await Execution.delayUntil(
            () => Inventory.countById(DIG_ID.ROPE) < ropesBefore || GameMessages.sawSince(mark, /tie the rope to the bucket/i),
            10_000
        );
        if (!tied) {
            log('the rope would not tie to the winch bucket');
        }
        await Execution.delayTicks(2);
        await Modals.closeIfOpen();
    }
    if (arrived()) {
        return true;
    }
    log(`the winch at (${stand.x},${stand.z}) never dropped us down the shaft`);
    return false;
}

/** The western shaft holds the cave workman with the chest key, and two arcenia roots. */
export function westShaftLeg(needKey: boolean, needRoot: boolean): QuestStep {
    return {
        kind: 'custom',
        name: needKey ? 'beg the cave workman for the chest key' : 'pick an arcenia root in the dig shaft',
        run: async log => {
            if (!inShaftWest(Game.tile())) {
                if (!(await descendWinch(DIG_LOC.WINCH_PRIVATE, DIG_TILE.WINCH_PRIVATE_STAND, () => inShaftWest(Game.tile()), log))) {
                    return false;
                }
            }
            let progressed = false;
            if (needKey && Inventory.countById(DIG_ID.CHEST_KEY) === 0) {
                await talkToNpcId(DIG_NPC.CAVE_WORKMAN, DIG_TILE.CAVE_WORKMAN, KEY_PREFER, log);
                await driveUntilHeld(() => Inventory.countById(DIG_ID.CHEST_KEY) > 0, KEY_PREFER, log, 30_000);
                progressed = Inventory.countById(DIG_ID.CHEST_KEY) > 0;
                if (!progressed) {
                    log('the cave workman kept his key this pass');
                }
            }
            if (needRoot && Inventory.countById(DIG_ID.ARCENIA_ROOT) === 0) {
                progressed = (await grabArcenia(log)) || progressed;
            }
            const stillNeeds = (needKey && Inventory.countById(DIG_ID.CHEST_KEY) === 0)
                || (needRoot && Inventory.countById(DIG_ID.ARCENIA_ROOT) === 0);
            if (!stillNeeds && !(await climbOutOfCave(log))) {
                log('the shaft work is done but the climb out did not land — retrying next pass');
            }
            return progressed;
        }
    };
}

/** Arcenia root lies on the shaft floor in both halves of the cave. */
export async function grabArcenia(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(DIG_ID.ARCENIA_ROOT) > 0) {
        return true;
    }
    for (const anchor of [DIG_TILE.ARCENIA_WEST, DIG_TILE.ARCENIA_WEST_ALT]) {
        const root = GroundItems.query().where(g => g.id === DIG_ID.ARCENIA_ROOT).within(24).nearest();
        if (!root) {
            if (!(await walkTo(anchor, 1, log))) {
                continue;
            }
            await settleScene();
        }
        const found = GroundItems.query().where(g => g.id === DIG_ID.ARCENIA_ROOT).within(24).nearest();
        if (!found) {
            continue;
        }
        if (found.distance() > 1 && !(await walkTo(found.tile() as Tile, 1, log))) {
            continue;
        }
        if (!(await found.interact('Take'))) {
            continue;
        }
        if (await Execution.delayUntil(() => Inventory.countById(DIG_ID.ARCENIA_ROOT) > 0, 8000)) {
            return true;
        }
    }
    log('no arcenia root within reach in this shaft');
    return false;
}

/** The chest on the river bank: unlocked with the workman's key, then searched for the powder. */
export function chestLeg(): QuestStep {
    return {
        kind: 'custom',
        name: 'unlock and search the digsite chest',
        run: async log => {
            if (Inventory.countById(DIG_ID.POWDER) > 0) {
                return true;
            }
            if (!(await walkTo(DIG_TILE.CHEST_STAND, 0, log))) {
                return false;
            }
            await settleScene();
            if (!locByIdAction([DIG_LOC.CHEST_OPEN], 'Search', 4)) {
                const key = Inventory.items().find(i => i.id === DIG_ID.CHEST_KEY);
                const shut = locByIds([DIG_LOC.CHEST_SHUT], 4);
                if (!key || !shut) {
                    log('the chest is shut and the pack has no chest key');
                    return false;
                }
                if (!(await key.useOn(shut))) {
                    return false;
                }
                await Execution.delayUntil(() => locByIdAction([DIG_LOC.CHEST_OPEN], 'Search', 4) !== null, 10_000);
                await settleScene();
            }
            const open = locByIdAction([DIG_LOC.CHEST_OPEN], 'Search', 4);
            if (!open) {
                log('the chest never opened');
                return false;
            }
            if (!(await open.interact('Search'))) {
                return false;
            }
            return driveUntilHeld(() => Inventory.countById(DIG_ID.POWDER) > 0, [], log, 15_000);
        }
    };
}

/** The sealed barrel: levered open with the trowel, then decanted into a vial. */
export function barrelLeg(): QuestStep {
    return {
        kind: 'custom',
        name: 'lever the barrel open and fill a vial',
        run: async log => {
            if (Inventory.countById(DIG_ID.LIQUID) > 0) {
                return true;
            }
            if (Inventory.countById(DIG_ID.VIAL) === 0) {
                log('no empty vial in the pack to fill');
                return false;
            }
            if (!(await walkTo(DIG_TILE.BARREL_STAND, 1, log))) {
                return false;
            }
            await settleScene();
            // Why: the lid flag is a `%itexam_bits` bit, so the trowel goes on first every pass — a second lever is a no-op, a missing one leaves "It's not open!".
            const trowel = Inventory.items().find(i => i.id === DIG_ID.TROWEL);
            const barrel = locByIds([DIG_LOC.BARREL], 6);
            if (!trowel || !barrel) {
                log('no trowel or no barrel at (3364,3377)');
                return false;
            }
            if (await trowel.useOn(barrel)) {
                await Execution.delayTicks(3);
                await driveChoice([], log);
            }
            await Modals.closeIfOpen();
            return useOnLocIds(
                DIG_ID.VIAL,
                [DIG_LOC.BARREL],
                DIG_TILE.BARREL_STAND,
                () => Inventory.countById(DIG_ID.LIQUID) > 0,
                log
            );
        }
    };
}

/** Try a use both ways round: `opheldu` is declared on one of the pair and the client cannot tell which. */
export async function mixItems(aId: number, bId: number, productId: number, log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(productId) > 0) {
        return true;
    }
    for (const [fromId, toId] of [[aId, bId], [bId, aId]]) {
        const from = Inventory.items().find(i => i.id === fromId);
        const to = Inventory.items().find(i => i.id === toId);
        if (!from || !to) {
            log(`mix: the pack is missing ${fromId} or ${toId}`);
            return false;
        }
        if (!(await from.useOn(to))) {
            continue;
        }
        // Why: the last mix ends in a `~chatplayer` line and only adds the compound after it, so a wait that does not drive the dialogue times out on a mix that worked.
        if (await driveUntilHeld(() => Inventory.countById(productId) > 0, [], log, 12_000)) {
            return true;
        }
    }
    await Modals.closeIfOpen();
    log(`mixing ${aId} with ${bId} produced no ${productId}`);
    return false;
}

export function mixStep(name: string, aId: number, bId: number, productId: number): QuestStep {
    return { kind: 'custom', name, run: log => mixItems(aId, bId, productId, log) };
}

function onBrickStand(): boolean {
    const here = Game.tile();
    return here !== null && here.level === 0 && here.x === DIG_TILE.BRICK_STAND.x && here.z === DIG_TILE.BRICK_STAND.z;
}

/** Pour the compound over the bricks and light it; the run-away sequence needs one exact tile. */
export function blastLeg(pour: boolean): QuestStep {
    return {
        kind: 'custom',
        name: pour ? 'pour the compound over the blocked bricks' : 'light the explosive compound',
        run: async log => {
            if (!inShaftEast(Game.tile())) {
                if (inAltarCave(Game.tile())) {
                    return true;
                }
                if (!(await descendWinch(DIG_LOC.WINCH_MAIN, DIG_TILE.WINCH_MAIN_STAND, () => inShaftEast(Game.tile()), log))) {
                    return false;
                }
            }
            // Why: `digsite_blockage_run_sequence` refuses any coord but (3379,9826) with "Eep! Eep! Unexpected player coord!", and a radius-0 walk reports the closest reachable tile as an arrival.
            for (let attempt = 0; attempt < 3 && !onBrickStand(); attempt++) {
                await walkTo(DIG_TILE.BRICK_STAND, 0, log);
            }
            if (!onBrickStand()) {
                const here = Game.tile();
                log(`the blast wants (${DIG_TILE.BRICK_STAND.x},${DIG_TILE.BRICK_STAND.z}) and we are at (${here?.x},${here?.z})`);
                return false;
            }
            await settleScene();
            const brick = locByIds([DIG_LOC.BRICK], 4);
            if (!brick) {
                log('no blocked brick within four tiles of (3379,9826)');
                return false;
            }
            if (pour) {
                const compound = Inventory.items().find(i => i.id === DIG_ID.COMPOUND);
                if (!compound) {
                    log('no chemical compound in the pack to pour');
                    return false;
                }
                if (!(await compound.useOn(brick))) {
                    return false;
                }
                const poured = await driveUntilHeld(() => Inventory.countById(DIG_ID.COMPOUND) === 0, [], log, 15_000);
                await Modals.closeIfOpen();
                return poured;
            }
            const tinderbox = Inventory.items().find(i => i.id === DIG_ID.TINDERBOX);
            if (!tinderbox) {
                log('no tinderbox in the pack to strike');
                return false;
            }
            const again = locByIds([DIG_LOC.BRICK], 4);
            if (!again || !(await tinderbox.useOn(again))) {
                return false;
            }
            // Why: the run-away sequence teleports across a mapsquare and ends in a `~chatplayer` line, and the client's own tile reads stale until that scene rebuild settles.
            await Execution.delayUntil(
                () => inAltarCave(Game.tile()) || ChatDialog.isOpen() || ChatDialog.canContinue(),
                30_000
            );
            await driveChoice([], log);
            await Modals.closeIfOpen();
            await settleScene();
            if (inAltarCave(Game.tile())) {
                return true;
            }
            log('the tinderbox did not set the compound off');
            return false;
        }
    };
}

/** The Zarosian tablet lies on the altar floor once the blast has opened the way. */
export function tabletLeg(): QuestStep {
    return {
        kind: 'custom',
        name: 'take the Zarosian stone tablet',
        run: async log => {
            if (Inventory.countById(DIG_ID.STONE_TABLET) > 0) {
                return true;
            }
            if (!inAltarCave(Game.tile())) {
                if (!(await descendWinch(DIG_LOC.WINCH_MAIN, DIG_TILE.WINCH_MAIN_STAND, () => inAltarCave(Game.tile()), log))) {
                    return false;
                }
            }
            if (!(await walkTo(DIG_TILE.TABLET, 1, log))) {
                return false;
            }
            await settleScene();
            const tablet = GroundItems.query().where(g => g.id === DIG_ID.STONE_TABLET).within(8).nearest();
            if (!tablet) {
                log('no stone tablet within eight tiles of (3374,9747)');
                return false;
            }
            if (!(await tablet.interact('Take'))) {
                return false;
            }
            return Execution.delayUntil(() => Inventory.countById(DIG_ID.STONE_TABLET) > 0, 8000);
        }
    };
}

export function leaveCaveStep(): QuestStep {
    return { kind: 'custom', name: 'climb out of the dig shaft', run: climbOutOfCave };
}
