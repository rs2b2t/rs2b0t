import { describe, expect, test } from 'bun:test';
import { ITEM_DB } from '#/bot/data/itemdb.js';
import {
    ALCH_FODDER_OBJS,
    ALCH_ITEMS,
    ALCH_OPTIONS,
    ALCH_OPTION_LABELS,
    DEFAULT_ALCH_ITEMS,
    alchItem,
    fmtGp,
    nextAlchTarget,
    selectedAlchItems
} from '#/bot/scripts/Alcher/AlcherLogic.js';

describe('the fodder table resolves against the item database', () => {
    test('every listed obj is in ITEM_DB', () => {
        const missing = ALCH_FODDER_OBJS.filter(obj => !ITEM_DB.some(r => r.obj === obj));
        expect(missing).toEqual([]);
        expect(ALCH_ITEMS).toHaveLength(ALCH_FODDER_OBJS.length);
    });

    test('the alch value is 60% of the shop cost, rounded down', () => {
        for (const item of ALCH_ITEMS) {
            const rec = ITEM_DB.find(r => r.obj === item.key);
            expect(item.alchValue).toBe(Math.floor(rec!.cost * 0.6));
        }
    });

    test('the classic fodder pays what the game pays', () => {
        expect(alchItem('yew_longbow')?.alchValue).toBe(768);
        expect(alchItem('magic_longbow')?.alchValue).toBe(1536);
        expect(alchItem('steel_platebody')?.alchValue).toBe(1200);
        expect(alchItem('dragonhide_body')?.alchValue).toBe(4680);
        expect(alchItem('black_dragonhide_body')?.alchValue).toBe(8088);
    });

    test('item ids are unique', () => {
        const ids = ALCH_ITEMS.map(i => i.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('entries are ordered by alch value, richest first', () => {
        for (let i = 1; i < ALCH_ITEMS.length; i++) {
            expect(ALCH_ITEMS[i - 1].alchValue).toBeGreaterThanOrEqual(ALCH_ITEMS[i].alchValue);
        }
    });
});

describe('labels disambiguate what the client name does not', () => {
    test('all four dragonhide bodies share one client name', () => {
        const hides = ALCH_ITEMS.filter(i => i.name === 'Dragonhide body');
        expect(hides).toHaveLength(4);
        expect(new Set(hides.map(i => i.label)).size).toBe(4);
    });

    test('every label is unique, so a chip never names two items', () => {
        const labels = ALCH_ITEMS.map(i => i.label);
        expect(new Set(labels).size).toBe(labels.length);
    });

    test('the chip label carries the alch value', () => {
        expect(ALCH_OPTION_LABELS.magic_longbow).toBe('Magic longbow (1,536)');
        expect(ALCH_OPTION_LABELS.black_dragonhide_body).toBe("Black d'hide body (8,088)");
    });

    test('every option has a label and every label an option', () => {
        expect(Object.keys(ALCH_OPTION_LABELS).sort()).toEqual([...ALCH_OPTIONS].sort());
    });
});

describe('defaults', () => {
    test('every default is a real option', () => {
        for (const key of DEFAULT_ALCH_ITEMS) {
            expect(ALCH_OPTIONS).toContain(key);
        }
    });

    test('the usual suspects are ticked out of the box', () => {
        expect(DEFAULT_ALCH_ITEMS).toContain('yew_longbow');
        expect(DEFAULT_ALCH_ITEMS).toContain('magic_longbow');
        expect(DEFAULT_ALCH_ITEMS).toContain('steel_platebody');
        expect(DEFAULT_ALCH_ITEMS.filter(k => k.includes('dragonhide')).length).toBeGreaterThanOrEqual(4);
    });
});

describe('selectedAlchItems', () => {
    test('resolves in table order however the keys arrive', () => {
        const picked = selectedAlchItems(['yew_longbow', 'black_dragonhide_body', 'magic_longbow']);
        expect(picked.map(i => i.key)).toEqual(['black_dragonhide_body', 'magic_longbow', 'yew_longbow']);
    });

    test('drops keys that are not fodder', () => {
        expect(selectedAlchItems(['yew_longbow', 'Rune platebody', 'nonsense']).map(i => i.key))
            .toEqual(['yew_longbow']);
    });

    test('matches keys case-insensitively', () => {
        expect(selectedAlchItems(['YEW_LONGBOW']).map(i => i.key)).toEqual(['yew_longbow']);
    });

    test('an empty selection falls back to the defaults', () => {
        expect(selectedAlchItems([]).map(i => i.key).sort()).toEqual([...DEFAULT_ALCH_ITEMS].sort());
    });

    test('a selection of nothing but junk falls back to the defaults', () => {
        expect(selectedAlchItems(['nonsense']).map(i => i.key).sort()).toEqual([...DEFAULT_ALCH_ITEMS].sort());
    });
});

describe('nextAlchTarget', () => {
    const selected = selectedAlchItems(['yew_longbow', 'magic_longbow', 'steel_platebody']);

    test('takes the richest item the bank still has', () => {
        expect(nextAlchTarget(selected, new Set())?.key).toBe('magic_longbow');
    });

    test('skips the ones the bank has run out of', () => {
        expect(nextAlchTarget(selected, new Set(['magic_longbow']))?.key).toBe('steel_platebody');
        expect(nextAlchTarget(selected, new Set(['magic_longbow', 'steel_platebody']))?.key).toBe('yew_longbow');
    });

    test('is null once every item is empty', () => {
        expect(nextAlchTarget(selected, new Set(selected.map(i => i.key)))).toBeNull();
    });

    test('is null with nothing selected', () => {
        expect(nextAlchTarget([], new Set())).toBeNull();
    });
});

describe('fmtGp', () => {
    test('reads at a glance across four orders of magnitude', () => {
        expect(fmtGp(0)).toBe('0');
        expect(fmtGp(768)).toBe('768');
        expect(fmtGp(1536)).toBe('1.5k');
        expect(fmtGp(15_360)).toBe('15k');
        expect(fmtGp(412_900)).toBe('413k');
        expect(fmtGp(4_812_000)).toBe('4.8m');
        expect(fmtGp(38_900_000)).toBe('38.9m');
    });

    test('rounds rather than truncating a fractional rate', () => {
        expect(fmtGp(999.6)).toBe('1.0k');
    });
});
