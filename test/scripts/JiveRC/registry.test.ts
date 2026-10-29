import { expect, test } from 'bun:test';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import JiveRC from '#/bot/scripts/JiveRC/JiveRC.js';
import '#/bot/scripts/index.js';

test('saved NatureCrafter profiles resolve to JiveRC without a duplicate library entry', () => {
    const legacy = ScriptRegistry.get('NatureCrafter');
    expect(legacy).toBeDefined();
    expect(legacy).toBe(ScriptRegistry.get('JiveRC'));
    expect(legacy?.create()).toBeInstanceOf(JiveRC);
    expect(ScriptRegistry.list().filter(meta => ['NatureCrafter', 'JiveRC'].includes(meta.name)).map(meta => meta.name)).toEqual(['JiveRC']);
});
