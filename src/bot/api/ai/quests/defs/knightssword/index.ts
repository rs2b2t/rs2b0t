import { Skills } from '../../../../skills/Skills.js';
import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { QuestFood } from '../../food.js';
import { KS_ID, KS_NAME, KS_STAGE, RELDO, SQUIRE, THURGO } from './areas.js';
import { mineBlurite } from './dungeon.js';
import { readKnightsSwordProgress } from './journal.js';
import { fetchPortrait } from './portrait.js';
import { bankedId, heldId, ironBarsAt, kit, pie, pieDish } from './supplies.js';

const FOOD_TARGET = 14;
const FOOD_LOW = 5;

const talk = (stop: typeof SQUIRE): QuestStep => ({ kind: 'talk', stop });

function foodWant(snap: QuestSnapshot): { name: string; held: number; target: number; low: number } | null {
    const name = QuestFood.name?.trim();
    if (!name) {
        return null;
    }
    return {
        name,
        held: snap.inv.get(name.toLowerCase()) ?? 0,
        target: FOOD_TARGET,
        low: FOOD_LOW
    };
}

/**
 * `squire_status_report` at stage 6 has one branch per place the sword can be,
 * and only the pack completes the quest.
 */
function swordStep(snap: QuestSnapshot): QuestStep | null {
    if (snap.wornIds?.has(KS_ID.BLURITE_SWORD) ?? false) {
        return { kind: 'equip', item: KS_NAME.BLURITE_SWORD };
    }
    if (heldId(snap, KS_ID.BLURITE_SWORD) > 0) {
        return talk(SQUIRE);
    }
    if (bankedId(snap, KS_ID.BLURITE_SWORD) > 0) {
        return {
            kind: 'withdraw',
            items: [{ name: KS_NAME.BLURITE_SWORD, qty: 1, id: KS_ID.BLURITE_SWORD }]
        };
    }
    return null;
}

function materials(snap: QuestSnapshot, miningLevel: number): QuestStep {
    const sword = swordStep(snap);
    if (sword) {
        return sword;
    }
    if (heldId(snap, KS_ID.IRON_BAR) < 2) {
        return ironBarsAt(snap, miningLevel);
    }
    if (heldId(snap, KS_ID.BLURITE_ORE) === 0) {
        // Stock up above ground; kit() refuses to send the bot back out of the cave.
        return kit(snap, foodWant(snap)) ?? { kind: 'custom', name: 'mine blurite', run: mineBlurite };
    }
    return talk(THURGO);
}

export function decideAt(snap: QuestSnapshot, miningLevel: number): QuestStep {
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
    const float = kit(snap);
    if (float) {
        return float;
    }
    switch (stage) {
        case KS_STAGE.NOT_STARTED:
            return talk(SQUIRE);
        case KS_STAGE.STARTED:
            // Why: the dish's only non-members source is a ground spawn thirteen tiles from the librarian, so it rides this leg rather than its own trip.
            // Why: it is routed through supplies so both callers agree where a dish comes from.
            if (heldId(snap, KS_ID.PIE_DISH) === 0 && bankedId(snap, KS_ID.PIE_DISH) === 0) {
                return pieDish(snap);
            }
            return talk(RELDO);
        case KS_STAGE.SPOKEN_RELDO:
            return heldId(snap, KS_ID.REDBERRY_PIE) > 0 ? talk(THURGO) : pie(snap);
        case KS_STAGE.GIVEN_PIE:
            return talk(THURGO);
        case KS_STAGE.SPOKEN_THURGO:
            return talk(SQUIRE);
        case KS_STAGE.LOOKING_PORTRAIT:
            return heldId(snap, KS_ID.PORTRAIT) > 0
                ? talk(THURGO)
                : { kind: 'custom', name: 'take the portrait', run: fetchPortrait };
        case KS_STAGE.LOOKING_BLURITE:
            return materials(snap, miningLevel);
        default:
            return { kind: 'done' };
    }
}

export const decide = (snap: QuestSnapshot): QuestStep => decideAt(snap, Skills.level('mining'));

export const knightssword: QuestModule = {
    record: QUESTS.find(r => r.id === 'squire')!,
    // Four towns, and bank contents are global — pinning one booth buys nothing
    // and costs a kingdom-crossing on every leg that touches it.
    bank: 'nearest',
    // `coins` is not optional for a quest that buys anything: without it the
    // spillover deposit banks the float and every purchase parks on "need gp".
    tools: [
        'coins', 'pickaxe', 'pie dish', 'pot of flour', 'redberries', 'bucket',
        'pastry dough', 'pie shell', 'uncooked berry pie', 'redberry pie',
        'iron ore', 'iron bar', 'blurite ore', 'portrait', 'blurite sword'
    ],
    ownsInventory: true,
    // Literals, not QuestFood.name: this object is built at import, when the
    // setting still holds its default. The host merges the configured food in.
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.6 },
    readProgress: readKnightsSwordProgress,
    decide
};
