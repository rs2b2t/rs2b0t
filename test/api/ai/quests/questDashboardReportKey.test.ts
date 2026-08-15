import { describe, expect, test } from 'bun:test';
import { eligibilityReportKey } from '#/bot/api/ai/quests/eligibilityReportKey.js';
import type { QuestEligibility } from '#/bot/api/ai/quests/types.js';

function row(name: string, status: QuestEligibility['status']): QuestEligibility {
    return { id: name, name, status, reasons: [] };
}

describe('eligibilityReportKey', () => {
    test('banner overrides result content', () => {
        expect(eligibilityReportKey([], 'journal missing')).toBe('banner:journal missing');
        expect(eligibilityReportKey([row('Cook\'s Assistant', 'READY')], 'journal missing')).toBe(
            'banner:journal missing'
        );
    });

    test('same multiset of statuses produces the same key', () => {
        const a = [row('A', 'READY'), row('B', 'BLOCKED'), row('C', 'DONE')];
        const b = [row('C', 'DONE'), row('B', 'BLOCKED'), row('A', 'READY')];
        expect(eligibilityReportKey(a, '')).toBe(eligibilityReportKey(b, ''));
    });

    test('ready-name set is part of the key (order-independent)', () => {
        const a = [row('Sheep Shearer', 'READY'), row('Cook\'s Assistant', 'READY')];
        const b = [row('Cook\'s Assistant', 'READY'), row('Sheep Shearer', 'READY')];
        expect(eligibilityReportKey(a, '')).toBe(eligibilityReportKey(b, ''));
        const c = [row('Sheep Shearer', 'READY'), row('Restless Ghost', 'READY')];
        expect(eligibilityReportKey(a, '')).not.toBe(eligibilityReportKey(c, ''));
    });

    test('status flips change the key', () => {
        const ready = [row('Cook\'s Assistant', 'READY')];
        const done = [row('Cook\'s Assistant', 'DONE')];
        expect(eligibilityReportKey(ready, '')).not.toBe(eligibilityReportKey(done, ''));
    });
});
