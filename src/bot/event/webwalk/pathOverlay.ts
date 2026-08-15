// Why: only the HTML #overlay sits on top of the 3D canvas, so the published path is approximated by projecting each tile's four corners with the same Client.overlayPos as entities, filling and stroking diamond quads, and clipping to the 3D game viewport (512×334 at 4,4) so chat and tabs stay clean.
// Why: colours and hop text come from Global settings (see pathPaintTheme.ts).
// Why: the paint is depth-less against models and always draws above people and locs — fixing that needs a Client paint hook.

import { reader } from '../../adapter/ClientAdapter.js';
import { Locs } from '../../api/locs/Locs.js';
import { SettingsStore } from '../../runtime/Settings.js';
import { matchesTransportLoc } from './exec/transportLoc.js';
import { PathPublish, type PublishedPathTile } from './pathPublish.js';
import {
    parseHtmlColor,
    resolveNavPathPaintTheme,
    rgba,
    type NavPathPaintTheme
} from './pathPaintTheme.js';
import { remainingPathFromPlayer } from './geometry/pathExpand.js';
import { Game } from '../../api/game/Game.js';

/** areaGame surface blitted at (4,4) — see Client.overlayPos. */
export const GAME_VIEW_CLIP = { x: 4, y: 4, w: 512, h: 334 } as const;

/** Max tile quads to draw (far path is subsampled). Explore: denser for continuous look. */
const MAX_DRAW_TILES = 160;
/** Always paint this many steps ahead of pathIdx at full density. */
const NEAR_FULL_DENSITY = 48;

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

