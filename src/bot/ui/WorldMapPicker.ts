/**
 * Walkable-tile map picker for `type: 'tile'` settings.
 *
 * Loads the bot collision pack (same `collision.lcnav.gz` as the nav worker) and
 * draws a zoomable/pannable **dot grid of walkable tiles**. Click snaps to the
 * nearest walkable tile.
 *
 * When MapPicker `showBasemap` is on and `worldmap-basemap.manifest.json` +
 * PNG are deployed, a worldmap basemap is drawn under the dots.
 *
 * **No continuous render loop.** Paint runs only on user input / setting change,
 * coalesced to one `requestAnimationFrame` (pan/zoom do not full-redraw every event).
 * **Basemap rebuild** is manual only (Rebuild + in-app confirm). Local IndexedDB
 * cache is keyed by client `/crc` + bake prefs; on mismatch the picker falls back
 * to the deploy PNG and asks the user to Rebuild — never silent MapView on open.
 *
 * Public API: `WorldMapPicker.open()` → `{ x, z, level } | null`.
 */
import { gunzipSync } from 'fflate';
import { PathFinder } from '../nav/PathFinder.js';
import { WALK_DESTINATIONS } from '../api/WalkDestinations.js';
import {
    BASEMAP_MANIFEST_NAME,
    basemapSourceRect,
    isBasemapManifest,
    type BasemapManifest
} from './worldMapBasemap.js';
import {
    getMapPickerShowBasemap,
    isMapPickerThemeSettingKey,
    resolveMapPickerDotTheme
} from './mapPickerTheme.js';
import {
    BASEMAP_REGEN_BODY,
    BASEMAP_REGEN_TITLE,
    regenerateBasemap,
    resolveBasemapBakePrefs,
    restoreMapPickerBakeSettings,
    snapshotMapPickerBakeSettings
} from './basemapRegen.js';
import { showConfirmDialog } from './confirmDialog.js';
import {
    blobToImage,
    clearBasemapLocalCache,
    fetchClientCrcKey,
    prefsKeyFromBakePrefs,
    readBasemapLocalCache,
    saveRegeneratedBasemapLocally
} from './basemapLocalCache.js';
import {
    MAP_PICKER_SETTINGS,
    MAP_PICKER_SETTINGS_NS,
    SettingsBag,
    SettingsStore
} from '../runtime/Settings.js';
import ParamsModal from './ParamsModal.js';

export type PickedTile = { x: number; z: number; level: number };

/** Mainland-ish default centre (Varrock). */
const DEFAULT_CENTRE = { x: 3213, z: 3424 };
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 12;
/** Base: how many world tiles fit across the canvas width at zoom=1. */
const TILES_AT_ZOOM1 = 320;

let finderPromise: Promise<PathFinder> | null = null;
let basemapPromise: Promise<LoadedBasemap | null> | null = null;

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

async function loadDeployBasemap(): Promise<{ manifest: BasemapManifest; image: CanvasImageSource } | null> {
    const manUrl = new URL(`./${BASEMAP_MANIFEST_NAME}`, import.meta.url);
    const manRes = await fetch(manUrl);
    if (!manRes.ok) {
        return null;
    }
    let json: unknown;
    try {
        json = await manRes.json();
    } catch {
        return null;
    }
    if (!isBasemapManifest(json)) {
        return null;
    }
    const imgUrl = new URL(json.basemapUrl, manUrl);
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) {
        return null;
    }
    const blob = await imgRes.blob();
    return { manifest: json, image: await blobToImage(blob) };
}

export type LoadedBasemap = {
    manifest: BasemapManifest;
    image: CanvasImageSource;
    /**
     * Optional UI hint when the image is still usable but not a perfect cache hit.
     * Never set for a clean CRC+prefs hit.
     */
    hint?: 'stale-crc' | 'prefs-mismatch' | 'crc-unverified';
};

/**
 * Load basemap once per page (never runs MapView):
 *  1. IndexedDB hit when **CRC + bake prefs** match → use local.
 *  2. `/crc` unavailable but local exists → use local with `crc-unverified`.
 *  3. Local CRC or prefs mismatch → deploy PNG + hint (user must **Rebuild map…**).
 *  4. Else deploy PNG/manifest next to the bot bundle.
 *
 * Manual Rebuild always regenerates and overwrites the local entry.
 */
