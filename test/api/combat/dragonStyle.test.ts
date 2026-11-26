import { expect, test } from 'bun:test';
import { dragonMeleeStyle } from '#/bot/api/combat/dragonStyle.js';

for (const name of ['Green dragon', 'Blue dragon', 'Baby blue dragon', 'Baby red dragon', 'Iron dragon', 'Steel dragon']) {
    test(`Dragon longsword uses controlled against ${name}`, () => {
        expect(dragonMeleeStyle('strength', 'Dragon longsword', [name])).toBe('controlled');
    });
}

test('normalizes equipment and target names', () => {
    expect(dragonMeleeStyle('attack', ' DRAGON LONGSWORD ', [' baby blue DRAGON '])).toBe('controlled');
});

test('other weapons preserve the requested training style', () => {
    for (const weapon of ['Dragon dagger', 'Rune longsword', '', null, undefined]) {
        expect(dragonMeleeStyle('defence', weapon, ['Blue dragon'])).toBe('defence');
    }
});

test('mixed and empty target sets preserve the requested style until a victim is selected', () => {
    for (const targets of [[], ['Greater demon'], ['Blue dragon', 'Greater demon'], ['Dragon hunter']]) {
        expect(dragonMeleeStyle('attack', 'Dragon longsword', targets)).toBe('attack');
    }
});

test('actual target takes precedence over configured targets', () => {
    expect(dragonMeleeStyle('strength', 'Dragon longsword', ['Blue dragon', 'Greater demon'], 'Blue dragon')).toBe('controlled');
    expect(dragonMeleeStyle('strength', 'Dragon longsword', ['Blue dragon'], 'Greater demon')).toBe('strength');
    expect(dragonMeleeStyle('defence', 'Dragon longsword', ['Greater demon'], 'Baby blue dragon')).toBe('controlled');
});
