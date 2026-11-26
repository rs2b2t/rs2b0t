import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A whole-archive-compressed JAG with empty map layers and fonts.
const emptyMap = Buffer.from(
    'AAfLAAC9MUFZJlNZPBJubgAAMf//0oGMAABUBV6gAgJRYApkoAQSB5UFQwIUKBQgHgIQKg0gAHQhChpoADQNA0GQG1AbUHoT9FCvUkGmhgTEDCME0000yaGgYTTNmlrJt3G/lOMtNkNVoCaYAJVXBgAIgUhSFAAxLGL8zAPJhAQoB5OM754akXc8ExxtmGGT0hu6KRd6NwOqiT4XSTLPHLRBx9TqpmKQTqjJN7/LQxuIieImPCLYP4u5IpwoSB4JNzcA',
    'base64'
);
const cachedMap = Buffer.concat([emptyMap, Buffer.from('C')]);
const tools = join(import.meta.dir, '../../tools');

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
