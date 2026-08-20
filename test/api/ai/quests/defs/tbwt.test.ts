import { describe, expect, test } from 'bun:test';

import {
    TB_ARMOUR,
    TB_ID,
    TB_LUBUFU,
    TB_MAIN,
    TB_NAME,
    TB_POTIONS,
    TB_SPEARS,
    TB_TAMAYU,
    TB_TIADECHE,
    TB_TINSAY
} from '#/bot/api/ai/quests/defs/tbwt/areas.js';
import { decide, tbwt } from '#/bot/api/ai/quests/defs/tbwt/index.js';
import { TB_FLAG } from '#/bot/api/ai/quests/defs/tbwt/journal.js';
import { QUEST_DEFS } from '#/bot/api/ai/quests/defs/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const VILLAGE = { x: 2780, z: 3087, level: 0 };

const IRON = TB_SPEARS[0]!;
const STEEL = TB_SPEARS[1]!;
const DOSE4 = TB_POTIONS[0]!;
const DOSE2 = TB_POTIONS[2]!;

/** The kit a 70-ranged account with a stocked bank ends up in. */
const KIT = ['Maple shortbow', 'Adamant arrow', ...TB_ARMOUR];

interface Options {
    journal?: QuestSnapshot['journal'];
    main?: number;
    lubufu?: number;
    tiadeche?: number;
    tamayu?: number;
    tinsay?: number;
    agility?: boolean;
    spear?: boolean;
    invIds?: [number, number][];
    /** Leave the pack short, so the supply pass is what answers. */
    bare?: boolean;
    freeSlots?: number;
    tile?: QuestSnapshot['tile'];
}

/** Everything the remaining legs could want, so `decide` answers with the quest rather than the kit. */
const FULL_PACK: [number, number][] = [
    [TB_ID.COINS, 500],
    [TB_ID.NET, 1],
    [TB_ID.KNIFE, 1],
    [TB_ID.PESTLE, 1],
    [TB_ID.TINDERBOX, 1],
    [TB_ID.SEAWEED, 1],
    [IRON.id, 1],
    [DOSE4.id, 1]
];

