import { expect, test } from 'bun:test';
import { boxKey, boxKeyTail, wallLinkHref } from '#/bot/runtime/box.js';

test('the standalone client links to the wall', () => {
    expect(wallLinkHref('')).toBe('./multibox.html');
});

test('a wall slot does not link to the wall it is already inside', () => {
    expect(wallLinkHref('someaccount')).toBeNull();
});


test('opening a wall preserves memory and resolves its identity without carrying credentials', () => {
    expect(wallLinkHref('', new URL('https://w2.rs2b2t.com/rs2b0t/?nodeid=10&lowmem=0&members=0&password=secret')))
        .toBe('./multibox.html?lowmem=0&members=0&nodeid=11');
});

test('encoded profile and standalone settings use distinct top-level keys and decode partial prefixes', () => {
    for (const [id, prefix] of [['set', 'set:Miner:route%'], ['', 'set:set:route%'], ['set:Global/north', 'route%']]) {
        const key = boxKey(prefix + '3A:out', id);
        expect(key).toStartWith('rs2b0t:');
        expect(key.slice('rs2b0t:'.length)).not.toContain(':');
        expect(boxKeyTail(key, boxKey(prefix, id))).toBe('3A:out');
        expect(boxKeyTail(key + ':selectedScript', boxKey(prefix, id))).toBeNull();
        expect(key).not.toBe(boxKey('cluetrace', ''));
    }
    expect(boxKey('set:set:route%3A:out', 'set')).not.toBe(boxKey('set:set:route%3A:out', ''));
});

test('standalone prefix scans span encoded and ordinary fields of the same script', () => {
    const prefix = 'set:Travel:';
    for (const field of ['selectedScript', 'selectedScriptExtra', 'set:Miner:route%3A:out']) {
        const suffix = prefix + field;
        for (let end = prefix.length; end <= suffix.length; end++) {
            expect(boxKeyTail(boxKey(suffix, ''), boxKey(suffix.slice(0, end), ''))).toBe(suffix.slice(end));
        }
    }
});
