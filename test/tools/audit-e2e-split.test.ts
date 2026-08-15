import { describe, expect, test } from 'bun:test';
import {
    bunTestNamesUnder,
    consumersOf,
    importsInto,
    liveClosure,
    mentionsAcross,
    misnamedUnder,
    playwrightUnder,
    resolveSpec
} from '../../tools/audit-e2e-split.js';

// Why: these fixtures are synthetic path strings rather than a picture of the tree, and they model
// the pre-move layout deliberately — that is the shape the closure was written to resolve.

describe('resolveSpec', () => {
    test('resolves a sibling .js specifier to its .ts path', () => {
        expect(resolveSpec('tools/hillgiant-test.ts', './lib/harness.js')).toBe('tools/lib/harness.ts');
    });

    test('resolves a parent-relative specifier', () => {
        expect(resolveSpec('tools/clues/hardclue-e2e.ts', '../lib/harness.js')).toBe('tools/lib/harness.ts');
    });

    test('ignores a bare specifier', () => {
        expect(resolveSpec('tools/x.ts', 'playwright-core')).toBeNull();
    });

    test('ignores an aliased specifier', () => {
        expect(resolveSpec('tools/x.ts', '#/client/io/Packet.js')).toBeNull();
    });

    test('resolves an extensionless specifier to its .ts path', () => {
        expect(resolveSpec('tools/x.ts', '../e2e/lib/harness')).toBe('e2e/lib/harness.ts');
    });

    test('ignores a specifier naming a non-TypeScript extension', () => {
        expect(resolveSpec('tools/x.ts', './routes.json')).toBeNull();
    });
});

describe('liveClosure', () => {
    const entry = 'tools/lib/harness.ts';

    test('moves a direct consumer and the entry itself', () => {
        const sources = new Map([
            [entry, ''],
            ['tools/hillgiant-test.ts', "import { boot } from './lib/harness.js';"],
            ['tools/gen-itemdb.ts', "import { parse } from './items/parse.js';"],
            ['tools/items/parse.ts', '']
        ]);
        expect(liveClosure(entry, sources).move).toEqual(['tools/hillgiant-test.ts', entry]);
    });

    test('moves an ABI leaf imported by a consumer but importing nothing', () => {
        const sources = new Map([
            [entry, ''],
            ['tools/lib/harnessProof.ts', ''],
            ['tools/hillgiant-test.ts', "import { boot } from './lib/harness.js';\nimport { proof } from './lib/harnessProof.js';"]
        ]);
        expect(liveClosure(entry, sources).move).toEqual([
            'tools/hillgiant-test.ts',
            entry,
            'tools/lib/harnessProof.ts'
        ]);
    });

    test('moves a consumer reached transitively', () => {
        const sources = new Map([
            [entry, ''],
            ['tools/tutorial/harness.ts', "import { boot } from '../lib/harness.js';"],
            ['tools/gatheringbot-test.ts', "import { seed } from './tutorial/harness.js';"]
        ]);
        expect(liveClosure(entry, sources).move).toContain('tools/gatheringbot-test.ts');
    });

    test('holds back an ABI module an offline tool also imports', () => {
        const sources = new Map([
            [entry, ''],
            ['tools/nav-script-routes-live.ts', "import { boot } from './lib/harness.js';\nimport { build } from './nav/script-route-corpus.js';"],
            ['tools/nav/script-route-corpus.ts', ''],
            ['tools/nav/mainland-corpus.ts', "import { build } from './script-route-corpus.js';"]
        ]);
        const { move, heldBack } = liveClosure(entry, sources);
        expect(heldBack).toEqual(['tools/nav/script-route-corpus.ts']);
        expect(move).not.toContain('tools/nav/script-route-corpus.ts');
    });

    test('never leaves the source map, so product source is not swept in', () => {
        const sources = new Map([
            [entry, ''],
            ['tools/hillgiant-test.ts', "import { boot } from './lib/harness.js';\nimport { QUESTS } from '../src/bot/api/ai/quests/data/quests.js';"]
        ]);
        expect(liveClosure(entry, sources).move).toEqual(['tools/hillgiant-test.ts', entry]);
    });

    test('holds back an ABI module only a unit test consumes', () => {
        const sources = new Map([
            [entry, ''],
            ['tools/nav-script-travel-live.ts', "import { boot } from './lib/harness.js';\nimport { build } from './nav/script-travel-corpus.js';"],
            ['tools/nav/script-travel-corpus.ts', '']
        ]);
        const offlineTests = new Map([
            ['test/event/webwalk/script-travel-corpus.test.ts', "import { build } from '../../../tools/nav/script-travel-corpus.js';"]
        ]);
        const { move, heldBack } = liveClosure(entry, sources, offlineTests);
        expect(heldBack).toEqual(['tools/nav/script-travel-corpus.ts']);
        expect(move).not.toContain('tools/nav/script-travel-corpus.ts');
    });

    test('a unit test of a harness itself does not hold the harness back', () => {
        const sources = new Map([
            [entry, ''],
            ['tools/hillgiant-test.ts', "import { boot } from './lib/harness.js';"]
        ]);
        const offlineTests = new Map([
            ['test/tools/harness-args.test.ts', "import { parseArgs } from '../../tools/hillgiant-test.js';"]
        ]);
        expect(liveClosure(entry, sources, offlineTests).move).toContain('tools/hillgiant-test.ts');
    });

    test('reports an empty closure when the entry sits outside the scanned tree', () => {
        const sources = new Map([
            ['tools/gen-itemdb.ts', "import { parse } from './items/parse.js';"],
            ['tools/items/parse.ts', '']
        ]);
        expect(liveClosure('e2e/lib/harness.ts', sources).move).toEqual([]);
    });

    test('survives an import cycle', () => {
        const sources = new Map([
            [entry, ''],
            ['tools/a-live.ts', "import { b } from './b-live.js';\nimport { boot } from './lib/harness.js';"],
            ['tools/b-live.ts', "import { a } from './a-live.js';"]
        ]);
        expect(liveClosure(entry, sources).move).toContain('tools/a-live.ts');
    });

    test('picks up a dynamic import', () => {
        const sources = new Map([
            [entry, ''],
            ['tools/x-live.ts', "const m = await import('./lib/harness.js');"]
        ]);
        expect(liveClosure(entry, sources).move).toContain('tools/x-live.ts');
    });
});