function snap(options: Options = {}): QuestSnapshot {
    const main = options.main ?? TB_MAIN.STARTED;
    const flags = new Set<string>([
        `${TB_FLAG.LUBUFU}:${options.lubufu ?? TB_LUBUFU.UNKNOWN}`,
        `${TB_FLAG.TIADECHE}:${options.tiadeche ?? TB_TIADECHE.UNKNOWN}`,
        `${TB_FLAG.TAMAYU}:${options.tamayu ?? TB_TAMAYU.UNKNOWN}`,
        `${TB_FLAG.TINSAY}:${options.tinsay ?? TB_TINSAY.UNKNOWN}`
    ]);
    if (options.agility) {
        flags.add(TB_FLAG.AGILITY);
    }
    if (options.spear) {
        flags.add(TB_FLAG.SPEAR);
    }
    const ids = new Map<number, number>(options.bare ? (options.invIds ?? []) : [...FULL_PACK, ...(options.invIds ?? [])]);
    const inv = new Map<string, number>(options.bare ? [] : [
        [TB_NAME.COINS.toLowerCase(), 500],
        ['lobster', 6]
    ]);
    return {
        journal: options.journal ?? (main === TB_MAIN.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv,
        invIds: ids,
        worn: new Set(options.bare ? [] : KIT.map(n => n.toLowerCase())),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage: main,
        progress: { stage: main, flags },
        bank: new Map(),
        bankIds: new Map(),
        bankKnown: true,
        tile: options.tile ?? VILLAGE,
        freeSlots: options.freeSlots ?? 12,
        ranged: 70
    };
}

const step = (options: Options = {}): QuestStep => decide(snap(options));
const named = (s: QuestStep): string => (s.kind === 'custom' ? s.name : `${s.kind}:${s.kind === 'wait' ? s.reason : ''}`);

describe('tai bwo wannai trio decide', () => {
    test('an unloaded quest list waits rather than restarting the quest', () => {
        expect(step({ journal: 'unknown' })).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('a green journal is done', () => {
        expect(step({ journal: 'complete', main: TB_MAIN.COMPLETE })).toEqual({ kind: 'done' });
    });

    test('every pre-start stage goes back to Timfraku', () => {
        for (const main of [TB_MAIN.NOT_STARTED, TB_MAIN.SPOKE, TB_MAIN.ASKED_FOR_HELP]) {
            expect(named(step({ main }))).toBe('ask Timfraku for the job');
        }
    });

    test('the reward is claimed once all four brothers are done', () => {
        expect(named(step({ main: TB_MAIN.ALL_BROTHERS }))).toBe("claim Timfraku's reward");
        expect(named(step({ main: TB_MAIN.GOLD }))).toBe("claim Timfraku's reward");
    });

    // Why: the hunt teleports the player into a sealed pocket, and a step that walks from there has no route.
    test('nothing is attempted from inside the hunt cutscene', () => {
        expect(step({ tile: { x: 2520, z: 4568, level: 0 } })).toEqual({
            kind: 'wait',
            reason: 'watching Tamayu hunt the Shaikahan'
        });
    });

    test('a bare pack is filled before any brother is walked to', () => {
        expect(step({ bare: true }).kind).not.toBe('custom');
    });

    // Why: Timfraku sits across a 30gp ferry, and a bot that walks first arrives with nothing and no fare home.
    test('the pack is filled before the first crossing, not after it', () => {
        expect(step({ main: TB_MAIN.NOT_STARTED, bare: true }).kind).not.toBe('custom');
        expect(named(step({ main: TB_MAIN.NOT_STARTED }))).toBe('ask Timfraku for the job');
    });

    describe('Lubufu', () => {
        test('an unmet Lubufu is introduced to first', () => {
            expect(named(step())).toBe('introduce yourself to Lubufu');
        });

        test('the bait is netted while he is still owed some', () => {
            expect(named(step({ lubufu: TB_LUBUFU.FETCH_KARAMBWANJI }))).toBe('net Karambwanji (0/20)');
        });

        test('a full load is handed over rather than topped up', () => {
            expect(named(step({
                lubufu: TB_LUBUFU.FETCH_KARAMBWANJI,
                invIds: [[TB_ID.RAW_KARAMBWANJI, 20]]
            }))).toBe('hand Lubufu 20 of the 20 Karambwanji he still wants');
        });

        // Why: he counts them in himself, so a part load is progress and the pack never has to hold all twenty.
        test('a part load goes over as soon as the pack is out of room', () => {
            expect(named(step({
                lubufu: TB_LUBUFU.FETCH_KARAMBWANJI,
                invIds: [[TB_ID.RAW_KARAMBWANJI, 11]],
                freeSlots: 0
            }))).toBe('hand Lubufu 11 of the 20 Karambwanji he still wants');
        });

        test('the count he already holds is deducted from what is owed', () => {
            expect(named(step({ lubufu: TB_LUBUFU.FETCH_KARAMBWANJI + 14 }))).toBe('net Karambwanji (0/6)');
        });

        test('a full hand-in moves on to the apprenticeship', () => {
            expect(named(step({ lubufu: TB_LUBUFU.GIVEN_KARAMBWANJI })))
                .toBe("take up Lubufu's apprenticeship");
        });
    });

    describe("Tiadeche's catch", () => {
        const done = { lubufu: TB_LUBUFU.COMPLETE, invIds: [[TB_ID.VESSEL, 1]] as [number, number][] };

        test('the news comes before the vessel', () => {
            expect(named(step(done))).toBe('bring Tiadeche the news');
        });

        test('a vessel with no bait is baited first', () => {
            expect(named(step({ ...done, tiadeche: TB_TIADECHE.RETURN_WHEN_CAUGHT })))
                .toBe('net a Karambwanji for bait');
            expect(named(step({
                ...done,
                tiadeche: TB_TIADECHE.RETURN_WHEN_CAUGHT,
                invIds: [[TB_ID.VESSEL, 1], [TB_ID.RAW_KARAMBWANJI, 1]]
            }))).toBe('bait the Karambwan vessel');
        });

        test('a lost vessel is re-issued by Lubufu', () => {
            expect(named(step({ lubufu: TB_LUBUFU.COMPLETE, tiadeche: TB_TIADECHE.RETURN_WHEN_CAUGHT })))
                .toBe('ask Lubufu for another Karambwan vessel');
        });

        test('a baited vessel is handed over', () => {
            expect(named(step({
                lubufu: TB_LUBUFU.COMPLETE,
                tiadeche: TB_TIADECHE.RETURN_WHEN_CAUGHT,
                invIds: [[TB_ID.VESSEL_LOADED, 1]]
            }))).toBe('hand Tiadeche the baited vessel');
        });

        test('a catch he has not been asked about yet is picked back up in conversation', () => {
            expect(named(step({ lubufu: TB_LUBUFU.COMPLETE, tiadeche: TB_TIADECHE.CAUGHT })))
                .toBe('ask Tiadeche what he needs next');
        });
    });

    describe('Tamayu', () => {
        const past = { lubufu: TB_LUBUFU.COMPLETE, tiadeche: TB_TIADECHE.REQUEST_MANUAL };

        test('the hunt is watched before anything is handed over', () => {
            expect(named(step({ ...past, tamayu: TB_TAMAYU.SLAY_SHAIKAHAN }))).toBe("watch Tamayu's hunt");
        });

        test('the agility potion goes first', () => {
            expect(named(step({ ...past, tamayu: TB_TAMAYU.WATCHED_CUTSCENE })))
                .toBe(`give Tamayu the ${DOSE4.name}`);
        });

        // Why: he counts doses rather than bottles, and the journal only says so at the fourth.
        test('a part-doses pack pours what it has, one bottle per pass', () => {
            const base = { ...past, tamayu: TB_TAMAYU.WATCHED_CUTSCENE };
            expect(named(step({ ...base, invIds: [[DOSE4.id, 0], [DOSE2.id, 2]] })))
                .toBe(`give Tamayu the ${DOSE2.name}`);
        });

        // Why: Tiadeche's gift is the raw Karambwan the poison is ground from, which is why his leg runs first.
        test('the poisoned spear is built from the Karambwan he was given', () => {
            const base = { ...past, tamayu: TB_TAMAYU.WATCHED_CUTSCENE, agility: true };
            expect(named(step({ ...base, invIds: [[TB_ID.RAW_KARAMBWAN, 1]] })))
                .toBe('cook the Karambwan on the jungle fire');
            expect(named(step({ ...base, invIds: [[TB_ID.POORLY_COOKED_KARAMBWAN, 1]] })))
                .toBe('grind the cooked Karambwan into poison');
            expect(named(step({ ...base, invIds: [[TB_ID.KARAMBWAN_POISON_PASTE, 1]] })))
                .toBe('smear the Karambwan paste over the iron spear');
            expect(named(step({ ...base, invIds: [[IRON.kpId, 1]] })))
                .toBe('give Tamayu the Karambwan-poisoned spear');
        });

        // Why: any tier above bronze sets both bits Tamayu checks, so whatever the bank had is what he gets.
        test('whichever tier the pack carries is the one poisoned and handed over', () => {
            const base = { ...past, tamayu: TB_TAMAYU.WATCHED_CUTSCENE, agility: true };
            expect(named(step({ ...base, invIds: [[IRON.id, 0], [STEEL.id, 1], [TB_ID.KARAMBWAN_POISON_PASTE, 1]] })))
                .toBe('smear the Karambwan paste over the steel spear');
            expect(named(step({ ...base, invIds: [[IRON.id, 0], [STEEL.kpId, 1]] })))
                .toBe('give Tamayu the Karambwan-poisoned spear');
        });

        // Why: no shop on Karamja sells a spear, and Jogres drop one 4 times in 129.
        test('a pack with the poison and no shaft hunts Jogres for one', () => {
            const base = { ...past, tamayu: TB_TAMAYU.WATCHED_CUTSCENE, agility: true };
            expect(named(step({ ...base, invIds: [[IRON.id, 0], [TB_ID.KARAMBWAN_POISON_PASTE, 1]] })))
                .toBe('hunt Jogres for a spear');
        });

        // Why: the shoal is 160 tiles from the bait, and three Karambwan in ten burn on the fire.
        test('spare bait is carried to the shoal so a burn is re-cooked from the same trip', () => {
            const base = { ...past, tamayu: TB_TAMAYU.WATCHED_CUTSCENE, agility: true };
            expect(named(step(base))).toBe('net bait for the Karambwan shoal');
            expect(named(step({ ...base, invIds: [[TB_ID.RAW_KARAMBWANJI, 4]] })))
                .toBe('ask Lubufu for another Karambwan vessel');
            expect(named(step({ ...base, invIds: [[TB_ID.RAW_KARAMBWANJI, 4], [TB_ID.VESSEL, 1]] })))
                .toBe('lower the vessel for a Karambwan');
        });

        test('with both gifts given the hunt becomes the kill', () => {
            expect(named(step({ ...past, tamayu: TB_TAMAYU.WATCHED_CUTSCENE, agility: true, spear: true })))
                .toBe('follow Tamayu on the killing hunt');
        });
    });

    describe('Tinsay', () => {
        const past = {
            lubufu: TB_LUBUFU.COMPLETE,
            tiadeche: TB_TIADECHE.REQUEST_MANUAL,
            tamayu: TB_TAMAYU.COMPLETE,
            agility: true,
            spear: true
        };

        test('the rum is built banana, slice, bottle', () => {
            expect(named(step({ ...past, tinsay: TB_TINSAY.FETCH_RUM }))).toBe('pick a banana in the plantation');
            expect(named(step({ ...past, tinsay: TB_TINSAY.FETCH_RUM, invIds: [[TB_ID.BANANA, 1]] })))
                .toBe('slice the banana');
            expect(named(step({ ...past, tinsay: TB_TINSAY.FETCH_RUM, invIds: [[TB_ID.SLICED_BANANA, 1]] })))
                .toBe('buy Karamjan rum from Zambo');
            expect(named(step({
                ...past,
                tinsay: TB_TINSAY.FETCH_RUM,
                invIds: [[TB_ID.SLICED_BANANA, 1], [TB_ID.RUM, 1]]
            }))).toBe('drop the banana slices into the rum');
            expect(named(step({ ...past, tinsay: TB_TINSAY.FETCH_RUM, invIds: [[TB_ID.RUM_SLICED, 1]] })))
                .toBe('give Tinsay the sliced banana in Karamjan rum');
        });

        test('a handed-over item is followed by asking what he wants next', () => {
            expect(named(step({ ...past, tinsay: TB_TINSAY.GIVEN_RUM }))).toBe('ask Tinsay what he needs next');
            expect(named(step({ ...past, tinsay: TB_TINSAY.GIVEN_SANDWICH }))).toBe('ask Tinsay what he needs next');
        });

        // Why: nobody else on Karamja skins a monkey, and Tamayu only does it once his own hunt is over.
        test('the sandwich runs monkey, Tamayu, seaweed', () => {
            expect(named(step({ ...past, tinsay: TB_TINSAY.FETCH_SANDWICH })))
                .toBe('shoot a monkey for its corpse');
            expect(named(step({ ...past, tinsay: TB_TINSAY.FETCH_SANDWICH, invIds: [[TB_ID.MONKEY_CORPSE, 1]] })))
                .toBe('ask Tamayu to skin the monkey');
            expect(named(step({ ...past, tinsay: TB_TINSAY.FETCH_SANDWICH, invIds: [[TB_ID.MONKEY_SKIN, 1]] })))
                .toBe('sandwich the seaweed into the monkey skin');
            expect(named(step({ ...past, tinsay: TB_TINSAY.FETCH_SANDWICH, invIds: [[TB_ID.SANDWICH, 1]] })))
                .toBe('give Tinsay the seaweed sandwich');
        });

        test('the marinade runs Jogre, tinderbox, paste, fire', () => {
            const at = (invIds: [number, number][]): string =>
                named(step({ ...past, tinsay: TB_TINSAY.FETCH_BONES, invIds }));
            expect(at([])).toBe('kill a Jogre for its bones');
            expect(at([[TB_ID.JOGRE_BONES, 1]])).toBe('burn the Jogre bones');
            expect(at([[TB_ID.BURNT_JOGRE_BONES, 1]])).toBe('net a Karambwanji for the marinade');
            expect(at([[TB_ID.BURNT_JOGRE_BONES, 1], [TB_ID.RAW_KARAMBWANJI, 1]]))
                .toBe('grind the Karambwanji into paste');
            expect(at([[TB_ID.BURNT_JOGRE_BONES, 1], [TB_ID.KARAMBWANJI_PASTE, 1]]))
                .toBe('smother the bones in Karambwanji paste');
            expect(at([[TB_ID.PASTY_JOGRE_BONES, 1]])).toBe('marinate the bones on the jungle fire');
            expect(at([[TB_ID.MARINATED_JOGRE_BONES, 1]])).toBe('give Tinsay the marinated Jogre bones');
        });
    });

    describe("Tiadeche's manual", () => {
        const past = {
            lubufu: TB_LUBUFU.COMPLETE,
            tiadeche: TB_TIADECHE.REQUEST_MANUAL,
            tamayu: TB_TAMAYU.COMPLETE,
            tinsay: TB_TINSAY.COMPLETE,
            agility: true,
            spear: true
        };

        test('a vessel is fetched, taken to Tinsay, then the manual goes to Tiadeche', () => {
            expect(named(step(past))).toBe('ask Lubufu for another Karambwan vessel');
            expect(named(step({ ...past, invIds: [[TB_ID.VESSEL, 1]] })))
                .toBe('take a vessel to Tinsay for the crafting instructions');
            expect(named(step({ ...past, invIds: [[TB_ID.CRAFTING_MANUAL, 1]] })))
                .toBe('give Tiadeche the crafting manual');
        });
    });
});

describe('tai bwo wannai trio module', () => {
    test('it is registered after Jungle Potion, which it requires', () => {
        const ids = QUEST_DEFS.map(d => d.record.id);
        expect(ids).toContain('tbwt');
        expect(ids.indexOf('tbwt')).toBeGreaterThan(ids.indexOf('junglepotion'));
    });

    test('it owns its own pack and banks in Ardougne', () => {
        expect(tbwt.ownsInventory).toBe(true);
        expect(tbwt.record.requirements.quests).toContain('junglepotion');
        expect(tbwt.bank).not.toBe('nearest');
    });
});