export async function loadBasemap(): Promise<LoadedBasemap | null> {
    if (!basemapPromise) {
        basemapPromise = (async () => {
            const crcKey = await fetchClientCrcKey();
            const local = await readBasemapLocalCache();
            const prefsKey = prefsKeyFromBakePrefs(resolveBasemapBakePrefs());

            const tryLocal = async (
                hint?: LoadedBasemap['hint']
            ): Promise<LoadedBasemap | null> => {
                if (!local) {
                    return null;
                }
                try {
                    const image = await blobToImage(local.imageBlob);
                    return { manifest: local.manifest, image, hint };
                } catch {
                    await clearBasemapLocalCache();
                    return null;
                }
            };

            // Clean hit: same login CRC + same bake prefs → reuse (no MapView).
            if (local && crcKey && local.crcKey === crcKey && local.prefsKey === prefsKey) {
                const hit = await tryLocal();
                if (hit) {
                    return hit;
                }
            }

            // Offline /crc but we still have a prior rebuild — better than nothing.
            if (local && !crcKey) {
                const hit = await tryLocal('crc-unverified');
                if (hit) {
                    return hit;
                }
            }

            // Stale CRC or prefs: do **not** auto-regen (would freeze the tab on open).
            // Show deploy PNG and surface a rebuild hint on the picker status line.
            const deploy = await loadDeployBasemap();
            if (deploy) {
                let hint: LoadedBasemap['hint'];
                if (local && crcKey && local.crcKey !== crcKey) {
                    hint = 'stale-crc';
                } else if (local && crcKey && local.crcKey === crcKey && local.prefsKey !== prefsKey) {
                    hint = 'prefs-mismatch';
                }
                return { ...deploy, hint };
            }

            // No deploy asset — last resort: show stale local if we have one.
            if (local) {
                const hint: LoadedBasemap['hint'] =
                    crcKey && local.crcKey !== crcKey ? 'stale-crc' : 'prefs-mismatch';
                return tryLocal(hint);
            }

            return null;
        })().catch(() => {
            basemapPromise = null;
            return null;
        });
    }
    return basemapPromise;
}

/** Reset in-memory basemap promise (tests). Does not clear IndexedDB. */
export function resetBasemapCache(): void {
    basemapPromise = null;
}

