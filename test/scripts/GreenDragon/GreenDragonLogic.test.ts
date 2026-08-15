import { describe, expect, test } from 'bun:test';
import { depositAllExcept } from '#/bot/api/bank/bankRules.js';
import {
    escapeNeeded,
    gearCandidates,
    gearToKeep,
    inWilderness,
    isClueLike,
    isGrindForeign,
    packForcesBank,
    slotFreeingAction,
    underPlayerAttack,
    wantsGroundItem,
    WILDY_MIN_Z,
    type SlotFreeingState
} from '#/bot/scripts/GreenDragon/GreenDragonLogic.js';

const HARD_CLUE = 2723; // trail_clue_hard_sextant001
const HARD_CASKET = 2724; // trail_clue_hard_sextant001_casket

const DRAGON_LOOT = new Set(['dragon bones', 'dragonhide', 'herb']);

const filter = (over: Partial<{ lootSet: ReadonlySet<string>; bankCommon: boolean; solveClues: boolean }> = {}) => ({
    lootSet: DRAGON_LOOT,
    bankCommon: true,
    solveClues: true,
    ...over
});

const slots = (over: Partial<SlotFreeingState> = {}): SlotFreeingState => ({
    packFull: true,
    lootPresent: true,
    foodCount: 25,
    foodReserve: 4,
    hpFraction: 0.6,
    lootStacksIntoPack: false,
    ...over
});

describe('inWilderness', () => {
    test('the ditch row itself is not wilderness', () => {
        expect(inWilderness(WILDY_MIN_Z)).toBe(false);
    });
    test('one row north is', () => {
        expect(inWilderness(WILDY_MIN_Z + 1)).toBe(true);
    });
    test('the dragon field is, the Edgeville bank is not', () => {
        expect(inWilderness(3814)).toBe(true);
        expect(inWilderness(3493)).toBe(false);
    });
});

describe('underPlayerAttack', () => {
    test('retaliating at a player in the wilderness is an attack', () => {
        expect(underPlayerAttack(3814, true)).toBe(true);
    });
    test('fighting only dragons is not', () => {
        expect(underPlayerAttack(3814, false)).toBe(false);
    });
    test('players in Varrock on a clue trail are not', () => {
        expect(underPlayerAttack(3424, true)).toBe(false);
    });
    test('an unknown position is never an attack', () => {
        expect(underPlayerAttack(null, true)).toBe(false);
    });
});

describe('gearCandidates', () => {
    const ARMOUR = ['Rune platebody', 'Rune platelegs', 'Rune full helm'];
    test('armour worn at start is kept and re-equipped, not just the weapon and shield', () => {
        expect(gearCandidates('Rune scimitar', 'Dragonfire shield', ARMOUR)).toEqual([
            'Rune scimitar',
            'Dragonfire shield',
            'Rune platebody',
            'Rune platelegs',
            'Rune full helm'
        ]);
    });
    test('the configured weapon and shield are not duplicated when also worn at start', () => {
        expect(gearCandidates('Rune scimitar', 'Dragonfire shield', ['rune scimitar', 'Rune platebody'])).toEqual([
            'Rune scimitar',
            'Dragonfire shield',
            'Rune platebody'
        ]);
    });
    test('an empty weapon or shield slot contributes nothing', () => {
        expect(gearCandidates('', '', ARMOUR)).toEqual(ARMOUR);
        expect(gearCandidates('', '', [])).toEqual([]);
    });
});

