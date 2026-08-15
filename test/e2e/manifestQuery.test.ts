import { describe, expect, test } from 'bun:test';
import type { Case } from '../../e2e/manifestTypes.js';
import {
    casesForLevel,
    casesForLevelIncludingDocumented,
    casesForScript,
    casesForSubsystem,
    selectByChanges,
    validate
} from '../../e2e/manifestQuery.js';

const mk = (over: Partial<Case> & Pick<Case, 'id' | 'harness'>): Case => ({
    covers: { scripts: ['HillGiant'] },
    status: 'vetted',
    provenAt: 'abc1234',
    ...over
}) as Case;

describe('casesForScript', () => {
    test('finds every case naming the script', () => {
        const cases = [
            mk({ id: 'a', harness: 'hillgiant-test.ts' }),
            mk({ id: 'b', harness: 'hillgiant-bank-428-live.ts' }),
            mk({ id: 'c', harness: 'x-live.ts', covers: { scripts: ['MossGiant'] } })
        ];
        expect(casesForScript(cases, 'HillGiant').map(c => c.id)).toEqual(['a', 'b']);
    });
});

describe('casesForSubsystem', () => {
    test('finds cases by subsystem', () => {
        const cases = [
            mk({ id: 'n', harness: 'nav-stress-live.ts', covers: { subsystems: ['nav'] } }),
            mk({ id: 'h', harness: 'hillgiant-test.ts' })
        ];
        expect(casesForSubsystem(cases, 'nav').map(c => c.id)).toEqual(['n']);
    });
});

describe('casesForLevel', () => {
    const cases = [
        mk({ id: 'v', harness: 'a-test.ts' }),
        mk({ id: 'u', harness: 'b-test.ts', status: 'unvetted', provenAt: undefined }),
        mk({ id: 'x', harness: 'c-test.ts', status: 'broken', provenAt: undefined }),
        mk({ id: 'm', harness: 'd-test.ts', manual: true })
    ];

    test('quick runs vetted only', () => {
        expect(casesForLevel(cases, 'quick').map(c => c.id)).toEqual(['v']);
    });

    test('full adds unvetted but never broken', () => {
        expect(casesForLevel(cases, 'full').map(c => c.id)).toEqual(['v', 'u']);
    });

    test('manual cases are in no level', () => {
        for (const level of ['quick', 'smart', 'full'] as const) {
            expect(casesForLevel(cases, level).some(c => c.id === 'm')).toBe(false);
        }
    });
});

describe('selectByChanges', () => {
    const cases = [
        mk({ id: 'hg', harness: 'hillgiant-test.ts' }),
        mk({ id: 'nav', harness: 'nav-stress-live.ts', covers: { subsystems: ['nav'] } }),
        mk({ id: 'moss', harness: 'mossgiant-dart-test.ts', covers: { scripts: ['MossGiant'] } })
    ];

    test('a script change selects cases covering that script', () => {
        const got = selectByChanges(cases, ['src/bot/scripts/HillGiant/HillGiant.ts']);
        expect(got.cases.map(c => c.id)).toEqual(['hg']);
    });

    test('a webwalk change selects nav cases', () => {
        const got = selectByChanges(cases, ['src/bot/event/webwalk/DirectNavigator.ts']);
        expect(got.cases.map(c => c.id)).toEqual(['nav']);
    });

    test('shared runtime code selects everything', () => {
        const got = selectByChanges(cases, ['src/bot/runtime/BotHost.ts']);
        expect(got.cases).toHaveLength(3);
    });

    test('no changes selects nothing', () => {
        expect(selectByChanges(cases, []).cases).toEqual([]);
    });

    test('a broken case is never selected by a change', () => {
        const withBroken = [...cases, mk({ id: 'bad', harness: 'e-live.ts', status: 'broken', provenAt: undefined })];
        expect(selectByChanges(withBroken, ['src/bot/runtime/BotHost.ts']).cases.some(c => c.id === 'bad')).toBe(false);
    });
});

describe('validate', () => {
    const files = ['hillgiant-test.ts'];
    const dirs = ['HillGiant'];

    test('accepts a clean manifest', () => {
        expect(validate([mk({ id: 'a', harness: 'hillgiant-test.ts' })], files, dirs)).toEqual([]);
    });

    test('rejects a duplicate id', () => {
        const cases = [mk({ id: 'a', harness: 'hillgiant-test.ts' }), mk({ id: 'a', harness: 'hillgiant-test.ts' })];
        expect(validate(cases, files, dirs)).toContain('duplicate case id: a');
    });

    test('rejects a harness that does not exist', () => {
        const cases = [mk({ id: 'a', harness: 'ghost-test.ts' })];
        expect(validate(cases, files, dirs)).toContain('a: no such harness: ghost-test.ts');
    });

    test('rejects a script that does not exist', () => {
        const cases = [mk({ id: 'a', harness: 'hillgiant-test.ts', covers: { scripts: ['Ghost' as never] } })];
        expect(validate(cases, files, dirs)).toContain('a: no such script: Ghost');
    });

    test('rejects a case covering nothing', () => {
        const cases = [mk({ id: 'a', harness: 'hillgiant-test.ts', covers: {} })];
        expect(validate(cases, files, dirs)).toContain('a: covers no script or subsystem');
    });

    test('rejects a vetted case with no provenAt', () => {
        const cases = [mk({ id: 'a', harness: 'hillgiant-test.ts', provenAt: undefined })];
        expect(validate(cases, files, dirs)).toContain('a: vetted but carries no provenAt');
    });

    test('rejects a documented case with no documentedIn', () => {
        const cases = [mk({ id: 'a', harness: 'hillgiant-test.ts', status: 'documented', provenAt: undefined })];
        expect(validate(cases, files, dirs)).toContain('a: documented but carries no documentedIn');
    });

    test('a documented case needs no provenAt', () => {
        const cases = [mk({
            id: 'a', harness: 'hillgiant-test.ts', status: 'documented',
            provenAt: undefined, documentedIn: 'docs/TESTING.md'
        })];
        expect(validate(cases, files, dirs)).toEqual([]);
    });

    test('rejects a harness file no case names', () => {
        const cases = [mk({ id: 'a', harness: 'hillgiant-test.ts' })];
        expect(validate(cases, [...files, 'orphan-live.ts'], dirs))
            .toContain('no case names harness: orphan-live.ts');
    });
});

describe('casesForLevel with documented', () => {
    const cases = [
        mk({ id: 'v', harness: 'a-test.ts' }),
        mk({ id: 'd', harness: 'b-test.ts', status: 'documented', provenAt: undefined, documentedIn: 'docs/TESTING.md' }),
        mk({ id: 'u', harness: 'c-test.ts', status: 'unvetted', provenAt: undefined })
    ];

    test('quick runs vetted only, never documented', () => {
        expect(casesForLevel(cases, 'quick').map(c => c.id)).toEqual(['v']);
    });

    test('full runs vetted, documented and unvetted', () => {
        expect(casesForLevel(cases, 'full').map(c => c.id)).toEqual(['v', 'd', 'u']);
    });

    test('casesForLevelIncludingDocumented drops unvetted', () => {
        expect(casesForLevelIncludingDocumented(cases).map(c => c.id)).toEqual(['v', 'd']);
    });
});
