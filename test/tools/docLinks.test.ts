import { describe, expect, test } from 'bun:test';
import { extractLinks, extractPointers, extractRepoPaths, headingAnchors, resolveRelative, slugify, stripFences } from '../../tools/lib/docLinks.js';

describe('slugify', () => {
    test('lowercases and hyphenates', () => {
        expect(slugify('Bot base classes')).toBe('bot-base-classes');
    });
    test('drops punctuation, leaving the doubled hyphen GitHub produces', () => {
        expect(slugify('Entities & queries')).toBe('entities--queries');
    });
    test('strips backticks and trailing punctuation', () => {
        expect(slugify('`Execution` — the only legal way to sleep')).toBe('execution--the-only-legal-way-to-sleep');
    });
});

describe('headingAnchors', () => {
    test('collects every heading level', () => {
        expect(headingAnchors('# One\n\ntext\n\n### Two words\n')).toEqual(['one', 'two-words']);
    });
    test('suffixes duplicates the way GitHub does', () => {
        expect(headingAnchors('## Doors\n## Doors\n## Doors\n')).toEqual(['doors', 'doors-1', 'doors-2']);
    });
    test('ignores headings inside fenced code', () => {
        expect(headingAnchors('## Real\n\n```sh\n# Not a heading\n```\n')).toEqual(['real']);
    });
});

describe('stripFences', () => {
    test('blanks fenced regions but keeps line numbering', () => {
        expect(stripFences('a\n```\nb\n```\nc').split('\n')).toEqual(['a', '', '', '', 'c']);
    });
});

describe('extractLinks', () => {
    test('finds relative links with their line numbers', () => {
        expect(extractLinks('intro\n[api](API.md#bank)\n')).toEqual([{ href: 'API.md#bank', line: 2 }]);
    });
    test('skips absolute URLs', () => {
        expect(extractLinks('[site](https://2004bot.com)')).toEqual([]);
    });
    test('skips links inside fenced code', () => {
        expect(extractLinks('```md\n[x](Y.md)\n```\n')).toEqual([]);
    });
});

describe('extractRepoPaths', () => {
    test('finds backticked repo paths', () => {
        expect(extractRepoPaths('see `src/bot/nav/PathFinder.ts` now').map(p => p.path)).toEqual(['src/bot/nav/PathFinder.ts']);
    });
    test('tolerates a trailing slash on directories', () => {
        expect(extractRepoPaths('`src/bot/scripts/`').map(p => p.path)).toEqual(['src/bot/scripts']);
    });
    test('ignores globs and prose', () => {
        expect(extractRepoPaths('`tools/*-test.ts` and `bun run smoke`')).toEqual([]);
    });
    test('ignores paths outside the tracked roots', () => {
        expect(extractRepoPaths('`node_modules/foo/bar.js`')).toEqual([]);
    });
});

describe('extractPointers', () => {
    test('reads page and anchor out of a comment', () => {
        expect(extractPointers('const CORRIDOR = 3; // docs/NAV.md#corridor-snap')).toEqual([{ page: 'docs/NAV.md', anchor: 'corridor-snap', line: 1 }]);
    });
    test('anchor is optional', () => {
        expect(extractPointers('// docs/DEV.md')).toEqual([{ page: 'docs/DEV.md', anchor: null, line: 1 }]);
    });
});

describe('resolveRelative', () => {
    test('resolves against the referring doc directory', () => {
        expect(resolveRelative('docs/NAV.md', '../src/bot/nav/PathFinder.ts')).toBe('src/bot/nav/PathFinder.ts');
    });
    test('a bare anchor refers to the referring doc itself', () => {
        expect(resolveRelative('docs/API.md', '#bank')).toBe('docs/API.md');
    });
    test('resolves a sibling page', () => {
        expect(resolveRelative('docs/API.md', 'NAV.md#doors')).toBe('docs/NAV.md');
    });
});
