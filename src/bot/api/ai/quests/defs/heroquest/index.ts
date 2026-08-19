import { Inventory } from '../../../../inventory/Inventory.js';
import { QUESTS } from '../../data/quests.js';
import { talkAndClose, talkUntil } from '../../exec/legs.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import {
    ACHIETTIES,
    HERO_ID,
    HERO_NAMED,
    TAVERLEY_HOP_DOWN,
    TAVERLEY_HOP_UP,
    inBrimhavenHq,
    inDeepDungeon,
    inGarden,
    inKitchen,
    inMansion,
    inSideRoom,
    inTreasureRoom,
    inVelrakCell,
    inYard,
    onEntrana
} from './areas.js';
import { blackarmArmbandStep } from './blackarm.js';
import { returnToStreet } from './doors.js';
import { HeroConfig, heroGang, partnerConfigured } from './config.js';
import { eelStep, freeVelrak, leaveDeepDungeon } from './eel.js';
import { featherStep } from './feather.js';
import { HERO_STAGE, readHeroQuestProgress } from './journal.js';
import { decideHeroHandoff, heroHandoffStep } from './partner.js';
import { phoenixArmbandStep, snipeKitStep } from './phoenix.js';
import { anywhere, bankedId, heldId } from './state.js';

/** The three the quest is graded on, all of which Achietties takes from the pack. */
const HAND_IN = [
    { id: HERO_ID.FEATHER, name: HERO_NAMED.FEATHER },
    { id: HERO_ID.LAVA_EEL, name: HERO_NAMED.LAVA_EEL },
    { id: HERO_ID.ARMBAND, name: HERO_NAMED.ARMBAND }
] as const;

function handInStep(snap: QuestSnapshot): QuestStep {
    // Why: `~send_quest_complete` reads `inv_total(inv, …)`, so a banked feather is not a carried one.
    for (const item of HAND_IN) {
        if (heldId(snap, item.id) === 0) {
            if (bankedId(snap, item.id) > 0) {
                return { kind: 'withdraw', items: [{ name: item.name, qty: 1, id: item.id }] };
            }
            return { kind: 'wait', reason: `no ${item.name} to hand in` };
        }
    }
    return {
        kind: 'custom',
        name: 'give Achietties the three items',
        run: log => talkUntil(ACHIETTIES, ACHIETTIES.prefer,
            () => Inventory.countById(HERO_ID.ARMBAND) === 0, log, 60_000)
    };
}

/** The six Brimhaven pockets, every one of which the navigator has no edge out of. */
export function inSealedPocket(snap: QuestSnapshot): boolean {
    return inBrimhavenHq(snap.tile) || inMansion(snap.tile) || inTreasureRoom(snap.tile)
        || inKitchen(snap.tile) || inGarden(snap.tile) || inYard(snap.tile) || inSideRoom(snap.tile);
}

// Why: a bank, a shop or a booth is a walk the navigator plans, and from inside a sealed pocket every
// such plan reads `unreachable` — the custom legs cross their own doors, these steps cannot.
const NEEDS_STREET = new Set(['buy', 'withdraw', 'deposit', 'scanBank', 'mineRock']);

