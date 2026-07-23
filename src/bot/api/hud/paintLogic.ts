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
    kind: 'panel' | 'widget';
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

export function hitRegion(regions: readonly Region[], x: number, y: number): Region | null {
    let hit: Region | null = null;
    for (const region of regions) {
        if (!inRect(region, x, y)) {
            continue;
        }
        if (!hit || (hit.kind === 'panel' && region.kind === 'widget')) {
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
