import { expect, test } from 'bun:test';
import { gatheringTool, meleeEquipment, rangedBow } from '#/bot/scripts/AccountLeveler/equipment.js';
import { supplyOffer } from '#/bot/scripts/AccountLeveler/offers.js';
import { auditSupplies } from '#/bot/scripts/AccountLeveler/shopping.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

function snapshot(levels: Record<string, number> = {}, stock: Record<string, number> = { coins: 500000 }): LevelerSnapshot {
    return { levels: { attack: 1, strength: 1, defence: 1, ranged: 1, woodcutting: 1, mining: 1, ...levels },
        stock, bankReady: true, quests: {}, target: 40, wilderness: false, now: 0 };
}

test('uses a banked rune axe from inventory at woodcutting and attack level one', () => {
    expect(gatheringTool(snapshot({}, { coins: 0, 'rune axe': 1 }), 'axe')).toEqual({ item: 'Rune axe', count: 1, carry: 1 });
});

test('buys the best stocked axe rather than requiring an unavailable higher tier', () => {
    expect(gatheringTool(snapshot(), 'axe')).toEqual({ item: 'Steel axe', count: 1, carry: 1 });
});

test.each([[1, 'Iron pickaxe'], [5, 'Iron pickaxe'], [6, 'Steel pickaxe'], [20, 'Steel pickaxe'],
    [21, 'Mithril pickaxe'], [30, 'Mithril pickaxe'], [31, 'Adamant pickaxe'], [40, 'Adamant pickaxe'], [41, 'Rune pickaxe']])(
    'mining level %i selects %s independently of attack level', (mining, name) => {
        expect(gatheringTool(snapshot({ mining: Number(mining) }), 'pickaxe')).toEqual({ item: name, count: 1, carry: 1 });
    }
);

test('picks fall back to an affordable tier while protecting travel funds', () => {
    expect(gatheringTool(snapshot({ mining: 41 }, { coins: 1040 }), 'pickaxe').item).toBe('Iron pickaxe');
    expect(gatheringTool(snapshot({ mining: 41 }, { coins: 1039 }), 'pickaxe').item).toBe('Bronze pickaxe');
    expect(gatheringTool(snapshot({ mining: 41 }, { coins: 0, 'adamant pickaxe': 1 }), 'pickaxe').item).toBe('Adamant pickaxe');
    expect(gatheringTool(snapshot({ mining: 40 }, { coins: 0, 'rune pickaxe': 1, 'steel pickaxe': 1 }), 'pickaxe').item).toBe('Steel pickaxe');
});

test('pickaxe upgrades have a proven Nurmof shop destination', () => {
    const offer = supplyOffer('Rune pickaxe');
    expect(offer?.keeper).toBe('Nurmof');
    expect(offer?.tile).toEqual({ x: 2997, z: 9844, level: 0 });
});

test('melee chooses owned or stocked upgrades with independent attack and defence gates', () => {
    const owned = { coins: 500000, 'rune scimitar': 1, 'rune chainbody': 1, 'rune platelegs': 1 };
    expect(meleeEquipment(snapshot({ attack: 40, defence: 40 }, owned)).map(need => need.item)).toEqual(['Rune scimitar', 'Rune chainbody', 'Rune platelegs']);
    expect(meleeEquipment(snapshot({ attack: 20, defence: 1 }, owned)).map(need => need.item)).toEqual(['Mithril scimitar', 'Iron platebody', 'Iron platelegs']);
    expect(meleeEquipment(snapshot({ attack: 1, defence: 20 })).map(need => need.item)).toEqual(['Iron scimitar', 'Mithril platebody', 'Iron platelegs']);
});

test('melee kit keeps existing usable gear when no purchase is affordable', () => {
    const kit = meleeEquipment(snapshot({ attack: 40, defence: 40 }, { coins: 200, 'steel scimitar': 1, 'iron chainbody': 1, 'bronze platelegs': 1 }));
    expect(kit.map(need => need.item)).toEqual(['Steel scimitar', 'Iron chainbody', 'Bronze platelegs']);
    expect(kit.every(need => need.count === 1 && need.carry === 1 && need.equip === true)).toBe(true);
});

test('ranged upgrades only choose usable strung bow ids', () => {
    expect(rangedBow(snapshot({ ranged: 40 }, { coins: 0, '#857': 1 }))).toEqual({ item: 'Yew shortbow', id: 857, count: 1, carry: 1, equip: true });
    expect(rangedBow(snapshot({ ranged: 30 }, { coins: 500000, '#857': 1, '#64': 10, 'yew shortbow': 11 })).id).toBe(843);
    expect(rangedBow(snapshot({ ranged: 1 } )).id).toBe(841);
});

test('unavailable upgrades fall back without discarding an already owned tool', () => {
    const s = { ...snapshot({ mining: 41 }), unavailableItems: ['Rune pickaxe', 'adamant pickaxe'] };
    expect(gatheringTool(s, 'pickaxe').item).toBe('Mithril pickaxe');
    s.stock['rune pickaxe'] = 1;
    expect(gatheringTool(s, 'pickaxe').item).toBe('Rune pickaxe');
    expect(rangedBow({ ...snapshot({ ranged: 5 }), unavailableItems: ['#843', 'Oak longbow'] }).id).toBe(841);
});

test('owned higher tier longbows retain exact usable ids', () => {
    expect(rangedBow(snapshot({ ranged: 50 }, { coins: 0, '#859': 1 })).id).toBe(859);
});

test('startup tool upgrades share a budget and fall back after earlier purchases', () => {
    const s = snapshot({ attack: 40, defence: 40, ranged: 40, strength: 40, mining: 6 }, { coins: 3500 });
    const audit = auditSupplies(s);
    expect(audit.needs).toEqual([{ item: 'Steel axe', count: 1 }, { item: 'Iron pickaxe', count: 1 }]);
    expect(audit.budget + audit.reserve).toBeLessThanOrEqual(3500);
});

test('startup recognizes banked upgrades instead of buying extra bronze tools', () => {
    const s = snapshot({ attack: 40, defence: 40, ranged: 40, strength: 40, mining: 21 }, { coins: 0, 'rune axe': 1, 'mithril pickaxe': 1 });
    expect(auditSupplies(s).needs).toEqual([]);
    expect(auditSupplies(s).skipped).toEqual([]);
});

test('an affordable full melee kit takes priority over spending its leg budget on a stronger body', () => {
    expect(meleeEquipment(snapshot({}, { coins: 3000 })).map(need => need.item)).toEqual(['Iron scimitar', 'Bronze chainbody', 'Iron platelegs']);
});
