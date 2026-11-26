import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bundles = {
    'botclient.js': 'src/bot/main.ts',
    'multibox.js': 'src/bot/multibox/main.ts',
    'ondemandworker.js': 'src/client/io/OnDemandWorker.ts',
    'navworker.js': 'src/bot/event/webwalk/NavWorker.ts'
};

for (const mode of ['dev', 'prod']) {
    test(`${mode} bot bundles link to their sibling source maps`, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bot-bundle-'));
        try {
            for (const entry of Object.values(bundles)) {
                await Bun.write(join(dir, entry), `export const entry: string = '${entry}';\n`);
            }
            await Bun.write(join(dir, 'src/client/3rdparty/tinymidipcm/tinymidipcm.wasm'), '');
            const script = join(import.meta.dir, '../../bot.bundle.ts');
            execFileSync(process.execPath, mode === 'dev' ? [script, 'dev'] : [script], {
                cwd: dir,
                env: { RS2B0T_GIT_COMMIT: 'abcdef0' }
            });

            for (const [output, entry] of Object.entries(bundles)) {
                const js = await Bun.file(join(dir, 'out', output)).text();
                const links = Array.from(js.matchAll(/^\/\/# sourceMappingURL=(.*)$/gm), match => match[1]);
                expect(links).toEqual([`${output}.map`]);
                const map = await Bun.file(join(dir, 'out', links[0])).json();
                expect(map.version).toBe(3);
                expect(map.sourcesContent).toContain(await Bun.file(join(dir, entry)).text());
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
}
