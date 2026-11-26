import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encodePngRgba, pix2dToRgba } from '../../tools/map/encodePng.js';

const decodePng: (png: Buffer) => { width: number; height: number; data: Buffer } =
    import.meta.require('playwright-core/lib/utilsBundle').PNG.sync.read;

// A whole-archive-compressed JAG with empty map layers and fonts.
const emptyMap = Buffer.from(
    'AAfLAAC9MUFZJlNZPBJubgAAMf//0oGMAABUBV6gAgJRYApkoAQSB5UFQwIUKBQgHgIQKg0gAHQhChpoADQNA0GQG1AbUHoT9FCvUkGmhgTEDCME0000yaGgYTTNmlrJt3G/lOMtNkNVoCaYAJVXBgAIgUhSFAAxLGL8zAPJhAQoB5OM754akXc8ExxtmGGT0hu6KRd6NwOqiT4XSTLPHLRBx9TqpmKQTqjJN7/LQxuIieImPCLYP4u5IpwoSB4JNzcA',
    'base64'
);
const cachedMap = Buffer.concat([emptyMap, Buffer.from('C')]);
const tools = join(import.meta.dir, '../../tools');

function prepareDeployment(root: string, script: string) {
    for (const dir of ['tools', 'out', 'public-bot', 'engine/public/client', 'engine/data/pack/mapview']) {
        mkdirSync(join(root, dir), { recursive: true });
    }
    copyFileSync(join(tools, script), join(root, 'tools', script));
    symlinkSync(join(tools, 'map'), join(root, 'tools/map'));
    const bun = '#!/bin/sh\n[ "$1" = run ] && exit 0\nexec "$REAL_BUN" --no-install "$@" --fetch-url data:,\n';
    writeFileSync(join(root, 'tools/bun'), bun, { mode: 0o755 });
    for (const bundle of ['botclient', 'client', 'ondemandworker', 'navworker', 'multibox']) {
        writeFileSync(join(root, `out/${bundle}.js`), '');
        writeFileSync(join(root, `out/${bundle}.js.map`), '');
    }
    for (const file of ['out/collision.lcnav.gz', 'out/tinymidipcm.wasm', 'public-bot/bot.html', 'public-bot/multibox.html']) {
        writeFileSync(join(root, file), '');
    }
    return () => execFileSync('sh', [join('tools', script)], {
        cwd: root,
        stdio: 'pipe',
        env: {
            PATH: `${root}/tools:${process.env.PATH}`,
            REAL_BUN: process.execPath,
            ENGINE: join(root, 'engine'),
            ENGINE_DIR: join(root, 'engine'),
            PROD_RSAN: '1',
            HOME: root
        }
    });
}

const townMap = Buffer.from(
    'AAeFAACZMUFZJlNZcFT9XQAAINv/8p5ARAVCBFFgCaSAABIHFAEBAhQoFCAeABAADSAAdCpk0AaAAAAANNGQjKpiYQwAmjIZDAE9Jokn6vqpV9AbbACtdyJxJKUGEgPEBC+ssKyB2KIBg2EC+MQATSt6hpM+nAFFtexe7MteD8FJD56Yc3XIfhlxEX0yZ0RHIkkij8XckU4UJBwVP1dA',
    'base64'
);