/** Install basemap for this page session (after manual rebuild). */
export function installBasemapOverride(next: LoadedBasemap): void {
    basemapPromise = Promise.resolve({ ...next, hint: undefined });
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

/** Raise step so the visible grid never exceeds ~maxSamples on either axis. */
export function cappedSampleStep(zoom: number, tilesAcross: number, tilesHigh: number, maxSamples = 96): number {
    let step = sampleStep(zoom);
    const need = Math.max(tilesAcross / maxSamples, tilesHigh / maxSamples, 1);
    if (need > step) {
        step = Math.ceil(need);
    }
    return step;
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
            let basemap: LoadedBasemap | null = null;
            /** ready | missing | error — stable hook for live smoke (dataset may show off). */
            let basemapState: 'loading' | 'ready' | 'missing' | 'error' = 'loading';

            const overlay = document.createElement('div');
            overlay.className = 'rs2b0t-modal-overlay rs2b0t-walkmap-overlay';
            Object.assign(overlay.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100vw',
                height: '100vh',
                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                // Above .rs2b0t-modal-backdrop (1000); nothing else in bot UI is higher.
                zIndex: '1100',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
            });

            const canvas = document.createElement('canvas');
            canvas.width = 720;
            canvas.height = 540;
            canvas.className = 'rs2b0t-walkmap-canvas';
            canvas.dataset.basemap = 'loading';
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
            instruction.textContent =
                'Scroll, drag, click to select (snaps to walkable). Open Settings for basemap and dots.';

            const status = document.createElement('div');
            status.className = 'rs2b0t-walkmap-status';
            Object.assign(status.style, {
                color: '#8ab4f8',
                fontSize: '12px',
                marginBottom: '6px',
                fontFamily: 'monospace'
            });
            status.textContent = 'loading collision pack…';
            status.dataset.basemap = 'loading';

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

            const settingsBtn = document.createElement('button');
            settingsBtn.type = 'button';
            settingsBtn.className = 'rs2b0t-button rs2b0t-walkmap-settings';
            settingsBtn.textContent = 'Settings';
            settingsBtn.title = 'Basemap, walkable dots, rebuild layers';
            toolbar.appendChild(settingsBtn);

            const rebuildBtn = document.createElement('button');
            rebuildBtn.type = 'button';
            rebuildBtn.className = 'rs2b0t-button rs2b0t-walkmap-rebuild';
            rebuildBtn.textContent = 'Rebuild map…';
            rebuildBtn.title =
                'Re-render basemap from worldmap.jag using Settings → Basemap rebuild layers. Freezes the tab briefly.';
            toolbar.appendChild(rebuildBtn);

            /** Reflect showBasemap on dataset without clobbering load state when toggled back on. */
            const syncBasemapChrome = (): void => {
                const show = getMapPickerShowBasemap();
                rebuildBtn.style.display = show ? '' : 'none';
                const attr = show ? basemapState : 'off';
                canvas.dataset.basemap = attr;
                status.dataset.basemap = attr;
            };
            syncBasemapChrome();

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

            const setBasemapAttr = (s: typeof basemapState): void => {
                basemapState = s;
                // Keep internal state accurate; dataset may show "off" when basemap is hidden.
                syncBasemapChrome();
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
                let bm = 'basemap off';
                if (getMapPickerShowBasemap()) {
                    if (basemapState === 'ready') {
                        bm = `basemap ok ${basemap?.manifest.fingerprint.slice(0, 8) ?? ''}`;
                        if (basemap?.hint === 'stale-crc') {
                            bm += ' · outdated (Rebuild map…)';
                        } else if (basemap?.hint === 'prefs-mismatch') {
                            bm += ' · layers differ (Rebuild map…)';
                        } else if (basemap?.hint === 'crc-unverified') {
                            bm += ' · CRC unverified';
                        }
                    } else if (basemapState === 'loading') {
                        bm = 'basemap…';
                    } else if (basemapState === 'missing') {
                        bm = 'basemap missing';
                    } else if (basemapState === 'error') {
                        bm = 'basemap error';
                    }
                }
                status.textContent = `zoom ${zoom.toFixed(2)} · step ${sampleStep(zoom)} · ${sel} · centre ${Math.round(centreX)},${Math.round(centreZ)} · ${bm}`;
                status.style.color = basemap?.hint && getMapPickerShowBasemap() ? '#fa0' : '#8ab4f8';
            };

            const paintBasemap = (w: number, h: number): void => {
                if (!getMapPickerShowBasemap() || !basemap) {
                    return;
                }
                const { manifest, image } = basemap;
                const src = basemapSourceRect(
                    centreX,
                    centreZ,
                    tilesAcross(),
                    w,
                    h,
                    manifest.origin,
                    manifest.sizeTiles,
                    manifest.pixelsPerTile
                );
                // Dim slightly so walkable dots stay readable.
                ctx.save();
                ctx.globalAlpha = level === 0 ? 0.92 : 0.35;
                try {
                    ctx.drawImage(image, src.sx, src.sy, src.sw, src.sh, 0, 0, w, h);
                } catch {
                    /* out-of-bounds source rects on some browsers — skip frame */
                }
                ctx.restore();
            };

            /** Coalesce paints to one frame — pan must not full-redraw on every mousemove. */
            let paintRaf = 0;
            let closed = false;

            const paintNow = (): void => {
                if (closed) {
                    return;
                }
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

                paintBasemap(w, h);

                const ppt = pxPerTile();
                const halfW = tilesAcross() / 2;
                const halfH = (h / w) * halfW;
                const step = cappedSampleStep(zoom, tilesAcross(), halfH * 2);
                const minX = Math.floor(centreX - halfW) - step;
                const maxX = Math.ceil(centreX + halfW) + step;
                const minZ = Math.floor(centreZ - halfH) - step;
                const maxZ = Math.ceil(centreZ + halfH) + step;

                // Walkable dots — visibility/colour from MapPicker settings
                syncBasemapChrome();
                const theme = resolveMapPickerDotTheme();
                if (theme.showWalkable) {
                    // fillRect is cheaper than arc for many samples
                    const size = Math.max(1, Math.min(4, ppt * 0.45));
                    const half = size / 2;
                    ctx.fillStyle = theme.fill;
                    for (let x = minX; x <= maxX; x += step) {
                        for (let z = minZ; z <= maxZ; z += step) {
                            if (!finder.walkable(x, z, level)) {
                                continue;
                            }
                            const { sx, sy } = worldToScreen(x, z);
                            if (sx < -4 || sy < -4 || sx > w + 4 || sy > h + 4) {
                                continue;
                            }
                            ctx.fillRect(sx - half, sy - half, size, size);
                        }
                    }
                }

                // Named destinations
                ctx.font = '11px sans-serif';
                for (const dest of WALK_DESTINATIONS) {
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

            const requestPaint = (): void => {
                if (closed || paintRaf !== 0) {
                    return;
                }
                paintRaf = requestAnimationFrame(() => {
                    paintRaf = 0;
                    paintNow();
                });
            };

            // In-picker Settings modal (not Global settings).
            const settingsModal = new ParamsModal(
                () => false,
                () => requestPaint()
            );

            const unsubSettings = SettingsStore.onChange((name, key) => {
                if (name === MAP_PICKER_SETTINGS_NS && isMapPickerThemeSettingKey(key)) {
                    requestPaint();
                }
            });

            const cleanup = (): void => {
                closed = true;
                if (paintRaf !== 0) {
                    cancelAnimationFrame(paintRaf);
                    paintRaf = 0;
                }
                unsubSettings();
                settingsModal.close();
                canvas.removeEventListener('wheel', onWheel);
                canvas.removeEventListener('pointerdown', onPointerDown);
                canvas.removeEventListener('pointermove', onPointerMove);
                canvas.removeEventListener('pointerup', onPointerUp);
                canvas.removeEventListener('click', onClick);
                window.removeEventListener('keydown', onKey);
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
                requestPaint();
            });

            const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

            zoomIn.addEventListener('click', () => {
                zoom = clampZoom(zoom * 1.25);
                requestPaint();
            });
            zoomOut.addEventListener('click', () => {
                zoom = clampZoom(zoom / 1.25);
                requestPaint();
            });

            // Rebuild-layer prefs (Basemap rebuild group) are draft while Settings is open.
            // Snapshot is the baseline restored on close; successful Rebuild refreshes it so
            // further uncommitted edits still discard to the last rebuilt state.
            // Display keys persist immediately for live preview.
            let bakeSettingsSnapshot: ReturnType<typeof snapshotMapPickerBakeSettings> | null = null;

            settingsBtn.addEventListener('click', () => {
                bakeSettingsSnapshot = snapshotMapPickerBakeSettings();
                // Above map picker overlay (1100). Default params backdrop is 1000.
                settingsModal.open(MAP_PICKER_SETTINGS_NS, MAP_PICKER_SETTINGS, {
                    title: 'Map picker settings',
                    zIndex: 1200,
                    intro:
                        'Display options apply immediately. Basemap rebuild layers only apply after '
                        + 'Rebuild map… (confirm freezes the tab briefly while the map regenerates). '
                        + 'Closing this panel without rebuilding discards rebuild-layer changes. '
                        + 'If the client /crc (game rev) or rebuild layers no longer match the local '
                        + 'cache, the deploy basemap is shown until you Rebuild.',
                    onClose: () => {
                        if (bakeSettingsSnapshot) {
                            restoreMapPickerBakeSettings(bakeSettingsSnapshot);
                        }
                        bakeSettingsSnapshot = null;
                    }
                });
            });

            // Manual rebuild only (in-app Yes/No + Don't ask again). Never silent on open.
            rebuildBtn.addEventListener('click', () => {
                if (rebuildBtn.disabled || !getMapPickerShowBasemap()) {
                    return;
                }
                void (async () => {
                    const skip = new SettingsBag(
                        SettingsStore.resolve(MAP_PICKER_SETTINGS_NS, MAP_PICKER_SETTINGS)
                    ).bool('skipRebuildConfirm', false);

                    if (!skip) {
                        const answer = await showConfirmDialog({
                            title: BASEMAP_REGEN_TITLE,
                            body: BASEMAP_REGEN_BODY,
                            dontAskAgainLabel: "Don't ask again",
                            confirmLabel: 'Yes, rebuild',
                            cancelLabel: 'No',
                            zIndex: 1300
                        });
                        if (!answer.confirmed) {
                            return;
                        }
                        if (answer.dontAskAgain) {
                            SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
                        }
                    }

                    if (closed) {
                        return;
                    }
                    rebuildBtn.disabled = true;
                    status.textContent = 'rebuilding basemap (tab may freeze)…';
                    status.style.color = '#fa0';
                    try {
                        const prefs = resolveBasemapBakePrefs();
                        const next = await regenerateBasemap(prefs);
                        if (closed) {
                            return;
                        }
                        // New baseline for draft discard = post-rebuild bake keys.
                        // Further toggles without another rebuild still discard on close.
                        bakeSettingsSnapshot = snapshotMapPickerBakeSettings();
                        const crcKey = await fetchClientCrcKey();
                        if (crcKey) {
                            try {
                                await saveRegeneratedBasemapLocally(crcKey, prefs, next.manifest, next.image);
                            } catch {
                                /* local cache optional */
                            }
                        }
                        const installed: LoadedBasemap = { ...next };
                        installBasemapOverride(installed);
                        basemap = installed;
                        setBasemapAttr('ready');
                        status.textContent = `basemap rebuilt (${next.manifest.fingerprint})`;
                        status.style.color = '#8ab4f8';
                        requestPaint();
                    } catch (err) {
                        if (closed) {
                            return;
                        }
                        const msg = err instanceof Error ? err.message : String(err);
                        status.textContent = `rebuild failed: ${msg}`;
                        status.style.color = '#f88';
                    } finally {
                        if (!closed) {
                            rebuildBtn.disabled = false;
                        }
                    }
                })();
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
                requestPaint();
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
                requestPaint();
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
                // Final frame after pan settles
                requestPaint();
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
                requestPaint();
            };

            canvas.addEventListener('wheel', onWheel, { passive: false });
            canvas.addEventListener('pointermove', onPointerMove);
            canvas.addEventListener('pointerup', onPointerUp);
            canvas.addEventListener('pointercancel', onPointerUp);
            canvas.addEventListener('click', onClick);

            // Escape: settings first (ParamsModal stops propagation when it consumes Escape);
            // confirm dialog uses capture. Only close the picker when nothing nested is open.
            const onKey = (e: KeyboardEvent): void => {
                if (e.key !== 'Escape') {
                    return;
                }
                if (settingsModal.isOpen()) {
                    // Belt-and-suspenders if ParamsModal order ever changes.
                    e.preventDefault();
                    e.stopPropagation();
                    settingsModal.close();
                    return;
                }
                // In-app rebuild confirm is still open (capture handler owns Escape).
                if (document.querySelector('.rs2b0t-confirm-backdrop')) {
                    return;
                }
                finish(null);
            };
            window.addEventListener('keydown', onKey);

            void loadFinder()
                .then(f => {
                    if (closed) {
                        return;
                    }
                    finder = f;
                    requestPaint();
                })
                .catch(err => {
                    if (closed) {
                        return;
                    }
                    loadError = err instanceof Error ? err.message : String(err);
                    requestPaint();
                });

            // Cache / deploy PNG only (never MapView on open). Rebuild is a separate button.
            // Fetch even when basemap is hidden so enabling it mid-session is free.
            void loadBasemap()
                .then(bm => {
                    if (closed) {
                        return;
                    }
                    if (bm) {
                        basemap = bm;
                        // Keep load state as ready even when display is off (syncBasemapChrome).
                        basemapState = 'ready';
                        syncBasemapChrome();
                    } else {
                        basemapState = 'missing';
                        syncBasemapChrome();
                    }
                    requestPaint();
                })
                .catch(() => {
                    if (closed) {
                        return;
                    }
                    basemapState = 'error';
                    syncBasemapChrome();
                    requestPaint();
                });

            requestPaint();
        });
    }
}