describe('gearToKeep', () => {
    const HELM = 'Adamant full helm';
    const KIT = ['Rune scimitar', 'Anti-dragon shield', HELM];
    const worn = (...names: string[]) => (n: string) => names.some(w => w.toLowerCase() === n.toLowerCase());

    test('gear that is already on needs no keep slot', () => {
        expect(gearToKeep(KIT, worn(...KIT))).toEqual([]);
    });
    test('gear stripped into the pack is kept so it can be re-equipped', () => {
        expect(gearToKeep(KIT, worn('Rune scimitar', 'Anti-dragon shield'))).toEqual([HELM]);
    });
    test('a looted duplicate of worn armour still banks', () => {
        const keep = gearToKeep(gearCandidates('Rune scimitar', 'Anti-dragon shield', [HELM]), worn(...KIT));
        expect(depositAllExcept(keep)(HELM)).toBe(true);
    });
    test('the stripped original is not banked out from under the re-equip', () => {
        const keep = gearToKeep(gearCandidates('Rune scimitar', 'Anti-dragon shield', [HELM]), worn('Rune scimitar'));
        expect(depositAllExcept(keep)(HELM)).toBe(false);
    });
});

describe('isClueLike', () => {
    test('a hard clue scroll and its casket both match', () => {
        expect(isClueLike(HARD_CLUE)).toBe(true);
        expect(isClueLike(HARD_CASKET)).toBe(true);
    });
    test('dragon loot does not', () => {
        expect(isClueLike(536)).toBe(false);
    });
});

describe('wantsGroundItem', () => {
    test('takes loot named in the loot set', () => {
        expect(wantsGroundItem({ id: 536, name: 'Dragon bones' }, filter())).toBe(true);
    });
    test('ignores loot the user unchecked', () => {
        expect(wantsGroundItem({ id: 1753, name: 'Dragon spear' }, filter())).toBe(false);
    });
    test('takes a clue even though it is absent from the loot set', () => {
        expect(wantsGroundItem({ id: HARD_CLUE, name: 'Clue scroll' }, filter())).toBe(true);
    });
    test('leaves the clue when clue solving is off', () => {
        expect(wantsGroundItem({ id: HARD_CLUE, name: 'Clue scroll' }, filter({ solveClues: false }))).toBe(false);
    });
    test('an emptied loot set still takes clues', () => {
        const empty = filter({ lootSet: new Set<string>(), bankCommon: false });
        expect(wantsGroundItem({ id: HARD_CLUE, name: 'Clue scroll' }, empty)).toBe(true);
        expect(wantsGroundItem({ id: 536, name: 'Dragon bones' }, empty)).toBe(false);
    });
    test('common junk follows its own toggle', () => {
        const gem = { id: 1623, name: 'Uncut sapphire' };
        expect(wantsGroundItem(gem, filter())).toBe(true);
        expect(wantsGroundItem(gem, filter({ bankCommon: false }))).toBe(false);
    });
    test('an unnamed ground item is never taken', () => {
        expect(wantsGroundItem({ id: 4242, name: null }, filter())).toBe(false);
    });
    test('burying forces bones to be looted even when unchecked', () => {
        const noBones = filter({ lootSet: new Set(['dragonhide']) });
        expect(wantsGroundItem({ id: 536, name: 'Dragon bones' }, noBones)).toBe(false);
        expect(wantsGroundItem({ id: 536, name: 'Dragon bones' }, { ...noBones, buryBones: true, boneName: 'Dragon bones' })).toBe(true);
    });
    test('burying does not drag in bones the bot was not told to bury', () => {
        const burying = filter({ lootSet: new Set<string>(), bankCommon: false });
        expect(wantsGroundItem({ id: 526, name: 'Bones' }, { ...burying, buryBones: true, boneName: 'Dragon bones' })).toBe(false);
    });
});

describe('escapeNeeded', () => {
    const esc = (over: Partial<Parameters<typeof escapeNeeded>[0]> = {}) => ({
        threat: false, hpFraction: 0.1, panicHp: 0.3, hasFood: false, atBank: false, ...over
    });
    test('flees when starving and hurt out in the field', () => {
        expect(escapeNeeded(esc())).toBe(true);
    });
    test('stops once it reaches the bank — otherwise it re-walks forever', () => {
        expect(escapeNeeded(esc({ atBank: true }))).toBe(false);
    });
    test('a threat still overrides, even at the bank', () => {
        expect(escapeNeeded(esc({ threat: true, atBank: true }))).toBe(true);
    });
    test('food in the pack means eat, not flee', () => {
        expect(escapeNeeded(esc({ hasFood: true }))).toBe(false);
    });
    test('healthy and foodless is not a panic', () => {
        expect(escapeNeeded(esc({ hpFraction: 0.9 }))).toBe(false);
    });
});

