import type { QuestSnapshot } from './types.js';

export const NO_PROGRESS_WARN = 3;
export const NO_PROGRESS_PARK = 8;

export function progressSignature(snap: QuestSnapshot): string {
    const items = [...snap.inv.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([n, c]) => `${n}:${c}`);
    return `${snap.journal}|${items.join(',')}`;
}

export class ProgressWatchdog {
    private last = '';
    private count = 0;

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
