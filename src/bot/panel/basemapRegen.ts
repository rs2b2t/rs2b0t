/**
 * Manual basemap rebuild for the map picker, reached only from the Rebuild button path: never on picker open, never on a timer, never when settings change.
 * Why: the tab freezes briefly while worldmap.jag decodes and paints.
 */
// eslint-disable-next-line no-restricted-imports -- TODO: route through ClientAdapter
import { sleep } from '#/client/util/JsUtil.js';
// eslint-disable-next-line no-restricted-imports -- TODO: route through ClientAdapter
import { canvas, canvas2d } from '#/client/graphics/Canvas.js';
import {
    BASEMAP_SCHEMA,
    DEFAULT_MAP_ORIGIN,
    DEFAULT_MAP_SIZE,
    type BasemapManifest
} from './worldMapBasemap.js';
import {
    MAP_PICKER_SETTINGS,
    MAP_PICKER_SETTINGS_NS,
    SettingsBag,
    SettingsStore
} from '../runtime/Settings.js';

export type BasemapBakePrefs = {
    labels: boolean;
    borders: boolean;
    npcs: boolean;
    items: boolean;
    /** Stamp Key icons into live Rebuild raster (prefer pre-baked overlay). */
    keyIcons: boolean;
    multimap: boolean;
    freemap: boolean;
};

type RegeneratedBasemap = {
    manifest: BasemapManifest;
    image: CanvasImageSource;
};

let pendingJag: Uint8Array | null = null;
/**
 * Serialize regenerates so only one MapView bake runs at a time.
 * Callers after the first wait, then run with **their own** prefs (not the first's).
 */
let regenTail: Promise<unknown> = Promise.resolve();

/** Defaults for live Rebuild: nothing stamped (terrain-like). Prefer pre-baked overlays. */
const DEFAULT_BASEMAP_BAKE_PREFS: BasemapBakePrefs = {
    labels: false,
    borders: false,
    npcs: false,
    items: false,
    keyIcons: false,
    multimap: false,
    freemap: false
};

/** Schema keys that only take effect when the basemap is regenerated. */
const MAP_PICKER_BAKE_KEYS = [
    'bakeLabels',
    'bakeBorders',
    'bakeNpcs',
    'bakeItems',
    'bakeKeyIcons',
    'bakeMultimap',
    'bakeFreemap'
] as const;

type MapPickerBakeKey = (typeof MAP_PICKER_BAKE_KEYS)[number];

export function resolveBasemapBakePrefs(): BasemapBakePrefs {
    const g = new SettingsBag(SettingsStore.resolve(MAP_PICKER_SETTINGS_NS, MAP_PICKER_SETTINGS));
    return {
        labels: g.bool('bakeLabels', DEFAULT_BASEMAP_BAKE_PREFS.labels),
        borders: g.bool('bakeBorders', DEFAULT_BASEMAP_BAKE_PREFS.borders),
        npcs: g.bool('bakeNpcs', DEFAULT_BASEMAP_BAKE_PREFS.npcs),
        items: g.bool('bakeItems', DEFAULT_BASEMAP_BAKE_PREFS.items),
        keyIcons: g.bool('bakeKeyIcons', DEFAULT_BASEMAP_BAKE_PREFS.keyIcons),
        multimap: g.bool('bakeMultimap', DEFAULT_BASEMAP_BAKE_PREFS.multimap),
        freemap: g.bool('bakeFreemap', DEFAULT_BASEMAP_BAKE_PREFS.freemap)
    };
}

/** Snapshot rebuild-layer settings (raw strings as stored). */
export function snapshotMapPickerBakeSettings(): Record<MapPickerBakeKey, string> {
    const out = {} as Record<MapPickerBakeKey, string>;
    for (const key of MAP_PICKER_BAKE_KEYS) {
        const def = MAP_PICKER_SETTINGS[key];
        out[key] = SettingsStore.displayString(MAP_PICKER_SETTINGS_NS, key, def);
    }
    return out;
}

/** Restore rebuild-layer settings from a snapshot (discard uncommitted modal edits). */
export function restoreMapPickerBakeSettings(snap: Record<MapPickerBakeKey, string>): void {
    for (const key of MAP_PICKER_BAKE_KEYS) {
        const raw = snap[key];
        if (raw !== undefined) {
            SettingsStore.save(MAP_PICKER_SETTINGS_NS, key, raw);
        }
    }
}

