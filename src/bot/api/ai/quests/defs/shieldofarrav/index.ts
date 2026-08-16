import { Game } from '../../../../game/Game.js';
import { QUESTS } from '../../data/quests.js';
import { heldId, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { SOA_HOPS, SOA_ID } from './areas.js';
import { blackarmStep } from './blackarm.js';
import { certStep, certsBanked, certsHeld, curatorStep } from './certs.js';
import { ArravConfig, resolveGang, type ArravGang } from './config.js';
import { readShieldOfArravProgress, SOA_STAGE } from './journal.js';
import { ArravHandoffState, decideHandoff, handoffStep } from './partner.js';
import { phoenixStep } from './phoenix.js';
import { otherHalf, ownHalf } from './state.js';

let cachedGang: ArravGang | null = null;
let cachedFor = '';

// Why: the character name lands a few ticks after login, and re-resolving every tick would flip the gang mid-run.
function gang(): ArravGang {
    const name = Game.myName() ?? '';
    const fingerprint = `${ArravConfig.gang}|${name}`;
    if (cachedGang === null || (cachedFor !== fingerprint && name.length > 0)) {
        cachedGang = resolveGang(ArravConfig.gang, name.length > 0 ? name : null);
        cachedFor = fingerprint;
    }
    return cachedGang;
}

/** Test seam: the gang is memoised for the process, and a test that changes the setting has to clear it. */
export function resetGangCache(): void {
    cachedGang = null;
    cachedFor = '';
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
        return { kind: 'wait', reason: 'quest stage not readable' };
    }

    const mine = gang();
    // Why: `ownsInventory` skips the engine's provisioning, so nothing else ever opens a booth — and a certificate or a traded store key sitting in the bank stays invisible until one read happens.
    if (!snap.bankKnown) {
        return { kind: 'scanBank' };
    }
    // Why: minting outranks every trade — a bot holding both halves must never hand one back.
    const curator = curatorStep(snap, mine);
    if (curator) {
        return curator;
    }

    const handoff = decideHandoff({
        gang: mine,
        stage,
        hasKey: heldId(snap, SOA_ID.STORE_KEY) > 0,
        hasOwnHalf: heldId(snap, ownHalf(mine)) > 0,
        hasOtherHalf: heldId(snap, otherHalf(mine)) > 0,
        certs: certsHeld(snap) + certsBanked(snap),
        certsHeld: certsHeld(snap),
        certTarget: ArravConfig.certTarget,
        partnerConfigured: ArravConfig.partner.trim().length > 0,
        halvesGiven: ArravHandoffState.halvesGiven,
        gaveCert: ArravHandoffState.gaveCert
    });
    if (handoff) {
        return handoffStep(handoff, mine);
    }

    const certs = certStep(snap, mine);
    if (certs) {
        return certs;
    }

    return mine === 'phoenix' ? phoenixStep(snap) : blackarmStep(snap);
}

export const shieldofarrav: QuestModule = {
    record: QUESTS.find(r => r.id === 'blackarmgang')!,
    // Why: the quest never leaves Varrock, which has two booths.
    bank: 'nearest',
    // Why: the bribe and the certificate are acquired at the stage that needs them, not up front.
    ownsInventory: true,
    hops: [...SOA_HOPS],
    grind: ['Jonny the beard', 'Weaponsmaster'],
    tools: ['coins', 'broken shield', 'certificate', 'key', 'scroll', 'phoenix crossbow', 'book'],
    // Literals, not QuestFood.name: this object is built at import, when the setting still holds its default.
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.5 },
    readProgress: readShieldOfArravProgress,
    // Why: the quest is not finishable alone — the crossbows sit behind a door only Straven's key opens, and joining Phoenix makes Katrine refuse you.
    warnReadiness: () =>
        ArravConfig.partner.trim().length > 0
            ? null
            : 'Shield of Arrav needs a partner or a banked certificate — it cannot be finished alone',
    decide
};

export { SOA_STAGE };
