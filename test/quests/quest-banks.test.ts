import { describe, expect, test } from 'bun:test';

import { QUEST_DEFS } from '#/bot/quests/defs/index.js';
import { BANK_LOCATIONS } from '#/bot/api/BankLocations.js';

const bankKeys = new Set(BANK_LOCATIONS.map(b => `${b.tile.x},${b.tile.z},${b.tile.level}`));

describe('per-quest provisioning bank', () => {
    test('every implemented quest declares a bank', () => {
        const missing = QUEST_DEFS.filter(d => d.bank === undefined).map(d => d.record.id);
        expect(missing).toEqual([]);
    });

    test('every quest bank is a real known BANK_LOCATIONS tile', () => {
        for (const d of QUEST_DEFS) {
            const b = d.bank!;
            expect(bankKeys.has(`${b.x},${b.z},${b.level}`), `${d.record.id} → (${b.x},${b.z},${b.level})`).toBe(true);
        }
    });

    test('every quest bank is level 0', () => {
        for (const d of QUEST_DEFS) {
            expect(d.bank!.level, d.record.id).toBe(0);
        }
    });
});
