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
     * Returns true when it landed on one, so the canvas can swallow the event
     * instead of letting the game zoom.
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

/** Truncate paint text with an ellipsis (chatbox rows are tight). */
export function paintClip(text: string, max = 52): string {
    const s = text.trim();
    if (s.length <= max) {
        return s;
    }
    return `${s.slice(0, Math.max(0, max - 1))}…`;
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
