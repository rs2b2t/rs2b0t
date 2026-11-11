import type { TransportEdgeData } from './PathFinder.js';

const AXES = ['Bronze axe', 'Iron axe', 'Steel axe', 'Black axe', 'Mithril axe', 'Adamant axe', 'Rune axe'];

export function dungeonTravelEdges(): TransportEdgeData[] {
    return [
        {
            from: { x: 2747, z: 3152, level: 0 }, to: { x: 2713, z: 9564, level: 0 },
            locName: 'Dungeon entrance', action: 'Enter', kind: 'dungeon', locId: 5083, locX: 2743, locZ: 3153,
            debugName: 'dungeon_tree_closed', requires: { members: true, items: [{ name: 'Coins', count: 875, consumed: true }] }
        },
        {
            from: { x: 3226, z: 3108, level: 0 }, to: { x: 3483, z: 9510, level: 2 },
            locName: 'Tunnel entrance', action: 'Climb-down', kind: 'dungeon', locId: 3827, openLocId: 3828, locX: 3227, locZ: 3108,
            debugName: 'kalphite_burrow_entrance', requires: { members: true, items: [{ name: 'Rope', count: 1, consumed: true }] }
        },
        {
            from: { x: 3483, z: 9510, level: 2 }, to: { x: 3226, z: 3108, level: 0 },
            locName: 'Rope', action: 'Climb-up', kind: 'dungeon', locId: 3829, locX: 3483, locZ: 9509,
            debugName: 'kalphite_burrow_exit'
        }
    ];
}

export function withDungeonTools(edges: TransportEdgeData[]): TransportEdgeData[] {
    return edges.flatMap(edge => {
        if (!/^karam_dungeon_vineblocking[1-5]$/.test(edge.debugName ?? '') || !edge.requires?.skills?.length) return [edge];
        return AXES.flatMap(name => (['items', 'worn'] as const).map(location => ({
            ...edge, requires: { ...edge.requires, [location]: [{ name, count: 1 }] }
        })));
    });
}
