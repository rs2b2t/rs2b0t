import { describe, expect, test } from 'bun:test';

import { buildCatalog, displayName, resolveByName } from '#/bot/api/market/catalog.js';
import { ITEM_ALIASES, NAME_SYNONYMS } from '#/bot/data/itemAliases.js';
import { NAME_COLLISIONS } from '#/bot/data/nameCollisions.js';
import { UNTRADEABLE_IDS } from '#/bot/data/untradeable.js';
import { worthStocking } from '#/bot/api/market/catalog.js';
import type { ObjRecord } from '#/bot/adapter/ClientAdapter.js';

const UNTRADEABLE = new Set(UNTRADEABLE_IDS);

/** The groups a shop could put on a shelf, which is what the aliases have to cover. */
const SHOP_VISIBLE = NAME_COLLISIONS.map(g => ({
    name: g.name,
    objs: g.objs.filter(o => !UNTRADEABLE.has(o.id))
})).filter(g => g.objs.length > 1 && worthStocking(g.name));

function rec(id: number, name: string, over: Partial<ObjRecord> = {}): ObjRecord {
    return { id, name, cost: 1, stackable: false, members: false, equippable: false, certlink: -1, certtemplate: -1, ...over };
}

/** A catalog holding one collision group, so resolution can be asked about it in isolation. */
// Why: the strung half of a bow or amulet pair is the one with a wear model, and preferWorn splits the pair
// Why: on that flag, so a fixture that drops it tests a client the shop never talks to.
function catalogOf(groupName: string) {
    const group = SHOP_VISIBLE.find(g => g.name === groupName);
    if (!group) {
        throw new Error(`no collision group named ${groupName}`);
    }
    const records = group.objs.map(o => rec(o.id, groupName, { equippable: !o.obj.includes('unstrung') }));
    return { group, cat: buildCatalog(records) };
}

describe('the generated collision list', () => {
    test('is name-sorted with no id appearing twice', () => {
        const names = NAME_COLLISIONS.map(g => g.name);
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
        const ids = NAME_COLLISIONS.flatMap(g => g.objs.map(o => o.id));
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('every group holds more than one obj, or it is not a collision', () => {
        for (const group of NAME_COLLISIONS) {
            expect(group.objs.length).toBeGreaterThan(1);
        }
    });
});

describe('the hand-written aliases', () => {
    // Why: an entry pointing at an id the content no longer repeats is dead weight that never fires again.
    test('every id it names is one the content really does repeat', () => {
        const collided = new Set(NAME_COLLISIONS.flatMap(g => g.objs.map(o => o.id)));
        for (const id of Object.keys(ITEM_ALIASES)) {
            expect({ id, collides: collided.has(Number(id)) }).toEqual({ id, collides: true });
        }
    });

    // Why: two objs answering to one label is the bug this table exists to remove.
    test('no two ids answer to the same label', () => {
        const labels = Object.values(ITEM_ALIASES).map(a => a.label);
        expect(new Set(labels).size).toBe(labels.length);
    });

    test('every entry carries at least one word', () => {
        for (const [id, alias] of Object.entries(ITEM_ALIASES)) {
            expect({ id, words: alias.words.length > 0 }).toEqual({ id, words: true });
        }
    });

    test('every synonym stands for a name the content actually repeats', () => {
        const names = new Set(NAME_COLLISIONS.map(g => g.name.toLowerCase()));
        for (const name of Object.keys(NAME_SYNONYMS)) {
            expect({ name, known: names.has(name) }).toEqual({ name, known: true });
        }
    });
});

// Why: these are the families a shop puts on a shelf, so a customer has to be able to name one of them
// Why: and the shop has to be able to say which it means. New content inside one fails here.
describe('the families a shop trades are fully separated', () => {
    const FAMILIES = [
        'Dragonhide',
        'Dragonhide body',
        'Dragonhide chaps',
        'Dragon leather',
        'Dragon vambraces',
        'Half of a key',
        'Cape',
        'Maple longbow',
        'Yew longbow',
        'Magic shortbow',
        'Sapphire amulet'
    ];

    for (const name of FAMILIES) {
        test(`${name}: every member has its own label`, () => {
            const { group, cat } = catalogOf(name);
            const labels = group.objs.map(o => displayName(cat, o.id));
            expect(new Set(labels).size).toBe(labels.length);
        });

        test(`${name}: every member is reachable by the label the shop says`, () => {
            const { group, cat } = catalogOf(name);
            for (const obj of group.objs) {
                const label = displayName(cat, obj.id);
                expect({ label, ids: resolveByName(cat, label).map(r => r.id) }).toEqual({ label, ids: [obj.id] });
            }
        });
    }
});
