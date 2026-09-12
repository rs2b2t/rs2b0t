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
    // Why: `ownsInventory` skips the engine's provisioning, so nothing else opens a booth and a banked certificate or traded store key stays invisible until one read.
    if (!snap.bankKnown) {
        return { kind: 'scanBank' };
    }
    // Why: minting outranks every trade; a bot holding both halves must never hand one back.
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

    // Why: one half and no way to a second is the dead end `warnReadiness` names; only a `wait` parks it, a failing `custom` step never does.
    if (ArravConfig.partner.trim().length === 0
        && certsHeld(snap) + certsBanked(snap) === 0
        && heldId(snap, ownHalf(mine)) > 0) {
        return { kind: 'wait', reason: 'own half held, no partner and no banked certificate: the other gang\'s half is out of reach alone' };
    }

    return mine === 'phoenix' ? phoenixStep(snap) : blackarmStep(snap);
}

export const shieldofarrav: QuestModule = {
    record: QUESTS.find(r => r.id === 'blackarmgang')!,
    // Why: the quest never leaves Varrock, which has 2 booths.
    bank: 'nearest',
    // Why: the bribe and the certificate get acquired at the stage that needs them.
    ownsInventory: true,
    hops: [...SOA_HOPS],
    grind: ['Jonny the beard', 'Weaponsmaster'],
    tools: ['coins', 'broken shield', 'certificate', 'key', 'scroll', 'phoenix crossbow', 'book'],
    // Built at import, when the QuestFood setting still holds its default, so these stay literals.
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.5 },
    readProgress: readShieldOfArravProgress,
    // Why: the crossbows sit behind a door only Straven's key opens and joining Phoenix makes Katrine refuse you, so nobody finishes this alone.
    warnReadiness: () =>
        ArravConfig.partner.trim().length > 0
            ? null
            : 'Shield of Arrav needs a partner or a banked certificate — it cannot be finished alone',
    decide
};

export { SOA_STAGE };
