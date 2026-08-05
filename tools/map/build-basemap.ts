/**
 * Bake a full-world basemap PNG + fingerprint manifest from worldmap.jag.
 *
 * Usage:
 *   bun tools/map/build-basemap.ts [--engine DIR] [--jag PATH] [--out DIR] [--revision TAG]
 *
 * Resolution order for the jag:
 *   1. --jag PATH
 *   2. $ENGINE/data/pack/mapview/worldmap.jag (or --engine)
 *   3. out/worldmap.jag (cached download)
 *   4. https://2004.lostcity.rs/worldmap.jag (download once into out/)
 *
 * Emits:
 *   out/worldmap-basemap.<fingerprint>.png
 *   out/worldmap-basemap.manifest.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { GlobalRegistrator } from '@happy-dom/global-registrator';

import {
    BASEMAP_MANIFEST_NAME,
    BASEMAP_SCHEMA,
    type BasemapManifest
} from '#/bot/ui/worldMapBasemap.js';
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
    // Use Bun's native fetch before happy-dom is registered (CORS).
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

    // happy-dom's canvas getContext returns null; MapView/PixMap need a 2d context.
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

async function bake(jagBytes: Uint8Array): Promise<{
    pixels: Int32Array;
    width: number;
    height: number;
    originX: number;
    originZ: number;
}> {
    installCanvasMock();

    // Module-level jag for subclass (TS param props are not available during super()).
    (globalThis as { __basemapJag?: Uint8Array }).__basemapJag = jagBytes;

    const { MapView } = await import('#/mapview/MapView.js');
    const JagFile = (await import('#/io/JagFile.js')).default;
    const PixMap = (await import('#/graphics/PixMap.js')).default;
    const { sleep } = await import('#/util/JsUtil.js');

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

    // Default basemap: full-world (1 px/tile of entire map) with no place labels.
    MapView.shouldDrawLabels = false;
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
    // Full map extent = max zoom-out (1 world tile → 1 pixel). Labels stay off.
    view.zoom = 4;
    view.targetZoom = 4;

    const pix = new PixMap(width, height);
    pix.setPixels();
    view.renderWorldMap(0, 0, width, height, 0, 0, width, height);

    return {
        pixels: pix.data,
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

    const { pixels, width, height, originX, originZ } = await bake(bytes);
    console.log(`raster: ${width}×${height} (${((performance.now() - started) / 1000).toFixed(1)}s so far)`);

    const rgba = pix2dToRgba(pixels);
    const png = encodePngRgba(rgba, width, height);

    fs.mkdirSync(opts.outDir, { recursive: true });
    const pngName = `worldmap-basemap.${fp}.png`;
    const pngPath = path.join(opts.outDir, pngName);
    fs.writeFileSync(pngPath, png);

    const manifest: BasemapManifest = {
        schema: BASEMAP_SCHEMA,
        revision: opts.revision,
        fingerprint: fp,
        origin: { x: originX, z: originZ },
        sizeTiles: { w: width, h: height },
        pixelsPerTile: 1,
        basemapUrl: `./${pngName}`,
        jagBytes: bytes.length
    };
    const manPath = path.join(opts.outDir, BASEMAP_MANIFEST_NAME);
    fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2) + '\n');

    console.log('report:');
    console.log(`  png: ${pngPath} (${(png.length / 1024).toFixed(0)} KB)`);
    console.log(`  manifest: ${manPath}`);
    console.log(`  origin: ${originX},${originZ}`);
    console.log(`  elapsed: ${((performance.now() - started) / 1000).toFixed(1)}s`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