function quadCenter(corners: TileQuad['corners']): { x: number; y: number } {
    return {
        x: (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4,
        y: (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4
    };
}

function drawHopLabel(
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

// Why: the edge pattern matches FireGiant.outlineTarget and reader.npcBox.
// Why: the optional translucent face fills make thin doors and ladders easier to spot.

/** Wireframe AABB, 8 corners: 0–3 ground, 4–7 top. */
export function strokeLocHull(
    ctx: CanvasRenderingContext2D,
    box: { x: number; y: number }[],
    stroke: string,
    lineWidth = 2,
    opts?: { fill?: string }
): void {
    if (box.length < 8) {
        return;
    }
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (opts?.fill) {
        const face = (idxs: number[]): void => {
            ctx.beginPath();
            ctx.moveTo(box[idxs[0]!]!.x, box[idxs[0]!]!.y);
            for (let k = 1; k < idxs.length; k++) {
                ctx.lineTo(box[idxs[k]!]!.x, box[idxs[k]!]!.y);
            }
            ctx.closePath();
            ctx.fillStyle = opts.fill!;
            ctx.fill();
        };
        // Ground + top lids (most readable under camera pitch).
        face([0, 1, 2, 3]);
        face([4, 5, 6, 7]);
    }

    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    const edge = (a: number, b: number): void => {
        ctx.beginPath();
        ctx.moveTo(box[a]!.x, box[a]!.y);
        ctx.lineTo(box[b]!.x, box[b]!.y);
        ctx.stroke();
    };
    for (let i = 0; i < 4; i++) {
        edge(i, (i + 1) % 4);
        edge(4 + i, 4 + ((i + 1) % 4));
        edge(i, 4 + i);
    }
    ctx.restore();
}

/** Semi-transparent fill derived from a stroke rgba/hex (best-effort). */
export function hullFillFromStroke(stroke: string, alpha = 0.14): string {
    const m = stroke.match(
        /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i
    );
    if (m) {
        return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
    }
    if (stroke.startsWith('#') && (stroke.length === 7 || stroke.length === 4)) {
        const hex =
            stroke.length === 4
                ? `#${stroke[1]}${stroke[1]}${stroke[2]}${stroke[2]}${stroke[3]}${stroke[3]}`
                : stroke;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
    }
    return `rgba(255, 220, 80, ${alpha})`;
}

/**
 * Resolve the live scenery the executor would click for a published hop.
 * Returns null for teles / NPCs / missing scene (caller draws nothing).
 */
export function liveTransportLoc(t: PublishedPathTile): {
    x: number;
    z: number;
    level: number;
    id: number;
    name: string | null;
} | null {
    if (!t.transport) {
        return null;
    }
    if (t.teleportId || t.kind === 'teleport') {
        return null;
    }
    // NPC hops (ships, carts, essence wizards) are not scenery.
    if (t.kind === 'npc' || (t.locName && /^(customs officer|captain |seaman |monk of |vigroy|hajedy|aubury|sedridor|wizard |brimstail|gnome pilot)/i.test(t.locName))) {
        return null;
    }
    const locX = t.locX ?? t.x;
    const locZ = t.locZ ?? t.z;
    const meta = {
        locName: t.locName ?? '',
        action: t.action ?? '',
        locX,
        locZ,
        locId: t.locId
    };
    let q = Locs.query();
    if (t.locName) {
        q = q.name(t.locName);
    }
    if (t.action) {
        q = q.action(t.action);
    }
    const live =
        q.where(loc => matchesTransportLoc(meta, loc)).nearest()
        // Name-only near placement when action filter is empty/mismatched (open doors).
        ?? Locs.query()
            .where(loc => {
                if (t.locName && loc.name?.toLowerCase() !== t.locName.toLowerCase()) {
                    return false;
                }
                if (t.locId !== undefined && loc.id !== t.locId) {
                    return false;
                }
                const tile = loc.tile();
                return Math.max(Math.abs(tile.x - locX), Math.abs(tile.z - locZ)) <= 5;
            })
            .nearest();
    if (!live) {
        return null;
    }
    const tile = live.tile();
    return {
        x: tile.x,
        z: tile.z,
        level: tile.level,
        id: live.id,
        name: live.name
    };
}

/** Draw hulls for transport locs on the published path (object highlighter). */
function paintNavLocHulls(ctx: CanvasRenderingContext2D): void {
    if (!isNavPathPaintEnabled()) {
        return;
    }
    const path = PathPublish.get();
    if (!path) {
        return;
    }
    const me = reader.worldTile();
    if (!me || !reader.attached()) {
        return;
    }
    const theme = resolveNavPathPaintTheme();
    // Past hop trail + a few upcoming; always include the next scenery transport.
    const trailFrom = Math.max(0, path.pathIdx - 1);
    let nextHopIdx = -1;
    for (let i = path.pathIdx; i < path.tiles.length; i++) {
        if (path.tiles[i]!.transport) {
            nextHopIdx = i;
            break;
        }
    }

    ctx.save();
    try {
        ctx.beginPath();
        ctx.rect(GAME_VIEW_CLIP.x, GAME_VIEW_CLIP.y, GAME_VIEW_CLIP.w, GAME_VIEW_CLIP.h);
        ctx.clip();

        for (let i = trailFrom; i < path.tiles.length; i++) {
            const t = path.tiles[i]!;
            if (!t.transport) {
                continue;
            }
            // Cap far hulls so only near path clutter is drawn.
            if (i > path.pathIdx + 12 && i !== nextHopIdx) {
                continue;
            }
            const live = liveTransportLoc(t);
            if (!live || live.level !== me.level) {
                continue;
            }
            // Only hulls for locs that resolve in the live scene (no fake tile cubes).
            const box = reader.locBox({
                x: live.x,
                z: live.z,
                level: live.level,
                id: live.id,
                name: live.name ?? undefined
            });
            if (!box) {
                continue;
            }
            const done = i < path.pathIdx;
            const isNext = i === nextHopIdx;
            const stroke = done ? theme.doneStroke : theme.hopStroke;
            const lineW = done ? 1.15 : isNext ? 2.75 : 1.85;
            const fillA = done ? 0.06 : isNext ? 0.18 : 0.1;
            strokeLocHull(ctx, box, stroke, lineW, {
                fill: hullFillFromStroke(stroke, fillA)
            });
        }
    } finally {
        ctx.restore();
    }
}

export function paintNavPath(
    ctx: CanvasRenderingContext2D,
    opts?: { labelsOnly?: boolean }
): void {
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

    const labelsOnly = opts?.labelsOnly === true;

    ctx.save();
    try {
        ctx.beginPath();
        ctx.rect(GAME_VIEW_CLIP.x, GAME_VIEW_CLIP.y, GAME_VIEW_CLIP.w, GAME_VIEW_CLIP.h);
        ctx.clip();

        if (!labelsOnly) {
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

            // Experimental: client-walk trail. Solid when walking; checkerboard when running.
            const segRaw = path.clientSegment;
            if (segRaw && segRaw.length > 0) {
                let clientColor = '#00D4FF';
                let runAltColor = '#FFFF00';
                try {
                    const bag = SettingsStore.globalBag();
                    clientColor = bag.str('navPathColorClient', '#00D4FF');
                    runAltColor = bag.str('navPathColorClientRunAlt', '#FFFF00');
                } catch {
                    /* default */
                }
                const primary = parseHtmlColor(clientColor, '#00D4FF');
                const runAlt = parseHtmlColor(runAltColor, '#FFFF00');
                const runOn = Game.runEnabled();
                const seg = remainingPathFromPlayer(segRaw, me);
                for (const t of seg) {
                    if (t.level !== me.level) {
                        continue;
                    }
                    const corners = projectTileQuad(t, project);
                    if (!corners) {
                        continue;
                    }
                    const c = runOn && ((t.x + t.z) & 1) === 1 ? runAlt : primary;
                    fillQuad(ctx, corners, rgba(c, 0.45), rgba(c, 0.95), 1.5);
                }
            }
        }

        // Object highlighter (always on when path paint is on) — actual loc model AABB
        paintNavLocHulls(ctx);

        if (theme.showText) {
            for (const q of quads) {
                if (!q.transport || !q.label) {
                    continue;
                }
                const c = quadCenter(q.corners);
                drawHopLabel(ctx, q.label, c.x, c.y, theme, { done: q.done });
            }
        }
    } finally {
        ctx.restore();
    }
}
