/**
 * Draw published nav path on the bot #overlay canvas.
 * Uses reader.overlayPosWorld (Client.overlayPos).
 */

import { reader } from '../adapter/ClientAdapter.js';
import { SettingsStore } from '../runtime/Settings.js';
import { PathPublish, type PublishedPathTile } from './pathPublish.js';

const WALK_STROKE = 'rgba(80, 200, 255, 0.85)';
const WALK_FILL = 'rgba(80, 200, 255, 0.18)';
const DONE_STROKE = 'rgba(120, 120, 140, 0.45)';
const HOP_STROKE = 'rgba(255, 180, 40, 0.95)';
const HOP_FILL = 'rgba(255, 180, 40, 0.35)';
const CLICK_STROKE = 'rgba(120, 255, 120, 0.95)';

const MAX_DRAW_POINTS = 120;

export function isNavPathPaintEnabled(): boolean {
    try {
        return SettingsStore.globalBag().bool('showNavPath', false);
    } catch {
        return false;
    }
}

/** Pure: project tiles for unit tests (inject overlayPosWorld). */
export function projectPathTiles(
    tiles: PublishedPathTile[],
    fromIdx: number,
    cameraLevel: number,
    project: (x: number, z: number, level: number) => { x: number; y: number } | null
): { x: number; y: number; transport: boolean; idx: number }[] {
    const remaining = Math.max(0, tiles.length - fromIdx);
    const stride = remaining > MAX_DRAW_POINTS ? Math.ceil(remaining / MAX_DRAW_POINTS) : 1;
    const out: { x: number; y: number; transport: boolean; idx: number }[] = [];
    for (let i = fromIdx; i < tiles.length; i += stride) {
        const t = tiles[i]!;
        if (t.level !== cameraLevel) {
            continue;
        }
        const p = project(t.x, t.z, t.level);
        if (p) {
            out.push({ x: p.x, y: p.y, transport: !!t.transport, idx: i });
        }
    }
    if (stride > 1 && tiles.length > 0) {
        const lastIdx = tiles.length - 1;
        if (!out.some(p => p.idx === lastIdx)) {
            const last = tiles[lastIdx]!;
            if (last.level === cameraLevel) {
                const lp = project(last.x, last.z, last.level);
                if (lp) {
                    out.push({ x: lp.x, y: lp.y, transport: !!last.transport, idx: lastIdx });
                }
            }
        }
    }
    return out;
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

    const project = (x: number, z: number, _level: number): { x: number; y: number } | null =>
        reader.overlayPosWorld(x, z, 0);

    const pts = projectPathTiles(path.tiles, Math.max(0, path.pathIdx), me.level, project);
    if (pts.length === 0) {
        return;
    }

    ctx.save();
    try {
        const donePts = projectPathTiles(path.tiles, 0, me.level, project).filter(p => p.idx <= path.pathIdx);
        if (donePts.length >= 2) {
            ctx.strokeStyle = DONE_STROKE;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(donePts[0]!.x, donePts[0]!.y);
            for (let i = 1; i < donePts.length; i++) {
                ctx.lineTo(donePts[i]!.x, donePts[i]!.y);
            }
            ctx.stroke();
        }

        ctx.strokeStyle = WALK_STROKE;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i]!.x, pts[i]!.y);
        }
        ctx.stroke();

        for (const p of pts) {
            ctx.fillStyle = p.transport ? HOP_FILL : WALK_FILL;
            ctx.strokeStyle = p.transport ? HOP_STROKE : WALK_STROKE;
            ctx.lineWidth = p.transport ? 2 : 1;
            const r = p.transport ? 5 : 3;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        if (path.clickIdx >= 0 && path.clickIdx < path.tiles.length) {
            const ct = path.tiles[path.clickIdx]!;
            if (ct.level === me.level) {
                const cp = reader.overlayPosWorld(ct.x, ct.z, 0);
                if (cp) {
                    ctx.strokeStyle = CLICK_STROKE;
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(cp.x, cp.y, 8, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
        }
    } finally {
        ctx.restore();
    }
}