export function prefsFingerprint(prefs: BasemapBakePrefs): string {
    const bits = [
        prefs.labels ? 'L' : 'l',
        prefs.borders ? 'B' : 'b',
        prefs.npcs ? 'N' : 'n',
        prefs.items ? 'I' : 'i',
        prefs.keyIcons ? 'K' : 'k',
        prefs.multimap ? 'M' : 'm',
        prefs.freemap ? 'F' : 'f'
    ].join('');
    return bits;
}

async function fetchWorldmapJag(): Promise<Uint8Array> {
    const candidates: string[] = [];
    try {
        candidates.push(new URL('./worldmap.jag', import.meta.url).href);
    } catch {
        /* ignore */
    }
    if (typeof location !== 'undefined') {
        candidates.push(new URL('/worldmap.jag', location.origin).href);
        candidates.push(new URL('../worldmap.jag', location.href).href);
    }
    let lastErr = 'worldmap.jag not found';
    for (const url of candidates) {
        try {
            const res = await fetch(url);
            if (!res.ok) {
                lastErr = `${url} HTTP ${res.status}`;
                continue;
            }
            return new Uint8Array(await res.arrayBuffer());
        } catch (e) {
            lastErr = e instanceof Error ? e.message : String(e);
        }
    }
    throw new Error(
        `Could not load worldmap.jag (${lastErr}). Place it next to the bot bundle or serve /worldmap.jag.`
    );
}

function pix2dToImageData(pixels: Int32Array, width: number, height: number): ImageData {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i++) {
        const p = pixels[i] >>> 0;
        const o = i * 4;
        rgba[o] = (p >> 16) & 0xff;
        rgba[o + 1] = (p >> 8) & 0xff;
        rgba[o + 2] = p & 0xff;
        rgba[o + 3] = 0xff;
    }
    return new ImageData(rgba, width, height);
}

/**
 * Re-render the full world basemap with MapView layer flags (same idea as the classic /worldmap applet), saving and restoring the game canvas; still costly.
 * Concurrent calls queue: each waits for the previous bake, then runs with its own prefs rather than reusing the first caller's result.
 */
export function regenerateBasemap(prefs: BasemapBakePrefs = resolveBasemapBakePrefs()): Promise<RegeneratedBasemap> {
    const run = (): Promise<RegeneratedBasemap> => regenerateBasemapOnce(prefs);
    // Chain so a second Rebuild waits, then bakes with **its** prefs.
    const next = regenTail.then(run, run);
    regenTail = next.then(
        () => undefined,
        () => undefined
    );
    return next;
}

