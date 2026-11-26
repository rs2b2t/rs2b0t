import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const artifacts = [...['botclient', 'ondemandworker', 'navworker', 'multibox'].flatMap(name => [`${name}.js`, `${name}.js.map`]), 'tinymidipcm.wasm', 'version.json'];

for (const outDir of [undefined, 'alt']) {
    test(`packager stages the current bot build with B0T_OUT_DIR ${outDir ?? 'unset'}`, () => {
        const root = mkdtempSync(join(tmpdir(), 'pack-bot-'));
        try {
            for (const dir of ['tools', 'public-bot', 'current', 'out', 'engine/public']) {
                mkdirSync(join(root, dir), { recursive: true });
            }
            for (const file of ['tools/pack-rs2b0t.sh', 'public-bot/bot.html', 'public-bot/multibox.html']) {
                copyFileSync(join(import.meta.dir, '../..', file), join(root, file));
            }
            for (const file of artifacts) {
                if (outDir) writeFileSync(join(root, 'out', file), `previous ${file}`);
                writeFileSync(join(root, 'current', file), `current ${file}`);
            }
            for (const file of ['collision.lcnav.gz', 'worldmap-basemap.manifest.json']) {
                writeFileSync(join(root, 'out', file), '');
            }
            writeFileSync(
                join(root, 'tools/bun'),
                `#!/bin/sh
set -e
[ "$*" = "run build:bot" ] || { echo "unexpected bun command: $*" >&2; exit 1; }
dir=\${B0T_OUT_DIR:-out}
mkdir -p "$dir"
cp current/* "$dir/"
`,
                { mode: 0o755 }
            );

            execFileSync('sh', ['tools/pack-rs2b0t.sh'], {
                cwd: root,
                env: { PATH: `${root}/tools:${process.env.PATH}`, ENGINE: join(root, 'engine'), PROD_RSAN: '1', B0T_OUT_DIR: outDir }
            });

            const staged = (file: string) => readFileSync(join(root, 'engine/public/rs2b0t', file), 'utf8');
            for (const file of artifacts) {
                expect(staged(`bot/${file}`)).toBe(`current ${file}`);
            }
            expect(staged('version.json')).toBe('current version.json');
            for (const page of ['index', 'bot', 'multibox']) {
                const bundle = page === 'multibox' ? 'multibox' : 'botclient';
                const hash = createHash('sha1')
                    .update(staged(`bot/${bundle}.js`))
                    .digest('hex')
                    .slice(0, 10);
                expect(staged(`${page}.html`).match(/src="(\.\/bot\/(?:botclient|multibox)\.js[^"]*)"/)?.[1]).toBe(`./bot/${bundle}.js?v=${hash}`);
            }
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
}
