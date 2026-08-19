import { Inventory } from '../../../../inventory/Inventory.js';
import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { DIG_ID, DIG_ITEM, DIG_NPC, DIG_TILE, DIG_ZONE, inAltarCave, inDigCave, inShaftWest } from './areas.js';
import { barrelLeg, blastLeg, chestLeg, leaveCaveStep, mixStep, tabletLeg, westShaftLeg } from './caves.js';
import { bankedId, heldId, useOnNpcId } from './common.js';
import {
    DELIVER_GREEN,
    DELIVER_ORANGE,
    DELIVER_PURPLE,
    answered,
    examReady,
    replaceTrowel,
    searchBush,
    stampLetter,
    studyWithStudents,
    talkToExaminer
} from './exams.js';
import { DIG_STAGE, readDigsiteProgress } from './journal.js';
import {
    DigsiteState,
    SHOP,
    buy,
    digUntil,
    herbloreKit,
    kit,
    panUntil,
    pickpocketWorkman,
    takeSpecimenJar
} from './supplies.js';

/** Two, so one pickpocketing session ropes both winches. */
const ROPE_TARGET = 2;

function withdraw(name: string, qty: number, id: number): QuestStep {
    return { kind: 'withdraw', items: [{ name, qty, id }], bank: DIG_TILE.VARROCK_BANK };
}

/** Withdraw it when the bank has one, otherwise fall through to the world source. */
function fromBank(snap: QuestSnapshot, id: number, name: string, qty = 1): QuestStep | null {
    return bankedId(snap, id) > 0 ? withdraw(name, qty, id) : null;
}