describe('consumersOf', () => {
    test('names a file transitively importing the entry, never the entry ABI', () => {
        const sources = new Map([
            ['e2e/lib/harness.ts', ''],
            ['tools/bad.ts', "import { boot } from '../e2e/lib/harness.js';"],
            ['e2e/x-live.ts', "import { boot } from './lib/harness.js';\nimport { c } from '../tools/nav/corpus.js';"],
            ['tools/nav/corpus.ts', '']
        ]);
        expect(consumersOf('e2e/lib/harness.ts', sources).filter(f => f.startsWith('tools/')))
            .toEqual(['tools/bad.ts']);
    });
});

describe('importsInto', () => {
    test('flags a tools file importing across into e2e', () => {
        const sources = new Map([['tools/probe.ts', "import { boot } from '../e2e/lib/harness.js';"]]);
        expect(importsInto('tools', 'e2e', sources)).toEqual(['tools/probe.ts\t../e2e/lib/harness.js']);
    });

    test('flags a nested tools file reaching across', () => {
        const sources = new Map([['tools/nav/x.ts', "import { boot } from '../../e2e/lib/harness.js';"]]);
        expect(importsInto('tools', 'e2e', sources)).toEqual(['tools/nav/x.ts\t../../e2e/lib/harness.js']);
    });

    test('ignores imports that stay inside the prefix', () => {
        const sources = new Map([['tools/gen-itemdb.ts', "import { parse } from './items/parse.js';"]]);
        expect(importsInto('tools', 'e2e', sources)).toEqual([]);
    });

    test('ignores the permitted e2e to tools direction', () => {
        const sources = new Map([
            ['e2e/nav-script-routes-live.ts', "import { build } from '../tools/nav/script-route-corpus.js';"]
        ]);
        expect(importsInto('tools', 'e2e', sources)).toEqual([]);
    });

    test('catches a dynamic import across the boundary', () => {
        const sources = new Map([['tools/x.ts', "const m = await import('../e2e/lib/harness.js');"]]);
        expect(importsInto('tools', 'e2e', sources)).toEqual(['tools/x.ts\t../e2e/lib/harness.js']);
    });

    test('catches an extensionless import', () => {
        const sources = new Map([['tools/x.ts', "import { boot } from '../e2e/lib/harness';"]]);
        expect(importsInto('tools', 'e2e', sources)).toEqual(['tools/x.ts\t../e2e/lib/harness']);
    });

    test('catches a side-effect import carrying no from clause', () => {
        const sources = new Map([['tools/x.ts', "import '../e2e/lib/harness.js';"]]);
        expect(importsInto('tools', 'e2e', sources)).toEqual(['tools/x.ts\t../e2e/lib/harness.js']);
    });

    test('catches a require call', () => {
        const sources = new Map([['tools/x.ts', "const h = require('../e2e/lib/harness.js');"]]);
        expect(importsInto('tools', 'e2e', sources)).toEqual(['tools/x.ts\t../e2e/lib/harness.js']);
    });

    test('catches a re-export', () => {
        const sources = new Map([['tools/x.ts', "export { boot } from '../e2e/lib/harness.js';"]]);
        expect(importsInto('tools', 'e2e', sources)).toEqual(['tools/x.ts\t../e2e/lib/harness.js']);
    });

    test('catches an import of an e2e file other than the entry', () => {
        const sources = new Map([['tools/x.ts', "import { p } from '../e2e/lib/harnessProof.js';"]]);
        expect(importsInto('tools', 'e2e', sources)).toEqual(['tools/x.ts\t../e2e/lib/harnessProof.js']);
    });
});

