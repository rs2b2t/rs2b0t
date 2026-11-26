import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { browserBundleArtifacts, browserBundles } from '../fixtures/browser-bundles.js';

const artifacts = [...browserBundleArtifacts, 'tinymidipcm.wasm', 'version.json'];

const repo = join(import.meta.dir, '../..');

function setupPackager(root: string) {
    for (const dir of ['tools', 'public-bot', 'out', 'engine/public']) {
        mkdirSync(join(root, dir), { recursive: true });
    }
    for (const file of ['tools/pack-rs2b0t.sh', 'public-bot/bot.html', 'public-bot/multibox.html']) {
        copyFileSync(join(repo, file), join(root, file));
    }
    for (const file of ['collision.lcnav.gz', 'worldmap-basemap.manifest.json']) {
        writeFileSync(join(root, 'out', file), '');
    }
}

function pack(root: string, outDir?: string) {
    execFileSync('sh', ['tools/pack-rs2b0t.sh'], {
        cwd: root,
        stdio: 'pipe',
        env: {
            PATH: `${root}/tools:${dirname(process.execPath)}:${process.env.PATH}`,
            ENGINE: join(root, 'engine'),
            PROD_RSAN: '1',
            RS2B0T_GIT_COMMIT: 'abcdef0',
            B0T_OUT_DIR: outDir
        }
    });
}

for (const outDir of [undefined, 'alt']) {
    test(`packager stages the current bot build with B0T_OUT_DIR ${outDir ?? 'unset'}`, () => {
        const root = mkdtempSync(join(tmpdir(), 'pack-bot-'));
        try {
            setupPackager(root);
            mkdirSync(join(root, 'current'));
            for (const file of artifacts) {
                if (outDir) writeFileSync(join(root, 'out', file), `previous ${file}`);
                writeFileSync(join(root, 'current', file), `current ${file}`);
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

            pack(root, outDir);

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

const workers = {
    ondemandworker: browserBundles['ondemandworker.js'],
    navworker: browserBundles['navworker.js']
};

for (const [changed, entry] of Object.entries(workers)) {
    test(`packaged client loads new ${changed} bytes after a worker-only change`, async () => {
        const root = mkdtempSync(join(tmpdir(), 'pack-workers-'));
        try {
            setupPackager(root);
            symlinkSync(join(repo, 'bot.bundle.ts'), join(root, 'bot.bundle.ts'));
            await Bun.write(join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { 'build:bot': 'bun --no-install bot.bundle.ts' } }));
            await Bun.write(join(root, 'src/client/3rdparty/tinymidipcm/tinymidipcm.wasm'), '');
            await Bun.write(join(root, browserBundles['multibox.js']), '');
            await Bun.write(
                join(root, browserBundles['botclient.js']),
                `
                import OnDemand from ${JSON.stringify(join(repo, 'src/client/io/OnDemand.ts'))};
                import { NavWorkerClient } from ${JSON.stringify(join(repo, 'src/bot/event/webwalk/NavWorkerClient.ts'))};
                globalThis.Worker = class {
                    constructor(url) { console.log(url.href); }
                    postMessage() {}
                };
                globalThis.fetch = async () => new Response();
                new OnDemand({ read: () => new Uint8Array() }, { ingame: false });
                new NavWorkerClient().start();
            `
            );
            for (const [name, path] of Object.entries(workers)) {
                await Bun.write(join(root, path), `postMessage("${name} revision 1");`);
            }

            const page = pathToFileURL(join(realpathSync(root), 'engine/public/rs2b0t/bot.html'));
            const cache = new Map<string, string>();
            const release = () => {
                pack(root);
                const src = readFileSync(page, 'utf8').match(/src="([^"]*botclient\.js[^"]*)"/)![1];
                const client = new URL(src, page);
                const output = execFileSync('node', ['--input-type=module', '-e', 'await import(process.argv[1])', client.href], { cwd: root, env: { PATH: process.env.PATH }, stdio: 'pipe', encoding: 'utf8' });
                const urls = output
                    .trim()
                    .split('\n')
                    .map(href => new URL(href));
                const requests = Object.fromEntries(
                    Object.keys(workers).map(name => {
                        const url = urls.find(request => request.pathname === new URL(`bot/${name}.js`, page).pathname);
                        if (!url) throw new Error(`Missing ${name} request in ${output}`);
                        if (!cache.has(url.href)) cache.set(url.href, readFileSync(url, 'utf8'));
                        return [name, { url: url.href, bytes: cache.get(url.href)! }] as const;
                    })
                );
                return { client: client.href, requests };
            };

            const first = release();
            expect(first.requests[changed].bytes).toContain(`${changed} revision 1`);
            await Bun.write(join(root, entry), `postMessage("${changed} revision 2");`);
            const second = release();
            expect(second.requests[changed].bytes).toContain(`${changed} revision 2`);
            expect(second.requests[changed].url).not.toBe(first.requests[changed].url);
            const sibling = changed === 'navworker' ? 'ondemandworker' : 'navworker';
            expect(second.requests[sibling]).toEqual(first.requests[sibling]);
            expect(second.client).not.toBe(first.client);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
}