async function regenerateBasemapOnce(prefs: BasemapBakePrefs): Promise<RegeneratedBasemap> {
    const jag = await fetchWorldmapJag();
    pendingJag = jag;

    let saved: ImageData | null = null;
    let savedCursor: string | null = null;
    if (canvas) {
        savedCursor = canvas.style.cursor;
        if (canvas2d && canvas.width > 0 && canvas.height > 0) {
            try {
                saved = canvas2d.getImageData(0, 0, canvas.width, canvas.height);
            } catch {
                saved = null;
            }
        }
    }

    const { MapView } = await import('#/client/mapview/MapView.js');
    const JagFile = (await import('#/client/io/JagFile.js')).default;
    const PixMap = (await import('#/client/graphics/PixMap.js')).default;

    const prev = {
        labels: MapView.shouldDrawLabels,
        mapfunctions: MapView.shouldDrawMapfunctions,
        borders: MapView.shouldDrawBorders,
        npcs: MapView.shouldDrawNpcs,
        items: MapView.shouldDrawItems,
        multimap: MapView.shouldDrawMultimap,
        freemap: MapView.shouldDrawFreemap
    };

    MapView.shouldDrawLabels = prefs.labels;
    MapView.shouldDrawMapfunctions = prefs.keyIcons;
    MapView.shouldDrawBorders = prefs.borders;
    MapView.shouldDrawNpcs = prefs.npcs;
    MapView.shouldDrawItems = prefs.items;
    MapView.shouldDrawMultimap = prefs.multimap;
    MapView.shouldDrawFreemap = prefs.freemap;

    // Resolve when maininit finishes. MapView's constructor calls run(); we override
    // run() so it only runs maininit once — never enters GameShell's frame while-loop.
    let resolveReady!: () => void;
    let rejectReady!: (e: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });

    /** Set on timeout so in-flight maininit stops at the next drawProgress yield. */
    let aborted = false;
    const checkAbort = (): void => {
        if (aborted) {
            throw new Error('basemap rebuild cancelled');
        }
    };

    class LiveBakeMapView extends MapView {
        override async run(): Promise<void> {
            try {
                checkAbort();
                await this.maininit();
                checkAbort();
                resolveReady();
            } catch (e) {
                rejectReady(e);
            }
            // Intentionally no game loop (do not call super.run()).
        }
        override async drawProgress(): Promise<void> {
            checkAbort();
            await sleep(0);
            checkAbort();
        }
        override async loadWorldmap() {
            checkAbort();
            if (!this.worldmap) {
                if (!pendingJag) {
                    throw new Error('no worldmap.jag bytes');
                }
                this.worldmap = new JagFile(pendingJag);
            }
            return this.worldmap;
        }
        protected override resize(width: number, height: number): void {
            this.drawArea = new PixMap(width, height);
        }
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
        await sleep(0); // let status UI paint before the heavy work
        checkAbort();
        // Construct starts run() → maininit; do not race without an abort path.
        const view = new LiveBakeMapView();
        const timeout = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                aborted = true;
                reject(new Error('basemap rebuild timed out while loading worldmap.jag'));
            }, 120_000);
        });
        try {
            await Promise.race([ready, timeout]);
        } finally {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        }
        checkAbort();

        const width = view.mapWidth;
        const height = view.mapHeight;
        // Full-map raster = max zoom-out; label layer controlled by prefs (default off).
        view.zoom = 4;
        view.targetZoom = 4;

        const pix = new PixMap(width, height);
        pix.setPixels();
        view.renderWorldMap(0, 0, width, height, 0, 0, width, height);

        // Push raster off the shared Pix2D target so the game can resume drawing.
        view.refreshRaster();

        const imageData = pix2dToImageData(pix.data, width, height);
        let image: CanvasImageSource;
        if (typeof createImageBitmap === 'function') {
            image = await createImageBitmap(imageData);
        } else {
            const off = document.createElement('canvas');
            off.width = width;
            off.height = height;
            off.getContext('2d')!.putImageData(imageData, 0, 0);
            image = off;
        }

        const fp = `regen-${prefsFingerprint(prefs)}`;
        const manifest: BasemapManifest = {
            schema: BASEMAP_SCHEMA,
            revision: 'live-regen',
            fingerprint: fp,
            origin: { x: view.mapOriginX, z: view.mapOriginZ },
            sizeTiles: { w: width, h: height },
            pixelsPerTile: 1,
            basemapUrl: 'live-regen',
            jagBytes: jag.length
        };

        // Sanity: origin should match MapView defaults when jag is standard.
        if (!manifest.origin.x) {
            manifest.origin = { ...DEFAULT_MAP_ORIGIN };
        }
        if (!manifest.sizeTiles.w) {
            manifest.sizeTiles = { ...DEFAULT_MAP_SIZE };
        }

        // Do not call GameShell.shutdown() — it would tear down the live client's canvas handlers.
        // LiveBakeMapView.run() never installs those listeners (only maininit).
        return { manifest, image };
    } finally {
        aborted = true; // stop any straggler maininit that still yields
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
        MapView.shouldDrawLabels = prev.labels;
        MapView.shouldDrawMapfunctions = prev.mapfunctions;
        MapView.shouldDrawBorders = prev.borders;
        MapView.shouldDrawNpcs = prev.npcs;
        MapView.shouldDrawItems = prev.items;
        MapView.shouldDrawMultimap = prev.multimap;
        MapView.shouldDrawFreemap = prev.freemap;
        pendingJag = null;
        if (canvas && savedCursor !== null) {
            canvas.style.cursor = savedCursor;
        }
        if (saved && canvas2d) {
            try {
                canvas2d.putImageData(saved, 0, 0);
            } catch {
                /* ignore restore failure */
            }
        }
    }
}

/** Title / body for the in-app rebuild confirm (not window.confirm). */
export const BASEMAP_REGEN_TITLE = 'Rebuild basemap?';

export const BASEMAP_REGEN_BODY =
    'This re-runs MapView from worldmap.jag and freezes the tab for several seconds.\n\n'
    + 'Everyday Key icons / multi / free layers are already pre-baked at deploy — toggle them under '
    + 'Settings → Worldmap layers without rebuilding.\n\n'
    + 'Use Rebuild only after a game update, or for experimental stamps (place labels, NPC/item dots, …).';
