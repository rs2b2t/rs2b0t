import { Skills } from '../../../../skills/Skills.js';
import { QUESTS } from '../../data/quests.js';
import { hasFlag, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { BRUNDT, FT_TILE, THORVALD } from './areas.js';
import { bardStep } from './bard.js';
import { hunterStep } from './hunter.js';
import { merchantStep } from './merchant.js';
import { navigatorStep } from './navigator.js';
import { revellerStep } from './reveller.js';
import { seerStep } from './seer.js';
import { FT_STAGE, readFremennikProgress } from './journal.js';
import { PROTECT_MELEE_LEVEL, leaveLoftStep, warriorStep } from './warrior.js';

export { parseFremennikJournal, readFremennikProgress, FT_STAGE } from './journal.js';
export { riddleAnswer } from './seer.js';
export { FT_ID, FT_LOC, FT_TILE, MAZE_ROUTE } from './areas.js';

const VOTES_NEEDED = 7;

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    const stage = snap.progress?.stage;
    if (stage === undefined) {
        return { kind: 'wait', reason: 'quest stage not readable' };
    }
    // Why: `ownsInventory` skips the engine's provisioning, so nothing else ever opens a booth and a banked shark stays invisible until this read happens.
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: FT_TILE.SEERS_BANK };
    }
    if (stage === FT_STAGE.NOT_STARTED) {
        return { kind: 'talk', stop: BRUNDT(['Do you have any quests?', 'Yes, I am interested.', 'I want to become a Fremennik!']) };
    }
    // Why: the seventh vote is awarded by the honourable death, which leaves the character on a loft the walker has no edge off — Brundt is unreachable until that ladder is climbed.
    const loft = leaveLoftStep(snap);
    if (loft) {
        return loft;
    }
    if (stage >= VOTES_NEEDED) {
        return { kind: 'talk', stop: BRUNDT(['Ask about becoming a Fremennik']) };
    }

    // Why: this is the order the map wants — the longhall trials first, then the two east of town, then the maze, then the trade chain.
    // Why: the seer and the warrior come last because both are walked with an empty pack, and Peer's spell is what empties it.
    const trial = revellerStep(snap)
        ?? bardStep(snap)
        ?? hunterStep(snap)
        ?? navigatorStep(snap)
        ?? merchantStep(snap);
    if (trial) {
        return trial;
    }
    // Why: Peer only offers to bank your equipment while Thorvald's trial is open, and both of the last two are walked with nothing.
    if (!hasFlag(snap.progress, 'warrior-started') && !hasFlag(snap.progress, 'warrior-done')) {
        return { kind: 'talk', stop: THORVALD(['Yes']) };
    }
    return seerStep(snap) ?? warriorStep(snap) ?? { kind: 'wait', reason: 'seven votes are in but Brundt has not been told' };
}

function readiness(): string | null {
    const gaps: string[] = [];
    for (const [skill, level] of [['woodcutting', 40], ['crafting', 40], ['fletching', 25]] as const) {
        if (Skills.level(skill) < level) {
            gaps.push(`${skill} ${Skills.level(skill)}/${level}`);
        }
    }
    if (gaps.length > 0) {
        return `The Fremennik Trials needs ${gaps.join(', ')}`;
    }
    if (Skills.level('prayer') < PROTECT_MELEE_LEVEL) {
        return `The Fremennik Trials wants Prayer ${PROTECT_MELEE_LEVEL} — Koschei's first three forms kill an unarmed character without Protect from Melee`;
    }
    return 'The Fremennik Trials fights a level 69 Draugen and needs a raw shark — bank one, or the bot buys it from Rufus in Canifis';
}

export const fremenniktrials: QuestModule = {
    record: QUESTS.find(r => r.id === 'viking')!,
    bank: FT_TILE.SEERS_BANK,
    // Why: two trials are walked with an empty pack and one is walked with a full combat kit, so the module owns every banking decision.
    ownsInventory: true,
    grind: ['The Draugen', 'Koschei the deathless'],
    tools: ['coins', 'knife', 'axe', 'tinderbox', 'raw shark'],
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.5 },
    readProgress: readFremennikProgress,
    warnReadiness: readiness,
    decide
};
