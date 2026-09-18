import { expect, test } from 'bun:test';
import { options } from '../../../e2e/fisher-shilo/options.js';

test('rejects a remote engine before setup', () => {
    expect(() => options(['--base', 'http://rs2b2t.com'])).toThrow('local');
});
test('keeps speed unchanged by default', () => {
    expect(options(['--base', 'http://localhost:8888']).tick200).toBe(false);
});
test('accepts an explicit 200ms assertion without deploying', () => {
    const result = options(['--base', 'http://localhost:8888', '--tick200', '--no-deploy', '--scenario', 'limited']);
    expect([result.tick200, result.deploy, result.scenario]).toEqual([true, false, 'limited']);
});
test('rejects invalid fixture names', () => {
    expect(() => options(['--scenario', 'fake'])).toThrow('scenario');
});
test('rejects unbounded scenario budgets', () => {
    expect(() => options(['--minutes', 'Infinity'])).toThrow('positive');
});
test('accepts explicitly authorized world speed configuration', () => {
    expect(options(['--base', 'http://localhost:8890', '--set-tick200'])).toMatchObject({ setTick200: true });
});