function custom(name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep {
    return { kind: 'custom', name, run };
}

function useOnExpert(itemId: number, name: string, expect: () => boolean): QuestStep {
    return custom(name, log => useOnNpcId(itemId, DIG_NPC.EXPERT, DIG_TILE.EXPERT, expect, log));
}

function ropeStep(snap: QuestSnapshot): QuestStep | null {
    if (heldId(snap, DIG_ID.ROPE) > 0) {
        return null;
    }
    const banked = fromBank(snap, DIG_ID.ROPE, DIG_ITEM.ROPE, ROPE_TARGET);
    if (banked) {
        return banked;
    }
    return custom(
        `pickpocket the workmen for ${ROPE_TARGET} ropes`,
        log => pickpocketWorkman(() => Inventory.countById(DIG_ID.ROPE) >= ROPE_TARGET, log)
    );
}

function tinderboxStep(snap: QuestSnapshot): QuestStep | null {
    if (heldId(snap, DIG_ID.TINDERBOX) > 0) {
        return null;
    }
    return fromBank(snap, DIG_ID.TINDERBOX, DIG_ITEM.TINDERBOX) ?? buy(DIG_ITEM.TINDERBOX, 1, SHOP.GENERAL, 200);
}

function trowelStep(snap: QuestSnapshot): QuestStep | null {
    if (heldId(snap, DIG_ID.TROWEL) > 0) {
        return null;
    }
    return fromBank(snap, DIG_ID.TROWEL, DIG_ITEM.TROWEL) ?? replaceTrowel();
}

// Why: the guide only steps in on a pan he objects to, so the refused attempt is what asks for the tea and the answer needs remembering for one purchase.

/** The cup of tea a refused pan asked for, or null while the river is open. */
function panningGate(snap: QuestSnapshot): QuestStep | null {
    if (!DigsiteState.teaWanted || heldId(snap, DIG_ID.CUP_OF_TEA) > 0) {
        return null;
    }
    return fromBank(snap, DIG_ID.CUP_OF_TEA, DIG_ITEM.CUP_OF_TEA) ?? buy(DIG_ITEM.CUP_OF_TEA, 1, SHOP.TEA, 200);
}

function panFor(id: number, label: string): QuestStep {
    return custom(label, log => panUntil(() => Inventory.countById(id) > 0, log));
}

/** Exam 1 is three errands: a stolen sample, a sample in a bush and a sample in the river. */
function firstExamPlan(snap: QuestSnapshot): QuestStep {
    if (!answered(snap, 'green-answered')) {
        if (heldId(snap, DIG_ID.ROCK_SAMPLE_GREEN) > 0) {
            return DELIVER_GREEN();
        }
        return custom(
            "pickpocket the workmen for the green student's sample",
            log => pickpocketWorkman(() => Inventory.countById(DIG_ID.ROCK_SAMPLE_GREEN) > 0, log)
        );
    }
    if (!answered(snap, 'purple-answered')) {
        if (heldId(snap, DIG_ID.ROCK_SAMPLE_PURPLE) > 0) {
            return DELIVER_PURPLE();
        }
        return searchBush();
    }
    if (!answered(snap, 'orange-answered')) {
        if (heldId(snap, DIG_ID.ROCK_SAMPLE_ORANGE) > 0) {
            return DELIVER_ORANGE();
        }
        return panningGate(snap) ?? panFor(DIG_ID.ROCK_SAMPLE_ORANGE, "pan the river for the orange student's sample");
    }
    return talkToExaminer('sit the first Earth Sciences exam');
}

/** Exam 3's third errand is an opal, which the river gives up uncut. */
function thirdExamPlan(snap: QuestSnapshot): QuestStep {
    if (heldId(snap, DIG_ID.OPAL) > 0) {
        return studyWithStudents(DIG_STAGE.THIRD_EXAM);
    }
    if (heldId(snap, DIG_ID.UNCUT_OPAL) > 0) {
        if (heldId(snap, DIG_ID.CHISEL) === 0) {
            return fromBank(snap, DIG_ID.CHISEL, DIG_ITEM.CHISEL) ?? buy(DIG_ITEM.CHISEL, 1, SHOP.GENERAL, 200);
        }
        return { kind: 'useOn', item: DIG_ITEM.CHISEL, targetKind: 'item', target: DIG_ITEM.UNCUT_OPAL, anchor: DIG_TILE.STUDENTS, product: DIG_ITEM.OPAL };
    }
    return fromBank(snap, DIG_ID.OPAL, DIG_ITEM.OPAL)
        ?? fromBank(snap, DIG_ID.UNCUT_OPAL, DIG_ITEM.UNCUT_OPAL)
        ?? panningGate(snap)
        ?? panFor(DIG_ID.UNCUT_OPAL, 'pan the river for an opal');
}

/** Stage 5: find something on the site worth showing the expert, and take his letter to a workman. */
function impressPlan(snap: QuestSnapshot): QuestStep {
    if (heldId(snap, DIG_ID.EXPERT_SCROLL) > 0) {
        return custom('show the invitation letter to a workman', log =>
            useOnNpcId(DIG_ID.EXPERT_SCROLL, DIG_NPC.WORKMAN, DIG_TILE.WORKMEN, () => Inventory.countById(DIG_ID.EXPERT_SCROLL) === 0, log));
    }
    if (heldId(snap, DIG_ID.TALISMAN) > 0) {
        return useOnExpert(DIG_ID.TALISMAN, 'show the Zarosian talisman to the expert', () => Inventory.countById(DIG_ID.EXPERT_SCROLL) > 0);
    }
    const trowel = trowelStep(snap);
    if (trowel) {
        return trowel;
    }
    if (heldId(snap, DIG_ID.SPECIMEN_JAR) === 0) {
        return fromBank(snap, DIG_ID.SPECIMEN_JAR, DIG_ITEM.SPECIMEN_JAR)
            ?? custom('search the sacks for a specimen jar', takeSpecimenJar);
    }
    if (heldId(snap, DIG_ID.SPECIMEN_BRUSH) === 0) {
        return fromBank(snap, DIG_ID.SPECIMEN_BRUSH, DIG_ITEM.SPECIMEN_BRUSH)
            ?? custom('pickpocket the workmen for a specimen brush', log =>
                pickpocketWorkman(() => Inventory.countById(DIG_ID.SPECIMEN_BRUSH) > 0, log));
    }
    return custom('dig the level 3 site for a find', log =>
        digUntil(DIG_ZONE.LEVEL3, () => Inventory.countById(DIG_ID.TALISMAN) > 0, log));
}

/** Stage 6: four chemicals, two of them out of the shaft and the river bank. */
function compoundPlan(snap: QuestSnapshot, underground: boolean): QuestStep {
    const held = (id: number): number => heldId(snap, id);
    const mixed = held(DIG_ID.PRE_CHARCOAL) > 0 || held(DIG_ID.POST_CHARCOAL) > 0;
    const haveNitrate = held(DIG_ID.AMMONIUM_NITRATE) > 0 || mixed;
    const haveNitro = held(DIG_ID.NITROGLYCERIN) > 0 || mixed;
    const haveGround = held(DIG_ID.GROUND_CHARCOAL) > 0 || held(DIG_ID.POST_CHARCOAL) > 0;

    if (held(DIG_ID.COMPOUND) > 0) {
        const tinderbox = underground ? null : tinderboxStep(snap);
        if (tinderbox) {
            return tinderbox;
        }
        const rope = underground ? null : ropeStep(snap);
        if (rope) {
            return rope;
        }
        return blastLeg(true);
    }

    const needKey = held(DIG_ID.CHEST_KEY) === 0 && held(DIG_ID.POWDER) === 0 && !haveNitrate;
    const needRoot = held(DIG_ID.ARCENIA_ROOT) === 0;
    if (needKey || needRoot) {
        if (underground) {
            return inShaftWest(snap.tile) ? westShaftLeg(needKey, needRoot) : leaveCaveStep();
        }
        return ropeStep(snap) ?? westShaftLeg(needKey, needRoot);
    }
    if (underground) {
        return leaveCaveStep();
    }

    // Why: the tinderbox counter is in Varrock and the vial counter is in Taverley, which is the same road — buying each at the step that needs it walks that road three times over.
    const tinderbox = tinderboxStep(snap);
    if (tinderbox) {
        return tinderbox;
    }
    const needVial = held(DIG_ID.VIAL) === 0 && held(DIG_ID.LIQUID) === 0 && !haveNitro;
    const needPestle = held(DIG_ID.PESTLE) === 0 && !haveGround;
    if (needVial || needPestle) {
        const bankedVial = needVial ? fromBank(snap, DIG_ID.VIAL, DIG_ITEM.VIAL) : null;
        const bankedPestle = needPestle ? fromBank(snap, DIG_ID.PESTLE, DIG_ITEM.PESTLE) : null;
        if (bankedVial ?? bankedPestle) {
            return (bankedVial ?? bankedPestle)!;
        }
        return herbloreKit(needVial, needPestle);
    }

    if (!haveNitrate) {
        if (held(DIG_ID.POWDER) > 0) {
            return useOnExpert(DIG_ID.POWDER, 'have the expert identify the powder', () => Inventory.countById(DIG_ID.AMMONIUM_NITRATE) > 0);
        }
        return chestLeg();
    }
    if (!haveNitro) {
        if (held(DIG_ID.LIQUID) > 0) {
            return useOnExpert(DIG_ID.LIQUID, 'have the expert identify the liquid', () => Inventory.countById(DIG_ID.NITROGLYCERIN) > 0);
        }
        const trowel = trowelStep(snap);
        if (trowel) {
            return trowel;
        }
        return barrelLeg();
    }
    if (!mixed) {
        return mixStep('mix the nitrate into the nitroglycerin', DIG_ID.AMMONIUM_NITRATE, DIG_ID.NITROGLYCERIN, DIG_ID.PRE_CHARCOAL);
    }
    if (!haveGround) {
        if (held(DIG_ID.CHARCOAL) === 0) {
            const trowel = trowelStep(snap);
            if (trowel) {
                return trowel;
            }
            return fromBank(snap, DIG_ID.CHARCOAL, DIG_ITEM.CHARCOAL)
                ?? custom('dig the training site for charcoal', log =>
                    digUntil(DIG_ZONE.TRAINING, () => Inventory.countById(DIG_ID.CHARCOAL) > 0, log));
        }
        return mixStep('grind the charcoal to a powder', DIG_ID.CHARCOAL, DIG_ID.PESTLE, DIG_ID.GROUND_CHARCOAL);
    }
    if (held(DIG_ID.POST_CHARCOAL) === 0) {
        return mixStep('mix the ground charcoal in', DIG_ID.PRE_CHARCOAL, DIG_ID.GROUND_CHARCOAL, DIG_ID.POST_CHARCOAL);
    }
    return mixStep('mix the arcenia root in', DIG_ID.POST_CHARCOAL, DIG_ID.ARCENIA_ROOT, DIG_ID.COMPOUND);
}

function plan(snap: QuestSnapshot, stage: number, underground: boolean): QuestStep {
    // Why: every leg but the shaft ones starts on the surface, and a bot left down a one-way winch spends three passes proving a surface tile unreachable.
    const surface = (step: QuestStep): QuestStep => (underground ? leaveCaveStep() : step);

    switch (stage) {
        case DIG_STAGE.NOT_STARTED:
            return surface(talkToExaminer('ask the Examiner about the Earth Sciences exams'));

        case DIG_STAGE.STAMPING:
            if (heldId(snap, DIG_ID.STAMPED_LETTER) > 0) {
                return surface(talkToExaminer('hand the stamped letter to the Examiner'));
            }
            if (heldId(snap, DIG_ID.PLAIN_LETTER) > 0) {
                return surface(stampLetter());
            }
            return surface(
                fromBank(snap, DIG_ID.STAMPED_LETTER, DIG_ITEM.STAMPED_LETTER)
                ?? fromBank(snap, DIG_ID.PLAIN_LETTER, DIG_ITEM.PLAIN_LETTER)
                ?? talkToExaminer('ask the Examiner to replace the lost letter')
            );

        case DIG_STAGE.FIRST_EXAM:
            return surface(examReady(snap) ? talkToExaminer('sit the first Earth Sciences exam') : firstExamPlan(snap));

        case DIG_STAGE.SECOND_EXAM:
            return surface(examReady(snap)
                ? talkToExaminer('sit the second Earth Sciences exam')
                : studyWithStudents(DIG_STAGE.SECOND_EXAM));

        case DIG_STAGE.THIRD_EXAM:
            return surface(examReady(snap) ? talkToExaminer('sit the third Earth Sciences exam') : thirdExamPlan(snap));

        case DIG_STAGE.IMPRESS_EXPERT:
            return surface(impressPlan(snap));

        case DIG_STAGE.MINESHAFT_PERMIT:
            return compoundPlan(snap, underground);

        case DIG_STAGE.POURED_COMPOUND: {
            if (inAltarCave(snap.tile)) {
                return tabletLeg();
            }
            const tinderbox = underground ? null : tinderboxStep(snap);
            if (tinderbox) {
                return tinderbox;
            }
            const rope = underground ? null : ropeStep(snap);
            if (rope) {
                return rope;
            }
            return blastLeg(false);
        }

        case DIG_STAGE.REMOVED_BLOCKAGE: {
            if (heldId(snap, DIG_ID.STONE_TABLET) > 0) {
                return surface(useOnExpert(DIG_ID.STONE_TABLET, 'show the stone tablet to the expert', () => Inventory.countById(DIG_ID.STONE_TABLET) === 0));
            }
            if (underground && !inAltarCave(snap.tile)) {
                return leaveCaveStep();
            }
            const rope = inAltarCave(snap.tile) ? null : ropeStep(snap);
            if (rope) {
                return rope;
            }
            return tabletLeg();
        }

        default:
            return { kind: 'wait', reason: `nothing planned for stage ${stage}` };
    }
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
    // Why: `ownsInventory` skips the engine's provisioning, so nothing else ever opens a booth and a banked trowel or vial stays invisible until one read happens.
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: DIG_TILE.VARROCK_BANK };
    }
    const underground = inDigCave(snap.tile);
    // Why: coins and food are the module's own business here, and a shaft has no booth to draw them from.
    const supplies = underground ? null : kit(snap);
    if (supplies) {
        return supplies;
    }
    return plan(snap, stage, underground);
}

