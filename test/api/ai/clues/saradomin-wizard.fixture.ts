import type { NpcSnapshot } from '#/bot/adapter/ClientAdapter.js';

export function saradominWizard(distance = 1): NpcSnapshot {
    return {
        index: 4,
        id: 1,
        anim: -1,
        name: 'Saradomin Wizard',
        level: 65,
        size: 1,
        tile: { x: 3000, z: 3000, level: 0 },
        distance,
        ops: ['Attack'],
        inCombat: true,
        health: 40,
        totalHealth: 40,
        faceEntity: 32768
    };
}
