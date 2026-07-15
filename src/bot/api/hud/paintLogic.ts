/**
 * Pure core of the interactive Paint system (no DOM/canvas imports — plain
 * `bun test`). Owns everything the immediate-mode API and the input capture
 * layer share: coordinate mapping, dock geometry, region hit-testing, and the
 * cross-frame widget state (active tabs, collapse flags, queued clicks).
 *
 * Frame protocol: Paint.begin/…/end publishes this frame's regions here; the
 * capture layer feeds pointer events in CANVAS coordinates and learns whether
 * to swallow them; widgets consume queued clicks on the NEXT frame — the
 * standard immediate-mode arrangement.
 */

/** Logical client canvas size (the game's fixed 765×503 space). */
export const CANVAS_W = 765;
export const CANVAS_H = 503;

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Region extends Rect {
    id: string;
    /** 'panel' swallows input but never queues clicks; 'widget' does both. */
    kind: 'panel' | 'widget';
}

export type Dock = 'chatbox' | 'topleft' | Rect;

/** The chat area of the fixed 765×503 layout — the classic paint dock. */
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

/** CSS-pixel client coords → logical canvas coords (matches GameShell's
 *  getMousePos scaling for the non-fullscreen layout). */
export function toCanvasPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
    return {
        x: (clientX - rect.left) * (CANVAS_W / rect.width),
        y: (clientY - rect.top) * (CANVAS_H / rect.height)
    };
}

const inRect = (r: Rect, x: number, y: number): boolean => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** The region under (x,y) — widgets beat their containing panel. Null when
 *  the point is over open game. */
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

/** Cross-frame paint state: published regions, queued clicks, hover point,
 *  and a kv store for widget state (active tab, collapsed, …). One instance
 *  serves the whole client (one script runs at a time — ADR-0006). */
export class PaintState {
    private regions: Region[] = [];
    private clicks = new Set<string>();
    private hover: { x: number; y: number } | null = null;
    private store = new Map<string, string>();

    /** Paint.end() hands over this frame's hit regions. */
    publishRegions(regions: Region[]): void {
        this.regions = regions;
    }

    /** Pointer press in canvas coords. True = inside the paint (swallow). */
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

    /** Pointer move in canvas coords. True = inside the paint (swallow). */
    pointerMove(x: number, y: number): boolean {
        this.hover = { x, y };
        return hitRegion(this.regions, x, y) !== null;
    }

    /** Any pointer event that only needs swallowing (up/click/wheel/menu). */
    pointerIsInside(x: number, y: number): boolean {
        return hitRegion(this.regions, x, y) !== null;
    }

    /** A widget call consumes its queued click (once). */
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

    /** Script stopped: nothing may keep swallowing input or holding state. */
    reset(): void {
        this.regions = [];
        this.clicks.clear();
        this.hover = null;
        this.store.clear();
    }
}

/** The client-wide paint state singleton (Paint API + input layer share it). */
export const paintState = new PaintState();
