import type { TransportEdgeData } from './PathFinder.js';

export function lighthouseTravelEdges(): TransportEdgeData[] {
    const outside = { x: 2509, z: 3635, level: 0 };
    const inside = { x: 2509, z: 3636, level: 0 };
    return [
        { from: outside, to: inside },
        { from: inside, to: outside }
    ].map(({ from, to }) => ({
        from,
        to,
        locName: 'Doorway',
        action: 'Walk-through',
        kind: 'dungeon',
        locId: 4577,
        locX: 2509,
        locZ: 3636,
        debugName: 'horror_lighthouse_doorway_postquest',
        requires: { quests: [{ quest: 'Horror from the Deep', minStatus: 'complete' }] }
    }));
}
