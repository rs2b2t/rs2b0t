import { UP_ITEM } from '#/bot/api/ai/quests/defs/upass/areas.js';

export type Stack = number | [number, number];

export const counts = (stacks: Stack[]): Map<number, number> =>
    new Map(stacks.map(s => (Array.isArray(s) ? s : [s, 1])));

export const KIT: Stack[] = [
    [UP_ITEM.ROPE.id, 3],
    UP_ITEM.SHORTBOW.id,
    [UP_ITEM.BRONZE_ARROW.id, 50],
    UP_ITEM.TINDERBOX.id,
    UP_ITEM.SPADE.id,
    UP_ITEM.BUCKET.id,
    [UP_ITEM.LOBSTER.id, 14]
];
