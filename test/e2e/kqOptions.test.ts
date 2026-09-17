import { expect, test } from 'bun:test';
import { kqOptions } from '../../e2e/lib/kqOptions.js';

test('trip counts do not get parsed as a minute timeout', () => {
    expect(kqOptions(['--minutes', '60', '--trips', '10'])).toMatchObject({ minutes: 60, trips: 10 });
    expect(kqOptions(['--trips', '20', '--minutes', '120'])).toMatchObject({ minutes: 120, trips: 20 });
});

test('the default is a ten-trip hour-long soak', () => {
    expect(kqOptions([])).toMatchObject({ minutes: 60, trips: 10, level: 99, recoveryProbe: false, base: 'http://localhost:8890' });
});

test('the recovery probe is an explicit mode independent of soak flags', () => {
    for (const argv of [['--recovery-probe', '--level', '70', '--minutes', '10'], ['--level', '70', '--minutes', '10', '--recovery-probe']]) {
        expect(kqOptions(argv)).toMatchObject({ recoveryProbe: true, level: 70, minutes: 10 });
    }
});

test('the public loot probe defaults to level 70 and fifteen minutes and keeps explicit bounds', () => {
    expect(kqOptions(['--loot-probe'])).toMatchObject({ lootProbe: true, recoveryProbe: false, level: 70, minutes: 15 });
    expect(kqOptions(['--level', '75', '--minutes', '20', '--loot-probe'])).toMatchObject({ lootProbe: true, level: 75, minutes: 20 });
    expect(kqOptions([])).toMatchObject({ lootProbe: false, level: 99, minutes: 60 });
});

test('loot fixtures cannot be combined with death or gate fixtures', () => {
    expect(() => kqOptions(['--loot-probe', '--recovery-probe'])).toThrow('loot');
    expect(() => kqOptions(['--gate-delay-probe', '--loot-probe'])).toThrow('loot');
});

test('the gate delay is an explicit optional fixture compatible with recovery mode', () => {
    expect(kqOptions([])).toMatchObject({ gateDelayProbe: false });
    expect(kqOptions(['--gate-delay-probe', '--recovery-probe', '--level', '70', '--minutes', '15'])).toMatchObject({ gateDelayProbe: true, recoveryProbe: true, level: 70, minutes: 15 });
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
