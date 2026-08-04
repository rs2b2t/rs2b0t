/**
 * Walkable-tile map picker (#443).
 *
 * Loads the bot collision pack (same `collision.lcnav.gz` as the nav worker) and
 * draws a zoomable/pannable **dot grid of walkable tiles**. Click snaps to the
 * nearest walkable tile. Does **not** spin up MapView / worldmap JAG.
 *
 * Public API is unchanged: `WorldMapPicker.open()` → `{ x, z, level } | null`.
 * All `type: 'tile'` settings (WalkTo, fighters, banks, …) go through this.
 */
import { gunzipSync } from 'fflate';
import { PathFinder } from '../nav/PathFinder.js';
import { WALK_DESTINATIONS } from '../api/WalkDestinations.js';

export type PickedTile = { x: number; z: number; level: number };

/** Mainland-ish default centre (Varrock). */
const DEFAULT_CENTRE = { x: 3213, z: 3424 };
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 12;
/** Base: how many world tiles fit across the canvas width at zoom=1. */
const TILES_AT_ZOOM1 = 320;

let finderPromise: Promise<PathFinder> | null = null;

async function loadFinder(): Promise<PathFinder> {
    if (!finderPromise) {
        finderPromise = (async () => {
            // Same deploy layout as Navigator: collision.lcnav.gz next to the bot bundle.
            const res = await fetch(new URL('./collision.lcnav.gz', import.meta.url));
            if (!res.ok) {
                throw new Error(`collision pack HTTP ${res.status}`);
            }
            let bytes = new Uint8Array(await res.arrayBuffer());
            if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
                bytes = gunzipSync(bytes);
            }
            return new PathFinder(bytes);
        })().catch(err => {
            finderPromise = null;
            throw err;
        });
    }
    return finderPromise;
}

/** Nearest walkable tile within `radius` (Chebyshev), or null. */
export function nearestWalkable(
    finder: PathFinder,
    x: number,
    z: number,
    level: number,
    radius = 8
): { x: number; z: number } | null {
    const ix = Math.round(x);
    const iz = Math.round(z);
    if (finder.walkable(ix, iz, level)) {
        return { x: ix, z: iz };
    }
    let best: { x: number; z: number; d: number } | null = null;
    for (let r = 1; r <= radius; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) {
                    continue;
                }
                const nx = ix + dx;
                const nz = iz + dz;
                if (!finder.walkable(nx, nz, level)) {
                    continue;
                }
                const d = Math.hypot(dx, dz);
                if (!best || d < best.d) {
                    best = { x: nx, z: nz, d };
                }
            }
        }
        if (best) {
            return { x: best.x, z: best.z };
        }
    }
    return null;
}

/** Step size for sampling walkable dots given zoom (higher zoom → denser). */
export function sampleStep(zoom: number): number {
    if (zoom >= 6) {
        return 1;
    }
    if (zoom >= 3) {
        return 2;
    }
    if (zoom >= 1.5) {
        return 3;
    }
    if (zoom >= 0.8) {
        return 5;
    }
    return 8;
}

