import { describe, expect, test } from 'bun:test';
import { BIO_ITEM, VIALS, bioArea, inGuidorQuarter, inPigeonZone } from '#/bot/api/ai/quests/defs/biohazard/areas.js';
import { BIO_STAGE } from '#/bot/api/ai/quests/defs/biohazard/journal.js';
import { biohazard, decide } from '#/bot/api/ai/quests/defs/biohazard/index.js';
import { FOOD } from '#/bot/api/ai/quests/defs/biohazard/supplies.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const ARDOUGNE = { x: 2616, z: 3332, level: 0 };
const WEST = { x: 2529, z: 3304, level: 0 };
const HQ = { x: 2551, z: 3321, level: 0 };
const HQ_TOP = { x: 2550, z: 3326, level: 1 };
const QUARTER = { x: 3270, z: 3390, level: 0 };
const RIMMINGTON = { x: 2934, z: 3211, level: 0 };

const PURSE = new Map([[BIO_ITEM.COINS.id, 2_000_000]]);

function snapshot(o: Partial<QuestSnapshot> = {}): QuestSnapshot {
    return {
        journal: o.journal ?? 'inProgress',
        inv: o.inv ?? new Map(),
        invIds: o.invIds ?? new Map(),
        worn: o.worn ?? new Set(),
        wornIds: o.wornIds ?? new Set(),
        noProgress: o.noProgress ?? 0,
        bankCoins: o.bankCoins ?? 0,
        stage: o.stage,
        progress: o.progress,
        bank: o.bank ?? new Map(),
        bankIds: o.bankIds ?? PURSE,
        bankKnown: o.bankKnown ?? true,
        tile: o.tile === undefined ? ARDOUGNE : o.tile,
        freeSlots: o.freeSlots ?? 28
    };
}

const carrying = (...items: [{ id: number }, number][]): Map<number, number> =>
    new Map(items.map(([item, qty]) => [item.id, qty]));

const name = (step: QuestStep): string => (step.kind === 'custom' ? step.name : step.kind);

/** What the distraction leg draws before it starts: the meal and the priest suit's float. */
const PROVISIONED = carrying([FOOD, 5], [BIO_ITEM.COINS, 5000]);

const ALL_VIALS = carrying(...VIALS.map(vial => [vial, 1] as [{ id: number }, number]));
const KIT = new Map([
    ...ALL_VIALS,
    [BIO_ITEM.PLAGUE_SAMPLE.id, 1],
    [BIO_ITEM.TOUCH_PAPER.id, 1],
    [BIO_ITEM.PRIEST_GOWN.id, 1],
    [BIO_ITEM.PRIEST_ROBE.id, 1]
]);

describe('biohazard areas', () => {
    test('the headquarters building is its own area, not West Ardougne', () => {
        expect(bioArea(HQ)).toBe('hq');
        expect(bioArea(WEST)).toBe('west');
        expect(bioArea(HQ_TOP)).toBe('hqUpstairs');
    });

    test('Omart stands on the mainland and Kilron on the West Ardougne side', () => {
        expect(bioArea({ x: 2559, z: 3266, level: 0 })).toBe('mainland');
        expect(bioArea({ x: 2556, z: 3266, level: 0 })).toBe('west');
    });

    test("King Lathas's floor is not mistaken for the mainland", () => {
        expect(bioArea({ x: 2578, z: 3293, level: 1 })).toBe('castleUpstairs');
    });

    test('the pigeon-release box is the one the cage script checks', () => {
        expect(inPigeonZone({ x: 2564, z: 3303, level: 0 })).toBe(true);
        expect(inPigeonZone({ x: 2558, z: 3303, level: 0 })).toBe(false);
        expect(inPigeonZone({ x: 2564, z: 3308, level: 0 })).toBe(false);
    });

    test("Guidor's quarter excludes Varrock proper, where the gate would take the vials", () => {
        expect(inGuidorQuarter(QUARTER)).toBe(true);
        expect(inGuidorQuarter({ x: 3285, z: 3381, level: 0 })).toBe(true);
        expect(inGuidorQuarter({ x: 3212, z: 3428, level: 0 })).toBe(false);
    });
});

