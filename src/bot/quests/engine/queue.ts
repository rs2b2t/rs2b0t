import type { QuestEligibility } from '../types.js';

export type QueueStatus = 'DONE' | 'RUNNING' | 'READY' | 'PARKED' | 'BLOCKED' | 'UNKNOWN';

export interface QueueRow {
    id: string;
    name: string;
    status: QueueStatus;
    reasons: string[];
}

/** READY-and-not-parked first in def order; then parked READY (retry after
 *  everything else had its turn); null when nothing is runnable. Pure. */
export function nextQuest(
    order: string[],
    picked: Set<string>,
    elig: Map<string, QuestEligibility>,
    parked: Set<string>
): string | null {
    const ready = order.filter(id => picked.has(id) && elig.get(id)?.status === 'READY');
    return ready.find(id => !parked.has(id)) ?? ready[0] ?? null;
}

export function queueRows(
    order: string[],
    picked: Set<string>,
    elig: Map<string, QuestEligibility>,
    parked: Set<string>,
    runningId: string | null
): QueueRow[] {
    return order.filter(id => picked.has(id)).map(id => {
        const el = elig.get(id);
        if (id === runningId) {
            return { id, name: el?.name ?? id, status: 'RUNNING', reasons: [] };
        }
        if (!el) {
            return { id, name: id, status: 'UNKNOWN', reasons: ['eligibility not evaluated yet'] };
        }
        if (parked.has(id) && el.status === 'READY') {
            return { id, name: el.name, status: 'PARKED', reasons: ['no progress — parked'] };
        }
        return { id, name: el.name, status: el.status, reasons: el.reasons };
    });
}
