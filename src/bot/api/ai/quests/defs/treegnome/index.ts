import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import type { NpcStop } from '../../exec/primitives.js';
import { LOGS_WANTED, TG_ITEM, TG_NPC, TG_TILE, held, inStronghold, type TgItem } from './areas.js';
import { TG_STAGE, readTreeGnomeProgress } from './journal.js';
import { killTheWarlord } from './combat.js';
import { fireBallista, leaveStronghold, takeTheOrb } from './stronghold.js';
import { armForTheWarlord, chopLogs, scanBank, sourceAxe, topUpFood } from './supplies.js';

const BOLREN: NpcStop = {
    npc: TG_NPC.BOLREN,
    anchor: TG_TILE.BOLREN,
    leash: 8,
    prefer: [
        'Can I help at all?',
        'I would be glad to help.',
        'I will find the warlord and bring back the orbs.',
        'Yes please.'
    ]
};

const MONTAI: NpcStop = {
    npc: TG_NPC.MONTAI,
    anchor: TG_TILE.MONTAI,
    leash: 8,
    prefer: ["Ok, I'll gather some wood.", "I'll try my best."]
};

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

const LEAVE = custom('walk out of the Khazard stronghold', leaveStronghold);
const TAKE_ORB = custom("search the Khazard chest for the gnomes' orb", takeTheOrb);
const KILL_WARLORD = custom('kill the Khazard warlord for the last two orbs', killTheWarlord);

function logsLeg(snap: QuestSnapshot): QuestStep {
    if (held(snap, TG_ITEM.LOGS) >= LOGS_WANTED) {
        return { kind: 'talk', stop: MONTAI };
    }
    return sourceAxe(snap) ?? custom(`chop ${LOGS_WANTED} logs on the battlefield`, chopLogs);
}

const CEREMONY_RANGE = 12;

// Why: the chest and the warlord both refuse while a copy sits in the bank, so a banked orb has to come back out rather than be re-earned.
// Why: Bolren deletes the orbs a tick before the queue that finishes the quest, and an empty pack at his feet is that gap rather than a loss.
function reclaim(snap: QuestSnapshot, item: TgItem, earn: QuestStep): QuestStep {
    if (held(snap, item) > 0) {
        return { kind: 'talk', stop: BOLREN };
    }
    if (snap.tile && TG_TILE.BOLREN.distanceTo(snap.tile) <= CEREMONY_RANGE) {
        return { kind: 'wait', reason: 'King Bolren is running the ceremony' };
    }
    if (snap.bankKnown !== true) {
        return scanBank();
    }
    return (snap.bankIds?.get(item.id) ?? 0) > 0
        ? { kind: 'withdraw', items: [{ name: item.name, qty: 1, id: item.id }], bank: TG_TILE.BANK }
        : earn;
}

function stageStep(snap: QuestSnapshot, stage: number): QuestStep {
    switch (stage) {
        case TG_STAGE.NOT_STARTED:
            return { kind: 'talk', stop: BOLREN };
        case TG_STAGE.STARTED:
        case TG_STAGE.GAVE_LOGS:
            return { kind: 'talk', stop: MONTAI };
        case TG_STAGE.SPOKEN_MONTAI:
            return logsLeg(snap);
        case TG_STAGE.FINDING_TRACKERS:
            return custom('fire the gnome ballista at the stronghold', fireBallista);
        case TG_STAGE.BALLISTA_FIRED:
            return TAKE_ORB;
        case TG_STAGE.RETRIEVED_ORB:
            return reclaim(snap, TG_ITEM.ORB, TAKE_ORB);
        case TG_STAGE.RETURNED_FIRST_ORB:
            return topUpFood(snap) ?? KILL_WARLORD;
        case TG_STAGE.DEFEATED_WARLORD:
            return reclaim(snap, TG_ITEM.ORBS, KILL_WARLORD);
        default:
            return { kind: 'wait', reason: `Tree Gnome Village stage ${stage} is not implemented` };
    }
}

/** The chest is the only errand the stronghold pocket can run; everything else walks out first. */
function chestBusiness(snap: QuestSnapshot, stage: number): boolean {
    if (stage === TG_STAGE.BALLISTA_FIRED) {
        return true;
    }
    // Why: the chest refuses while a copy sits in the bank, so a banked orb is a walk out rather than a search.
    return stage === TG_STAGE.RETRIEVED_ORB
        && held(snap, TG_ITEM.ORB) === 0
        && (snap.bankIds?.get(TG_ITEM.ORB.id) ?? 0) === 0;
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    const stage = snap.progress?.stage ?? snap.stage;
    if (stage === undefined) {
        return { kind: 'wait', reason: 'Tree Gnome Village journal stage unavailable' };
    }
    if (inStronghold(snap.tile)) {
        return chestBusiness(snap, stage) ? TAKE_ORB : LEAVE;
    }
    // Why: the kit comes out on the opening bank trip — armed at the first fight instead, the bot walks the battlefield back to Ardougne for it.
    return armForTheWarlord(snap) ?? stageStep(snap, stage);
}

/** Proven floor 70 melee in rune with Protect from Melee; 50 is the next probe. */
function warnReadiness(): string | null {
    return 'Tree Gnome Village ends on a level 112 warlord with 170 hitpoints — 70 melee in rune took him without a hit landing.';
}

export const treegnome: QuestModule = {
    record: QUESTS.find(record => record.id === 'tree')!,
    bank: TG_TILE.BANK,
    food: 18,
    tools: ['logs', 'axe', 'orb of protection', 'gnome amulet'],
    readProgress: readTreeGnomeProgress,
    exit: leaveStronghold,
    warnReadiness,
    decide
};
