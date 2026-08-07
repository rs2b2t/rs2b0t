/**
 * Draw nav path into the client areaGame surface (post-world 3D, pre-nameplates).
 *
 * Uses the same projection as the scene (`projectAreaGame`) so tiles line up with
 * ground under the current camera — fixes the HTML-overlay “few tiles off” drift.
 * Still drawn after model composite (true z-buffer would need World inject).
 */

import type { Client } from '#/client/Client.js';
import Pix2D from '#/graphics/Pix2D.js';

import { reader } from '../adapter/ClientAdapter.js';
import {
    buildPathQuads,
    isNavPathPaintEnabled,
    projectTileQuad,
    type ProjectCorner,
    type TileQuad
} from './pathOverlay.js';
import { parseHtmlColor, NAV_PATH_PAINT_DEFAULTS } from './pathPaintTheme.js';
import { PathPublish } from './pathPublish.js';
import { remainingPathFromPlayer } from './pathExpand.js';
import { SettingsStore } from '../runtime/Settings.js';
import { Game } from '../api/Game.js';

function rgbInt(c: { r: number; g: number; b: number }): number {
    return ((c.r & 0xff) << 16) | ((c.g & 0xff) << 8) | (c.b & 0xff);
}

function alphaByte(a: number): number {
    return Math.max(0, Math.min(255, Math.round(a * 256)));
}

/** Barycentric fill of a triangle with translucent colour (into current Pix2D). */
function fillTri(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    rgb: number,
    alpha: number
): void {
    // Sort by y
    let ax = x0 | 0;
    let ay = y0 | 0;
    let bx = x1 | 0;
    let by = y1 | 0;
    let cx = x2 | 0;
    let cy = y2 | 0;
    if (ay > by) {
        [ax, bx] = [bx, ax];
        [ay, by] = [by, ay];
    }
    if (ay > cy) {
        [ax, cx] = [cx, ax];
        [ay, cy] = [cy, ay];
    }
    if (by > cy) {
        [bx, cx] = [cx, bx];
        [by, cy] = [cy, by];
    }
    if (ay === cy) {
        return;
    }
    const a = alphaByte(alpha);
    for (let y = ay; y <= cy; y++) {
        let xL: number;
        let xR: number;
        if (y < by) {
            const t0 = ay === by ? 0 : (y - ay) / (by - ay);
            const t1 = ay === cy ? 0 : (y - ay) / (cy - ay);
            xL = ax + (bx - ax) * t0;
            xR = ax + (cx - ax) * t1;
        } else {
            const t0 = by === cy ? 0 : (y - by) / (cy - by);
            const t1 = ay === cy ? 0 : (y - ay) / (cy - ay);
            xL = bx + (cx - bx) * t0;
            xR = ax + (cx - ax) * t1;
        }
        if (xL > xR) {
            const t = xL;
            xL = xR;
            xR = t;
        }
        const x0i = Math.floor(xL);
        const w = Math.ceil(xR) - x0i;
        if (w > 0) {
            Pix2D.fillRectTrans(x0i, y, w, 1, rgb, a);
        }
    }
}

function fillQuadPix(corners: TileQuad['corners'], rgb: number, alpha: number): void {
    fillTri(
        corners[0].x,
        corners[0].y,
        corners[1].x,
        corners[1].y,
        corners[2].x,
        corners[2].y,
        rgb,
        alpha
    );
    fillTri(
        corners[0].x,
        corners[0].y,
        corners[2].x,
        corners[2].y,
        corners[3].x,
        corners[3].y,
        rgb,
        alpha
    );
}

function strokeQuadPix(corners: TileQuad['corners'], rgb: number, alpha: number): void {
    const a = alphaByte(alpha);
    const pts = [corners[0], corners[1], corners[2], corners[3], corners[0]];
    for (let i = 0; i < 4; i++) {
        const p0 = pts[i]!;
        const p1 = pts[i + 1]!;
        drawLineTrans(p0.x | 0, p0.y | 0, p1.x | 0, p1.y | 0, rgb, a);
    }
}

