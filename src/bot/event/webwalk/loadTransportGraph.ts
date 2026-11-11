/** Shared graph load (doors + transports.json + curated travel + stairs) so NavWorker and offline tools match. */
import doorsJson from './data/doors.json';
import transportsJson from './data/transports.json';
import stairsJson from './data/stairEdges.json';
import type { DoorEdgeData, PathFinder, TransportEdgeData } from './PathFinder.js';
import { curatedTravelEdges } from './travelCatalog.js';
import { DESERT_MINING_CAMP_REPLACED_DOOR_IDS } from './desertMiningCampDoors.js';
import { dungeonTravelEdges, withDungeonTools } from './dungeonTravel.js';

/** Door rows replaced by directed transports whose handlers move the player. */
export function allDoorRows(): DoorEdgeData[] {
    return (doorsJson as DoorEdgeData[]).filter(door => !DESERT_MINING_CAMP_REPLACED_DOOR_IDS.has(door.locId));
}

export function allTransportRows(): TransportEdgeData[] {
    return [...withDungeonTools(transportsJson as TransportEdgeData[]), ...curatedTravelEdges(), ...dungeonTravelEdges()];
}

export function loadDefaultNavEdges(finder: PathFinder): void {
    finder.addEdges(
        allDoorRows(),
        allTransportRows(),
        stairsJson as TransportEdgeData[]
    );
}
