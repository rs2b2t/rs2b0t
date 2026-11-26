/** Bake terrain and transparent key, multi and free overlays from worldmap.jag.
 * Fresh input order: --jag, $ENGINE/data/pack/mapview, out/, then a 2004scape download. */

// Usage:
//   bun tools/map/build-basemap.ts [--engine DIR] [--jag PATH] [--out DIR] [--revision TAG] [--if-needed] [--publish-to DIR]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';

import {
    BASEMAP_MANIFEST_NAME,
    BASEMAP_SCHEMA,
    isBasemapManifest,
    type BasemapManifest,
    type WorldmapKeyIndex
} from '#/bot/panel/worldMapBasemap.js';
import { createBitmapFontContext } from './bitmapFont.js';
import { encodePngRgba, pix2dToRgba } from './encodePng.js';

type BakeManifest = BasemapManifest & { explicitJag?: boolean };

type BakeArgs = {
    engine: string;
    jag: string | null;
    outDir: string;
    revision?: string;
    fetchUrl: string;
    ifNeeded: boolean;
    publishTo?: string;
};

function parseArgs(): BakeArgs {
    const args = process.argv.slice(2);
    let engine = process.env.ENGINE_DIR ?? `${process.env.HOME}/code/rs2b2t-engine`;
    let jag: string | null = null;
    let outDir = 'out';
    let revision: string | undefined;
    let fetchUrl = 'https://2004.lostcity.rs/worldmap.jag';
    let ifNeeded = false;
    let publishTo: string | undefined;
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
        } else if (a === '--if-needed') {
            ifNeeded = true;
        } else if (a === '--publish-to') {
            publishTo = args[++i];
            if (!publishTo) throw new Error('--publish-to requires a destination directory');
        } else if (a === '--help' || a === '-h') {
            console.log(
                'usage: bun tools/map/build-basemap.ts [--engine DIR] [--jag PATH] [--out DIR] [--revision TAG] [--if-needed] [--publish-to DIR]'
            );
            process.exit(0);
        } else {
            console.error(`unknown arg: ${a}`);
            process.exit(2);
        }
    }
    return { engine, jag, outDir, revision, fetchUrl, ifNeeded, publishTo };
}

function readManifest(file: string): BakeManifest | null {
    try {
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        return isBasemapManifest(manifest) ? manifest : null;
    } catch {
        return null;
    }
}

function assetUrls(manifest: BakeManifest): string[] {
    const optional = [manifest.multiOverlayUrl, manifest.freeOverlayUrl, manifest.keyIndexUrl, manifest.playerMarkerUrl];
    const urls = [
        manifest.basemapUrl, manifest.keyOverlayUrl, manifest.labelsOverlayUrl,
        ...optional.filter(url => url !== undefined), ...Object.values(manifest.keyTypeOverlayUrls ?? {})
    ];
    return urls.map(url => {
        if (typeof url !== 'string' || !/^(?:\.\/)?worldmap-[\w.-]+\.(?:json|png)$/.test(url) || path.basename(url) === BASEMAP_MANIFEST_NAME) {
            throw new Error(`Invalid basemap asset: ${url}`);
        }
        return url;
    });
}

function isCurrentBake(outDir: string, manifest: BakeManifest, localFingerprint: string | null): boolean {
    try {
        return manifest.schema === BASEMAP_SCHEMA &&
            (localFingerprint === null || manifest.fingerprint === localFingerprint) &&
            assetUrls(manifest).every(url => fs.statSync(path.join(outDir, url)).isFile());
    } catch {
        return false;
    }
}

function findLocalJag(opts: BakeArgs, previous: BakeManifest | null) {
    if (opts.jag !== null) {
        if (!fs.existsSync(opts.jag)) throw new Error(`--jag not found: ${opts.jag}`);
        return { path: opts.jag, bytes: fs.readFileSync(opts.jag), explicit: true };
    }
    const engineJag = path.join(opts.engine, 'data/pack/mapview/worldmap.jag');
    const cacheJag = path.join(opts.outDir, 'worldmap.jag');
    const hasEngine = fs.existsSync(engineJag);
    const file = hasEngine ? engineJag : cacheJag;
    const hasLocal = hasEngine || fs.existsSync(cacheJag);
    if (previous && (previous.explicitJag !== false || previous.schema !== BASEMAP_SCHEMA || !hasLocal)) {
        const published = opts.publishTo && path.join(opts.publishTo, 'worldmap.jag');
        for (const candidate of [cacheJag, published]) {
            if (!candidate || !fs.existsSync(candidate)) continue;
            const bytes = fs.readFileSync(candidate);
            if (fingerprint(bytes, previous.schema) === previous.fingerprint) {
                const explicit = previous.explicitJag ?? (!hasEngine || !bytes.equals(fs.readFileSync(engineJag)));
                return { path: candidate, bytes, explicit };
            }
        }
    }
    if (!hasLocal) return null;
    const bytes = fs.readFileSync(file);
    if (previous?.explicitJag && fingerprint(bytes, previous.schema) !== previous.fingerprint) {
        throw new Error('Selected worldmap.jag is missing or changed. Supply --jag to select an archive.');
    }
    return { path: file, bytes, explicit: previous?.explicitJag === true };
}

function replaceFile(file: string, data: string | Uint8Array): void {
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, data);
    fs.renameSync(temp, file);
}

function stageJag(outDir: string, source: string | null, bytes: Uint8Array): void {
    const staged = path.join(outDir, 'worldmap.jag');
    if (source !== null && path.resolve(source) === path.resolve(staged)) return;
    if (fs.existsSync(staged) && fs.readFileSync(staged).equals(bytes)) return;
    replaceFile(staged, bytes);
}

