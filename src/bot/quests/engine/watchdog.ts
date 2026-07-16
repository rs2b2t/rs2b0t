import type { QuestSnapshot } from './types.js';

// Progress watchdog for the AIO quest loop: turns "the last completed step
// changed nothing observable" into a bounded counter the engine acts on. Pure —
// it reads only the plain snapshot, so it runs under bun:test with no client.

export const NO_PROGRESS_WARN = 3;
// 8, not 6: stage-invisible quests probe up to 4 NPCs per rotation and the
// worst convergent cycle (R&J stage 30 -> berries consumed) is 7 fruitless
// talks; parking earlier would bench a quest that was about to progress.
export const NO_PROGRESS_PARK = 8;

/** Journal + sorted inventory counts. Sorted so Map insertion order never
 *  fakes progress. Worn is deliberately excluded: equipping is a step SIDE
 *  EFFECT that shows up as an inventory delta anyway (item leaves the pack). */
export function progressSignature(snap: QuestSnapshot): string {
    const items = [...snap.inv.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([n, c]) => `${n}:${c}`);
    return `${snap.journal}|${items.join(',')}`;
}

/** Counter fed one signature per COMPLETED step. */
export class ProgressWatchdog {
    private last = '';
    private count = 0;

    /** Returns the current no-progress count (0 when the signature moved). */
    note(signature: string): number {
        if (signature !== this.last) {
            this.last = signature;
            this.count = 0;
        } else {
            this.count++;
        }
        return this.count;
    }

    reset(): void {
        this.last = '';
        this.count = 0;
    }
}
