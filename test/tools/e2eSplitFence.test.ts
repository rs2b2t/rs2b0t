import { describe, expect, test } from 'bun:test';
import { relative } from 'node:path';
import {
    bunTestNamesUnder,
    consumersOf,
    importsInto,
    mentionsAcross,
    misnamedUnder,
    playwrightUnder,
    readTree,
    walk
} from '../../tools/audit-e2e-split.js';

const paths = (dir: string): string[] => walk(dir).map(p => relative(process.cwd(), p));
const bothTrees = (): Map<string, string> => new Map([...readTree('tools'), ...readTree('e2e')]);

// Why: this module names the boundary it enforces, so its own literals are not violations.
const EXEMPT = new Set(['tools/audit-e2e-split.ts']);

describe('e2e/tools split', () => {
    test('no file under tools/ imports across into e2e/', () => {
        expect(importsInto('tools', 'e2e', readTree('tools'))).toEqual([]);
    });

    test('no file under tools/ reaches the harness ABI transitively', () => {
        const reaching = consumersOf('e2e/lib/harness.ts', bothTrees()).filter(f => f.startsWith('tools/'));
        expect(reaching).toEqual([]);
    });

    test('no file under tools/ names an e2e path in a string literal', () => {
        expect(mentionsAcross('tools', 'e2e', readTree('tools'), EXEMPT)).toEqual([]);
    });

    test('no file under tools/ drives a browser', () => {
        expect(playwrightUnder('tools', readTree('tools'))).toEqual([]);
    });

    test('no harness-suffixed file is left in tools/', () => {
        expect(misnamedUnder('tools', paths('tools'))).toEqual([]);
    });

    test('no file under e2e/ is auto-discovered by bun test', () => {
        expect(bunTestNamesUnder('e2e', paths('e2e'))).toEqual([]);
    });

    test('the harness fleet is non-empty', () => {
        const harnesses = paths('e2e').filter(f => f.endsWith('-test.ts') || f.endsWith('-live.ts'));
        expect(harnesses.length).toBeGreaterThan(50);
    });
});