describe('biohazard decide — terminal and guard cases', () => {
    test('a complete journal is done', () => {
        expect(decide(snapshot({ journal: 'complete' })).kind).toBe('done');
    });

    test('an unloaded journal waits — it is not notStarted', () => {
        expect(decide(snapshot({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('an unknown tile waits rather than guessing an area', () => {
        expect(decide(snapshot({ tile: null, stage: BIO_STAGE.STARTED })).kind).toBe('wait');
    });

    test('an unreadable stage waits', () => {
        expect(decide(snapshot({ stage: undefined })).kind).toBe('wait');
    });

    test('an unread bank is scanned before any stage decides', () => {
        expect(decide(snapshot({ stage: BIO_STAGE.STARTED, bankKnown: false })).kind).toBe('scanBank');
    });

    test('a nearly full pack banks spillover on the mainland', () => {
        expect(decide(snapshot({ stage: BIO_STAGE.STARTED, freeSlots: 2 })).kind).toBe('deposit');
    });

    test('a full pack inside the headquarters does not try to bank there', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.POISONED_STEW,
            tile: HQ_TOP,
            freeSlots: 1,
            invIds: carrying([BIO_ITEM.DOCTOR_GOWN, 1], [BIO_ITEM.MOURNER_KEY, 1])
        }));
        expect(step.kind).not.toBe('deposit');
    });
});

describe('biohazard decide — the wall crossing', () => {
    test('the quest starts with Elena', () => {
        expect(name(decide(snapshot({ stage: BIO_STAGE.NOT_STARTED })))).toBe('ask Elena about her distillator');
    });

    test('a started quest asks Jerico', () => {
        expect(name(decide(snapshot({ stage: BIO_STAGE.STARTED })))).toBe('ask Jerico how to cross the wall');
    });

    test('the seed comes before the birds', () => {
        expect(name(decide(snapshot({ stage: BIO_STAGE.SPOKEN_JERICO, invIds: PROVISIONED }))))
            .toBe("take bird feed from Jerico's cupboard");
    });

    test('banked bird feed is withdrawn, as the cupboard refuses a second bag', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.SPOKEN_JERICO,
            invIds: PROVISIONED,
            bankIds: new Map([...PURSE, [BIO_ITEM.BIRDFEED.id, 1]])
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('the birds are fetched before the tower is fed', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.SPOKEN_JERICO,
            invIds: new Map([...PROVISIONED, [BIO_ITEM.BIRDFEED.id, 1]])
        }));
        expect(name(step)).toBe("take a pigeon cage from behind Jerico's house");
    });

    test('with seed and birds in the pack the tower gets fed', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.SPOKEN_JERICO,
            invIds: new Map([...PROVISIONED, [BIO_ITEM.BIRDFEED.id, 1], [BIO_ITEM.PIGEONS.id, 1]])
        }));
        expect(name(step)).toBe('throw the bird feed onto the watchtower');
    });

    test("the priest suit's coins come out beside the Ardougne booth, not beside Thessalia", () => {
        const step = decide(snapshot({ stage: BIO_STAGE.SPOKEN_JERICO, invIds: carrying([FOOD, 5]) }));
        expect(step.kind).toBe('withdraw');
    });

    test('a fed tower releases the pigeons', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.USED_BIRDFEED,
            invIds: carrying([BIO_ITEM.PIGEONS, 1])
        }));
        expect(name(step)).toBe('open the pigeon cage by the wall');
    });

    test('a lost cage is re-fetched rather than opened', () => {
        expect(name(decide(snapshot({ stage: BIO_STAGE.USED_BIRDFEED }))))
            .toBe("take a pigeon cage from behind Jerico's house");
    });

    test('the meal comes out at Jerico, nine tiles from the booth, not at the wall', () => {
        const bank = new Map([...PURSE, [FOOD.id, 20]]);
        expect(decide(snapshot({ stage: BIO_STAGE.SPOKEN_JERICO, bankIds: bank })).kind).toBe('withdraw');
    });

    test('an empty larder and an empty purse never block the distraction leg', () => {
        const step = decide(snapshot({ stage: BIO_STAGE.SPOKEN_JERICO, bankIds: new Map() }));
        expect(name(step)).toBe("take bird feed from Jerico's cupboard");
    });

    test('released pigeons go straight to the ladder', () => {
        expect(name(decide(snapshot({ stage: BIO_STAGE.RELEASED_PIGEONS }))))
            .toBe("cross the wall on Omart's rope ladder");
    });
});