export class WorldMapPicker {
    /**
     * Opens an interactive walkable-map modal. Resolves with the picked tile or null on cancel.
     * Optional `initial` centres the view (defaults to Varrock).
     */
    public static open(initial?: Partial<PickedTile>): Promise<PickedTile | null> {
        return new Promise(resolve => {
            const level0 = initial?.level ?? 0;
            let level = Math.max(0, Math.min(3, level0));
            let centreX = initial?.x ?? DEFAULT_CENTRE.x;
            let centreZ = initial?.z ?? DEFAULT_CENTRE.z;
            let zoom = 1.2;
            let selected: PickedTile | null = null;
            let dragging = false;
            let lastMx = 0;
            let lastMy = 0;
            let finder: PathFinder | null = null;
            let loadError: string | null = null;

            const overlay = document.createElement('div');
            overlay.className = 'rs2b0t-modal-overlay rs2b0t-walkmap-overlay';
            Object.assign(overlay.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100vw',
                height: '100vh',
                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                zIndex: '9999',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
            });

            const canvas = document.createElement('canvas');
            canvas.width = 720;
            canvas.height = 540;
            canvas.className = 'rs2b0t-walkmap-canvas';
            Object.assign(canvas.style, {
                backgroundColor: '#0a0e14',
                border: '2px solid #555',
                cursor: 'crosshair',
                touchAction: 'none'
            });
            const ctx = canvas.getContext('2d')!;

            const instruction = document.createElement('div');
            instruction.className = 'rs2b0t-walkmap-hint';
            Object.assign(instruction.style, {
                color: '#aaa',
                margin: '8px 0 4px',
                fontSize: '13px',
                textAlign: 'center',
                maxWidth: '720px'
            });
            instruction.textContent = 'Walkable tiles (collision pack). Scroll to zoom, drag to pan, click to select.';

            const status = document.createElement('div');
            status.className = 'rs2b0t-walkmap-status';
            Object.assign(status.style, {
                color: '#8ab4f8',
                fontSize: '12px',
                marginBottom: '6px',
                fontFamily: 'monospace'
            });
            status.textContent = 'loading collision pack…';

            const toolbar = document.createElement('div');
            Object.assign(toolbar.style, {
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                marginBottom: '8px',
                flexWrap: 'wrap',
                justifyContent: 'center'
            });

            const levelLabel = document.createElement('label');
            levelLabel.style.color = '#ccc';
            levelLabel.style.fontSize = '13px';
            levelLabel.textContent = 'Level ';
            const levelSelect = document.createElement('select');
            levelSelect.className = 'rs2b0t-walkmap-level';
            for (let L = 0; L <= 3; L++) {
                const opt = document.createElement('option');
                opt.value = String(L);
                opt.textContent = String(L);
                if (L === level) {
                    opt.selected = true;
                }
                levelSelect.appendChild(opt);
            }
            levelLabel.appendChild(levelSelect);
            toolbar.appendChild(levelLabel);

            const zoomOut = document.createElement('button');
            zoomOut.type = 'button';
            zoomOut.className = 'rs2b0t-button rs2b0t-walkmap-zoom-out';
            zoomOut.textContent = '−';
            zoomOut.title = 'Zoom out';
            const zoomIn = document.createElement('button');
            zoomIn.type = 'button';
            zoomIn.className = 'rs2b0t-button rs2b0t-walkmap-zoom-in';
            zoomIn.textContent = '+';
            zoomIn.title = 'Zoom in';
            toolbar.appendChild(zoomOut);
            toolbar.appendChild(zoomIn);

            const btnRow = document.createElement('div');
            Object.assign(btnRow.style, { display: 'flex', gap: '8px', marginTop: '10px' });

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'rs2b0t-button rs2b0t-walkmap-cancel';
            cancelBtn.textContent = 'Cancel';

            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'button';
            confirmBtn.className = 'rs2b0t-button rs2b0t-walkmap-confirm';
            confirmBtn.textContent = 'Confirm';
            confirmBtn.disabled = true;

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(confirmBtn);

            overlay.appendChild(toolbar);
            overlay.appendChild(canvas);
            overlay.appendChild(instruction);
            overlay.appendChild(status);
            overlay.appendChild(btnRow);
            document.body.appendChild(overlay);

            const tilesAcross = (): number => TILES_AT_ZOOM1 / zoom;
            const pxPerTile = (): number => canvas.width / tilesAcross();

            const worldToScreen = (wx: number, wz: number): { sx: number; sy: number } => {
                const ppt = pxPerTile();
                const sx = canvas.width / 2 + (wx - centreX) * ppt;
                // World +z is north; screen +y is down → flip z.
                const sy = canvas.height / 2 - (wz - centreZ) * ppt;
                return { sx, sy };
            };

            const screenToWorld = (sx: number, sy: number): { x: number; z: number } => {
                const ppt = pxPerTile();
                const x = centreX + (sx - canvas.width / 2) / ppt;
                const z = centreZ - (sy - canvas.height / 2) / ppt;
                return { x, z };
            };

            const setStatus = (): void => {
                if (loadError) {
                    status.textContent = loadError;
                    status.style.color = '#f88';
                    return;
                }
                const sel = selected
                    ? `selected ${selected.x},${selected.z},L${selected.level}`
                    : 'no selection';
                status.textContent = `zoom ${zoom.toFixed(2)} · step ${sampleStep(zoom)} · ${sel} · centre ${Math.round(centreX)},${Math.round(centreZ)}`;
                status.style.color = '#8ab4f8';
            };

            const paint = (): void => {
                const w = canvas.width;
                const h = canvas.height;
                ctx.fillStyle = '#0a0e14';
                ctx.fillRect(0, 0, w, h);

                if (!finder) {
                    ctx.fillStyle = '#666';
                    ctx.font = '14px sans-serif';
                    ctx.fillText(loadError ?? 'Loading collision pack…', 24, 40);
                    setStatus();
                    return;
                }

                const ppt = pxPerTile();
                const step = sampleStep(zoom);
                const halfW = tilesAcross() / 2;
                const halfH = (h / w) * halfW;
                const minX = Math.floor(centreX - halfW) - step;
                const maxX = Math.ceil(centreX + halfW) + step;
                const minZ = Math.floor(centreZ - halfH) - step;
                const maxZ = Math.ceil(centreZ + halfH) + step;

                // Walkable dots
                const r = Math.max(1, Math.min(3.5, ppt * 0.35));
                ctx.fillStyle = '#3d8bfd';
                for (let x = minX; x <= maxX; x += step) {
                    for (let z = minZ; z <= maxZ; z += step) {
                        if (!finder.walkable(x, z, level)) {
                            continue;
                        }
                        const { sx, sy } = worldToScreen(x, z);
                        if (sx < -4 || sy < -4 || sx > w + 4 || sy > h + 4) {
                            continue;
                        }
                        ctx.beginPath();
                        ctx.arc(sx, sy, r, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }

                // Named destinations
                ctx.font = '11px sans-serif';
                for (const dest of WALK_DESTINATIONS) {
                    if (dest.tile.level !== level && level === 0) {
                        // still show level-0 pins when viewing L0
                    }
                    if (dest.tile.level !== level) {
                        continue;
                    }
                    const { sx, sy } = worldToScreen(dest.tile.x, dest.tile.z);
                    if (sx < 0 || sy < 0 || sx > w || sy > h) {
                        continue;
                    }
                    ctx.fillStyle = '#00ffff';
                    ctx.fillRect(sx - 3, sy - 3, 6, 6);
                    ctx.strokeStyle = '#000';
                    ctx.strokeRect(sx - 3, sy - 3, 6, 6);
                    ctx.fillStyle = '#9cf';
                    ctx.fillText(dest.name, sx + 6, sy + 4);
                }

                // Selection crosshair
                if (selected && selected.level === level) {
                    const { sx, sy } = worldToScreen(selected.x, selected.z);
                    ctx.strokeStyle = '#ff0';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(sx - 12, sy);
                    ctx.lineTo(sx + 12, sy);
                    ctx.moveTo(sx, sy - 12);
                    ctx.lineTo(sx, sy + 12);
                    ctx.stroke();
                    ctx.strokeStyle = '#000';
                    ctx.lineWidth = 4;
                    ctx.globalCompositeOperation = 'destination-over';
                    ctx.beginPath();
                    ctx.moveTo(sx - 12, sy);
                    ctx.lineTo(sx + 12, sy);
                    ctx.moveTo(sx, sy - 12);
                    ctx.lineTo(sx, sy + 12);
                    ctx.stroke();
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.lineWidth = 1;
                }

                // Crosshair at centre
                ctx.strokeStyle = 'rgba(255,255,255,0.15)';
                ctx.beginPath();
                ctx.moveTo(w / 2, 0);
                ctx.lineTo(w / 2, h);
                ctx.moveTo(0, h / 2);
                ctx.lineTo(w, h / 2);
                ctx.stroke();

                setStatus();
            };

            const cleanup = (): void => {
                canvas.removeEventListener('wheel', onWheel);
                canvas.removeEventListener('pointerdown', onPointerDown);
                canvas.removeEventListener('pointermove', onPointerMove);
                canvas.removeEventListener('pointerup', onPointerUp);
                canvas.removeEventListener('click', onClick);
                overlay.remove();
            };

            const finish = (value: PickedTile | null): void => {
                cleanup();
                resolve(value);
            };

            cancelBtn.addEventListener('click', () => finish(null));
            confirmBtn.addEventListener('click', () => {
                if (selected) {
                    finish(selected);
                }
            });

            levelSelect.addEventListener('change', () => {
                level = Number(levelSelect.value) || 0;
                selected = null;
                confirmBtn.disabled = true;
                paint();
            });

            const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

            zoomIn.addEventListener('click', () => {
                zoom = clampZoom(zoom * 1.25);
                paint();
            });
            zoomOut.addEventListener('click', () => {
                zoom = clampZoom(zoom / 1.25);
                paint();
            });

            const onWheel = (e: WheelEvent): void => {
                e.preventDefault();
                const factor = e.deltaY > 0 ? 0.9 : 1.1;
                // Zoom toward cursor
                const rect = canvas.getBoundingClientRect();
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                const before = screenToWorld(sx, sy);
                zoom = clampZoom(zoom * factor);
                const after = screenToWorld(sx, sy);
                centreX += before.x - after.x;
                centreZ += before.z - after.z;
                paint();
            };

            const onPointerDown = (e: PointerEvent): void => {
                if (e.button !== 0) {
                    return;
                }
                dragging = true;
                lastMx = e.clientX;
                lastMy = e.clientY;
                canvas.setPointerCapture(e.pointerId);
                canvas.style.cursor = 'grabbing';
            };

            const onPointerMove = (e: PointerEvent): void => {
                if (!dragging) {
                    return;
                }
                const ppt = pxPerTile();
                const dx = e.clientX - lastMx;
                const dy = e.clientY - lastMy;
                lastMx = e.clientX;
                lastMy = e.clientY;
                centreX -= dx / ppt;
                centreZ += dy / ppt;
                paint();
            };

            const onPointerUp = (e: PointerEvent): void => {
                if (!dragging) {
                    return;
                }
                dragging = false;
                canvas.style.cursor = 'crosshair';
                try {
                    canvas.releasePointerCapture(e.pointerId);
                } catch {
                    /* ignore */
                }
            };

            let downX = 0;
            let downY = 0;
            canvas.addEventListener('pointerdown', e => {
                downX = e.clientX;
                downY = e.clientY;
                onPointerDown(e);
            });

            const onClick = (e: MouseEvent): void => {
                // Ignore clicks that were pans
                if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) {
                    return;
                }
                if (!finder) {
                    return;
                }
                const rect = canvas.getBoundingClientRect();
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                const w = screenToWorld(sx, sy);
                const snap = nearestWalkable(finder, w.x, w.z, level, 12);
                if (!snap) {
                    status.textContent = 'no walkable tile nearby — zoom in or pan';
                    status.style.color = '#fa0';
                    return;
                }
                selected = { x: snap.x, z: snap.z, level };
                confirmBtn.disabled = false;
                paint();
            };

            canvas.addEventListener('wheel', onWheel, { passive: false });
            canvas.addEventListener('pointermove', onPointerMove);
            canvas.addEventListener('pointerup', onPointerUp);
            canvas.addEventListener('pointercancel', onPointerUp);
            canvas.addEventListener('click', onClick);

            // Escape to cancel
            const onKey = (e: KeyboardEvent): void => {
                if (e.key === 'Escape') {
                    window.removeEventListener('keydown', onKey);
                    finish(null);
                }
            };
            window.addEventListener('keydown', onKey);

            void loadFinder()
                .then(f => {
                    finder = f;
                    paint();
                })
                .catch(err => {
                    loadError = err instanceof Error ? err.message : String(err);
                    paint();
                });

            paint();
        });
    }
}
