import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { Glob } from 'bun';
import { extractLinks, extractPointers, extractRepoPaths, headingAnchors, resolveRelative } from '../../tools/lib/docLinks.js';

// these two hold example pointers as test fixtures, not live references
const FIXTURES = new Set(['test/tools/docLinks.test.ts', 'test/docs/links.test.ts']);

const DOCS = ['README.md', 'desktop/README.md', 'templates/script-template/README.md', ...[...new Glob('docs/*.md').scanSync('.')]].filter(existsSync).sort();
const SOURCES = [...new Glob('{src,tools,test,packages}/**/*.{ts,sh}').scanSync('.')].filter(f => !f.startsWith('src/3rdparty/') && !FIXTURES.has(f)).sort();

const anchorCache = new Map<string, string[]>();
function anchorsOf(page: string): string[] {
    let anchors = anchorCache.get(page);
    if (!anchors) {
        anchors = headingAnchors(readFileSync(page, 'utf8'));
        anchorCache.set(page, anchors);
    }
    return anchors;
}

describe('documentation links', () => {
    test('scans every manual page', () => {
        expect(DOCS.length).toBeGreaterThanOrEqual(4);
        expect(DOCS).toContain('README.md');
        expect(DOCS).toContain('docs/API.md');
    });

    test('every relative link resolves to a file that exists', () => {
        const broken: string[] = [];
        for (const doc of DOCS) {
            for (const { href, line } of extractLinks(readFileSync(doc, 'utf8'))) {
                const target = resolveRelative(doc, href);
                if (!existsSync(target)) broken.push(`${doc}:${line} -> ${href}`);
            }
        }
        expect(broken).toEqual([]);
    });

    test('every #anchor exists as a heading in its target page', () => {
        const broken: string[] = [];
        for (const doc of DOCS) {
            for (const { href, line } of extractLinks(readFileSync(doc, 'utf8'))) {
                const anchor = href.split('#')[1];
                if (!anchor) continue;
                const target = resolveRelative(doc, href);
                if (!target.endsWith('.md') || !existsSync(target)) continue;
                if (!anchorsOf(target).includes(anchor)) broken.push(`${doc}:${line} -> ${href}`);
            }
        }
        expect(broken).toEqual([]);
    });

    test('every backticked repo path cited in the docs exists', () => {
        const missing: string[] = [];
        for (const doc of DOCS) {
            const dir = doc.includes('/') ? doc.slice(0, doc.lastIndexOf('/')) : '';
            for (const { path, line } of extractRepoPaths(readFileSync(doc, 'utf8'))) {
                // a nested page may name a path relative to itself
                if (existsSync(path) || (dir !== '' && existsSync(`${dir}/${path}`))) continue;
                missing.push(`${doc}:${line} -> ${path}`);
            }
        }
        expect(missing).toEqual([]);
    });

    test('every page under docs/ is reachable from docs/README.md', () => {
        const index = 'docs/README.md';
        expect(existsSync(index)).toBe(true);
        const reachable = new Set<string>([index]);
        const queue = [index];
        while (queue.length > 0) {
            const doc = queue.shift()!;
            for (const { href } of extractLinks(readFileSync(doc, 'utf8'))) {
                const target = resolveRelative(doc, href);
                if (!target.startsWith('docs/') || !target.endsWith('.md') || reachable.has(target) || !existsSync(target)) continue;
                reachable.add(target);
                queue.push(target);
            }
        }
        const pages = [...new Glob('docs/*.md').scanSync('.')].sort();
        expect(pages.filter(page => !reachable.has(page))).toEqual([]);
    });

    test('every docs pointer in source resolves to a real page and anchor', () => {
        const dangling: string[] = [];
        for (const file of SOURCES) {
            for (const { page, anchor, line } of extractPointers(readFileSync(file, 'utf8'))) {
                if (!existsSync(page)) {
                    dangling.push(`${file}:${line} -> ${page}`);
                    continue;
                }
                if (anchor && !anchorsOf(page).includes(anchor)) dangling.push(`${file}:${line} -> ${page}#${anchor}`);
            }
        }
        expect(dangling).toEqual([]);
    });
});
