import { expect, test } from 'bun:test';
import { installNavWorkerPool, type NavPoolHost } from '#/bot/event/webwalk/NavWorkerClient.js';

test('61 profiles share four route planners owned by their wall across tile reloads', () => {
    const wall: NavPoolHost = {};
    installNavWorkerPool(wall);
    const profiles = Array.from({ length: 61 }, () => wall.__rs2b0tAcquireNavigator!());
    expect(new Set(profiles).size).toBe(4);
    installNavWorkerPool(wall);
    expect(wall.__rs2b0tAcquireNavigator!()).toBe(profiles[1]);
    const secondWall: NavPoolHost = {};
    installNavWorkerPool(secondWall);
    expect(profiles).not.toContain(secondWall.__rs2b0tAcquireNavigator!());
});
