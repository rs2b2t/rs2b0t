/** Bake full-world basemap assets from worldmap.jag: [--engine DIR] [--jag PATH] [--out DIR] [--revision TAG]. Emits a terrain-only basemap plus pre-baked transparent key / multi / free overlays so the picker can toggle layers without re-running MapView.
 *  worldmap.jag resolution order: --jag → $ENGINE/data/pack/mapview → out/ → download from 2004scape. */

// Usage:
//   bun tools/map/build-basemap.ts [--engine DIR] [--jag PATH] [--out DIR] [--revision TAG]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { GlobalRegistrator } from '@happy-dom/global-registrator';

import {
    BASEMAP_MANIFEST_NAME,
    BASEMAP_SCHEMA,
    type BasemapManifest,
    type WorldmapKeyIndex
} from '#/bot/panel/worldMapBasemap.js';
import { encodePngRgba, pix2dToRgba } from './encodePng.js';

const SCHEMA_TAG = `basemap-schema-${BASEMAP_SCHEMA}`;

type BakeArgs = {
    engine: string;
    jag: string | null;
    outDir: string;
    revision: string;
    fetchUrl: string;
};

function parseArgs(): BakeArgs {
    const args = process.argv.slice(2);
    let engine = process.env.ENGINE_DIR ?? `${process.env.HOME}/code/rs2b2t-engine`;
    let jag: string | null = null;
    let outDir = 'out';
    let revision = '274';
    let fetchUrl = 'https://2004.lostcity.rs/worldmap.jag';
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--engine') {
            engine = args[++i];
        } else if (a === '--jag') {
            jag = args[++i];
        } else if (a === '--out') {
            outDir = args[++i];
        } else if (a === '--revision') {
            revision = args[++i];
        } else if (a === '--fetch-url') {
            fetchUrl = args[++i];
        } else if (a === '--help' || a === '-h') {
            console.log(
                'usage: bun tools/map/build-basemap.ts [--engine DIR] [--jag PATH] [--out DIR] [--revision TAG]'
            );
            process.exit(0);
        } else {
            console.error(`unknown arg: ${a}`);
            process.exit(2);
        }
    }
    return { engine, jag, outDir, revision, fetchUrl };
}

