// docs/QUESTS.md
import { Equipment } from '../../../../equipment/Equipment.js';
import { gearOf } from '../../../../loadout/loadoutPlan.js';
import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { QuestFood } from '../../food.js';
import { QuestLoadout } from '../../gear.js';
import {
    CHARLIE,
    GLOUGH,
    GT_HOPS,
    GT_ITEMS,
    GT_OBJ,
    GT_PILLARS,
    GT_STAGE,
    HAZELMERE,
    NARNODE,
    NARNODE_UNDER,
    inCaves,
    inKaramja,
    inStronghold
} from './areas.js';
import { descendTrapdoor, fightBlackDemon } from './fight.js';
import { readGrandTreeStage } from './journal.js';
import {
    anitaKey,
    descendGloughTree,
    femiCart,
    foremanOrder,
    jailedByGlough,
    leaveCaves,
    openChest,
    placeTwig,
    searchCupboard,
    searchNextRoot,
    startQuest,
    giveRock,
    flyToKaramja
} from './legs.js';

/** Lobsters to have in the pack before dropping in on the demon. */
const DEMON_FOOD = 8;

/** Gear the bank turned out not to hold; asking for it again is a bank trip a fight does not have. */
const unavailable = new Set<string>();

function custom(name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep {
    return { kind: 'custom', name, run };
}

function held(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

function foodName(): string | null {
    return QuestFood.name;
}

function keepList(): string[] {
    const food = foodName()?.toLowerCase();
    return [...GT_ITEMS, 'coins', ...(food ? [food] : [])];
}

// Why: the King hands over two items at the start and four twigs at stage 110, and each refuses outright when the pack is short.

/** Bank spare junk when the pack has no room for what the next talk hands over. */
function roomFor(snap: QuestSnapshot, slots: number): QuestStep | null {
    if ((snap.freeSlots ?? 28) >= slots) {
        return null;
    }
    return { kind: 'deposit', keep: keepList() };
}

function wearAll(names: readonly string[]): QuestStep {
    return custom(`wear ${names.join(', ')}`, async log => {
        for (const name of names) {
            if (Equipment.contains(name) || (await Equipment.equip(name))) {
                continue;
            }
            log(`cannot wear ${name} — shedding it and fighting without`);
            unavailable.add(name.toLowerCase());
        }
        return true;
    });
}

// Why: the demon has 157 hitpoints and 152 defence, so what the pack is carrying sets how long the fight runs — and Family Crest's lesson is that preparation must stop at the door, or a decide() mid-fight walks the bot out to re-bank.

/** Kit and food, resolved once and only while the trapdoor is still shut. */
function demonKit(snap: QuestSnapshot): QuestStep | null {
    const want = gearOf(QuestLoadout.current)
        .filter(name => !snap.worn.has(name.toLowerCase()) && !unavailable.has(name.toLowerCase()));
    const food = foodName();
    const shortFood = food !== null && (snap.inv.get(food.toLowerCase()) ?? 0) < DEMON_FOOD;
    if (want.length === 0 && !shortFood) {
        return null;
    }
    const missing = want.filter(name => (snap.inv.get(name.toLowerCase()) ?? 0) === 0);
    if (missing.length === 0 && !shortFood) {
        return wearAll(want);
    }
    if (snap.bankKnown !== true) {
        return { kind: 'scanBank' };
    }
    const draw = missing
        .filter(name => (snap.bank?.get(name.toLowerCase()) ?? 0) > 0)
        .map(name => ({ name, qty: 1 }));
    if (shortFood && food !== null && (snap.bank?.get(food.toLowerCase()) ?? 0) > 0) {
        draw.push({ name: food, qty: DEMON_FOOD - (snap.inv.get(food.toLowerCase()) ?? 0) });
    }
    if (draw.length > 0) {
        return { kind: 'withdraw', items: draw };
    }
    for (const name of missing) {
        unavailable.add(name.toLowerCase());
    }
    return want.length > missing.length ? wearAll(want.filter(n => !unavailable.has(n.toLowerCase()))) : null;
}

// Why: the twigs are re-issued by the King whenever none is held, and one already lying on its pillar counts as neither held nor lost — so an empty pack at stage 120 is the only honest ask.

/** The next twig to lay, or null when the pack holds none. */
function nextTwig(snap: QuestSnapshot): number | null {
    const index = GT_PILLARS.findIndex(p => held(snap, p.obj) > 0);
    return index === -1 ? null : index;
}

// Why: Anita re-issues the key and the chest re-issues the plans whenever neither the pack nor the bank holds one, so a death between the two is a walk rather than a dead end.

/** Fetch the key, unlock the chest, and take Glough's invasion plans. */
function invasionPlans(snap: QuestSnapshot): QuestStep {
    return held(snap, GT_OBJ.KEY) > 0
        ? custom("unlock Glough's chest", openChest)
        : custom('ask Anita for the chest key', anitaKey);
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    const stage = snap.stage;
    if (stage === undefined) { return { kind: 'wait', reason: 'The Grand Tree journal stage unavailable' }; }

    // Why: the twig legs live on Glough's pillar floor, a seven-tile pocket with no baked way off it, so the kit is bought on the ground before the first climb rather than beside the trapdoor.
    // Why: a run that arrives up there still owing gear climbs back down for it — a bank step decided in the pocket has no route and burns its budget down to nothing proving so.
    if ((stage === GT_STAGE.GIVEN_TWIGS || stage === GT_STAGE.UNLOCKED_TRAPDOOR) && !inCaves(snap.tile)) {
        const kit = demonKit(snap);
        if (kit) {
            return (snap.tile?.level ?? 0) > 0
                ? custom("climb down out of Glough's tree for the kit", descendGloughTree)
                : kit;
        }
    }

    // Why: everything past the demon happens in the root caves, whose only mouth before the quest ends is Glough's trapdoor — so a death, or a run resumed on the surface, climbs back down before it can act.
    if (stage >= GT_STAGE.DEFEATED_BLACK_DEMON && stage < GT_STAGE.COMPLETE && !inCaves(snap.tile)) {
        return custom('drop back into the root caves', descendTrapdoor);
    }

    switch (stage) {
        case GT_STAGE.NOT_STARTED:
            return roomFor(snap, 2) ?? custom('start the quest with King Narnode', startQuest);
        case GT_STAGE.STARTED:
            // Why: Hazelmere hands nothing over without the sample, and `~check_narnode_items` is what replaces a lost one.
            return held(snap, GT_OBJ.BARK) > 0
                ? { kind: 'talk', stop: HAZELMERE }
                : roomFor(snap, 2) ?? { kind: 'talk', stop: NARNODE };
        case GT_STAGE.SPOKEN_HAZELMERE:
            return { kind: 'talk', stop: NARNODE };
        case GT_STAGE.RELAYED_MESSAGE:
            return { kind: 'talk', stop: GLOUGH };
        case GT_STAGE.SPOKEN_GLOUGH:
            return { kind: 'talk', stop: NARNODE };
        case GT_STAGE.FOUND_PRISONER:
            return { kind: 'talk', stop: CHARLIE };
        case GT_STAGE.SPOKEN_PRISONER:
            return custom("search Glough's cupboard", searchCupboard);
        case GT_STAGE.FOUND_JOURNAL:
            return custom('confront Glough and get out of his cage', jailedByGlough);
        case GT_STAGE.RELEASED_PRISON:
            return inKaramja(snap.tile)
                ? custom('get the lumber order from the foreman', foremanOrder)
                : custom('take the glider to Karamja', flyToKaramja);
        case GT_STAGE.OBTAINED_LUMBER_ORDER:
            return inStronghold(snap.tile)
                ? { kind: 'talk', stop: CHARLIE }
                : custom("ride Femi's cart into the stronghold", femiCart);
        case GT_STAGE.CLUE_CHARLIE:
            return invasionPlans(snap);
        case GT_STAGE.FOUND_INVASION_PLANS:
            if (held(snap, GT_OBJ.INVASION_PLANS) === 0) {
                return invasionPlans(snap);
            }
            return roomFor(snap, 4) ?? { kind: 'talk', stop: NARNODE };
        case GT_STAGE.GIVEN_TWIGS: {
            const twig = nextTwig(snap);
            return twig === null
                ? { kind: 'talk', stop: NARNODE }
                : custom(`lay twig ${twig + 1} of 4 on its pillar`, placeTwig(twig));
        }
        case GT_STAGE.UNLOCKED_TRAPDOOR:
            return custom('take the trapdoor and kill the Black Demon', fightBlackDemon);
        case GT_STAGE.DEFEATED_BLACK_DEMON:
            return { kind: 'talk', stop: NARNODE_UNDER };
        case GT_STAGE.SEARCHING_DACONIA:
            return held(snap, GT_OBJ.DACONIA) > 0
                ? custom('give the King the Daconia rock', giveRock)
                : custom('search the roots for the Daconia rock', searchNextRoot);
        default:
            return { kind: 'wait', reason: `unhandled Grand Tree stage ${stage}` };
    }
}

export const grandtree: QuestModule = {
    record: QUESTS.find(r => r.id === 'grandtree')!,
    bank: 'nearest',
    hops: GT_HOPS,
    food: 10,
    coinFloat: 2000,
    tools: [...GT_ITEMS],
    readStage: readGrandTreeStage,
    sustain: { foods: ['Lobster'], eatBelowHp: 0.6 },
    exit: leaveCaves,
    warnReadiness: () =>
        'The Grand Tree ends on a level-172 Black Demon (157 hitpoints, 152 defence). Proven at 70 across the board'
        + ' with a rune melee kit and Protect from Melee; below Prayer 43 it lands hits for the whole fight.',
    observe: (snap, step) => [
        `stage=${snap.stage ?? '?'} step=${step.kind} caves=${inCaves(snap.tile)}`
        + ` stronghold=${inStronghold(snap.tile)} karamja=${inKaramja(snap.tile)}`,
        `held: bark=${held(snap, GT_OBJ.BARK)} scroll=${held(snap, GT_OBJ.SCROLL)}`
        + ` journal=${held(snap, GT_OBJ.JOURNAL)} order=${held(snap, GT_OBJ.LUMBER_ORDER)}`
        + ` key=${held(snap, GT_OBJ.KEY)} plans=${held(snap, GT_OBJ.INVASION_PLANS)}`
        + ` twigs=${GT_PILLARS.filter(p => held(snap, p.obj) > 0).length}/4 rock=${held(snap, GT_OBJ.DACONIA)}`
    ],
    decide
};