describe('packForcesBank', () => {
    test('a pack full of food is NOT a reason to bank — it gets eaten', () => {
        expect(packForcesBank(true, 25, 4)).toBe(false);
    });
    test('banks once the food is down to the reserve and cannot free a slot', () => {
        expect(packForcesBank(true, 4, 4)).toBe(true);
        expect(packForcesBank(true, 0, 4)).toBe(true);
    });
    test('a pack with room never forces a bank', () => {
        expect(packForcesBank(false, 0, 4)).toBe(false);
    });
});

describe('isGrindForeign', () => {
    const ctx = {
        keep: new Set(['lobster', 'rune scimitar', 'dragonfire shield']),
        loot: filter()
    };
    test('trail kit left over from a clue is foreign', () => {
        for (const n of ['Spade', 'Sextant', 'Watch', 'Chart']) {
            expect(isGrindForeign({ id: 9001, name: n }, ctx)).toBe(true);
        }
    });
    test('grind gear and food are not foreign', () => {
        expect(isGrindForeign({ id: 1333, name: 'Rune scimitar' }, ctx)).toBe(false);
        expect(isGrindForeign({ id: 379, name: 'Lobster' }, ctx)).toBe(false);
    });
    test('intended loot is not foreign', () => {
        expect(isGrindForeign({ id: 536, name: 'Dragon bones' }, ctx)).toBe(false);
        expect(isGrindForeign({ id: 1623, name: 'Uncut sapphire' }, ctx)).toBe(false);
    });
    test('a clue is never foreign — SolveClue owns it', () => {
        expect(isGrindForeign({ id: HARD_CLUE, name: 'Clue scroll' }, ctx)).toBe(false);
        expect(isGrindForeign({ id: HARD_CASKET, name: 'Casket' }, ctx)).toBe(false);
    });
    test('an unnamed item is never foreign', () => {
        expect(isGrindForeign({ id: 9001, name: null }, ctx)).toBe(false);
    });
});

describe('slotFreeingAction', () => {
    test('eats when the heal is not wasted', () => {
        expect(slotFreeingAction(slots({ hpFraction: 0.6 }))).toBe('eat');
    });
    test('drops at full hp rather than eating for nothing', () => {
        expect(slotFreeingAction(slots({ hpFraction: 1 }))).toBe('drop');
    });
    test('the 25-lobster case frees a slot instead of banking', () => {
        expect(slotFreeingAction(slots({ foodCount: 25, hpFraction: 1 }))).toBe('drop');
    });
    test('does nothing when the pack has room', () => {
        expect(slotFreeingAction(slots({ packFull: false }))).toBe('none');
    });
    test('does nothing when there is no loot to make room for', () => {
        expect(slotFreeingAction(slots({ lootPresent: false }))).toBe('none');
    });
    test('never digs into the reserve', () => {
        expect(slotFreeingAction(slots({ foodCount: 5, foodReserve: 4 }))).toBe('eat');
        expect(slotFreeingAction(slots({ foodCount: 4, foodReserve: 4 }))).toBe('none');
        expect(slotFreeingAction(slots({ foodCount: 3, foodReserve: 4 }))).toBe('none');
    });
    test('a zero reserve still needs one food to spend', () => {
        expect(slotFreeingAction(slots({ foodCount: 1, foodReserve: 0 }))).toBe('eat');
        expect(slotFreeingAction(slots({ foodCount: 0, foodReserve: 0 }))).toBe('none');
    });
    test('does not burn food for loot that stacks into the pack', () => {
        expect(slotFreeingAction(slots({ lootStacksIntoPack: true }))).toBe('none');
    });
});
