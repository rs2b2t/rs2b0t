import { describe, expect, test } from 'bun:test';
import { DROP_DB } from '#/bot/data/dropdb.js';
import { SETTINGS } from '#/bot/scripts/JiveDragons/JiveDragons.js';

describe('JiveDragons loot defaults', () => {
    const loot = SETTINGS.loot!;
    const defaults = loot.default as string[];

    test('Coins and Bass are offered but start unticked', () => {
        expect(loot.options).toContain('Coins');
        expect(loot.options).toContain('Bass');
        expect(defaults).not.toContain('Coins');
        expect(defaults).not.toContain('Bass');
    });

    test('the drops worth the walk are still on by default', () => {
        expect(defaults).toContain('Dragon bones');
        expect(defaults).toContain('Dragonhide');
    });

    test('no arrow is on the blue dragon table, so a range run only gets its own back by name', () => {
        expect(DROP_DB['Blue dragon']!.some(n => n.toLowerCase().includes('arrow'))).toBe(false);
    });
});

describe('JiveDragons leaveVia', () => {
    test('the teleport and the gate walk are the only ways out, the teleport by default', () => {
        expect(SETTINGS.leaveVia!.options).toEqual(['teleport', 'walk']);
        expect(SETTINGS.leaveVia!.default).toBe('teleport');
    });
});