// Why: `no path to (2793,3180,0): unreachable without 30x Coins` — the Ardougne ferry is 30 coins and
// the legs between purchases carry none, so the quest holds a float at a low-water mark.
const LOW_COINS = 200;
const COIN_TOP_UP = 10_000;

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
    // Why: `ownsInventory` skips the engine's provisioning, so nothing else ever opens a booth — and an
    // armband or a feather banked by an earlier run stays invisible until one read happens.
    if (!snap.bankKnown) {
        return egress(snap, { kind: 'scanBank' });
    }
    if (heldId(snap, HERO_ID.COINS) < LOW_COINS && snap.bankCoins > 0) {
        return egress(snap, {
            kind: 'withdraw',
            items: [{ name: HERO_NAMED.COINS, qty: Math.min(COIN_TOP_UP, snap.bankCoins), id: HERO_ID.COINS }]
        });
    }
    if (stage === HERO_STAGE.NOT_STARTED) {
        return {
            kind: 'custom',
            name: 'apply to the Heroes Guild',
            run: log => talkAndClose(ACHIETTIES, ACHIETTIES.prefer, log)
        };
    }

    const gang = heroGang();
    // Why: the trades outrank the gang legs — the rival is standing at the rendezvous waiting, and every
    // other leg on this side of the quest is blocked until the key or the candlestick has moved.
    const handoff = decideHeroHandoff({
        gang,
        stage,
        hasKey: heldId(snap, HERO_ID.MISC_KEY) > 0,
        candlesticks: heldId(snap, HERO_ID.CANDLESTICK),
        partnerConfigured: partnerConfigured(),
        ready: gang !== 'phoenix' || snipeKitStep(snap) === null
    });
    if (handoff) {
        return heroHandoffStep(handoff);
    }

    if (anywhere(snap, HERO_ID.ARMBAND) === 0) {
        const armband = gang === 'phoenix'
            ? phoenixArmbandStep(snap, stage)
            : blackarmArmbandStep(snap, stage);
        if (armband) {
            return egress(snap, armband);
        }
        return {
            kind: 'wait',
            reason: partnerConfigured()
                ? `waiting on ${HeroConfig.partner} at stage ${stage}`
                : 'Heroes Quest needs a rival-gang partner — set heroPartner'
        };
    }

    // Why: Entrana is a one-ferry island with no walkable route home, so a bot standing on it settles
    // the feather leg before the chain order gets a say.
    if (onEntrana(snap.tile)) {
        return featherStep(snap) ?? handInStep(snap);
    }
    return egress(snap, eelStep(snap) ?? featherStep(snap) ?? handInStep(snap));
}

// Why: a restart taken mid-leg can leave a bot standing in either Taverley pocket, and both of those
// doors open from the inside without a key — the way out is never the way in.
function egress(snap: QuestSnapshot, step: QuestStep): QuestStep {
    if (!NEEDS_STREET.has(step.kind)) {
        return step;
    }
    if (inDeepDungeon(snap.tile)) {
        return { kind: 'custom', name: 'leave the deep dungeon', run: leaveDeepDungeon };
    }
    if (inVelrakCell(snap.tile)) {
        return { kind: 'custom', name: "leave Velrak's cell", run: freeVelrak };
    }
    if (!inSealedPocket(snap)) {
        return step;
    }
    return { kind: 'custom', name: 'leave the sealed Brimhaven pocket', run: returnToStreet };
}

export const heroquest: QuestModule = {
    record: QUESTS.find(r => r.id === 'hero')!,
    // Why: the quest works in six kingdoms, so no one booth is close to more than a leg of it.
    bank: 'nearest',
    // Why: the disguise, the bow, the herb chain and the Entrana strip are all bought or banked at the
    // point of use, never provisioned up front.
    ownsInventory: true,
    hops: [TAVERLEY_HOP_DOWN, TAVERLEY_HOP_UP],
    grind: ['Chaos druid', 'Grip', 'Ice Queen', 'Jailer'],
    tools: [
        HERO_NAMED.ICE_GLOVES, HERO_NAMED.FEATHER, HERO_NAMED.LAVA_EEL, HERO_NAMED.ARMBAND,
        HERO_NAMED.OILY_ROD, HERO_NAMED.FISHING_BAIT, HERO_NAMED.CANDLESTICK, HERO_NAMED.MISC_KEY,
        HERO_NAMED.JAIL_KEY, HERO_NAMED.DUSTY_KEY
    ],
    // Literals, not QuestFood.name: this object is built at import, when the setting still holds its default.
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.5 },
    readProgress: readHeroQuestProgress,
    // Why: Grip refuses a Black Arm attacker and only a Phoenix bot can shoot him, while the treasure
    // door and the chest answer only to the Black Arm bot — neither half finishes alone.
    warnReadiness: () => partnerConfigured()
        ? null
        : "Hero's Quest needs a rival-gang partner — the armband cannot be earned alone",
    decide
};

export { HERO_STAGE };
