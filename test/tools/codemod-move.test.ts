import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderSpec, resolveSpec, rewriteSource } from '../../tools/codemod-move.js';

const ROOT = process.cwd();
const abs = (p: string) => `${ROOT}/${p}`;
const KNOWN = new Set([
    abs('src/bot/api/core/Game.ts'),
    abs('src/bot/api/entities/index.ts'),
    abs('src/bot/event/webwalk/data/doors.json'),
    abs('src/bot/panel/WorldMapPicker.ts')
]);
const exists = (p: string) => KNOWN.has(p);

describe('move map validation', () => {
    let root: string;
    const importer = "import './b.js';";

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'codemod-move-'));
        for (const dir of ['src', 'test', 'tools']) {
            mkdirSync(join(root, dir));
        }
        writeFileSync(join(root, 'src/a.ts'), importer);
        writeFileSync(join(root, 'src/b.ts'), 'export {};');
        const git = '#!/bin/sh\necho "$@" >> git-calls\n[ "$1" = mv ] && [ ! -e "$3" ] && /bin/mv "$2" "$3"\n';
        writeFileSync(join(root, 'tools/git'), git, { mode: 0o755 });
    });

    afterEach(() => rmSync(root, { recursive: true, force: true }));

    function run(secondTarget: string, ...args: string[]) {
        writeFileSync(join(root, 'moves.json'), JSON.stringify({ 'src/a.ts': 'src/new/c.ts', 'src/b.ts': secondTarget }));
        return spawnSync(process.execPath, [abs('tools/codemod-move.ts'), 'moves.json', ...args], {
            cwd: root,
            env: { PATH: join(root, 'tools') },
            encoding: 'utf8'
        });
    }

    for (const args of [[], ['--dry']]) {
        test(`rejects normalized duplicate destinations before changes in ${args.length ? 'dry' : 'apply'} mode`, () => {
            const result = run('src/new/./c.ts', ...args);
            expect(existsSync(join(root, 'git-calls'))).toBe(false);
            expect(existsSync(join(root, 'src/new'))).toBe(false);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('src/new/c.ts');
            expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(importer);
            expect(readFileSync(join(root, 'src/b.ts'), 'utf8')).toBe('export {};');
        });
    }

    test('previews and applies two distinct destinations', () => {
        const preview = run('src/new/d.ts', '--dry');
        expect(preview.status).toBe(0);
        expect(preview.stdout).toContain('2 files move');
        expect(existsSync(join(root, 'src/new'))).toBe(false);

        expect(run('src/new/d.ts').status).toBe(0);
        expect(readFileSync(join(root, 'src/new/c.ts'), 'utf8')).toBe("import './d.js';");
        expect(readFileSync(join(root, 'src/new/d.ts'), 'utf8')).toBe('export {};');
        expect(existsSync(join(root, 'src/a.ts'))).toBe(false);
        expect(existsSync(join(root, 'src/b.ts'))).toBe(false);
    });
});

describe('resolveSpec', () => {
    test('resolves a relative .js specifier to its .ts source', () => {
        expect(resolveSpec(abs('src/bot/api/hud/Bank.ts'), '../core/Game.js', exists)).toBe(abs('src/bot/api/core/Game.ts'));
    });

    test('resolves a #/ alias specifier', () => {
        expect(resolveSpec(abs('test/api/x.test.ts'), '#/bot/api/core/Game.js', exists)).toBe(abs('src/bot/api/core/Game.ts'));
    });

    test('resolves an extensionless specifier', () => {
        expect(resolveSpec(abs('src/bot/panel/Overlay.ts'), './WorldMapPicker', exists)).toBe(abs('src/bot/panel/WorldMapPicker.ts'));
    });

    test('resolves a directory specifier to its index.ts', () => {
        expect(resolveSpec(abs('src/bot/api/hud/Bank.ts'), '../entities', exists)).toBe(abs('src/bot/api/entities/index.ts'));
    });

    test('passes .json through unchanged', () => {
        expect(resolveSpec(abs('src/bot/event/webwalk/Navigator.ts'), './data/doors.json', exists)).toBe(abs('src/bot/event/webwalk/data/doors.json'));
    });

    test('returns null for bare and 3rdparty specifiers', () => {
        expect(resolveSpec(abs('src/bot/api/core/Game.ts'), 'fflate', exists)).toBeNull();
        expect(resolveSpec(abs('src/bot/api/core/Game.ts'), '#3rdparty/x.js', exists)).toBeNull();
    });

    test('returns null for a specifier naming nothing on disk', () => {
        expect(resolveSpec(abs('src/bot/api/hud/Bank.ts'), './Nonexistent.js', exists)).toBeNull();
    });
});