describe('biohazard decide — West Ardougne', () => {
    test('the apples come before the cauldron', () => {
        expect(name(decide(snapshot({ stage: BIO_STAGE.CLIMBED_LADDER, tile: WEST }))))
            .toBe('take the rotten apples in West Ardougne');
    });

    test('holding the apples, the stew is poisoned', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.CLIMBED_LADDER,
            tile: WEST,
            invIds: carrying([BIO_ITEM.ROTTEN_APPLES, 1])
        }));
        expect(name(step)).toBe("poison the mourners' stew");
    });

    test('a poisoned stew on the mainland crosses back west first', () => {
        expect(name(decide(snapshot({ stage: BIO_STAGE.CLIMBED_LADDER }))))
            .toBe("cross the wall on Omart's rope ladder");
    });

    test('the gown comes from the nurse when nobody owns one', () => {
        expect(name(decide(snapshot({ stage: BIO_STAGE.POISONED_STEW, tile: WEST }))))
            .toBe("search the nurse's cupboard for a doctors' gown");
    });

    test('a banked gown is withdrawn, as the cupboard checks the bank too', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.POISONED_STEW,
            bankIds: new Map([...PURSE, [BIO_ITEM.DOCTOR_GOWN.id, 1]])
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('a worn gown counts as owned and the key leg starts', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.POISONED_STEW,
            tile: WEST,
            wornIds: new Set([BIO_ITEM.DOCTOR_GOWN.id])
        }));
        expect(name(step)).toBe('take the key off the sick mourner');
    });

    test('with the key in hand the crate is searched', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.POISONED_STEW,
            tile: HQ_TOP,
            wornIds: new Set([BIO_ITEM.DOCTOR_GOWN.id]),
            invIds: carrying([BIO_ITEM.MOURNER_KEY, 1])
        }));
        expect(name(step)).toBe("search the crate for Elena's distillator");
    });

    test('the distillator goes back to Elena over the wall', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.FOUND_DISTILLATOR,
            tile: HQ_TOP,
            invIds: carrying([BIO_ITEM.DISTILLATOR, 1])
        }));
        expect(name(step)).toBe('leave for the East Ardougne side');
    });

    test("Elena's four-item hand-back gets the slots it needs first", () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.FOUND_DISTILLATOR,
            invIds: carrying([BIO_ITEM.DISTILLATOR, 1]),
            freeSlots: 4
        }));
        expect(step.kind).toBe('deposit');
    });

    test('with room in the pack the distillator is handed over', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.FOUND_DISTILLATOR,
            invIds: carrying([BIO_ITEM.DISTILLATOR, 1])
        }));
        expect(name(step)).toBe('hand Elena her distillator');
    });

    test('a lost distillator is looked for in the crate again', () => {
        expect(name(decide(snapshot({ stage: BIO_STAGE.FOUND_DISTILLATOR, tile: HQ }))))
            .toBe("search the crate for Elena's distillator");
    });
});

