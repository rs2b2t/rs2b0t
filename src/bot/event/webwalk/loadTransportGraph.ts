/**
 * Shared graph load: doors + transports.json + curated 2004 travel + stairs.
 * Keep NavWorker and offline tools in sync.
 */
import doorsJson from './data/doors.json';
import transportsJson from './data/transports.json';
import stairsJson from './data/stairEdges.json';
import type { DoorEdgeData, PathFinder, TransportEdgeData } from './PathFinder.js';
import { curatedTravelEdges } from './travelCatalog.js';

export function allTransportRows(): TransportEdgeData[] {
    return [...(transportsJson as TransportEdgeData[]), ...curatedTravelEdges()];
}

export function loadDefaultNavEdges(finder: PathFinder): void {
    finder.addEdges(
        doorsJson as DoorEdgeData[],
        allTransportRows(),
        stairsJson as TransportEdgeData[]
    );
}
