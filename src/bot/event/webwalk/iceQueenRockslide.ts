import { PICKAXES } from '../../api/acquisition/Tools.js';
import type { TransportEdgeData } from './PathFinder.js';

export const ICE_QUEEN_ROCKSLIDE_ID = 2634;

export function iceQueenRockslideEdges(): TransportEdgeData[] {
    const west = { x: 2837, z: 3518, level: 0 };
    const east = { x: 2840, z: 3517, level: 0 };
    return [west, east].flatMap((from, i) => PICKAXES.flatMap(pickaxe =>
        (['items', 'worn'] as const).map(location => ({
            from, to: i === 0 ? east : west,
            locId: ICE_QUEEN_ROCKSLIDE_ID, locName: 'Rock slide', locX: 2838, locZ: 3517,
            action: 'Mine', kind: 'shortcut', debugName: 'herorockslide',
            requires: {
                members: true,
                skills: [{ name: 'mining', level: 50 }],
                [location]: [{ name: pickaxe.name, count: 1 }]
            }
        }))
    ));
}
