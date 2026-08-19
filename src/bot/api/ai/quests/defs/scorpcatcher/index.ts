// docs/QUESTS.md
import { Skills } from '../../../../skills/Skills.js';
import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { BARCRAWL_CARD, BARCRAWL_GP } from '../../barcrawl/BarcrawlLogic.js';
import {
    ANTIPOISON_DOSES, ANTIPOISON_GP, CAGE_ID, CAGE_NAME, EVERY_CAGE, EVERY_SCORPION, SC_ITEM,
    SC_STAGE, SC_TILE, SCORPION_LABEL, THORMAC, caughtIn
} from './areas.js';
import { readScorpionProgress } from './journal.js';
import { CATCH_LEG, askTheSeer } from './legs.js';

function firstCage(counts: ReadonlyMap<number, number> | undefined): number | undefined {
    for (const id of EVERY_CAGE) {
        if ((counts?.get(id) ?? 0) > 0) {
            return id;
        }
    }
    return undefined;
}

// Why: Thormac hands out a replacement only when there is no cage in the pack AND none in the bank, so a banked cage has to come home before he is asked for anything.

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.journal === 'notStarted') {
        return { kind: 'talk', stop: THORMAC };
    }

    const held = firstCage(snap.invIds);
    if (held === undefined) {
        if (snap.bankKnown !== true) {
            return { kind: 'scanBank' };
        }
        const banked = firstCage(snap.bankIds);
        if (banked !== undefined) {
            return { kind: 'withdraw', items: [{ name: CAGE_NAME, qty: 1, id: banked }] };
        }
        return { kind: 'talk', stop: THORMAC };
    }
    if (held === CAGE_ID.FULL) {
        return { kind: 'talk', stop: THORMAC };
    }

    const progress = snap.progress;
    if (progress === undefined) {
        return { kind: 'wait', reason: 'Scorpion Catcher journal stage unavailable' };
    }
    // Why: the seer's first hint is what makes the Taverley wall searchable, and the other two scorpions are already where they will be.
    if (progress.stage < SC_STAGE.FIRST_HINT) {
        return { kind: 'custom', name: 'ask the Seer where the scorpions are', run: askTheSeer };
    }

    const caught = caughtIn(held);
    const next = EVERY_SCORPION.find(key => !caught.has(key));
    if (next === undefined) {
        return { kind: 'talk', stop: THORMAC };
    }
    return { kind: 'custom', name: `catch the ${SCORPION_LABEL[next]} scorpion`, run: CATCH_LEG[next] };
}

// Why: 31 Prayer is the journal's own gate, but joining the order needs it unboosted and the Jailer, the dragon corridor and Protect from Magic are all live combat the record cannot express.

export function warnReadiness(): string | null {
    const prayer = Skills.level('prayer');
    if (prayer < 37) {
        return `Scorpion Catcher: Prayer ${prayer} — 31 opens the monastery, but the blue dragons between the`
            + ' dusty-key gate and the coffins hit 30 through Protect from Magic at 37 and 50 without it';
    }
    const attack = Math.min(Skills.level('attack'), Skills.level('strength'), Skills.level('defence'));
    if (attack < 40) {
        return `Scorpion Catcher: melee ${attack} — the Jailer is level 47 and has to die for the jail key`;
    }
    return null;
}

export const scorpcatcher: QuestModule = {
    record: QUESTS.find(r => r.id === 'scorpcatcher')!,
    // Why: the quest is spread over the Sorcerer's Tower, the Barbarian Outpost, Taverley Dungeon and the monastery, so the nearest bank beats any one of them pinned.
    bank: SC_TILE.BANK,
    food: 12,
    // Why: the ten-bar barcrawl is the only way past the outpost gate, and the Karamja antipoison is two ferry fares on top of it — both are bought with the engine's coin float.
    coinFloat: Math.max(1000, BARCRAWL_GP * 2 + ANTIPOISON_GP),
    tools: [CAGE_NAME, SC_ITEM.DUSTY_KEY, SC_ITEM.JAIL_KEY, BARCRAWL_CARD, ...ANTIPOISON_DOSES],
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.6 },
    readProgress: readScorpionProgress,
    warnReadiness,
    decide
};
