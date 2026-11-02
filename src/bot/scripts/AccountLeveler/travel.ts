import type { WorldTile } from '../../adapter/ClientAdapter.js';
import type { WalkResilientOptions } from '../../api/walking/Traversal.js';
import { wildernessLevelAt } from '../../event/webwalk/wilderness.js';

export function levelerTravelZones(destination?: WorldTile, wilderness = false): WalkResilientOptions['avoidZones'] {
    return [
        'white-wolf-mountain',
        ...(wilderness && destination && wildernessLevelAt(destination) > 0 ? [] : [
            { minX: 2944, maxX: 3391, minZ: 3520, maxZ: 6399 },
            { minX: 2944, maxX: 3391, minZ: 9920, maxZ: 12799, level: 0 }
        ])
    ];
}
