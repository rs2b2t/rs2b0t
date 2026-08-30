import type { BankSortResult } from '../../api/bank/bankSort.js';
import type { QuestJunkFinding } from '../../api/bank/bankQuestJunk.js';
import type { BankCategory } from '../../api/bank/bankSortRules.js';

export function droppableOf(found: readonly QuestJunkFinding[], armed: boolean): QuestJunkFinding[] {
    return armed ? found.filter(f => f.droppable) : [];
}

// Why: no name rule can separate a live quest item from a dead one, because that lives in the journal.
export function questCategories(found: readonly QuestJunkFinding[]): Map<number, BankCategory> {
    return new Map(found.map(f => [f.id, f.status === 'complete' ? 'questObsolete' : 'questLive']));
}

// Why: the live harness surfaces a bounded number of log lines per poll, so one line per item reads as silence.
export function reportLine(found: readonly QuestJunkFinding[]): string {
    const parts = found.map(f => `${f.name} (${f.quest}, ${f.status})`);
    return `BankSorter: quest leftovers — ${parts.join('; ') || 'none'}`;
}

export function summaryLine(
    result: BankSortResult,
    found: readonly QuestJunkFinding[],
    dropped: number
): string {
    return [
        `BankSorter: ${result.reason}`,
        `${result.moves} moves (${result.mode ?? 'none'})`,
        `${result.unmatched.length} unfiled`,
        `${found.length} quest leftovers`,
        `${dropped} dropped`
    ].join(', ');
}
