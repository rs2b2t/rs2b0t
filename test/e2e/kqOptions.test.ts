import { expect, test } from 'bun:test';
import { kqOptions } from '../../e2e/lib/kqOptions.js';

test('trip counts do not get parsed as a minute timeout', () => {
    expect(kqOptions(['--minutes', '60', '--trips', '10'])).toMatchObject({ minutes: 60, trips: 10 });
    expect(kqOptions(['--trips', '20', '--minutes', '120'])).toMatchObject({ minutes: 120, trips: 20 });
});

test('the default is a ten-trip hour-long soak', () => {
    expect(kqOptions([])).toMatchObject({ minutes: 60, trips: 10, base: 'http://localhost:8890' });
});

test('invalid soak bounds fail before opening clients', () => {
    for (const argv of [['--trips'], ['--trips', 'NaN'], ['--trips', '1'], ['--trips', '2.5'], ['--minutes', '0']]) {
        expect(() => kqOptions(argv)).toThrow();
    }
});
