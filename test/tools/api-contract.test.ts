import { describe, expect, test } from 'bun:test';
import { allowlist, checkContract, compare, declaredSurface, packageExports, publicationDrifts, report, runtimeSurface } from '../../tools/api-contract.js';
import type { Member, Surface } from '../../tools/api-contract.js';

function members(names: string[], optional: string[] = []): Map<string, Member> {
    return new Map(names.map(n => [n, { type: 'x', optional: optional.includes(n) }]));
}

describe('compare', () => {
    test('flags runtime members the declaration lacks, with the runtime type', () => {
        const runtime: Surface = new Map([['Game', new Map([['ingame', { type: '() => boolean', optional: false }], ['sceneReady', { type: '() => boolean', optional: false }]])]]);
        const declared: Surface = new Map([['Game', members(['ingame'])]]);
        expect(compare(runtime, declared, ['Game'])).toEqual([{ kind: 'undeclared-member', export: 'Game', member: 'sceneReady', signature: '() => boolean' }]);
    });

    test('flags declared members the runtime lacks unless the declaration marks them optional', () => {
        const runtime: Surface = new Map([['Bank', members(['open'])]]);
        const declared: Surface = new Map([['Bank', members(['open', 'gone', 'maybe'], ['maybe'])]]);
        expect(compare(runtime, declared, ['Bank'])).toEqual([{ kind: 'phantom-member', export: 'Bank', member: 'gone' }]);
    });

    test('flags an index.js name that one side lacks', () => {
        const runtime: Surface = new Map([['Game', members(['ingame'])]]);
        const declared: Surface = new Map([['Tile', members(['x'])]]);
        expect(compare(runtime, declared, ['Game', 'Tile'])).toEqual([
            { kind: 'undeclared-export', export: 'Game' },
            { kind: 'missing-at-runtime', export: 'Tile' }
        ]);
    });

    test('flags a declared value export index.js does not re-export', () => {
        const runtime: Surface = new Map([['Game', members(['ingame'])], ['NAV', null]]);
        const declared: Surface = new Map([['Game', members(['ingame'])], ['NAV', null]]);
        expect(compare(runtime, declared, ['Game'])).toEqual([{ kind: 'phantom-export', export: 'NAV' }]);
    });

    test('memberless exports compare by presence only', () => {
        const runtime: Surface = new Map([['held', null], ['apiVersion', null]]);
        const declared: Surface = new Map([['held', null], ['apiVersion', null]]);
        expect(compare(runtime, declared, ['held', 'apiVersion'])).toEqual([]);
    });

    test('the allowlist silences the drifts it names', () => {
        const runtime: Surface = new Map([['Game', members(['ingame', 'secret'])]]);
        const declared: Surface = new Map([['Game', members(['ingame'])], ['Extra', null]]);
        expect(compare(runtime, declared, ['Game'], new Set(['Game.secret', 'Extra']))).toEqual([]);
    });
});

test('publication ledger pins the roots and exact runtime member sets', () => {
    expect(publicationDrifts(runtimeSurface(), packageExports())).toEqual([]);
});

test('publication ledger rejects missing roots and changed member sets', () => {
    const runtime = new Map(runtimeSurface());
    const prayer = runtime.get('Prayer');
    if (!(prayer instanceof Map)) throw new Error('Prayer runtime surface is not an object');
    const changedPrayer = new Map(prayer);
    changedPrayer.delete('points');
    changedPrayer.set('unexpected', { type: '() => void', optional: false });
    runtime.set('Prayer', changedPrayer);

    expect(
        publicationDrifts(
            runtime,
            packageExports().filter(name => name !== 'SettingsStore')
        )
    ).toEqual([
        { kind: 'missing-published-member', export: 'Prayer', member: 'points' },
        { kind: 'unexpected-published-member', export: 'Prayer', member: 'unexpected' },
        { kind: 'missing-published-export', export: 'SettingsStore' }
    ]);
});

test('contract check keeps the published roots required', () => {
    expect(checkContract(new Map(), new Map(), [])).toEqual([
        { kind: 'missing-published-export', export: 'Prayer' },
        { kind: 'missing-published-export', export: 'Reachability' },
        { kind: 'missing-published-export', export: 'SettingsStore' }
    ]);
});

test('packageExports reads the destructured names and drops comments', () => {
    expect(packageExports('export const {\n    apiVersion,\n    // Tools\n    Game, Tile\n} = abi;')).toEqual(['apiVersion', 'Game', 'Tile']);
});

test('report is one line per drift', () => {
    const text = report([
        { kind: 'undeclared-member', export: 'Game', member: 'sceneReady', signature: '() => boolean' },
        { kind: 'phantom-export', export: 'NAV' }
    ]);
    expect(text).toBe('api-contract: 2 drift(s)\n  undeclared-member   Game.sceneReady: () => boolean\n  phantom-export      NAV');
    expect(report([])).toBe('api-contract: index.d.ts matches every index.js export; published roots and members are intact');
});

test('index.d.ts matches the runtime ABI over every index.js export', () => {
    const drifts = checkContract(runtimeSurface(), declaredSurface(), packageExports(), allowlist());
    expect(report(drifts)).toBe('api-contract: index.d.ts matches every index.js export; published roots and members are intact');
}, 120_000);