function region(snap: QuestSnapshot): string {
    if (inAltarCave(snap.tile)) return 'altar cave';
    if (inShaftWest(snap.tile)) return 'west shaft';
    if (inDigCave(snap.tile)) return 'east shaft';
    return 'surface';
}

export const digsite: QuestModule = {
    record: QUESTS.find(r => r.id === 'itexam')!,
    // Why: the quest sits between Varrock and the dig site, and the east booth is the only one either end walks past.
    bank: DIG_TILE.VARROCK_BANK,
    // Why: nine of the ten items are acquired at the stage that needs them — stolen, panned, dug or mixed — which the engine's up-front provisioning cannot express.
    ownsInventory: true,
    tools: ['coins', 'trowel', 'specimen jar', 'specimen brush', 'panning tray', 'rope', 'vial', 'pestle and mortar', 'tinderbox', 'chisel'],
    // Literals, not QuestFood.name: this object is built at import, when the setting still holds its default.
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.5 },
    readProgress: readDigsiteProgress,
    observe: (snap, step) => [
        `stage ${snap.progress?.stage ?? snap.stage ?? '?'} · ${region(snap)} · flags [${[...(snap.progress?.flags ?? [])].join(', ')}]`,
        `step '${step.kind === 'custom' ? step.name : step.kind}' · teaWanted=${DigsiteState.teaWanted}`
    ],
    decide
};

export { DIG_STAGE };
