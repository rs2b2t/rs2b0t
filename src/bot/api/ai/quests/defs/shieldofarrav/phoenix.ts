import { CANT_REACH, GameMessages } from '../../../../chatbox/gameMessages.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { promptLoc } from '../../exec/prompts.js';
import { BARAEK, RELDO, SOA_ID, SOA_LOC, SOA_TILE, STRAVEN_HANDIN, STRAVEN_JOIN } from './areas.js';
import { enterPhoenixInner, leaveHideout, openContainer, talkInHideout, walkAndTalk } from './hideout.js';
import { SOA_STAGE } from './journal.js';
import { heldId, liveItem, modalSaid } from './state.js';

/** Baraek wants 20; the float covers a death and a second attempt. */
const BRIBE_GP = 20;
const COIN_FLOAT = 500;

const JONNY_NPC = 645;
const KILL_MS = 60_000;
const WALK_MS = 120_000;

// Why: both land as a main modal from `~objbox` / `~mesbox`, never as a chat line.
const CHEST_EMPTY = /the chest is empty/i;

/** The bookcase answers Check with a player line and a mesbox before the book lands, which no item-count wait survives on its own. */
export async function takeBook(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(SOA_ID.BOOK) > 0) {
        return true;
    }
    const took = await promptLoc({
        name: 'Bookcase',
        op: 'Check',
        near: SOA_TILE.BOOKCASE,
        id: SOA_LOC.BOOKCASE,
        within: 6,
        expect: () => Inventory.countById(SOA_ID.BOOK) > 0,
        expectMs: 15_000
    }, log);
    await Modals.close();
    if (!took && Inventory.countById(SOA_ID.BOOK) === 0) {
        log('the quest bookcase gave up no book');
        return false;
    }
    return true;
}

export async function readBook(log: (m: string) => void): Promise<boolean> {
    const book = liveItem(SOA_ID.BOOK);
    if (!book) {
        log('no book in the pack to read');
        return false;
    }
    if (!(await book.interact('Read'))) {
        return false;
    }
    await Execution.delayTicks(3);
    await Modals.close();
    return true;
}

function jonny(): Npc | null {
    return Npcs.query().where(n => n.id === JONNY_NPC).nearest();
}

/** Jonny is level 2 and drops the report unconditionally; his respawn is 74 ticks, so a missed window retries. */
export async function killJonny(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(SOA_ID.REPORT) > 0) {
        return true;
    }
    const drop = GroundItems.query().where(g => g.id === SOA_ID.REPORT).within(12).nearest();
    if (drop) {
        const mark = GameMessages.mark();
        if (!(await drop.interact('Take'))) {
            return false;
        }
        await Execution.delayUntil(() => Inventory.countById(SOA_ID.REPORT) > 0 || GameMessages.sawSince(mark, CANT_REACH), 6000);
        return Inventory.countById(SOA_ID.REPORT) > 0;
    }

    const target = jonny();
    if (!target) {
        log('no Jonny the beard in the scene — walking to the Blue Moon Inn');
        return Traversal.walkResilient(SOA_TILE.JONNY, { radius: 3, attempts: 3, timeoutMs: WALK_MS, log });
    }
    Game.setCombatStyle('strength');
    if (!(await target.interact('Attack'))) {
        return false;
    }
    const deadline = performance.now() + KILL_MS;
    while (performance.now() < deadline) {
        await Sustain.run();
        if (EventSignal.pending()) {
            return false;
        }
        if (!jonny()) {
            log('Jonny the beard died');
            // Why: the report lands as a ground drop, and taking it is the next pass's work.
            return true;
        }
        await Execution.delayTicks(1);
    }
    log(`Jonny outlived ${KILL_MS / 1000}s of combat`);
    return false;
}

export async function joinPhoenixGang(log: (m: string) => void): Promise<boolean> {
    return talkInHideout(STRAVEN_JOIN, STRAVEN_JOIN.prefer, log);
}

/** Straven takes the report by dialogue and hands back the weapon-store key, which is what proves the join. */
export async function handInReport(log: (m: string) => void): Promise<boolean> {
    if (!(await talkInHideout(STRAVEN_HANDIN, [], log))) {
        return false;
    }
    return Inventory.countById(SOA_ID.REPORT) === 0;
}

