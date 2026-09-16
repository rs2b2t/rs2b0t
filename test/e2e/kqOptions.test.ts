import { expect, test } from 'bun:test';
import { kqOptions } from '../../e2e/lib/kqOptions.js';

test('trip counts do not get parsed as a minute timeout', () => {
    expect(kqOptions(['--minutes', '60', '--trips', '10'])).toMatchObject({ minutes: 60, trips: 10 });
    expect(kqOptions(['--trips', '20', '--minutes', '120'])).toMatchObject({ minutes: 120, trips: 20 });
});

test('the default is a ten-trip hour-long soak', () => {
    expect(kqOptions([])).toMatchObject({ minutes: 60, trips: 10, level: 99, base: 'http://localhost:8890' });
});

test('level fixtures preserve the trip count and timeout in either flag order', () => {
    expect(kqOptions(['--minutes', '60', '--level', '70', '--trips', '10'])).toMatchObject({ minutes: 60, trips: 10, level: 70 });
    expect(kqOptions(['--level', '85', '--trips', '12', '--minutes', '45'])).toMatchObject({ minutes: 45, trips: 12, level: 85 });
});

test('unsupported fixture levels fail before opening clients', () => {
    for (const value of [undefined, 'NaN', '69', '100', '70.5']) {
        expect(() => kqOptions(value === undefined ? ['--level'] : ['--level', value])).toThrow('--level');
    }
});

test('invalid soak bounds fail before opening clients', () => {
    for (const argv of [['--trips'], ['--trips', 'NaN'], ['--trips', '1'], ['--trips', '2.5'], ['--minutes', '0']]) {
        expect(() => kqOptions(argv)).toThrow();
    }
});
