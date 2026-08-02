/**
 * Draw published nav path as ground-style tile quads on the bot #overlay canvas.
 *
 * We only have HTML #overlay on top of the 3D canvas, so we approximate:
 *   - project each path tile's four corners (same Client.overlayPos as entities)
 *   - fill/stroke diamond quads
 *   - clip to the 3D game viewport (512×334 at 4,4) so chat/tabs stay clean
 *
 * Colours / hop text come from Global settings (see pathPaintTheme.ts).
 * Still depth-less vs models (always above people/locs). That needs a Client paint hook.
 */

import { reader } from '../adapter/ClientAdapter.js';
import { SettingsStore } from '../runtime/Settings.js';
import { PathPublish, type PublishedPathTile } from './pathPublish.js';
import {
    resolveNavPathPaintTheme,
    type NavPathPaintTheme
} from './pathPaintTheme.js';

/** areaGame surface blitted at (4,4) — see Client.overlayPos. */
export const GAME_VIEW_CLIP = { x: 4, y: 4, w: 512, h: 334 } as const;

/** Max tile quads to draw (far path is subsampled). */
const MAX_DRAW_TILES = 80;
/** Always paint this many steps ahead of pathIdx at full density. */
const NEAR_FULL_DENSITY = 24;

export type ProjectCorner = (x: number, z: number, u: number, v: number) => { x: number; y: number } | null;

export interface TileQuad {
    /** SW, SE, NE, NW in screen space. */
    corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
    transport: boolean;
    idx: number;
    done: boolean;
    label?: string;
}

export function isNavPathPaintEnabled(): boolean {
    try {
        return SettingsStore.globalBag().bool('showNavPath', false);
    } catch {
        return false;
    }
}

/**
 * Indices of path tiles to paint: full density near pathIdx, then subsampled.
 * Always keeps the terminal. `force` (e.g. hop indices) is never dropped.
 */
export function selectDrawIndices(
    fromIdx: number,
    pathLen: number,
    maxTiles = MAX_DRAW_TILES,
    nearFull = NEAR_FULL_DENSITY,
    force: readonly number[] = []
): number[] {
    if (pathLen <= 0 || fromIdx >= pathLen) {
        return [];
    }
    const start = Math.max(0, fromIdx);
    const nearEnd = Math.min(pathLen, start + nearFull);
    const chosen = new Set<number>();
    for (let i = start; i < nearEnd; i++) {
        chosen.add(i);
    }
    const remaining = pathLen - nearEnd;
    if (remaining > 0) {
        const budget = Math.max(0, maxTiles - chosen.size);
        if (budget > 0) {
            const stride = Math.max(1, Math.ceil(remaining / budget));
            for (let i = nearEnd; i < pathLen; i += stride) {
                chosen.add(i);
            }
        }
    }
    chosen.add(pathLen - 1);
    for (const i of force) {
        if (i >= start && i < pathLen) {
            chosen.add(i);
        }
    }
    return [...chosen].sort((a, b) => a - b);
}

/** Project four corners of a world tile; null if any corner fails. */
export function projectTileQuad(
    tile: PublishedPathTile,
    project: ProjectCorner
): [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] | null {
    const sw = project(tile.x, tile.z, 0, 0);
    const se = project(tile.x, tile.z, 1, 0);
    const ne = project(tile.x, tile.z, 1, 1);
    const nw = project(tile.x, tile.z, 0, 1);
    if (!sw || !se || !ne || !nw) {
        return null;
    }
    return [sw, se, ne, nw];
}

/** Build ground-style quads for the active path segment. Hop tiles are never subsampled away. */
export function buildPathQuads(
    tiles: PublishedPathTile[],
    pathIdx: number,
    cameraLevel: number,
    project: ProjectCorner
): TileQuad[] {
    const forceHops: number[] = [];
    for (let i = 0; i < tiles.length; i++) {
        if (tiles[i]!.transport) {
            forceHops.push(i);
        }
    }
    const indices = selectDrawIndices(pathIdx, tiles.length, MAX_DRAW_TILES, NEAR_FULL_DENSITY, forceHops);
    const out: TileQuad[] = [];
    for (const idx of indices) {
        const t = tiles[idx]!;
        if (t.level !== cameraLevel) {
            continue;
        }
        const corners = projectTileQuad(t, project);
        if (!corners) {
            continue;
        }
        out.push({
            corners,
            transport: !!t.transport,
            idx,
            done: idx < pathIdx,
            label: t.label
        });
    }
    return out;
}

