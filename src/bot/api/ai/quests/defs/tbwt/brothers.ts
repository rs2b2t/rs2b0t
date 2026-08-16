import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { reader } from '../../../../../adapter/ClientAdapter.js';
import { TB_ID, TB_TIADECHE, TB_TILE, TB_NPC, TB_VARP, TIMFRAKU_REWARD, TIMFRAKU_START } from './areas.js';
import { CUTSCENE_GAP, LONG_GAP, type Log, talkFully, useOnNpc } from './talk.js';

const heldId = (id: number): number => Inventory.items().filter(i => i.id === id).reduce((n, i) => n + i.count, 0);

// Why: every list is matched by preference rather than index, and the entries are ordered so that the
// first one that appears anywhere in a menu is the one this leg wants.

/**
 * The Lubufu introduction: name yourself, then work the menu round to the bait offer.
 * Why: the first refusal arms a ten-tick "go away" queue that re-arms on every talk inside it, so the second attempt waits it out.
 */
const LUBUFU_MEET = [
    "What's a whippersnapper?",
    'Talk about him',
    'How old are you?',
    'I could help collect the bait.',
    'You sound like you could do with the help.'
] as const;

/** Three questions past the hand-in and he offers the apprenticeship himself. */
const LUBUFU_APPRENTICE = ['What is a Karambwan?', 'Yes!'] as const;

const LUBUFU_SPARE_VESSEL = ["Actually, I've lost my Karambwan vessel.", 'a shark ate it!'] as const;

const TIADECHE_INTRO = ['When will you be finished?'] as const;
const TIADECHE_ACCEPT = ['Yes'] as const;

const TAMAYU_HUNT = ['When will you succeed?', 'Take me on your next hunt', 'Yes'] as const;

// Why: the queue itself is ten ticks, but a talk that the reach layer had to re-click has already
// armed it once before the module's own conversation starts, so the wait carries margin.

/** The queue Lubufu arms on a brush-off, in ticks. */
const LUBUFU_QUEUE_TICKS = 16;

export function startQuest(log: Log): Promise<boolean> {
    return talkFully(TIMFRAKU_START.npc, TIMFRAKU_START.anchor, TIMFRAKU_START.prefer, log, LONG_GAP);
}

export function claimReward(log: Log): Promise<boolean> {
    return talkFully(TIMFRAKU_REWARD.npc, TIMFRAKU_REWARD.anchor, TIMFRAKU_REWARD.prefer, log, LONG_GAP);
}

/** Talk, sit out the brush-off queue, talk again — idempotent from either state. */
export async function meetLubufu(log: Log): Promise<boolean> {
    if (!(await talkFully(TB_NPC.LUBUFU, TB_TILE.LUBUFU, LUBUFU_MEET, log))) {
        return false;
    }
    await Execution.delayTicks(LUBUFU_QUEUE_TICKS);
    return talkFully(TB_NPC.LUBUFU, TB_TILE.LUBUFU, LUBUFU_MEET, log);
}

/** Hand over whatever Karambwanji the pack holds; he counts them in himself. */
export async function giveKarambwanji(log: Log): Promise<boolean> {
    const before = heldId(TB_ID.RAW_KARAMBWANJI);
    if (before === 0) {
        log('no Raw karambwanji in the pack to hand over');
        return false;
    }
    if (!(await talkFully(TB_NPC.LUBUFU, TB_TILE.LUBUFU, [], log, LONG_GAP))) {
        return false;
    }
    return heldId(TB_ID.RAW_KARAMBWANJI) < before;
}

/** Ask until he offers the apprenticeship and hands the vessel over. */
export async function becomeApprentice(log: Log): Promise<boolean> {
    for (let ask = 0; ask < 6 && heldId(TB_ID.VESSEL) === 0 && heldId(TB_ID.VESSEL_LOADED) === 0; ask++) {
        if (!(await talkFully(TB_NPC.LUBUFU, TB_TILE.LUBUFU, LUBUFU_APPRENTICE, log, LONG_GAP))) {
            return false;
        }
    }
    return heldId(TB_ID.VESSEL) > 0 || heldId(TB_ID.VESSEL_LOADED) > 0;
}

// Why: Tiadeche keeps the first vessel and Tinsay consumes the second, and Lubufu re-issues one to anyone carrying none.

/** A replacement vessel from Lubufu. */
export async function spareVessel(log: Log): Promise<boolean> {
    if (heldId(TB_ID.VESSEL) > 0 || heldId(TB_ID.VESSEL_LOADED) > 0) {
        return true;
    }
    if (!(await talkFully(TB_NPC.LUBUFU, TB_TILE.LUBUFU, LUBUFU_SPARE_VESSEL, log, LONG_GAP))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(TB_ID.VESSEL) > 0, 8000);
}

export function meetTiadeche(log: Log): Promise<boolean> {
    return talkFully(TB_NPC.TIADECHE, TB_TILE.TIADECHE, TIADECHE_INTRO, log);
}

/**
 * Hand him the baited vessel. He lands his first Karambwan, offers it, and the
 * "Yes" is what puts the raw Karambwan the poisoned spear needs into the pack.
 */
export async function tiadecheCatch(log: Log): Promise<boolean> {
    if (!(await useOnNpc(TB_ID.VESSEL_LOADED, TB_NPC.TIADECHE, TB_TILE.TIADECHE, TIADECHE_ACCEPT, log, LONG_GAP))) {
        return false;
    }
    return reader.varp(TB_VARP.TIADECHE) >= TB_TIADECHE.REQUEST_MANUAL;
}

export function giveManual(log: Log): Promise<boolean> {
    return useOnNpc(TB_ID.CRAFTING_MANUAL, TB_NPC.TIADECHE, TB_TILE.TIADECHE, [], log, LONG_GAP);
}

export function meetTinsay(log: Log): Promise<boolean> {
    return talkFully(TB_NPC.TINSAY, TB_TILE.TINSAY, ['Yes.'], log, LONG_GAP);
}

export function giveTinsay(itemId: number): (log: Log) => Promise<boolean> {
    return log => useOnNpc(itemId, TB_NPC.TINSAY, TB_TILE.TINSAY, [], log, LONG_GAP);
}

export function meetTamayu(log: Log): Promise<boolean> {
    return talkFully(TB_NPC.TAMAYU, TB_TILE.TAMAYU, [], log, LONG_GAP);
}

// Why: the hunt is a scripted cutscene — the player is teleported into an instance for six camera
// moves with nothing on the chat interface, then teleported back beside Tamayu for his verdict.

/** Follow Tamayu on a hunt. With four doses and a poisoned spear given, this is the kill. */
export function huntShaikahan(log: Log): Promise<boolean> {
    return talkFully(TB_NPC.TAMAYU, TB_TILE.TAMAYU, TAMAYU_HUNT, log, CUTSCENE_GAP);
}

export function giveTamayu(itemId: number): (log: Log) => Promise<boolean> {
    return log => useOnNpc(itemId, TB_NPC.TAMAYU, TB_TILE.TAMAYU, [], log, LONG_GAP);
}