async function resolveJag(opts: ReturnType<typeof parseArgs>): Promise<{ bytes: Uint8Array; source: string }> {
    if (opts.jag) {
        if (!fs.existsSync(opts.jag)) {
            throw new Error(`--jag not found: ${opts.jag}`);
        }
        return { bytes: new Uint8Array(fs.readFileSync(opts.jag)), source: opts.jag };
    }
    const engineJag = path.join(opts.engine, 'data/pack/mapview/worldmap.jag');
    if (fs.existsSync(engineJag)) {
        return { bytes: new Uint8Array(fs.readFileSync(engineJag)), source: engineJag };
    }
    const cacheJag = path.join(opts.outDir, 'worldmap.jag');
    if (fs.existsSync(cacheJag)) {
        return { bytes: new Uint8Array(fs.readFileSync(cacheJag)), source: cacheJag };
    }
    console.log(`worldmap.jag missing under engine; downloading ${opts.fetchUrl}…`);
    const res = await fetch(opts.fetchUrl);
    if (!res.ok) {
        throw new Error(`download failed HTTP ${res.status}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    fs.mkdirSync(opts.outDir, { recursive: true });
    fs.writeFileSync(cacheJag, bytes);
    console.log(`  cached ${cacheJag} (${bytes.length} bytes)`);
    return { bytes, source: `${opts.fetchUrl} → ${cacheJag}` };
}

function fingerprint(jag: Uint8Array): string {
    return createHash('sha256').update(jag).update(SCHEMA_TAG).digest('hex').slice(0, 16);
}

function installCanvasMock(): void {
    GlobalRegistrator.register();

    function fake2d(c: { width: number; height: number }) {
        return {
            fillStyle: '#000',
            strokeStyle: '#000',
            font: '10px sans-serif',
            textAlign: 'left' as CanvasTextAlign,
            createImageData(w: number, h: number) {
                return {
                    data: new Uint8ClampedArray(w * h * 4),
                    width: w,
                    height: h,
                    colorSpace: 'srgb' as const
                };
            },
            getImageData(_x: number, _y: number, w: number, h: number) {
                return {
                    data: new Uint8ClampedArray(w * h * 4),
                    width: w,
                    height: h,
                    colorSpace: 'srgb' as const
                };
            },
            putImageData() {},
            fillRect() {},
            strokeRect() {},
            fillText() {},
            measureText: () => ({ width: 8 }),
            drawImage() {},
            beginPath() {},
            moveTo() {},
            lineTo() {},
            stroke() {},
            save() {},
            restore() {},
            clearRect() {},
            canvas: c
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = function (type: string) {
        if (type === '2d') {
            return fake2d(this);
        }
        return null;
    };

    const el = document.createElement('canvas');
    el.id = 'canvas';
    el.width = 800;
    el.height = 600;
    document.body.appendChild(el);
}

/** Blit a MapView Pix32 (0x00RRGGBB, 0 = transparent) into an RGBA buffer. */
function blitSpriteRgba(
    rgba: Uint8Array,
    mapW: number,
    mapH: number,
    sprite: { data: Int32Array; wi: number; hi: number; xof: number; yof: number },
    destX: number,
    destY: number
): void {
    const x0 = (destX + sprite.xof) | 0;
    const y0 = (destY + sprite.yof) | 0;
    for (let sy = 0; sy < sprite.hi; sy++) {
        const dy = y0 + sy;
        if (dy < 0 || dy >= mapH) {
            continue;
        }
        for (let sx = 0; sx < sprite.wi; sx++) {
            const dx = x0 + sx;
            if (dx < 0 || dx >= mapW) {
                continue;
            }
            const rgb = sprite.data[sy * sprite.wi + sx] >>> 0;
            if (rgb === 0) {
                continue;
            }
            const o = (dy * mapW + dx) * 4;
            rgba[o] = (rgb >> 16) & 0xff;
            rgba[o + 1] = (rgb >> 8) & 0xff;
            rgba[o + 2] = rgb & 0xff;
            rgba[o + 3] = 0xff;
        }
    }
}

/** Zone tint overlay from a boolean[][] grid (same layout as MapView multiPos/freePos). */
function bakeTintRgba(
    grid: boolean[][],
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
    a: number
): Uint8Array {
    const rgba = new Uint8Array(width * height * 4);
    for (let x = 0; x < width; x++) {
        const col = grid[x];
        if (!col) {
            continue;
        }
        for (let y = 0; y < height; y++) {
            if (!col[y]) {
                continue;
            }
            const o = (y * width + x) * 4;
            rgba[o] = r;
            rgba[o + 1] = g;
            rgba[o + 2] = b;
            rgba[o + 3] = a;
        }
    }
    return rgba;
}

type BakeResult = {
    terrain: Int32Array;
    /** All Key icons on one transparent sheet (optional “everything” layer). */
    keyRgba: Uint8Array;
    /** Per mapfunction type id → transparent sheet with only that Key type. */
    keyTypeRgba: Record<string, Uint8Array>;
    /** Town / place-name labels (transparent; pixels that differ from terrain). */
    labelsRgba: Uint8Array;
    multiRgba: Uint8Array;
    freeRgba: Uint8Array;
    keyIndex: WorldmapKeyIndex;
    width: number;
    height: number;
    originX: number;
    originZ: number;
};

async function bake(jagBytes: Uint8Array): Promise<BakeResult> {
    installCanvasMock();

    (globalThis as { __basemapJag?: Uint8Array }).__basemapJag = jagBytes;

    const { MapView } = await import('#/client/mapview/MapView.js');
    const JagFile = (await import('#/client/io/JagFile.js')).default;
    const PixMap = (await import('#/client/graphics/PixMap.js')).default;
    const { sleep } = await import('#/client/util/JsUtil.js');

    class BakeMapView extends MapView {
        override async run(): Promise<void> {
            await this.maininit();
        }
        override async drawProgress(): Promise<void> {}
        override async loadWorldmap() {
            if (!this.worldmap) {
                const raw = (globalThis as { __basemapJag?: Uint8Array }).__basemapJag;
                if (!raw) {
                    throw new Error('no jag bytes');
                }
                this.worldmap = new JagFile(raw);
            }
            return this.worldmap;
        }
        protected override resize(width: number, height: number): void {
            this.drawArea = new PixMap(width, height);
        }
    }

    // Terrain only: no Key icons, labels, tints, dots, borders.
    MapView.shouldDrawLabels = false;
    MapView.shouldDrawMapfunctions = false;
    MapView.shouldDrawBorders = false;
    MapView.shouldDrawNpcs = false;
    MapView.shouldDrawItems = false;
    MapView.shouldDrawMultimap = false;
    MapView.shouldDrawFreemap = false;

    const view = new BakeMapView();
    const t0 = performance.now();
    while (!view.overview) {
        await sleep(20);
        if (performance.now() - t0 > 120_000) {
            throw new Error('MapView.maininit timed out');
        }
    }

    const width = view.mapWidth;
    const height = view.mapHeight;
    view.zoom = 4;
    view.targetZoom = 4;

    const pix = new PixMap(width, height);
    pix.setPixels();
    view.renderWorldMap(0, 0, width, height, 0, 0, width, height);
    const terrain = new Int32Array(pix.data);

    // Place names: re-render with labels on, keep pixels that differ from terrain.
    // Uses the same WorldMapFont path as the classic worldmap (zoom 4 full-map bake).
    MapView.shouldDrawLabels = true;
    const pixLabeled = new PixMap(width, height);
    pixLabeled.setPixels();
    view.renderWorldMap(0, 0, width, height, 0, 0, width, height);
    const labeled = pixLabeled.data;
    MapView.shouldDrawLabels = false;
    const labelsRgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < terrain.length; i++) {
        const a = terrain[i] >>> 0;
        const b = labeled[i] >>> 0;
        if (a === b) {
            continue;
        }
        const o = i * 4;
        labelsRgba[o] = (b >> 16) & 0xff;
        labelsRgba[o + 1] = (b >> 8) & 0xff;
        labelsRgba[o + 2] = b & 0xff;
        labelsRgba[o + 3] = 0xff;
    }

    // Key icons: per-type transparent overlays + composite (same −7 offset as MapView).
    const keyRgba = new Uint8Array(width * height * 4);
    const keyTypeRgba: Record<string, Uint8Array> = {};
    const placements: Record<string, [number, number][]> = {};
    const names = [...MapView.KEY_NAMES];

    for (let i = 0; i < view.activeMapFunctionCount; i++) {
        const type = view.activeMapFunctions[i];
        const lx = view.activeMapFunctionX[i];
        const ly = view.activeMapFunctionZ[i];
        const key = String(type);
        if (!placements[key]) {
            placements[key] = [];
            keyTypeRgba[key] = new Uint8Array(width * height * 4);
        }
        // Centre of the 1×1 tile cell (matches startX + lengthX/2 at 1 ppt).
        const cx = lx;
        const cy = ly;
        placements[key].push([cx, cy]);

        const sprite = view.mapfunction[type];
        if (sprite) {
            // MapView: plotSprite(startX + lengthX/2 - 7, startY + lengthY/2 - 7)
            blitSpriteRgba(keyRgba, width, height, sprite, cx - 7, cy - 7);
            blitSpriteRgba(keyTypeRgba[key]!, width, height, sprite, cx - 7, cy - 7);
        }
    }

    // Multi / free tints match MapView fillRectTrans colours (0xff0000 / 0x00ff00 @ alpha 96).
    const multiRgba = bakeTintRgba(view.multiPos, width, height, 0xff, 0x00, 0x00, 96);
    const freeRgba = bakeTintRgba(view.freePos, width, height, 0x00, 0xff, 0x00, 96);

    const keyIndex: WorldmapKeyIndex = {
        schema: 1,
        names,
        placements
    };

    return {
        terrain,
        keyRgba,
        keyTypeRgba,
        labelsRgba,
        multiRgba,
        freeRgba,
        keyIndex,
        width,
        height,
        originX: view.mapOriginX,
        originZ: view.mapOriginZ
    };
}

async function main(): Promise<void> {
    const opts = parseArgs();
    const started = performance.now();

    const { bytes, source } = await resolveJag(opts);
    const fp = fingerprint(bytes);
    console.log(`source: ${source}`);
    console.log(`fingerprint: ${fp}`);
    console.log(`revision: ${opts.revision}`);
    console.log(`schema: ${BASEMAP_SCHEMA} (terrain + per-type Key overlays + multi/free)`);

    const result = await bake(bytes);
    const { width, height } = result;
    console.log(`raster: ${width}×${height} (${((performance.now() - started) / 1000).toFixed(1)}s so far)`);

    fs.mkdirSync(opts.outDir, { recursive: true });

    const terrainName = `worldmap-basemap.${fp}.png`;
    const keyName = `worldmap-key.${fp}.png`;
    const labelsName = `worldmap-labels.${fp}.png`;
    const multiName = `worldmap-multi.${fp}.png`;
    const freeName = `worldmap-free.${fp}.png`;
    const keyIndexName = `worldmap-key-index.${fp}.json`;

    const terrainPng = encodePngRgba(pix2dToRgba(result.terrain), width, height);
    const keyPng = encodePngRgba(result.keyRgba, width, height);
    const labelsPng = encodePngRgba(result.labelsRgba, width, height);
    const multiPng = encodePngRgba(result.multiRgba, width, height);
    const freePng = encodePngRgba(result.freeRgba, width, height);

    fs.writeFileSync(path.join(opts.outDir, terrainName), terrainPng);
    fs.writeFileSync(path.join(opts.outDir, keyName), keyPng);
    fs.writeFileSync(path.join(opts.outDir, labelsName), labelsPng);
    fs.writeFileSync(path.join(opts.outDir, multiName), multiPng);
    fs.writeFileSync(path.join(opts.outDir, freeName), freePng);
    fs.writeFileSync(
        path.join(opts.outDir, keyIndexName),
        JSON.stringify(result.keyIndex, null, 2) + '\n'
    );

    const keyTypeOverlayUrls: Record<string, string> = {};
    let keyTypeBytes = 0;
    for (const [typeId, rgba] of Object.entries(result.keyTypeRgba)) {
        const name = `worldmap-key-type-${typeId}.${fp}.png`;
        const png = encodePngRgba(rgba, width, height);
        fs.writeFileSync(path.join(opts.outDir, name), png);
        keyTypeOverlayUrls[typeId] = `./${name}`;
        keyTypeBytes += png.length;
    }

    // Classic media mapmarker (you-are-here pin) for the basemap picker.
    let playerMarkerUrl: string | undefined;
    const mediaPath = path.join(opts.engine, 'data/pack/client/media');
    if (fs.existsSync(mediaPath)) {
        try {
            const marker = await extractMapmarkerPng(new Uint8Array(fs.readFileSync(mediaPath)), 0);
            const markerName = `worldmap-player-marker.${fp}.png`;
            fs.writeFileSync(path.join(opts.outDir, markerName), marker);
            playerMarkerUrl = `./${markerName}`;
            console.log(`  player marker: ${markerName} (${(marker.length / 1024).toFixed(1)} KB)`);
        } catch (e) {
            console.warn(`  player marker: skip (${e instanceof Error ? e.message : e})`);
        }
    }

    const placementCount = Object.values(result.keyIndex.placements).reduce((n, a) => n + a.length, 0);
    const typeCount = Object.keys(result.keyIndex.placements).length;

    const manifest: BasemapManifest = {
        schema: BASEMAP_SCHEMA,
        revision: opts.revision,
        fingerprint: fp,
        origin: { x: result.originX, z: result.originZ },
        sizeTiles: { w: width, h: height },
        pixelsPerTile: 1,
        basemapUrl: `./${terrainName}`,
        keyOverlayUrl: `./${keyName}`,
        keyIndexUrl: `./${keyIndexName}`,
        keyTypeOverlayUrls,
        labelsOverlayUrl: `./${labelsName}`,
        multiOverlayUrl: `./${multiName}`,
        freeOverlayUrl: `./${freeName}`,
        playerMarkerUrl,
        jagBytes: bytes.length
    };
    const manPath = path.join(opts.outDir, BASEMAP_MANIFEST_NAME);
    fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2) + '\n');

    console.log('report:');
    console.log(`  terrain: ${terrainName} (${(terrainPng.length / 1024).toFixed(0)} KB)`);
    console.log(`  key all: ${keyName} (${(keyPng.length / 1024).toFixed(0)} KB)`);
    console.log(
        `  key types: ${typeCount} PNGs (${(keyTypeBytes / 1024).toFixed(0)} KB total) — ${placementCount} icons`
    );
    console.log(`  labels overlay: ${labelsName} (${(labelsPng.length / 1024).toFixed(0)} KB)`);
    console.log(`  multi overlay: ${multiName} (${(multiPng.length / 1024).toFixed(0)} KB)`);
    console.log(`  free overlay: ${freeName} (${(freePng.length / 1024).toFixed(0)} KB)`);
    console.log(`  key index: ${keyIndexName}`);
    console.log(`  manifest: ${manPath}`);
    console.log(`  origin: ${result.originX},${result.originZ}`);
    console.log(`  elapsed: ${((performance.now() - started) / 1000).toFixed(1)}s`);
}

/** Export media `mapmarker` sprite (index 0 = classic pin) to a small RGBA PNG. */
async function extractMapmarkerPng(mediaBytes: Uint8Array, spriteIndex: number): Promise<Uint8Array> {
    const JagFile = (await import('#/client/io/JagFile.js')).default;
    const Pix32 = (await import('#/client/graphics/Pix32.js')).default;
    const jag = new JagFile(mediaBytes);
    const s = Pix32.depack(jag, 'mapmarker', spriteIndex);
    const w = s.owi;
    const h = s.ohi;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < s.hi; y++) {
        for (let x = 0; x < s.wi; x++) {
            const rgb = s.data[y * s.wi + x] >>> 0;
            if (!rgb) {
                continue;
            }
            const dx = x + s.xof;
            const dy = y + s.yof;
            if (dx < 0 || dy < 0 || dx >= w || dy >= h) {
                continue;
            }
            const o = (dy * w + dx) * 4;
            rgba[o] = (rgb >> 16) & 0xff;
            rgba[o + 1] = (rgb >> 8) & 0xff;
            rgba[o + 2] = rgb & 0xff;
            rgba[o + 3] = 0xff;
        }
    }
    return encodePngRgba(rgba, w, h);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
