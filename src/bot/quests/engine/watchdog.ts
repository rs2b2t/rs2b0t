import type { QuestSnapshot } from './types.js';

export const NO_PROGRESS_WARN = 3;
export const NO_PROGRESS_PARK = 8;

export function progressSignature(snap: QuestSnapshot): string {
    const items = [...snap.inv.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([n, c]) => `${n}:${c}`);
    const itemIds = [...(snap.invIds?.entries() ?? [])].sort(([a], [b]) => a - b).map(([id, c]) => `${id}:${c}`);
    const worn = [...snap.worn].sort().join(',');
    const wornIds = [...(snap.wornIds ?? [])].sort((a, b) => a - b).join(',');
    const tile = snap.tile ? `${snap.tile.x},${snap.tile.z},${snap.tile.level}` : '?';
    return `${snap.journal}|stage:${snap.stage ?? '?'}|tile:${tile}|inv:${items.join(',')}|invIds:${itemIds.join(',')}|worn:${worn}|wornIds:${wornIds}`;
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
