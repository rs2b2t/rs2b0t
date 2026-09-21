import { expect, test } from 'bun:test';
import { wallLinkHref } from '#/bot/runtime/box.js';

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
