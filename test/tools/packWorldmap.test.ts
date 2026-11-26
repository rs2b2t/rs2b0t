import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

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

function bakeArgs(root: string, ...args: string[]) {
    return [
        join(tools, 'map/build-basemap.ts'), '--engine', join(root, 'engine'),
        '--out', root, '--fetch-url', 'data:,', ...args
    ];
}

function bakeMap(root: string, ...args: string[]) {
    return execFileSync(process.execPath, ['--no-install', ...bakeArgs(root, ...args)], { cwd: root, env: { HOME: root }, stdio: 'pipe' });
}

function bakeWithPreload(root: string, preload: string, ...args: string[]) {
    return execFileSync(process.execPath, ['--no-install', '--preload', preload, ...bakeArgs(root, ...args)],
        { cwd: root, env: { HOME: root }, stdio: 'pipe' });
}

function bakeIfNeeded(root: string, ...args: string[]) {
    return bakeMap(root, '--if-needed', ...args);
}

function prepareDeployment(root: string, script: string, afterBake = '') {
    for (const dir of ['tools', 'out', 'public-bot', 'engine/public/client', 'engine/data/pack/mapview']) {
        mkdirSync(join(root, dir), { recursive: true });
    }
    copyFileSync(join(tools, script), join(root, 'tools', script));
    symlinkSync(join(tools, 'map'), join(root, 'tools/map'));
    const bun = `#!/bin/sh
set -e
case "$1" in
    run) exit 0 ;;
    tools/live-proxy.ts) cp -R "$B0T_INSTANCE_DIR/out/." instance; exit 42 ;;
    tools/nav/build-collision.ts) touch "$5.gz" ;;
    tools/map/build-basemap.ts) "$REAL_BUN" --no-install "$@" --fetch-url data:, ;;
    *) exit 2 ;;
esac
${afterBake}
`;
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
            B0T_VIEWER: 'none',
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
            mkdirSync(dest, { recursive: true });
            writeFileSync(join(script === 'pack-rs2b0t.sh' ? dest : out, 'worldmap.jag'), townMap);
            writeFileSync(join(out, 'worldmap-basemap.manifest.json'), JSON.stringify({
                schema: 2,
                revision: '275',
                fingerprint: oldFingerprint,
                origin: { x: 2048, z: 2816 },
                sizeTiles: { w: 1600, h: 1216 },
                pixelsPerTile: 1,
                basemapUrl: oldBasemap,
                keyOverlayUrl: oldKey,
                labelsOverlayUrl: oldLabels
            }, null, 2));

            writeFileSync(join(root, 'engine/data/pack/mapview/worldmap.jag'), emptyMap);
            deploy();
            const manifest = JSON.parse(readFileSync(join(dest, 'worldmap-basemap.manifest.json'), 'utf8'));
            expect(manifest.labelsOverlayUrl).not.toBe(oldLabels);
            expect(manifest.fingerprint).not.toBe(oldFingerprint);
            expect(manifest.revision).toBe('275');
            expect(readFileSync(join(dest, 'worldmap.jag'))).toEqual(townMap);
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

            if (script === 'deploy-local.sh') {
                rmSync(join(root, 'engine/data/pack/mapview/worldmap.jag'));
                rmSync(join(out, 'worldmap.jag'));
            }
            deploy();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test(`${script} publishes the selected bake before a second baker can replace it`, () => {
        const root = mkdtempSync(join(tmpdir(), 'pack-snapshot-'));
        try {
            const deploy = prepareDeployment(root, script,
                '"$REAL_BUN" --no-install tools/map/build-basemap.ts --jag second.jag --engine engine --out out');
            writeFileSync(join(root, 'out/worldmap.jag'), townMap);
            writeFileSync(join(root, 'second.jag'), emptyMap);
            deploy();
            const dest = join(root, 'engine/public', script === 'deploy-local.sh' ? 'bot' : 'rs2b0t/bot');
            const manifest = JSON.parse(readFileSync(join(dest, 'worldmap-basemap.manifest.json'), 'utf8'));
            expect(readFileSync(join(root, 'out/worldmap.jag'))).toEqual(emptyMap);
            expect(readFileSync(join(dest, 'worldmap.jag'))).toEqual(townMap);
            expect(manifest.fingerprint).toBe('322ab26cb258482b');
            expect(existsSync(join(dest, manifest.labelsOverlayUrl))).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test(`${script} keeps the published map when explicit JAG bytes are missing`, () => {
        const root = mkdtempSync(join(tmpdir(), 'pack-missing-explicit-'));
        try {
            const deploy = prepareDeployment(root, script);
            const out = join(root, 'out');
            const dest = join(root, 'engine/public', script === 'deploy-local.sh' ? 'bot' : 'rs2b0t/bot');
            writeFileSync(join(out, 'worldmap.jag'), emptyMap);
            deploy();
            const manifestPath = join(dest, 'worldmap-basemap.manifest.json');
            const previous = readFileSync(manifestPath);
            const selected = join(root, 'selected.jag');
            writeFileSync(selected, townMap);
            bakeMap(out, '--jag', selected);
            rmSync(selected);
            rmSync(join(out, 'worldmap.jag'));
            expect(deploy).toThrow(/Selected worldmap.jag is missing/);
            expect(readFileSync(manifestPath)).toEqual(previous);
            expect(readFileSync(join(dest, 'worldmap.jag'))).toEqual(emptyMap);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
}

for (const phase of ['baking', 'publishing']) {
    test(`replacing the staged JAG during ${phase} cannot publish a mismatched map`, () => {
        const root = mkdtempSync(join(tmpdir(), 'pack-replaced-jag-'));
        try {
            const dest = join(root, 'published');
            const jag = join(root, 'worldmap.jag');
            writeFileSync(jag, townMap);
            const replacement = join(root, 'replacement.jag');
            writeFileSync(replacement, emptyMap);
            const duringBake = phase === 'baking';
            const labels = join(duringBake ? root : dest, 'worldmap-labels.322ab26cb258482b.png');
            const preload = join(root, 'replace-jag.cjs');
            writeFileSync(preload, `
                const fs = require('node:fs');
                const rename = fs.renameSync;
                fs.renameSync = (from, to) => {
                    rename(from, to);
                    if (to === ${JSON.stringify(labels)}) rename(${JSON.stringify(replacement)}, ${JSON.stringify(jag)});
                };
            `);
            const pack = () => bakeWithPreload(root, preload, '--if-needed', '--publish-to', dest);
            const name = 'worldmap-basemap.manifest.json';
            if (duringBake) {
                expect(pack).toThrow(/worldmap\.jag changed/);
                expect(existsSync(join(root, name))).toBe(false);
                expect(existsSync(join(dest, name))).toBe(false);
            } else {
                pack();
                expect(JSON.parse(readFileSync(join(dest, name), 'utf8')).fingerprint).toBe('322ab26cb258482b');
                expect(readFileSync(join(dest, 'worldmap.jag'))).toEqual(townMap);
            }
            expect(readFileSync(jag)).toEqual(emptyMap);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
}

test('a failed overlay copy leaves the published JAG and manifest in place', () => {
    const root = mkdtempSync(join(tmpdir(), 'pack-overlay-copy-'));
    try {
        const deploy = prepareDeployment(root, 'pack-rs2b0t.sh');
        const dest = join(root, 'engine/public/rs2b0t/bot');
        const source = join(root, 'engine/data/pack/mapview/worldmap.jag');
        writeFileSync(source, emptyMap);
        deploy();
        const manifest = join(dest, 'worldmap-basemap.manifest.json');
        const first = readFileSync(manifest);
        writeFileSync(source, townMap);
        mkdirSync(join(dest, 'worldmap-labels.322ab26cb258482b.png'));
        expect(deploy).toThrow();
        expect(readFileSync(manifest)).toEqual(first);
        expect(readFileSync(join(dest, 'worldmap.jag'))).toEqual(emptyMap);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('retrying a failed label repair publishes a complete PNG', () => {
    const root = mkdtempSync(join(tmpdir(), 'pack-label-retry-'));
    try {
        const dest = join(root, 'published');
        const args = ['--if-needed', '--publish-to', dest];
        writeFileSync(join(root, 'worldmap.jag'), townMap);
        bakeMap(root, ...args);
        const { labelsOverlayUrl } = JSON.parse(readFileSync(join(dest, 'worldmap-basemap.manifest.json'), 'utf8'));
        const staged = join(root, labelsOverlayUrl);
        const published = join(dest, labelsOverlayUrl);
        const original = readFileSync(published);
        rmSync(staged);

        const preload = join(root, 'fail-label-write.cjs');
        writeFileSync(preload, `
            const fs = require('node:fs');
            const write = fs.writeFileSync;
            fs.writeFileSync = (file, data, ...args) => {
                if (file.startsWith(${JSON.stringify(staged)})) {
                    write(file, data.subarray(0, 8));
                    throw new Error('injected ENOSPC');
                }
                return write(file, data, ...args);
            };
        `);
        expect(() => bakeWithPreload(root, preload, ...args)).toThrow(/injected ENOSPC/);
        expect(readFileSync(published).equals(original)).toBe(true);

        bakeMap(root, ...args);
        const repaired = readFileSync(published);
        expect(decodePng(repaired).width).toBe(1600);
        expect(repaired.equals(original)).toBe(true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('an unreadable staged manifest stops packaging before the engine map is selected', () => {
    const root = mkdtempSync(join(tmpdir(), 'pack-manifest-read-'));
    try {
        const dest = join(root, 'published');
        const selected = join(root, 'selected.jag');
        const engineMap = join(root, 'engine/data/pack/mapview');
        mkdirSync(engineMap, { recursive: true });
        writeFileSync(join(engineMap, 'worldmap.jag'), emptyMap);
        writeFileSync(selected, townMap);
        bakeMap(root, '--jag', selected, '--revision', '275', '--publish-to', dest);
        const name = 'worldmap-basemap.manifest.json';
        const manifest = readFileSync(join(root, name));
        const preload = join(root, 'deny-manifest.cjs');
        writeFileSync(preload, `
            const fs = require('node:fs');
            const read = fs.readFileSync;
            fs.readFileSync = (file, ...args) => {
                if (file === ${JSON.stringify(join(root, name))}) throw Object.assign(new Error('manifest EACCES'), { code: 'EACCES' });
                return read(file, ...args);
            };
        `);
        expect(() => bakeWithPreload(root, preload, '--if-needed', '--publish-to', dest)).toThrow(/manifest EACCES/);
        for (const dir of [root, dest]) {
            expect(readFileSync(join(dir, name))).toEqual(manifest);
            expect(readFileSync(join(dir, 'worldmap.jag'))).toEqual(townMap);
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a failed staged manifest rename preserves the selected archive for the next package', () => {
    const root = mkdtempSync(join(tmpdir(), 'stage-manifest-'));
    try {
        const selected = join(root, 'selected.jag');
        const manifest = join(root, 'worldmap-basemap.manifest.json');
        writeFileSync(selected, townMap);
        bakeMap(root, '--jag', selected, '--revision', '275');
        const first = readFileSync(manifest);
        writeFileSync(selected, emptyMap);
        const preload = join(root, 'deny-rename.cjs');
        writeFileSync(preload, `
            const fs = require('node:fs');
            const rename = fs.renameSync;
            fs.renameSync = (from, to) => {
                if (to === ${JSON.stringify(manifest)}) throw new Error('manifest rename failed');
                rename(from, to);
            };
        `);
        expect(() => bakeWithPreload(root, preload, '--jag', selected)).toThrow(/manifest rename failed/);
        expect(readFileSync(manifest)).toEqual(first);
        expect(readFileSync(join(root, 'worldmap.jag'))).toEqual(townMap);
        const dest = join(root, 'published');
        bakeIfNeeded(root, '--publish-to', dest);
        expect(readFileSync(join(dest, 'worldmap-basemap.manifest.json'))).toEqual(first);
        expect(readFileSync(join(dest, 'worldmap.jag'))).toEqual(townMap);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

for (const interrupted of ['staging', 'publication', 'first publication']) {
    test(`packaging recovers the selected JAG after interrupted ${interrupted}`, () => {
        const root = mkdtempSync(join(tmpdir(), 'pack-interrupted-'));
        try {
            const dest = join(root, 'published');
            const selected = join(root, 'selected.jag');
            writeFileSync(selected, townMap);
            bakeMap(root, '--jag', selected, '--revision', '275', '--publish-to', dest);
            const manifestName = 'worldmap-basemap.manifest.json';
            const manifest = readFileSync(join(root, manifestName));
            const staging = interrupted === 'staging';
            const dir = staging ? root : dest;
            const jag = join(dir, 'worldmap.jag');
            const firstPublish = interrupted === 'first publication';
            if (firstPublish) rmSync(join(dest, manifestName));
            const preload = join(root, 'interrupt.cjs');
            writeFileSync(preload, `
                const fs = require('node:fs');
                const rename = fs.renameSync;
                fs.renameSync = (from, to) => {
                    rename(from, to);
                    if (to === ${JSON.stringify(jag)}) process.exit(86);
                };
            `);
            writeFileSync(selected, emptyMap);
            const args = staging ? [] : ['--out', join(root, 'second'), '--publish-to', dest];
            expect(() => bakeWithPreload(root, preload, '--jag', selected, ...args)).toThrow();
            expect(readFileSync(jag)).toEqual(emptyMap);
            if (firstPublish) expect(existsSync(join(dest, manifestName))).toBe(false);
            else expect(readFileSync(join(dir, manifestName))).toEqual(manifest);
            rmSync(join(staging ? dest : root, 'worldmap.jag'));

            bakeIfNeeded(root, '--publish-to', dest);
            for (const output of [root, dest]) {
                expect(readFileSync(join(output, 'worldmap.jag'))).toEqual(townMap);
                expect(readFileSync(join(output, manifestName))).toEqual(manifest);
            }
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
}

for (const operation of ['writeFileSync', 'renameSync']) {
    test(`a failed manifest ${operation} preserves the published JAG and manifest`, () => {
        const root = mkdtempSync(join(tmpdir(), 'publish-manifest-'));
        try {
            const dest = join(root, 'published');
            const manifest = join(dest, 'worldmap-basemap.manifest.json');
            const jag = join(root, 'worldmap.jag');
            writeFileSync(jag, emptyMap);
            bakeMap(root, '--publish-to', dest);
            const first = readFileSync(manifest);
            writeFileSync(jag, townMap);
            const preload = join(root, 'fail.cjs');
            writeFileSync(preload, `
                const fs = require('node:fs');
                const original = fs.${operation};
                fs.${operation} = (from, to, ...args) => {
                    const file = ${operation === 'writeFileSync' ? 'from' : 'to'};
                    if (file.startsWith(${JSON.stringify(dest + '/')}) && file.endsWith('/worldmap-basemap.manifest.json')) {
                        throw new Error('injected ENOSPC');
                    }
                    return original(from, to, ...args);
                };
            `);
            expect(() => bakeWithPreload(root, preload, '--publish-to', dest)).toThrow(/injected ENOSPC/);
            expect(readFileSync(manifest)).toEqual(first);
            expect(readFileSync(join(dest, 'worldmap.jag'))).toEqual(emptyMap);
            bakeIfNeeded(root, '--publish-to', dest);
            expect(readFileSync(manifest)).toEqual(readFileSync(join(root, 'worldmap-basemap.manifest.json')));
            expect(readFileSync(join(dest, 'worldmap.jag'))).toEqual(townMap);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
}

test('two launcher runs reuse the upgraded shared bake', () => {
    const root = mkdtempSync(join(tmpdir(), 'launcher-basemap-'));
    try {
        const launch = prepareDeployment(root, 'b0t.sh');
        mkdirSync(join(root, 'node_modules'));
        writeFileSync(join(root, 'tools/curl'), `#!/bin/sh\necho ${'1'.repeat(250)}\n`, { mode: 0o755 });
        const out = join(root, 'out');
        const manifestName = 'worldmap-basemap.manifest.json';
        writeFileSync(join(out, 'worldmap.jag'), townMap);
        bakeMap(out, '--revision', '275');
        const current = JSON.parse(readFileSync(join(out, manifestName), 'utf8'));
        writeFileSync(join(out, manifestName), JSON.stringify({ ...current, schema: 2, fingerprint: '5f1c291201a299b0' }));
        const labels = join(out, current.labelsOverlayUrl);
        rmSync(labels);
        for (let i = 0; i < 2; i++) {
            expect(launch).toThrow(/proxy exited during startup \(status 42\)/);
            expect(JSON.parse(readFileSync(join(out, manifestName), 'utf8'))).toEqual(current);
            const instance = join(root, 'instance');
            expect(readFileSync(join(instance, manifestName))).toEqual(readFileSync(join(out, manifestName)));
            expect(readFileSync(join(instance, 'worldmap.jag'))).toEqual(townMap);
            expect(readFileSync(join(instance, current.labelsOverlayUrl))).toEqual(readFileSync(labels));
            if (i === 1) expect(statSync(labels).mtimeMs).toBe(1000);
            utimesSync(labels, 1, 1);
            rmSync(instance, { recursive: true });
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test.skipIf(process.getuid?.() === 0)('launcher copies a complete bake from read-only staging', () => {
    const root = mkdtempSync(join(tmpdir(), 'launcher-read-only-'));
    const out = join(root, 'out');
    try {
        const launch = prepareDeployment(root, 'b0t.sh');
        mkdirSync(join(root, 'node_modules'));
        writeFileSync(join(root, 'tools/curl'), `#!/bin/sh\necho ${'1'.repeat(250)}\n`, { mode: 0o755 });
        const selected = join(root, 'selected.jag');
        writeFileSync(selected, townMap);
        bakeMap(root, '--jag', selected, '--revision', '275');
        const assets = readdirSync(root).filter(name => name.startsWith('worldmap'));
        for (const name of assets) {
            copyFileSync(join(root, name), join(out, name));
            chmodSync(join(out, name), 0o444);
        }
        chmodSync(out, 0o555);
        expect(launch).toThrow(/proxy exited during startup \(status 42\)/);
        for (const name of assets) {
            expect(readFileSync(join(root, 'instance', name))).toEqual(readFileSync(join(root, name)));
        }
    } finally {
        chmodSync(out, 0o755);
        rmSync(root, { recursive: true, force: true });
    }
});

test.skipIf(process.getuid?.() === 0)('launcher bakes in the instance when a read-only checkout has no out directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'launcher-no-out-'));
    try {
        const launch = prepareDeployment(root, 'b0t.sh');
        mkdirSync(join(root, 'node_modules'));
        mkdirSync(join(root, 'instance'));
        writeFileSync(join(root, 'tools/curl'), `#!/bin/sh\necho ${'1'.repeat(250)}\n`, { mode: 0o755 });
        writeFileSync(join(root, 'engine/data/pack/mapview/worldmap.jag'), townMap);
        rmSync(join(root, 'out'), { recursive: true });
        chmodSync(root, 0o555);

        expect(launch).toThrow(/proxy exited during startup \(status 42\)/);
        expect(existsSync(join(root, 'out'))).toBe(false);
        const instance = join(root, 'instance');
        expect(readFileSync(join(instance, 'worldmap.jag'))).toEqual(townMap);
        const manifest = JSON.parse(readFileSync(join(instance, 'worldmap-basemap.manifest.json'), 'utf8'));
        expect(existsSync(join(instance, manifest.labelsOverlayUrl))).toBe(true);
    } finally {
        chmodSync(root, 0o755);
        rmSync(root, { recursive: true, force: true });
    }
});

test('packager keeps an explicit JAG when the engine has a different map', () => {
    const root = mkdtempSync(join(tmpdir(), 'pack-explicit-map-'));
    try {
        const pack = prepareDeployment(root, 'pack-rs2b0t.sh');
        const out = join(root, 'out');
        const dest = join(root, 'engine/public/rs2b0t/bot');
        const selected = join(root, 'selected.jag');
        writeFileSync(selected, townMap);
        bakeMap(out, '--jag', selected);
        rmSync(selected);
        writeFileSync(join(root, 'engine/data/pack/mapview/worldmap.jag'), emptyMap);

        const manifest = JSON.parse(readFileSync(join(out, 'worldmap-basemap.manifest.json'), 'utf8'));
        rmSync(join(out, manifest.labelsOverlayUrl));
        pack();
        expect(readFileSync(join(out, 'worldmap.jag')).equals(townMap)).toBe(true);
        expect(readFileSync(join(dest, 'worldmap.jag')).equals(townMap)).toBe(true);
        expect(JSON.parse(readFileSync(join(dest, 'worldmap-basemap.manifest.json'), 'utf8')).fingerprint).toBe(manifest.fingerprint);
        expect(existsSync(join(dest, manifest.labelsOverlayUrl))).toBe(true);

        rmSync(join(out, 'worldmap.jag'));
        pack();
        expect(readFileSync(join(out, 'worldmap.jag'))).toEqual(townMap);
        expect(JSON.parse(readFileSync(join(dest, 'worldmap-basemap.manifest.json'), 'utf8'))).toEqual(manifest);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

for (const source of ['staging', 'engine only']) {
    test(`packager keeps a schema 2 selection from ${source} after the engine changes`, () => {
        const root = mkdtempSync(join(tmpdir(), 'pack-changed-map-'));
        try {
            const pack = prepareDeployment(root, 'pack-rs2b0t.sh');
            const engineJag = join(root, 'engine/data/pack/mapview/worldmap.jag');
            const out = join(root, 'out');
            const dest = join(root, 'engine/public/rs2b0t/bot');
            const name = 'worldmap-basemap.manifest.json';
            writeFileSync(join(out, name), JSON.stringify({
                schema: 2, revision: '275', fingerprint: '5f1c291201a299b0', basemapUrl: './worldmap-old.png',
                origin: { x: 2048, z: 2816 }, sizeTiles: { w: 1600, h: 1216 }, pixelsPerTile: 1
            }));
            if (source === 'staging') writeFileSync(join(out, 'worldmap.jag'), townMap);
            writeFileSync(engineJag, townMap);
            pack();
            const upgraded = readFileSync(join(out, name));
            expect(JSON.parse(upgraded.toString())).toMatchObject({ revision: '275', fingerprint: '322ab26cb258482b' });

            writeFileSync(engineJag, emptyMap);
            pack();
            for (const dir of [out, dest]) {
                expect(readFileSync(join(dir, 'worldmap.jag'))).toEqual(townMap);
                expect(readFileSync(join(dir, name))).toEqual(upgraded);
            }
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
}

test('a schema 2 upgrade preserves the selected map when the engine JAG is unreadable', () => {
    const root = mkdtempSync(join(tmpdir(), 'pack-unreadable-engine-'));
    try {
        const dest = join(root, 'published');
        const engine = join(root, 'engine/data/pack/mapview');
        mkdirSync(engine, { recursive: true });
        const engineJag = join(engine, 'worldmap.jag');
        writeFileSync(engineJag, emptyMap);
        writeFileSync(join(root, 'worldmap.jag'), townMap);
        const name = 'worldmap-basemap.manifest.json';
        writeFileSync(join(root, name), JSON.stringify({
            schema: 2, revision: '275', fingerprint: '5f1c291201a299b0', basemapUrl: './worldmap-old.png',
            origin: { x: 2048, z: 2816 }, sizeTiles: { w: 1600, h: 1216 }, pixelsPerTile: 1
        }));
        const preload = join(root, 'deny-engine.cjs');
        writeFileSync(preload, `
            const fs = require('node:fs');
            const read = fs.readFileSync;
            fs.readFileSync = (file, ...args) => {
                if (file === ${JSON.stringify(engineJag)}) throw Object.assign(new Error('engine EACCES'), { code: 'EACCES' });
                return read(file, ...args);
            };
        `);
        bakeWithPreload(root, preload, '--if-needed', '--publish-to', dest);
        bakeIfNeeded(root, '--publish-to', dest);
        expect(readFileSync(join(dest, 'worldmap.jag'))).toEqual(townMap);
        expect(JSON.parse(readFileSync(join(dest, name), 'utf8'))).toMatchObject({
            revision: '275', fingerprint: '322ab26cb258482b'
        });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test.skipIf(process.getuid?.() === 0)('packager reuses a verified bake when its engine JAG becomes unreadable', () => {
    const root = mkdtempSync(join(tmpdir(), 'pack-engine-permissions-'));
    try {
        const pack = prepareDeployment(root, 'pack-rs2b0t.sh');
        const engineJag = join(root, 'engine/data/pack/mapview/worldmap.jag');
        const out = join(root, 'out');
        const dest = join(root, 'engine/public/rs2b0t/bot');
        writeFileSync(engineJag, townMap);
        pack();
        const name = 'worldmap-basemap.manifest.json';
        const manifest = readFileSync(join(out, name));
        const labels = join(out, JSON.parse(manifest.toString()).labelsOverlayUrl);
        utimesSync(labels, 1, 1);
        chmodSync(engineJag, 0);
        rmSync(join(dest, 'worldmap.jag'));
        pack();
        expect(statSync(labels).mtimeMs).toBe(1000);
        expect(readFileSync(join(dest, name))).toEqual(manifest);
        expect(readFileSync(join(dest, 'worldmap.jag'))).toEqual(townMap);

        rmSync(join(dest, 'worldmap.jag'));
        writeFileSync(join(out, 'worldmap.jag'), emptyMap);
        expect(pack).toThrow(/EACCES/);
        expect(existsSync(join(dest, 'worldmap.jag'))).toBe(false);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('packager restores a missing free overlay referenced by the manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'pack-missing-overlay-'));
    try {
        const pack = prepareDeployment(root, 'pack-rs2b0t.sh');
        const dest = join(root, 'engine/public/rs2b0t/bot');
        writeFileSync(join(root, 'out/worldmap.jag'), townMap);
        pack();
        const { freeOverlayUrl } = JSON.parse(readFileSync(join(dest, 'worldmap-basemap.manifest.json'), 'utf8'));
        const staged = join(dest, freeOverlayUrl);
        const expected = readFileSync(staged);
        rmSync(join(root, 'out', freeOverlayUrl));
        rmSync(staged);

        pack();
        expect(readFileSync(staged)).toEqual(expected);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a cache hit repairs the staged JAG before packaging', () => {
    const root = mkdtempSync(join(tmpdir(), 'pack-stale-jag-'));
    try {
        const pack = prepareDeployment(root, 'pack-rs2b0t.sh');
        writeFileSync(join(root, 'engine/data/pack/mapview/worldmap.jag'), townMap);
        pack();
        writeFileSync(join(root, 'out/worldmap.jag'), emptyMap);
        pack();
        expect(readFileSync(join(root, 'out/worldmap.jag')).equals(townMap)).toBe(true);
        expect(readFileSync(join(root, 'engine/public/rs2b0t/bot/worldmap.jag')).equals(townMap)).toBe(true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

async function raceBakes(root: string, pausedJag: string, first: string[], second: string[]) {
    const pause = join(root, 'pause.cjs');
    writeFileSync(pause, `
        const fs = require('node:fs');
        const rename = fs.renameSync;
        fs.renameSync = (from, to) => {
            rename(from, to);
            if (to === ${JSON.stringify(pausedJag)}) {
                fs.writeSync(1, 'JAG renamed\\n');
                fs.readSync(0, Buffer.alloc(1), 0, 1, null);
            }
        };
    `);
    const options = { cwd: root, env: { HOME: root }, timeout: 10000 };
    const run = promisify(execFile);
    const paused = run(process.execPath, ['--no-install', '--preload', pause, ...first], options);
    const staged = new Promise<void>(resolve => {
        paused.child.stdout!.on('data', chunk => {
            if (chunk.toString().includes('JAG renamed')) resolve();
        });
    });
    await Promise.race([staged, paused.then(() => { throw new Error('Bake exited before staging the JAG'); })]);
    const check = run(process.execPath, ['--no-install', ...second], options);
    try {
        await Promise.race([check, Bun.sleep(500)]);
    } finally {
        paused.child.stdin!.end('1');
        await Promise.all([paused, check]);
    }
}

test('two staging directories publish matching JAG and manifest pairs to a shared destination', async () => {
    const root = mkdtempSync(join(tmpdir(), 'publish-concurrent-'));
    try {
        const dest = join(root, 'published');
        const publishers = [townMap, emptyMap].map((bytes, i) => {
            const out = join(root, String(i));
            mkdirSync(out);
            writeFileSync(join(out, 'worldmap.jag'), bytes);
            bakeMap(out);
            return bakeArgs(out, '--if-needed', '--publish-to', dest);
        });
        await raceBakes(root, join(dest, 'worldmap.jag'), publishers[0], publishers[1]);
        expect(readFileSync(join(dest, 'worldmap.jag'))).toEqual(emptyMap);
        expect(readFileSync(join(dest, 'worldmap-basemap.manifest.json'))).toEqual(readFileSync(join(root, '1/worldmap-basemap.manifest.json')));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a concurrent cache check preserves the JAG staged by an explicit bake', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bake-concurrent-'));
    try {
        const engine = join(root, 'engine/data/pack/mapview');
        mkdirSync(engine, { recursive: true });
        writeFileSync(join(engine, 'worldmap.jag'), emptyMap);
        writeFileSync(join(root, 'selected.jag'), townMap);
        bakeIfNeeded(root);

        await raceBakes(root, join(root, 'worldmap.jag'),
            bakeArgs(root, '--jag', 'selected.jag'), bakeArgs(root, '--if-needed', '--revision', '276'));

        expect(readFileSync(join(root, 'worldmap.jag'))).toEqual(townMap);
        bakeIfNeeded(root);
        const manifest = JSON.parse(readFileSync(join(root, 'worldmap-basemap.manifest.json'), 'utf8'));
        expect(manifest.revision).toBe('276');
        expect(manifest.explicitJag).toBe(true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a cache hit rejects a missing explicit JAG', () => {
    const root = mkdtempSync(join(tmpdir(), 'bake-missing-jag-'));
    try {
        writeFileSync(join(root, 'worldmap.jag'), townMap);
        bakeIfNeeded(root);
        expect(() => bakeIfNeeded(root, '--jag', 'missing.jag')).toThrow(/--jag not found: missing.jag/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a cache hit updates the requested revision and reuses the baked PNG', () => {
    const root = mkdtempSync(join(tmpdir(), 'bake-revision-'));
    try {
        writeFileSync(join(root, 'worldmap.jag'), townMap);
        bakeIfNeeded(root);
        const manifest = () => JSON.parse(readFileSync(join(root, 'worldmap-basemap.manifest.json'), 'utf8'));
        const first = manifest();
        const labels = join(root, first.labelsOverlayUrl);
        utimesSync(labels, 1, 1);

        bakeIfNeeded(root, '--revision', '275');
        expect(manifest()).toEqual({ ...first, revision: '275' });
        bakeIfNeeded(root);
        expect(manifest().revision).toBe('275');
        expect(statSync(labels).mtimeMs).toBe(1000);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a direct schema upgrade keeps the source revision unless explicitly overridden', () => {
    const root = mkdtempSync(join(tmpdir(), 'bake-upgrade-revision-'));
    try {
        writeFileSync(join(root, 'worldmap.jag'), townMap);
        bakeMap(root, '--revision', '275');
        const path = join(root, 'worldmap-basemap.manifest.json');
        const manifest = () => JSON.parse(readFileSync(path, 'utf8'));
        const legacy = { ...manifest(), schema: 2, fingerprint: '5f1c291201a299b0' };
        for (const revision of [undefined, '276']) {
            writeFileSync(path, JSON.stringify(legacy));
            bakeMap(root, ...(revision ? ['--revision', revision] : []));
            expect(manifest().revision).toBe(revision ?? '275');
        }
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
