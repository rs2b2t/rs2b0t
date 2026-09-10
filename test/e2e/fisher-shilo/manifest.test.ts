import { expect, test } from 'bun:test';
import { CASES } from '../../../e2e/manifest.js';

test('registers full and limited Fisher scenarios under canonical GatheringBot coverage', () => {
    const cases = CASES.filter(entry => entry.harness === 'fisher-shilo-shopping-live.ts');
    expect(cases.map(entry => ({ id: entry.id, scripts: entry.covers.scripts, args: entry.args, status: entry.status }))).toEqual([
        { id: 'fisher-shilo-shopping-live', scripts: ['GatheringBot'], args: ['--scenario', 'all', '--minutes', '8'], status: 'unvetted' },
        { id: 'fisher-shilo-shopping-limited', scripts: ['GatheringBot'], args: ['--scenario', 'limited', '--minutes', '8'], status: 'unvetted' }
    ]);
    expect(cases[1]?.manual).toBe(true);
});
