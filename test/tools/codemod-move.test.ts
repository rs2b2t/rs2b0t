import { describe, expect, test } from 'bun:test';
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
