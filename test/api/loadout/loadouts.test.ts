import { describe, expect, test } from 'bun:test';
import {
    parseLoadouts,
    removeLoadout,
    serializeLoadouts,
    uniqueName,
    upsertLoadout,
    type Loadout
} from '#/bot/api/loadout/loadouts.js';

const melee: Loadout = {
    name: 'melee',
    worn: { righthand: 'Rune scimitar', torso: 'Adamant platebody' },
    carry: [{ item: 'Lobster', qty: 16 }]
};

describe('parseLoadouts', () => {
    test('round-trips through serialize', () => {
        expect(parseLoadouts(serializeLoadouts([melee]))).toEqual([melee]);
    });

    test('an empty value is no loadouts', () => {
        expect(parseLoadouts('')).toEqual([]);
    });

    test('corrupt JSON degrades to no loadouts rather than throwing', () => {
        expect(parseLoadouts('{not json')).toEqual([]);
    });

    test('a non-array payload degrades to no loadouts', () => {
        expect(parseLoadouts('{"name":"melee"}')).toEqual([]);
    });

    test('skips unusable names and preserves valid names in order, including duplicates', () => {
        const raw = JSON.stringify([
            null, { name: ' melee ' }, {}, { name: '   ' }, { name: 'range' }, { name: 7 }, { name: ' melee ' }
        ]);
        expect(parseLoadouts(raw).map(entry => entry.name)).toEqual([' melee ', 'range', ' melee ']);
    });

    test('drops unknown slots and keeps known ones', () => {
        const out = parseLoadouts('[{"name":"a","worn":{"righthand":"Rune scimitar","pocket":"Coins"},"carry":[]}]');
        expect(out[0]!.worn).toEqual({ righthand: 'Rune scimitar' });
    });

    test('drops carry entries with a non-positive quantity', () => {
        const out = parseLoadouts('[{"name":"a","worn":{},"carry":[{"item":"Lobster","qty":0},{"item":"Tuna","qty":3}]}]');
        expect(out[0]!.carry).toEqual([{ item: 'Tuna', qty: 3 }]);
    });

    test('fills in missing worn and carry', () => {
        expect(parseLoadouts('[{"name":"bare"}]')).toEqual([{ name: 'bare', worn: {}, carry: [] }]);
    });
});

describe('upsertLoadout', () => {
    test('replaces by name, case-insensitively, keeping position', () => {
        const list = [melee, { name: 'range', worn: {}, carry: [] }];
        const out = upsertLoadout(list, { name: 'MELEE', worn: {}, carry: [] });
        expect(out.map(l => l.name)).toEqual(['MELEE', 'range']);
    });

    test('appends when the name is new', () => {
        expect(upsertLoadout([melee], { name: 'range', worn: {}, carry: [] }).map(l => l.name))
            .toEqual(['melee', 'range']);
    });
});

describe('removeLoadout', () => {
    test('removes by name, case-insensitively', () => {
        expect(removeLoadout([melee], 'MELEE')).toEqual([]);
    });
});

describe('uniqueName', () => {
    test('leaves a free name alone', () => {
        expect(uniqueName([melee], 'range')).toBe('range');
    });

    test('suffixes a taken name', () => {
        expect(uniqueName([melee], 'melee')).toBe('melee 2');
    });

    test('keeps counting past the first collision', () => {
        const list = [melee, { name: 'melee 2', worn: {}, carry: [] }];
        expect(uniqueName(list, 'melee')).toBe('melee 3');
    });
});