describe('mentionsAcross', () => {
    test('catches a specifier assembled by concatenation', () => {
        const sources = new Map([['tools/x.ts', "const s = '../e2e/lib/' + 'harness.js';\nawait import(s);"]]);
        expect(mentionsAcross('tools', 'e2e', sources, new Set())).toEqual(['tools/x.ts\t../e2e/lib/']);
    });

    test('exempts a named file', () => {
        const sources = new Map([['tools/audit-e2e-split.ts', "const entry = 'e2e/lib/harness.ts';"]]);
        expect(mentionsAcross('tools', 'e2e', sources, new Set(['tools/audit-e2e-split.ts']))).toEqual([]);
    });

    test('ignores a bare directory name carrying no separator', () => {
        const sources = new Map([['tools/e2e.ts', "readdirSync('e2e');"]]);
        expect(mentionsAcross('tools', 'e2e', sources, new Set())).toEqual([]);
    });

    test('ignores prose naming an e2e command', () => {
        const sources = new Map([
            ['tools/nav/script-route-corpus.ts', "description: 'Live: HARD=1 bun e2e/nav-script-routes-live.ts'"]
        ]);
        expect(mentionsAcross('tools', 'e2e', sources, new Set())).toEqual([]);
    });
});

describe('playwrightUnder', () => {
    test('flags a file driving a browser outside the e2e tree', () => {
        const sources = new Map([
            ['tools/clues/live-clue-sweep.ts', "import { chromium } from 'playwright-core';"],
            ['tools/gen-itemdb.ts', "import { parse } from './items/parse.js';"]
        ]);
        expect(playwrightUnder('tools', sources)).toEqual(['tools/clues/live-clue-sweep.ts']);
    });

    test('does not flag a file naming playwright only in a symbol', () => {
        const sources = new Map([['tools/audit-e2e-split.ts', 'export function playwrightUnder() {}']]);
        expect(playwrightUnder('tools', sources)).toEqual([]);
    });
});

describe('misnamedUnder', () => {
    test('flags harness suffixes under the prefix', () => {
        expect(misnamedUnder('tools', ['tools/a-test.ts', 'tools/b-live.ts', 'tools/gen-x.ts', 'e2e/c-test.ts']))
            .toEqual(['tools/a-test.ts', 'tools/b-live.ts']);
    });
});

describe('bunTestNamesUnder', () => {
    test('flags names bun test would auto-discover', () => {
        expect(bunTestNamesUnder('e2e', ['e2e/a.test.ts', 'e2e/b_test.ts', 'e2e/c.spec.ts', 'e2e/d_spec.ts', 'e2e/e-test.ts']))
            .toEqual(['e2e/a.test.ts', 'e2e/b_test.ts', 'e2e/c.spec.ts', 'e2e/d_spec.ts']);
    });
});
