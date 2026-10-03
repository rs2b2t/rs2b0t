import type { NavPoint } from '#/bot/event/webwalk/PathFinder.js';

// Why: this clue uses the west-side dig tile beside the fence, within one tile of the content coordinate.
export const DIG_ANCHORS: Readonly<Partial<Record<number, NavPoint>>> = {
    2745: { x: 3054, z: 3696, level: 0 }
};