describe('biohazard decide — the smuggle to Varrock', () => {
    const heldKit = (extra: Partial<Record<number, number>> = {}): Map<number, number> =>
        new Map([...KIT, ...Object.entries(extra).map(([id, qty]) => [Number(id), qty ?? 0] as [number, number])]);

    test('the chemist is asked for touch paper once Elena has handed the vials over', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.GIVEN_DISTILLATOR,
            invIds: new Map([...ALL_VIALS, [BIO_ITEM.PLAGUE_SAMPLE.id, 1]])
        }));
        expect(name(step)).toBe('ask the chemist for touch paper');
    });

    test('a sample nobody has is asked back from Elena rather than walked to Rimmington', () => {
        expect(name(decide(snapshot({ stage: BIO_STAGE.GIVEN_DISTILLATOR }))))
            .toBe('ask Elena to replace the sample she gave me');
    });

    test('a banked vial is withdrawn before Elena is asked for another', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.SPOKEN_CHEMIST,
            invIds: carrying([BIO_ITEM.PLAGUE_SAMPLE, 1], [BIO_ITEM.TOUCH_PAPER, 1]),
            bankIds: new Map([...PURSE, [BIO_ITEM.ETHENEA.id, 1]])
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('vials in the pack outside the quarter go to the errand boys', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.SPOKEN_CHEMIST,
            tile: RIMMINGTON,
            invIds: heldKit()
        }));
        expect(name(step)).toBe('give the errand boys their vials');
    });

    test('an empty purse is filled before the walk to Thessalia', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.SPOKEN_CHEMIST,
            tile: RIMMINGTON,
            invIds: carrying([BIO_ITEM.PLAGUE_SAMPLE, 1], [BIO_ITEM.TOUCH_PAPER, 1])
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('with the vials away and coins in hand the priest suit is bought before the gate', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.SPOKEN_CHEMIST,
            tile: RIMMINGTON,
            invIds: carrying([BIO_ITEM.PLAGUE_SAMPLE, 1], [BIO_ITEM.TOUCH_PAPER, 1], [BIO_ITEM.COINS, 5000])
        }));
        expect(name(step)).toBe('buy a priest gown from Thessalia');
    });

    test('a robed bot with no vials crosses into the quarter', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.SPOKEN_CHEMIST,
            tile: RIMMINGTON,
            invIds: carrying(
                [BIO_ITEM.PLAGUE_SAMPLE, 1],
                [BIO_ITEM.TOUCH_PAPER, 1],
                [BIO_ITEM.PRIEST_GOWN, 1],
                [BIO_ITEM.PRIEST_ROBE, 1]
            )
        }));
        expect(name(step)).toBe("walk through the gate to Varrock's east quarter");
    });

    test('inside the quarter the vials are collected from the inn', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.SPOKEN_CHEMIST,
            tile: QUARTER,
            invIds: carrying(
                [BIO_ITEM.PLAGUE_SAMPLE, 1],
                [BIO_ITEM.TOUCH_PAPER, 1],
                [BIO_ITEM.PRIEST_GOWN, 1],
                [BIO_ITEM.PRIEST_ROBE, 1]
            )
        }));
        expect(name(step)).toBe('collect the vials at the Dancing Donkey');
    });

    test('boys who keep coming back empty send the bot to Elena for replacements', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.SPOKEN_CHEMIST,
            tile: QUARTER,
            noProgress: 3,
            invIds: carrying(
                [BIO_ITEM.PLAGUE_SAMPLE, 1],
                [BIO_ITEM.TOUCH_PAPER, 1],
                [BIO_ITEM.PRIEST_GOWN, 1],
                [BIO_ITEM.PRIEST_ROBE, 1]
            )
        }));
        expect(name(step)).toBe('ask Elena to replace the vials the errand boys ruined');
    });

    test('the kit in the quarter goes to Guidor', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.SPOKEN_CHEMIST,
            tile: QUARTER,
            invIds: heldKit()
        }));
        expect(name(step)).toBe('take the kit to Guidor');
    });

    test('a banked vial is never withdrawn inside the quarter — the gate would take it back', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.SPOKEN_CHEMIST,
            tile: QUARTER,
            invIds: carrying([BIO_ITEM.PLAGUE_SAMPLE, 1], [BIO_ITEM.TOUCH_PAPER, 1]),
            bankIds: new Map([...PURSE, [BIO_ITEM.ETHENEA.id, 1]])
        }));
        expect(step.kind).not.toBe('withdraw');
        expect(name(step)).toBe('collect the vials at the Dancing Donkey');
    });

    test('a bank leg decided inside the sealed headquarters leaves first', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.POISONED_STEW,
            tile: { x: 2551, z: 3321, level: 0 },
            bankKnown: false
        }));
        expect(name(step)).toBe('leave for the East Ardougne side');
    });

    test('lost touch paper is asked for again before anything else', () => {
        const step = decide(snapshot({
            stage: BIO_STAGE.SPOKEN_CHEMIST,
            tile: QUARTER,
            invIds: new Map([...ALL_VIALS, [BIO_ITEM.PLAGUE_SAMPLE.id, 1]])
        }));
        expect(name(step)).toBe('ask the chemist for touch paper');
    });
});

describe('biohazard decide — the ending', () => {
    test("Guidor's findings are reported to Elena", () => {
        expect(name(decide(snapshot({ stage: BIO_STAGE.FOUND_SECRET }))))
            .toBe('tell Elena what Guidor found');
    });

    test('a reported hoax is taken to King Lathas', () => {
        expect(name(decide(snapshot({ stage: BIO_STAGE.REPORTED_ELENA }))))
            .toBe('confront King Lathas about the plague');
    });

    test('a stage past the ladder reached from the castle floor walks out first', () => {
        expect(name(decide(snapshot({ stage: BIO_STAGE.FOUND_SECRET, tile: { x: 2578, z: 3293, level: 1 } }))))
            .toBe('leave for the East Ardougne side');
    });
});

describe('biohazard module wiring', () => {
    test('the record is the Biohazard row and requires Plague City', () => {
        expect(biohazard.record.id).toBe('biohazard');
        expect(biohazard.record.requirements.quests).toContain('elena');
    });

    test('the module owns its inventory, as three towns supply it', () => {
        expect(biohazard.ownsInventory).toBe(true);
        expect(biohazard.bank).toBe('nearest');
    });
});
