const CANVAS_W = 765;
const CANVAS_H = 503;

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Region extends Rect {
    id: string;
    kind: 'panel' | 'widget' | 'scroll';
}

export type Dock = 'chatbox' | 'topleft' | Rect;

const CHATBOX: Rect = { x: 8, y: 345, w: 506, h: 150 };
const TOPLEFT: Rect = { x: 6, y: 6, w: 320, h: 150 };

export function resolveDock(dock: Dock): Rect {
    if (dock === 'chatbox') {
        return { ...CHATBOX };
    }
    if (dock === 'topleft') {
        return { ...TOPLEFT };
    }
    return { ...dock };
}

export function toCanvasPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
    return {
        x: (clientX - rect.left) * (CANVAS_W / rect.width),
        y: (clientY - rect.top) * (CANVAS_H / rect.height)
    };
}

const inRect = (r: Rect, x: number, y: number): boolean => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/**
 * Wrap-around option cycle for paint steppers / selects.
 * `delta` of −1 is previous, +1 is next. Unknown `current` starts at index 0.
 */
export function cycleOption(options: readonly string[], current: string, delta: number): string {
    if (options.length === 0) {
        return current;
    }
    const at = options.findIndex(o => o.toLowerCase() === current.toLowerCase());
    const from = at >= 0 ? at : 0;
    const step = Math.trunc(delta) || 1;
    const n = options.length;
    const next = ((from + step) % n + n) % n;
    return options[next]!;
}

export function hitRegion(regions: readonly Region[], x: number, y: number): Region | null {
    let hit: Region | null = null;
    for (const region of regions) {
        if (!inRect(region, x, y)) {
            continue;
        }
        if (!hit || (hit.kind !== 'widget' && region.kind === 'widget') || (hit.kind === 'panel' && region.kind === 'scroll')) {
            hit = region;
        }
    }
    return hit;
}

export class PaintState {
    private regions: Region[] = [];
    private clicks = new Set<string>();
    private hover: { x: number; y: number } | null = null;
    private store = new Map<string, string>();
    /** Wheel notches accumulated per scrollable region since the last paint. */
    private wheels = new Map<string, number>();

    publishRegions(regions: Region[]): void {
        this.regions = regions;
    }

    pointerDown(x: number, y: number): boolean {
        const hit = hitRegion(this.regions, x, y);
        if (!hit) {
            return false;
        }
        if (hit.kind === 'widget') {
            this.clicks.add(hit.id);
        }
        return true;
    }

    pointerMove(x: number, y: number): boolean {
        this.hover = { x, y };
        return hitRegion(this.regions, x, y) !== null;
    }

    pointerIsInside(x: number, y: number): boolean {
        return hitRegion(this.regions, x, y) !== null;
    }

    consumeClick(id: string): boolean {
        return this.clicks.delete(id);
    }

    /**
     * Route a wheel notch to whatever scrollable region is under the cursor.
     * Why: true means it landed on one, so the canvas can swallow the event instead of letting the game zoom.
     */
    wheel(x: number, y: number, delta: number): boolean {
        const hit = hitRegion(this.regions, x, y);
        if (!hit || hit.kind !== 'scroll') {
            return false;
        }
        this.wheels.set(hit.id, (this.wheels.get(hit.id) ?? 0) + delta);
        return true;
    }

    /** Take the pending notches for a region; a paint applies them once. */
    consumeWheel(id: string): number {
        const n = this.wheels.get(id) ?? 0;
        this.wheels.delete(id);
        return n;
    }

    isHovered(rect: Rect): boolean {
        return this.hover !== null && inRect(rect, this.hover.x, this.hover.y);
    }

    get(key: string, fallback: string): string {
        return this.store.get(key) ?? fallback;
    }

    set(key: string, value: string): void {
        this.store.set(key, value);
    }

    reset(): void {
        this.regions = [];
        this.clicks.clear();
        this.hover = null;
        this.store.clear();
    }
}

export const paintState = new PaintState();

/** Monospace characters that fit a panel `w` px wide with `pad` px of gutter each side. */
export function paintCols(w: number, pad: number, charW: number): number {
    if (charW <= 0) {
        return 0;
    }
    return Math.max(0, Math.floor((w - pad * 2) / charW));
}

/**
 * Word-wrap `text` to `cols` characters, indenting continuation lines by
 * `indent` spaces so a wrapped entry still reads as one entry.
 */
