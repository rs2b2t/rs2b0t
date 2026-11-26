import { expect, test } from 'bun:test';
import { parseQuestArgs } from '../../e2e/lib/questArgs.js';

const defaults = { base: 'localhost', user: 'test', stage: 0, until: 10, minutes: 60, tickMs: 300, deploy: true };

test('quest flags read the next token literally and keep the last value', () => {
    const args = parseQuestArgs(['--stage', '3', '--user', '--stage', '--stage', '6', '--no-deploy', '--until'], defaults);
    expect(args).toEqual({ ...defaults, user: '--stage', stage: 6, deploy: false });
    expect(parseQuestArgs(['--tick', 'invalid', '--minutes', ''], defaults)).toMatchObject({ tickMs: NaN, minutes: 0 });
});

test('unknown flags consume a value and optional quest fields stay absent', () => {
    expect(parseQuestArgs(['--unknown', '--no-deploy', '--food', 'Lobster', '--stats', '99', 'constructor', '--stage'], defaults)).toEqual(defaults);
    expect(parseQuestArgs(['--food', 'Shark', '--stats', '70'], { ...defaults, food: 'Lobster', stats: 10 }))
        .toMatchObject({ food: 'Shark', stats: 70 });
});

test('quest switches consume a single token and custom values are converted inline', () => {
    const options = {
        switches: { '--no-kit': { kit: false } },
        values: { '--items': (value: string) => ({ items: value.split(',').filter(Boolean) }) }
    };
    const args = parseQuestArgs(['--no-kit', '--items', 'a,,b', '--tick', '25', '--no-deploy'], { ...defaults, kit: true, items: [] as string[] }, options);
    expect(args).toMatchObject({ kit: false, items: ['a', 'b'], tickMs: 25, deploy: false });
});
