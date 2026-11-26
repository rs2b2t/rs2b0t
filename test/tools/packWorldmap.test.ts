import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const decodePng: (png: Buffer) => { width: number; height: number; data: Buffer } =
    import.meta.require('playwright-core/lib/utilsBundle').PNG.sync.read;

// A whole-archive-compressed JAG with empty map layers and fonts.
const emptyMap = Buffer.from(
    'AAfLAAC9MUFZJlNZPBJubgAAMf//0oGMAABUBV6gAgJRYApkoAQSB5UFQwIUKBQgHgIQKg0gAHQhChpoADQNA0GQG1AbUHoT9FCvUkGmhgTEDCME0000yaGgYTTNmlrJt3G/lOMtNkNVoCaYAJVXBgAIgUhSFAAxLGL8zAPJhAQoB5OM754akXc8ExxtmGGT0hu6KRd6NwOqiT4XSTLPHLRBx9TqpmKQTqjJN7/LQxuIieImPCLYP4u5IpwoSB4JNzcA',
    'base64'
);
const cachedMap = Buffer.concat([emptyMap, Buffer.from('C')]);
const tools = join(import.meta.dir, '../../tools');

test('baking without map fonts draws Town at the center of the labels PNG only', () => {
    const root = mkdtempSync(join(tmpdir(), 'bake-labels-'));
    try {
        const jag = join(root, 'town.jag');
        writeFileSync(jag, Buffer.from(
            'AAeFAACZMUFZJlNZcFT9XQAAINv/8p5ARAVCBFFgCaSAABIHFAEBAhQoFCAeABAADSAAdCpk0AaAAAAANNGQjKpiYQwAmjIZDAE9Jokn6vqpV9AbbACtdyJxJKUGEgPEBC+ssKyB2KIBg2EC+MQATSt6hpM+nAFFtexe7MteD8FJD56Yc3XIfhlxEX0yZ0RHIkkij8XckU4UJBwVP1dA',
            'base64'
        ));
        execFileSync(process.execPath, [
            '--no-install', join(tools, 'map/build-basemap.ts'), '--jag', jag, '--out', root, '--engine', root
        ], { cwd: root, env: { HOME: root }, stdio: 'pipe' });

        const manifest = JSON.parse(readFileSync(join(root, 'worldmap-basemap.manifest.json'), 'utf8'));
        const labels = decodePng(readFileSync(join(root, manifest.labelsOverlayUrl)));
        const terrain = decodePng(readFileSync(join(root, manifest.basemapUrl)));
        expect([labels.width, labels.height]).toEqual([1600, 1216]);
        expect([terrain.width, terrain.height]).toEqual([labels.width, labels.height]);

        let inside = 0;
        let outside = 0;
        let changedTerrain = 0;
        for (let y = 0; y < labels.height; y++) {
            for (let x = 0; x < labels.width; x++) {
                const offset = (y * labels.width + x) * 4;
                if (terrain.data.readUInt32BE(offset) !== 0x000000ff) changedTerrain++;
                if (labels.data[offset + 3] === 0) continue;
                if (Math.abs(x - 800) <= 24 && Math.abs(y - 608) <= 12) inside++;
                else outside++;
            }
        }
        expect(changedTerrain).toBe(0);
        expect(outside).toBe(0);
        expect(inside).toBeGreaterThan(0);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

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
            for (const dir of ['tools', 'out', 'public-bot', 'engine/public', 'engine/data/pack/mapview']) {
                mkdirSync(join(root, dir), { recursive: true });
            }
            copyFileSync(join(tools, 'pack-rs2b0t.sh'), join(root, 'tools/pack-rs2b0t.sh'));
            symlinkSync(join(tools, 'map'), join(root, 'tools/map'));
            const bun = '#!/bin/sh\n[ "$1" = run ] && exit 0\nexec "$REAL_BUN" --no-install "$@" --fetch-url data:,\n';
            writeFileSync(join(root, 'tools/bun'), bun, { mode: 0o755 });
            for (const bundle of ['botclient', 'ondemandworker', 'navworker', 'multibox']) {
                writeFileSync(join(root, `out/${bundle}.js`), '');
                writeFileSync(join(root, `out/${bundle}.js.map`), '');
            }
            for (const file of ['out/collision.lcnav.gz', 'out/tinymidipcm.wasm', 'public-bot/bot.html', 'public-bot/multibox.html']) {
                writeFileSync(join(root, file), '');
            }
            if (sources.includes('engine')) {
                writeFileSync(join(root, 'engine/data/pack/mapview/worldmap.jag'), emptyMap);
            }
            if (sources.includes('cache')) {
                writeFileSync(join(root, 'out/worldmap.jag'), cachedMap);
            }

            execFileSync('sh', ['tools/pack-rs2b0t.sh'], {
                cwd: root,
                env: {
                    PATH: `${root}/tools:${process.env.PATH}`,
                    REAL_BUN: process.execPath,
                    ENGINE: join(root, 'engine'),
                    PROD_RSAN: '1',
                    HOME: root
                }
            });

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