function writeManifest(file: string, manifest: BakeManifest): void {
    replaceFile(file, JSON.stringify(manifest, null, 2) + '\n');
}

async function downloadJag(url: string): Promise<Uint8Array> {
    console.log(`worldmap.jag missing under engine; downloading ${url}…`);
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`download failed HTTP ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
}

function fingerprint(jag: Uint8Array, schema = BASEMAP_SCHEMA): string {
    return createHash('sha256').update(jag).update(`basemap-schema-${schema}`).digest('hex').slice(0, 16);
}

async function installCanvasMock(): Promise<void> {
    const { GlobalRegistrator } = await import('@happy-dom/global-registrator');
    GlobalRegistrator.register();

    const el = document.createElement('canvas');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = function (type: string) {
        if (type !== '2d') return null;
        if (this !== el) return createBitmapFontContext(this.width, this.height);
        return {
            createImageData(w: number, h: number) {
                return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h, colorSpace: 'srgb' };
            },
            fillRect() {},
            putImageData() {}
        };
    };

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
    /** All Key icons on one transparent sheet (optional "everything" layer). */
    keyRgba: Uint8Array;
    /** Per mapfunction type id, a transparent sheet with only that Key type. */
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
    await installCanvasMock();

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

    // Key icons: per-type transparent overlays + composite (same -7 offset as MapView).
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
        // Centre of the 1x1 tile cell (matches startX + lengthX/2 at 1 ppt).
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
    const dirs = [opts.outDir];
    if (opts.publishTo) dirs.push(opts.publishTo);
    const lockDirs = new Set(dirs.map(dir => {
        fs.mkdirSync(dir, { recursive: true });
        return fs.realpathSync(dir);
    }));
    const locks: Database[] = [];
    try {
        // Why: both staging and published archives can be inputs, so lock them in a consistent order.
        for (const dir of [...lockDirs].sort()) {
            const lock = new Database(path.join(dir, '.basemap-lock.sqlite'));
            locks.push(lock);
            lock.run('PRAGMA busy_timeout = 60000');
            lock.run('BEGIN EXCLUSIVE');
        }
        const manifest = await buildBasemap(opts);
        if (opts.publishTo && lockDirs.size > 1) publishBasemap(opts.outDir, opts.publishTo, manifest);
    } finally {
        for (const lock of locks.reverse()) lock.close();
    }
}

function publishBasemap(outDir: string, dest: string, manifest: BakeManifest): void {
    const pending = fs.mkdtempSync(path.join(dest, '.basemap-'));
    function stage(name: string): string {
        const temp = path.join(pending, name);
        fs.copyFileSync(path.join(outDir, name), temp);
        return temp;
    }
    try {
        for (const name of assetUrls(manifest)) {
            fs.renameSync(stage(name), path.join(dest, name));
        }
        const jag = path.join(dest, 'worldmap.jag');
        const nextJag = stage('worldmap.jag');
        const nextManifest = stage(BASEMAP_MANIFEST_NAME);
        const backup = path.join(pending, 'previous.jag');
        const hadJag = fs.existsSync(jag);
        if (hadJag) fs.copyFileSync(jag, backup);
        fs.renameSync(nextJag, jag);
        try {
            fs.renameSync(nextManifest, path.join(dest, BASEMAP_MANIFEST_NAME));
        } catch (err) {
            if (hadJag) fs.renameSync(backup, jag);
            else fs.unlinkSync(jag);
            throw err;
        }
    } finally {
        fs.rmSync(pending, { recursive: true, force: true });
    }
}

async function buildBasemap(opts: BakeArgs): Promise<BakeManifest> {
    const started = performance.now();

    const manPath = path.join(opts.outDir, BASEMAP_MANIFEST_NAME);
    const existing = readManifest(manPath);
    const previous = opts.ifNeeded || existing?.schema !== BASEMAP_SCHEMA ? existing : null;
    const local = findLocalJag(opts, previous);
    const localFingerprint = local && fingerprint(local.bytes);
    const explicitJag = local?.explicit ?? previous?.explicitJag;
    if (previous?.explicitJag && !local) throw new Error('Selected worldmap.jag is missing. Supply --jag to rebuild.');
    if (opts.ifNeeded && previous && (local || !opts.publishTo) && isCurrentBake(opts.outDir, previous, localFingerprint)) {
        if (local) stageJag(opts.outDir, local.path, local.bytes);
        const revision = opts.revision ?? previous.revision;
        if (previous.revision !== revision || previous.explicitJag !== explicitJag) {
            const manifest = { ...previous, revision, explicitJag };
            writeManifest(manPath, manifest);
            return manifest;
        }
        return previous;
    }

    const source = local?.path ?? opts.fetchUrl;
    const bytes = local?.bytes ?? await downloadJag(opts.fetchUrl);
    const fp = localFingerprint ?? fingerprint(bytes);
    const sameSource = previous && fingerprint(bytes, previous.schema) === previous.fingerprint;
    const revision = opts.revision ?? (sameSource ? previous.revision : undefined) ?? '274';
    console.log(`source: ${source}`);
    console.log(`fingerprint: ${fp}`);
    console.log(`revision: ${revision}`);
    console.log(`schema: ${BASEMAP_SCHEMA} (terrain + per-type Key overlays + multi/free)`);

    const result = await bake(bytes);
    const { width, height } = result;
    console.log(`raster: ${width}×${height} (${((performance.now() - started) / 1000).toFixed(1)}s so far)`);

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

    const manifest: BakeManifest = {
        schema: BASEMAP_SCHEMA,
        revision,
        explicitJag: explicitJag ?? false,
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
    stageJag(opts.outDir, local?.path ?? null, bytes);
    writeManifest(manPath, manifest);

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
    return manifest;
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