describe('renderSpec', () => {
    test('renders a relative specifier with .js', () => {
        expect(renderSpec(abs('src/bot/api/bank/Bank.ts'), abs('src/bot/api/game/Game.ts'), '../core/Game.js')).toBe('../game/Game.js');
    });

    test('renders a sibling specifier with a leading ./', () => {
        expect(renderSpec(abs('src/bot/api/game/Bot.ts'), abs('src/bot/api/game/Game.ts'), './Game.js')).toBe('./Game.js');
    });

    test('preserves the #/ alias form', () => {
        expect(renderSpec(abs('test/api/x.test.ts'), abs('src/bot/api/game/Game.ts'), '#/bot/api/core/Game.js')).toBe('#/bot/api/game/Game.js');
    });

    test('preserves an extensionless original', () => {
        expect(renderSpec(abs('src/bot/panel/Overlay.ts'), abs('src/bot/panel/WorldMapPicker.ts'), './WorldMapPicker')).toBe('./WorldMapPicker');
    });

    test('keeps the .json extension', () => {
        expect(renderSpec(abs('src/bot/event/webwalk/Navigator.ts'), abs('src/bot/event/webwalk/data/doors.json'), './data/doors.json')).toBe('./data/doors.json');
    });
});

describe('rewriteSource', () => {
    const move = (p: string) => (p === abs('src/bot/api/core/Game.ts') ? abs('src/bot/api/game/Game.ts') : p);

    test('rewrites a static import when the target moves', () => {
        const out = rewriteSource("import { Game } from '../core/Game.js';", abs('src/bot/api/hud/Bank.ts'), abs('src/bot/api/hud/Bank.ts'), move, exists);
        expect(out).toBe("import { Game } from '../game/Game.js';");
    });

    test('recomputes the path when the importer moves and the target does not', () => {
        const out = rewriteSource(
            "import { E } from '../entities/index.js';",
            abs('src/bot/api/hud/Bank.ts'),
            abs('src/bot/api/bank/Bank.ts'),
            (p: string) => p,
            exists
        );
        expect(out).toBe("import { E } from '../entities/index.js';");
    });

    test('recomputes the path when the importer moves depth', () => {
        const out = rewriteSource(
            "import { Game } from '../core/Game.js';",
            abs('src/bot/api/hud/Bank.ts'),
            abs('src/bot/api/deep/nest/Bank.ts'),
            (p: string) => p,
            exists
        );
        expect(out).toBe("import { Game } from '../../core/Game.js';");
    });

    test('rewrites a dynamic import()', () => {
        const out = rewriteSource("await import('../core/Game.js');", abs('src/bot/api/hud/Bank.ts'), abs('src/bot/api/hud/Bank.ts'), move, exists);
        expect(out).toBe("await import('../game/Game.js');");
    });

    test('rewrites export ... from', () => {
        const out = rewriteSource("export { Game } from '../core/Game.js';", abs('src/bot/api/hud/Bank.ts'), abs('src/bot/api/hud/Bank.ts'), move, exists);
        expect(out).toBe("export { Game } from '../game/Game.js';");
    });

    test('leaves bare specifiers alone', () => {
        const src = "import { unzip } from 'fflate';";
        expect(rewriteSource(src, abs('src/bot/api/hud/Bank.ts'), abs('src/bot/api/hud/Bank.ts'), move, exists)).toBe(src);
    });
});
