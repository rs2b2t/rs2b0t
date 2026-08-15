import { describe, expect, test } from 'bun:test';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { nextQuest, queueRows } from '#/bot/api/ai/quests/engine/queue.js';
import type { QuestEligibility } from '#/bot/api/ai/quests/types.js';

const e = (id: string, status: QuestEligibility['status'], reasons: string[] = []): [string, QuestEligibility] =>
    [id, { id, name: id.toUpperCase(), status, reasons }];

const ORDER = ['runemysteries', 'doric', 'sheep', 'priest'];

/**
 * Mirrors QuestEngine after a user Skip: the skipped id is blocked for the
 * session and removed from the selectable set before nextQuest runs.
 */
function afterUserSkip(
    skippedId: string,
    order: string[],
    picked: Set<string>,
    elig: Map<string, QuestEligibility>,
    blocked: Map<string, string[]>
): string | null {
    blocked.set(skippedId, ['skipped by user this session']);
    const selectable = new Set([...picked].filter(id => !blocked.has(id)));
    return nextQuest(order, selectable, elig, new Set());
}

describe('Skip quest (#432) session block', () => {
    test('skip stops the current quest and advances to the next READY', () => {
        const elig = new Map([
            e('runemysteries', 'READY'),
            e('doric', 'READY'),
            e('sheep', 'READY')
        ]);
        const blocked = new Map<string, string[]>();
        const next = afterUserSkip('runemysteries', ORDER, new Set(ORDER), elig, blocked);
        expect(next).toBe('doric');
        expect(blocked.get('runemysteries')).toEqual(['skipped by user this session']);
    });

    test('a skipped quest is never selected again this session', () => {
        const elig = new Map([e('runemysteries', 'READY'), e('doric', 'READY')]);
        const blocked = new Map<string, string[]>();
        afterUserSkip('runemysteries', ORDER, new Set(['runemysteries', 'doric']), elig, blocked);
        // even if nothing else is ready, the skipped id stays out of selectable
        const onlySkipped = nextQuest(
            ORDER,
            new Set(['runemysteries'].filter(id => !blocked.has(id))),
            elig,
            new Set()
        );
        expect(onlySkipped).toBeNull();
        // A park alone still returns the id; only the session block takes it out of selectable.
        expect(nextQuest(ORDER, new Set(['runemysteries']), elig, new Set(['runemysteries']))).toBe(
            'runemysteries'
        );
    });

    test('queue rows mark a skipped quest BLOCKED with the skip reason', () => {
        const elig = new Map([e('runemysteries', 'READY'), e('doric', 'READY')]);
        const blocked = new Map([['runemysteries', ['skipped by user this session']]]);
        const rows = queueRows(ORDER, new Set(['runemysteries', 'doric']), elig, new Set(), 'doric').map(r => {
            const reasons = blocked.get(r.id);
            return reasons ? { ...r, status: 'BLOCKED' as const, reasons } : r;
        });
        expect(rows.find(r => r.id === 'runemysteries')).toMatchObject({
            status: 'BLOCKED',
            reasons: ['skipped by user this session']
        });
        expect(rows.find(r => r.id === 'doric')?.status).toBe('RUNNING');
    });

    test('skip is not the same as temporary park (park retries, skip does not)', () => {
        const elig = new Map([e('doric', 'READY')]);
        // park fallback re-picks the only ready quest
        expect(nextQuest(ORDER, new Set(['doric']), elig, new Set(['doric']))).toBe('doric');
        // session block leaves nothing to run
        expect(nextQuest(ORDER, new Set(), elig, new Set())).toBeNull();
    });
});

describe('EventSignal interrupt (#432 skip yields walks)', () => {
    test('setInterrupt ORs with the main provider', () => {
        let main = false;
        let extra = false;
        EventSignal.setProvider(() => main);
        EventSignal.setInterrupt(() => extra);
        expect(EventSignal.pending()).toBe(false);
        main = true;
        expect(EventSignal.pending()).toBe(true);
        main = false;
        extra = true;
        expect(EventSignal.pending()).toBe(true);
        EventSignal.setInterrupt(null);
        expect(EventSignal.pending()).toBe(false);
        // restore default-ish empty provider so other tests are not polluted
        EventSignal.setProvider(() => false);
    });
});
