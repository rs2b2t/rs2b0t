import doors from '#/bot/event/webwalk/data/doors.json';
import stairs from '#/bot/event/webwalk/data/stairEdges.json';
import transports from '#/bot/event/webwalk/data/transports.json';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { PathFinder, type DoorEdgeData, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import { readCollisionPack } from '../../tools/lib/readCollisionPack.js';

export function loadDefaultFinder(pack: string): PathFinder {
    const finder = new PathFinder(readCollisionPack(pack));
    loadDefaultNavEdges(finder);
    return finder;
}

export function loadStaticFinder(pack: string): PathFinder {
    const finder = new PathFinder(readCollisionPack(pack));
    finder.addEdges(doors as DoorEdgeData[], transports as TransportEdgeData[], stairs as TransportEdgeData[]);
    return finder;
}
