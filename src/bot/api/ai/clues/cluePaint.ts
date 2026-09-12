import type { PaintFrame } from '#/bot/paint/Paint.js';
import { ClueExecutor, tilesTo } from '#/bot/api/ai/clues/ClueExecutor.js';

const MUTED = '#8a919a';

/** Shared clue progress display used by both grind bots and ClueSolver. */
export function paintClueProgress(p: PaintFrame, idle = 'no clue in progress'): void {
    const cur = ClueExecutor.current;
    if (!cur) {
        p.text(idle, MUTED);
        return;
    }
    p.text(`${cur.name} — leg ${cur.leg}${cur.attempt > 1 ? ` (try ${cur.attempt})` : ''}`);
    p.text(cur.step, MUTED);

    const left = tilesTo(cur.target);
    if (cur.target && left !== null) {
        // Full bar means standing on it; it fills as the gap closes.
        p.bar('Travel', cur.startDist > 0 ? 1 - left / cur.startDist : 1);
        p.text(`${left} tiles to (${cur.target.x},${cur.target.z},${cur.target.level})`, MUTED);
    }
}