export function wrapText(text: string, cols: number, indent = 0): string[] {
    if (cols <= 0) {
        return [];
    }
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const pad = ' '.repeat(Math.max(0, Math.min(indent, cols - 1)));
    const lines: string[] = [];
    let line = '';
    const room = (): number => (lines.length === 0 ? cols : cols - pad.length);
    const flush = (): void => {
        if (line.length > 0) {
            lines.push(lines.length === 0 ? line : pad + line);
            line = '';
        }
    };
    for (let word of words) {
        // A word wider than the line has to break somewhere; break it at the edge.
        while (word.length > room()) {
            flush();
            const take = room();
            lines.push(lines.length === 0 ? word.slice(0, take) : pad + word.slice(0, take));
            word = word.slice(take);
        }
        if (line.length === 0) {
            line = word;
        } else if (line.length + 1 + word.length <= room()) {
            line += ` ${word}`;
        } else {
            flush();
            line = word;
        }
    }
    flush();
    return lines;
}

/** Pixel widths for weighted columns sharing `total` px. */
export function cellWidths(total: number, weights: readonly number[]): number[] {
    const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
    if (sum <= 0) {
        return weights.map(() => 0);
    }
    return weights.map(w => (Math.max(0, w) / sum) * total);
}

/** Rows needed to lay `len` entries `columns` across. */
export function gridRows(len: number, columns: number): number {
    if (columns <= 0 || len <= 0) {
        return 0;
    }
    return Math.ceil(len / columns);
}

/** Rows a single wheel notch moves a scrollable list. */
export const WHEEL_ROWS = 3;

export interface ListScrollState {
    offset: number;
    /** True once the user has scrolled, which detaches the list from `focus`. */
    manual: boolean;
    /** The focus row this state was computed against; a change re-attaches. */
    focus: number;
}

/**
 * Scroll position for an immediate-mode list.
 * Wheel notches detach the list from `focus`; a new `focus` row re-attaches it.
 */
export function listScroll(
    len: number,
    rows: number,
    state: ListScrollState,
    wheel: number,
    focus: number
): ListScrollState {
    const max = Math.max(0, len - rows);
    const clamp = (n: number): number => Math.min(max, Math.max(0, n));
    let manual = state.manual;
    if (focus !== state.focus) {
        manual = false;
    }
    let offset = clamp(Number.isFinite(state.offset) ? Math.trunc(state.offset) : 0);
    if (wheel !== 0) {
        manual = true;
        offset = clamp(offset + Math.trunc(wheel) * WHEEL_ROWS);
    } else if (!manual && rows > 0 && focus >= 0 && focus < len) {
        if (focus < offset) {
            offset = clamp(focus);
        } else if (focus >= offset + rows) {
            offset = clamp(focus - rows + 1);
        }
    }
    return { offset, manual, focus };
}

export function fmtDuration(mins: number): string {
    const t = Math.max(0, Math.floor(mins * 60));
    return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Compact skill labels for chatbox paint rows. */
export function paintSkillShort(skill: string): string {
    switch (skill) {
        case 'woodcutting':
            return 'WC';
        case 'firemaking':
            return 'FM';
        case 'fishing':
            return 'Fish';
        case 'cooking':
            return 'Cook';
        case 'mining':
            return 'Mine';
        default:
            return skill;
    }
}

export function paintSkillTitle(skill: string): string {
    switch (skill) {
        case 'woodcutting':
            return 'Woodcutting';
        case 'firemaking':
            return 'Firemaking';
        case 'fishing':
            return 'Fishing';
        case 'cooking':
            return 'Cooking';
        case 'mining':
            return 'Mining';
        default:
            return skill;
    }
}

/** Clip to `cols` characters with a trailing ellipsis, keeping leading spaces so padded columns stay aligned. */
export function clipText(text: string, cols: number): string {
    if (cols <= 0) {
        return '';
    }
    if (text.length <= cols) {
        return text;
    }
    return `${text.slice(0, cols - 1)}…`;
}

/** Truncate paint text with an ellipsis (chatbox rows are tight). */
export function paintClip(text: string, max = 52): string {
    return clipText(text.trim(), max);
}

export function fmtXpGained(n: number): string {
    if (n <= 0) {
        return '+0';
    }
    if (n >= 1000) {
        return `+${(n / 1000).toFixed(1)}k`;
    }
    return `+${n}`;
}

export function fmtXpHr(gained: number, mins: number): string {
    if (mins <= 0.5) {
        return '—';
    }
    return `${(((gained / mins) * 60) / 1000).toFixed(1)}k`;
}

/** Gathering script title accent colours. */
export function gatherPaintAccent(kind: 'fish' | 'mine' | 'wc' | 'other'): string {
    switch (kind) {
        case 'fish':
            return '#7ec8e3';
        case 'mine':
            return '#e0c36a';
        case 'wc':
        case 'other':
        default:
            return '#9be05b';
    }
}