for (const script of ['pack-rs2b0t.sh', 'deploy-local.sh']) {
    test(`${script} upgrades blank schema 2 labels and reuses the corrected bake`, () => {
        const root = mkdtempSync(join(tmpdir(), 'bake-labels-'));
        try {
            const deploy = prepareDeployment(root, script);
            const out = join(root, 'out');
            const dest = join(root, 'engine/public', script === 'deploy-local.sh' ? 'bot' : 'rs2b0t/bot');
            const oldFingerprint = '5f1c291201a299b0';
            const oldBasemap = `./worldmap-basemap.${oldFingerprint}.png`;
            const oldLabels = `./worldmap-labels.${oldFingerprint}.png`;
            const oldKey = `./worldmap-key.${oldFingerprint}.png`;
            const blank = encodePngRgba(new Uint8Array(1600 * 1216 * 4), 1600, 1216);
            const terrain = encodePngRgba(pix2dToRgba(new Int32Array(1600 * 1216)), 1600, 1216);
            writeFileSync(join(out, oldBasemap), terrain);
            writeFileSync(join(out, oldLabels), blank);
            writeFileSync(join(out, oldKey), blank);
            writeFileSync(join(out, 'worldmap.jag'), townMap);
            writeFileSync(join(out, 'worldmap-basemap.manifest.json'), JSON.stringify({
                schema: 2,
                fingerprint: oldFingerprint,
                origin: { x: 2048, z: 2816 },
                sizeTiles: { w: 1600, h: 1216 },
                pixelsPerTile: 1,
                basemapUrl: oldBasemap,
                keyOverlayUrl: oldKey,
                labelsOverlayUrl: oldLabels
            }, null, 2));

            deploy();
            const manifest = JSON.parse(readFileSync(join(dest, 'worldmap-basemap.manifest.json'), 'utf8'));
            expect(manifest.labelsOverlayUrl).not.toBe(oldLabels);
            expect(manifest.fingerprint).not.toBe(oldFingerprint);
            const labels = decodePng(readFileSync(join(dest, manifest.labelsOverlayUrl)));
            expect(readFileSync(join(dest, manifest.basemapUrl)).equals(terrain)).toBe(true);
            expect([labels.width, labels.height]).toEqual([1600, 1216]);

            let inside = 0;
            let outside = 0;
            for (let y = 0; y < labels.height; y++) {
                for (let x = 0; x < labels.width; x++) {
                    const offset = (y * labels.width + x) * 4;
                    if (labels.data[offset + 3] === 0) continue;
                    if (Math.abs(x - 800) <= 24 && Math.abs(y - 608) <= 12) inside++;
                    else outside++;
                }
            }
            expect(outside).toBe(0);
            expect(inside).toBeGreaterThan(0);

            rmSync(join(out, 'worldmap.jag'));
            deploy();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
}

test('a failed download bake can retry and cache the valid worldmap', () => {
    const root = mkdtempSync(join(tmpdir(), 'bake-worldmap-'));
    try {
        const out = join(root, 'out');
        const jag = join(out, 'worldmap.jag');
        const manifest = join(out, 'worldmap-basemap.manifest.json');
        const bake = (fetchUrl: string) => execFileSync(process.execPath, [
            '--no-install', join(tools, 'map/build-basemap.ts'), '--engine', join(root, 'engine'),
            '--out', out, '--fetch-url', fetchUrl
        ], { cwd: root, env: { HOME: root }, stdio: 'pipe' });

        expect(() => bake('data:,invalid')).toThrow(/Invalid bz2 blocktype/);
        expect(existsSync(manifest)).toBe(false);
        expect(existsSync(jag)).toBe(false);

        bake(`data:application/octet-stream;base64,${emptyMap.toString('base64')}`);
        expect(readFileSync(jag)).toEqual(emptyMap);
        expect(JSON.parse(readFileSync(manifest, 'utf8')).jagBytes).toBe(emptyMap.length);

        bake('data:,invalid');
        expect(readFileSync(jag)).toEqual(emptyMap);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

for (const sources of ['engine and cache', 'engine', 'cache']) {
    test(`fresh bake packages the selected worldmap with ${sources} present`, () => {
        const root = mkdtempSync(join(tmpdir(), 'pack-worldmap-'));
        try {
            const pack = prepareDeployment(root, 'pack-rs2b0t.sh');
            if (sources.includes('engine')) {
                writeFileSync(join(root, 'engine/data/pack/mapview/worldmap.jag'), emptyMap);
            }
            if (sources.includes('cache')) {
                writeFileSync(join(root, 'out/worldmap.jag'), cachedMap);
            }

            pack();

            const dest = join(root, 'engine/public/rs2b0t/bot');
            const expected = sources === 'cache' ? cachedMap : emptyMap;
            const manifest = JSON.parse(readFileSync(join(dest, 'worldmap-basemap.manifest.json'), 'utf8'));
            const fingerprint = createHash('sha256')
                .update(expected)
                .update(`basemap-schema-${manifest.schema}`)
                .digest('hex')
                .slice(0, 16);
            expect(manifest.fingerprint).toBe(fingerprint);
            expect(readFileSync(join(dest, 'worldmap.jag'))).toEqual(expected);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
}