function drawLineTrans(x0: number, y0: number, x1: number, y1: number, rgb: number, alpha: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    for (;;) {
        Pix2D.fillRectTrans(x, y, 1, 1, rgb, alpha);
        if (x === x1 && y === y1) {
            break;
        }
        const e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x += sx;
        }
        if (e2 < dx) {
            err += dx;
            y += sy;
        }
    }
}

/**
 * Paint path + loc markers into the bound game surface.
 * `client` is the live BotClient instance (for projectAreaGame).
 */
export function paintNavPathInGame(_client: Client): void {
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

    const pathRgb = rgbInt(parseHtmlColor(SettingsStore.globalBag().str('navPathColorPath', NAV_PATH_PAINT_DEFAULTS.path)));
    const hopRgb = rgbInt(
        parseHtmlColor(SettingsStore.globalBag().str('navPathColorTransport', NAV_PATH_PAINT_DEFAULTS.transport))
    );
    const clickRgb = rgbInt(parseHtmlColor(SettingsStore.globalBag().str('navPathColorClick', NAV_PATH_PAINT_DEFAULTS.click)));
    // Explore: client walk trail colour (solid when walking; alternate when running).
    const g = SettingsStore.globalBag();
    const clientSegRgb = rgbInt(parseHtmlColor(g.str('navPathColorClient', '#00D4FF'), '#00D4FF'));
    // Run-alt: yellow (user-facing); hex default #FFFF00.
    const clientRunAltRgb = rgbInt(
        parseHtmlColor(g.str('navPathColorClientRunAlt', '#FFFF00'), '#FFFF00')
    );
    const runOn = Game.runEnabled();

    const project: ProjectCorner = (x, z, u, v) => reader.projectAreaGameWorld(x, z, 0, u, v);

    const trailFrom = Math.max(0, path.pathIdx - 4);
    const quads = buildPathQuads(path.tiles, trailFrom, me.level, project);
    for (const q of quads) {
        q.done = q.idx < path.pathIdx;
    }

    // Walk / hop tiles under camera (scene-aligned)
    for (const q of quads) {
        if (q.done) {
            fillQuadPix(q.corners, pathRgb, 0.12);
            strokeQuadPix(q.corners, pathRgb, 0.35);
        } else if (q.transport) {
            fillQuadPix(q.corners, hopRgb, 0.45);
            strokeQuadPix(q.corners, hopRgb, 0.95);
        } else {
            fillQuadPix(q.corners, pathRgb, 0.28);
            strokeQuadPix(q.corners, pathRgb, 0.85);
        }
    }

    // Experimental: client walk trail (exact tryMove tiles). No centre-line.
    // Walk: solid primary. Run: checkerboard by world tile (stable as path trims).
    const segRaw = path.clientSegment;
    if (segRaw && segRaw.length > 0) {
        const seg = remainingPathFromPlayer(segRaw, me);
        for (const t of seg) {
            if (t.level !== me.level) {
                continue;
            }
            const corners = projectTileQuad(t, project);
            if (!corners) {
                continue;
            }
            const rgb = runOn && ((t.x + t.z) & 1) === 1 ? clientRunAltRgb : clientSegRgb;
            fillQuadPix(corners, rgb, 0.5);
            strokeQuadPix(corners, rgb, 0.95);
        }
    }

    // Object highlighter hulls are drawn on the HTML overlay (crisp 2D strokes).
    // Scene paint keeps path tile quads + click target.

    // Next click target (where the walker will actually click)
    if (path.clickIdx >= 0 && path.clickIdx < path.tiles.length) {
        const ct = path.tiles[path.clickIdx]!;
        if (ct.level === me.level) {
            const corners = projectTileQuad(ct, project);
            if (corners) {
                strokeQuadPix(corners, clickRgb, 1);
                const c2 = projectTileQuad(ct, (x, z, u, v) => project(x, z, 0.08 + u * 0.84, 0.08 + v * 0.84));
                if (c2) {
                    strokeQuadPix(c2, clickRgb, 0.85);
                }
            }
        }
    }
}
