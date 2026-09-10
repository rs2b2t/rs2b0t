import { expect, test } from 'bun:test';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import '#/bot/scripts/index.js';

test('offers Fisher instead of a standalone Shilo script', () => {
    expect(['Fisher', 'JiveShilo'].filter(name => ScriptRegistry.get(name) !== undefined)).toEqual(['Fisher']);
});

test('exposes the compatible supply timer for Guild and Shilo camps', () => {
    const setting = ScriptRegistry.get('Fisher')?.settingsSchema?.guildFeatherMinutes;
    expect(setting?.type).toBe('number');
    expect(setting?.default).toBe(0);
    expect(setting?.showIf).toEqual({ key: 'location', anyOf: ['Fishing Guild', 'Shilo Village'] });
});
