import { describe, expect, test } from 'bun:test';
import { readdirSync, statSync } from 'node:fs';
import { CASES } from '../../e2e/manifest.js';
import { validate } from '../../e2e/manifestQuery.js';
import { SCRIPT_NAMES } from '../../e2e/manifestTypes.js';

/** Suffixed harness files the suite owns: top-level plus one level of subdirectory. */
function harnessFiles(): string[] {
    const out: string[] = [];
    for (const name of readdirSync('e2e')) {
        if (statSync(`e2e/${name}`).isDirectory()) {
            if (name === 'lib' || name === 'tutorial') {
                continue;
            }
            for (const inner of readdirSync(`e2e/${name}`)) {
                if (inner.endsWith('-test.ts') || inner.endsWith('-live.ts')) {
                    out.push(`${name}/${inner}`);
                }
            }
        } else if (name.endsWith('-test.ts') || name.endsWith('-live.ts')) {
            out.push(name);
        }
    }
    return out.sort();
}

const scriptDirs = (): string[] =>
    readdirSync('src/bot/scripts').filter(n => statSync(`src/bot/scripts/${n}`).isDirectory()).sort();

describe('manifest', () => {
    test('agrees with the tree', () => {
        expect(validate(CASES, harnessFiles(), scriptDirs())).toEqual([]);
    });

    test('covers every suffixed harness', () => {
        const named = new Set(CASES.map(c => c.harness));
        expect(harnessFiles().filter(f => !named.has(f))).toEqual([]);
    });

    test('SCRIPT_NAMES matches the registry in both directions', () => {
        // Why: comparing the runtime array against the directories catches a script added to src/
        // Why: with no union entry, and a union entry whose directory was deleted.
        expect(([...SCRIPT_NAMES] as string[]).sort()).toEqual(scriptDirs());
    });

    test('every case id is unique', () => {
        expect(new Set(CASES.map(c => c.id)).size).toBe(CASES.length);
    });
});