export async function takePhoenixHalf(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(SOA_ID.SHIELD_PHOENIX) > 0) {
        await leaveHideout(log);
        return true;
    }
    if (!(await enterPhoenixInner(log))) {
        log('could not get through the gang door to the chest');
        return false;
    }
    // Why: the chest renders as two locs and only the open one carries Search.
    if (!(await openContainer('Chest', SOA_LOC.CHEST_SHUT, SOA_LOC.CHEST_OPEN, SOA_TILE.CHEST_STAND, log))) {
        await leaveHideout(log);
        return false;
    }

    await promptLoc({
        name: 'Chest',
        op: 'Search',
        near: SOA_TILE.CHEST_STAND,
        id: SOA_LOC.CHEST_OPEN,
        within: 6,
        expect: () => Inventory.countById(SOA_ID.SHIELD_PHOENIX) > 0 || modalSaid(CHEST_EMPTY)
    }, log);
    const empty = modalSaid(CHEST_EMPTY);
    await Modals.close();

    if (Inventory.countById(SOA_ID.SHIELD_PHOENIX) === 0) {
        log(empty
            ? 'the chest is empty — a half is already held or banked, or the quest is complete'
            : 'the chest search landed nothing');
        await leaveHideout(log);
        return false;
    }
    // Why: the half in the pack is the work; a failed climb out is retried by the next pass's early branch, and reporting failure here would throw away a shield half the pack is holding.
    if (!(await leaveHideout(log))) {
        log('half taken, but the climb back to the surface did not land — retrying next pass');
    }
    return true;
}

// Why: every conversation goes through Reach rather than the shared `talk` step, whose gotoNpc approaches on a leash and calls a stand two tiles off "arrived".
function say(stop: typeof RELDO, name: string): QuestStep {
    return { kind: 'custom', name, run: log => walkAndTalk(stop, stop.prefer, log) };
}

export function phoenixStep(snap: QuestSnapshot): QuestStep {
    const stage = snap.progress?.stage ?? snap.stage ?? SOA_STAGE.NOT_STARTED;
    const flags = snap.progress?.flags ?? new Set<string>();

    switch (stage) {
        case SOA_STAGE.NOT_STARTED:
            return say(RELDO, 'ask Reldo for a quest');

        case SOA_STAGE.TOLD_OF_BOOK:
            if (heldId(snap, SOA_ID.BOOK) > 0) {
                return { kind: 'custom', name: 'read The Shield of Arrav', run: readBook };
            }
            // Why: nine other Bookcase locs stand within four tiles, and only this one carries Check.
            return { kind: 'custom', name: 'check the palace bookcase', run: takeBook };

        case SOA_STAGE.READ_BOOK:
            return say(RELDO, 'ask Reldo for a quest');

        case SOA_STAGE.SENT_TO_BARAEK:
            if (heldId(snap, SOA_ID.COINS) < BRIBE_GP) {
                return { kind: 'withdraw', items: [{ name: 'Coins', qty: COIN_FLOAT, id: SOA_ID.COINS }] };
            }
            return say(BARAEK, 'bribe Baraek for the hideout');

        // Why: Straven lives in a sealed underground pocket, and the shared hop walks to a stand two tiles off, calls it arrived, and never climbs.
        case SOA_STAGE.FIND_STRAVEN:
            return { kind: 'custom', name: 'offer Straven your services', run: joinPhoenixGang };

        case SOA_STAGE.KILL_JONNY:
            if (heldId(snap, SOA_ID.REPORT) > 0 || flags.has('report-held')) {
                return { kind: 'custom', name: 'hand the report to Straven', run: handInReport };
            }
            return { kind: 'custom', name: 'kill Jonny the beard for the report', run: killJonny };

        case SOA_STAGE.PHOENIX_JOINED:
            if (heldId(snap, SOA_ID.SHIELD_PHOENIX) > 0) {
                return { kind: 'wait', reason: 'phoenix half held — the other half is not this leg' };
            }
            return { kind: 'custom', name: 'search the Phoenix hideout chest', run: takePhoenixHalf };

        default:
            return { kind: 'wait', reason: `phoenix leg has nothing for stage ${stage}` };
    }
}