export function quadCenter(corners: TileQuad['corners']): { x: number; y: number } {
    return {
        x: (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4,
        y: (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4
    };
}

export function drawHopLabel(
    ctx: CanvasRenderingContext2D,
    label: string,
    cx: number,
    cy: number,
    theme: Pick<NavPathPaintTheme, 'textFill' | 'textShadow' | 'textSize'>,
    opts?: { done?: boolean }
): void {
    const text = label.trim();
    if (!text) {
        return;
    }
    const alpha = opts?.done ? 0.45 : 1;
    const size = theme.textSize;
    ctx.save();
    ctx.font = `bold ${size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const lift = Math.max(4, Math.round(size * 0.55));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = theme.textShadow;
    ctx.fillText(text, cx + 1, cy - lift + 1);
    ctx.fillStyle = theme.textFill;
    ctx.fillText(text, cx, cy - lift);
    ctx.restore();
}

/** @deprecated centre-line helper kept for unit tests / optional debug. */
export function projectPathTiles(
    tiles: PublishedPathTile[],
    fromIdx: number,
    cameraLevel: number,
    project: (x: number, z: number, level: number) => { x: number; y: number } | null
): { x: number; y: number; transport: boolean; idx: number }[] {
    const indices = selectDrawIndices(fromIdx, tiles.length);
    const out: { x: number; y: number; transport: boolean; idx: number }[] = [];
    for (const i of indices) {
        const t = tiles[i]!;
        if (t.level !== cameraLevel) {
            continue;
        }
        const p = project(t.x, t.z, t.level);
        if (p) {
            out.push({ x: p.x, y: p.y, transport: !!t.transport, idx: i });
        }
    }
    return out;
}

function fillQuad(
    ctx: CanvasRenderingContext2D,
    corners: TileQuad['corners'],
    fill: string,
    stroke: string,
    lineWidth: number
): void {
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    ctx.lineTo(corners[1].x, corners[1].y);
    ctx.lineTo(corners[2].x, corners[2].y);
    ctx.lineTo(corners[3].x, corners[3].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
}

export function paintNavPath(ctx: CanvasRenderingContext2D): void {
    if (!isNavPathPaintEnabled()) {
        return;
    }
    const path = PathPublish.get();
    if (!path || path.tiles.length === 0) {
        return;
    }
    const me = reader.worldTile();
    if (!me || !reader.attached()) {
        return;
    }

    const theme = resolveNavPathPaintTheme();
    const project: ProjectCorner = (x, z, u, v) => reader.overlayPosWorld(x, z, 0, u, v);

    const trailFrom = Math.max(0, path.pathIdx - 4);
    const quads = buildPathQuads(path.tiles, trailFrom, me.level, project);
    for (const q of quads) {
        q.done = q.idx < path.pathIdx;
    }
    if (quads.length === 0) {
        return;
    }

    ctx.save();
    try {
        ctx.beginPath();
        ctx.rect(GAME_VIEW_CLIP.x, GAME_VIEW_CLIP.y, GAME_VIEW_CLIP.w, GAME_VIEW_CLIP.h);
        ctx.clip();

        for (const q of quads) {
            if (!q.done) {
                continue;
            }
            fillQuad(ctx, q.corners, theme.doneFill, theme.doneStroke, 1);
        }
        for (const q of quads) {
            if (q.done) {
                continue;
            }
            if (q.transport) {
                fillQuad(ctx, q.corners, theme.hopFill, theme.hopStroke, 1.5);
            } else {
                fillQuad(ctx, q.corners, theme.walkFill, theme.walkStroke, 1);
            }
        }

        if (theme.showText) {
            for (const q of quads) {
                if (!q.transport || !q.label) {
                    continue;
                }
                const c = quadCenter(q.corners);
                drawHopLabel(ctx, q.label, c.x, c.y, theme, { done: q.done });
            }
        }

        if (path.clickIdx >= 0 && path.clickIdx < path.tiles.length) {
            const ct = path.tiles[path.clickIdx]!;
            if (ct.level === me.level) {
                const corners = projectTileQuad(ct, project);
                if (corners) {
                    ctx.beginPath();
                    ctx.moveTo(corners[0].x, corners[0].y);
                    ctx.lineTo(corners[1].x, corners[1].y);
                    ctx.lineTo(corners[2].x, corners[2].y);
                    ctx.lineTo(corners[3].x, corners[3].y);
                    ctx.closePath();
                    ctx.strokeStyle = theme.clickStroke;
                    ctx.lineWidth = 2.5;
                    ctx.stroke();
                }
            }
        }
    } finally {
        ctx.restore();
    }
}
