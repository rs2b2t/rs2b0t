import { clipText, wrapText } from '../../paint/paintLogic.js';
import type { QueueRow, QueueStatus } from '../../api/ai/quests/engine/queue.js';

export const QUEUE_ICON: Record<QueueStatus, string> = {
    DONE: '✓',
    RUNNING: '▶',
    READY: '·',
    PARKED: '⏸',
    BLOCKED: '✗',
    UNKNOWN: '?'
};

export const QUEUE_COLOUR: Record<QueueStatus, string> = {
    DONE: '#4f7a52',
    RUNNING: '#ffffff',
    READY: '#cdd3da',
    PARKED: '#e8c35b',
    BLOCKED: '#e05b5b',
    UNKNOWN: '#8a919a'
};

export interface QueueEntry {
    icon: string;
    name: string;
    note: string;
    colour: string;
}

/** One queue row, split into the columns the Queue tab paints. */
export function queueEntry(row: QueueRow): QueueEntry {
    const [first, ...rest] = row.reasons;
    const note = first ? (rest.length > 0 ? `${first} (+${rest.length} more)` : first) : '';
    return { icon: QUEUE_ICON[row.status], name: row.name, note, colour: QUEUE_COLOUR[row.status] };
}

export interface BlockedEntry {
    name: string;
    reasons: string[];
}

/** The quests that are going nowhere, with every reason they gave. */
export function blockedEntries(rows: readonly QueueRow[]): BlockedEntry[] {
    return rows
        .filter(r => r.status === 'BLOCKED' || r.status === 'PARKED' || r.status === 'UNKNOWN')
        .map(r => ({ name: r.name, reasons: r.reasons.length > 0 ? [...r.reasons] : ['no reason given'] }));
}

/** Quest name column of the Blocked tab; reasons hang to its right. */
const BLOCKED_NAME_COLS = 20;

export interface BlockedLine {
    text: string;
    /** Continuation lines are dimmed, so each quest still reads as one block. */
    dim: boolean;
}

/**
 * The Blocked tab, one reason per line with the name column held clear so the
 * reasons line up. The first reason shares the name's line; the rest hang under it.
 */
export function blockedLines(rows: readonly QueueRow[], cols: number): BlockedLine[] {
    const gutter = ' '.repeat(BLOCKED_NAME_COLS);
    const room = Math.max(1, cols - BLOCKED_NAME_COLS - 1);
    const out: BlockedLine[] = [];
    for (const entry of blockedEntries(rows)) {
        let head = clipText(entry.name, BLOCKED_NAME_COLS).padEnd(BLOCKED_NAME_COLS);
        for (const reason of entry.reasons) {
            for (const line of wrapText(reason, room)) {
                out.push({ text: `${head} ${line}`, dim: head === gutter });
                head = gutter;
            }
        }
    }
    return out;
}

/** Row the Queue list keeps on screen: whatever is running, else the next unfinished quest. */
export function focusRow(rows: readonly QueueRow[], runningId: string | null): number {
    const running = rows.findIndex(r => r.id === runningId);
    return running >= 0 ? running : rows.findIndex(r => r.status !== 'DONE');
}

export interface QueueSummary {
    done: number;
    stuck: number;
    total: number;
}

export function queueSummary(rows: readonly QueueRow[]): QueueSummary {
    return {
        done: rows.filter(r => r.status === 'DONE').length,
        stuck: rows.filter(r => r.status === 'BLOCKED' || r.status === 'PARKED').length,
        total: rows.length
    };
}
