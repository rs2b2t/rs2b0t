import type { TransportInfo } from '#/bot/event/webwalk/PathFinder.js';

export const gate: TransportInfo = {
    locName: 'Gate',
    action: 'Open',
    locX: 3312,
    locZ: 3235,
    locId: 3198
};

export const trapdoor: TransportInfo = {
    locName: 'Trapdoor',
    action: 'Climb-down',
    locX: 3097,
    locZ: 3468,
    locId: 1568,
    openLocId: 1570
};

export const loc = (id: number, x: number, z: number) => ({
    id,
    tile: () => ({ x, z })
});
