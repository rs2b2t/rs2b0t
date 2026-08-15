import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export const SS_OBJ = {
    TORCH_LIT: 594,
    TORCH_UNLIT: 596,
    DAMP_STICKS: 1467,
    DRY_STICKS: 1468,
    BROKEN_GLASS: 1469,
    SWAMP_PASTE: 1941
} as const;

export const SS_ITEM = {
    DAMP_STICKS: 'Damp sticks',
    DRY_STICKS: 'Dry sticks',
    BROKEN_GLASS: 'Broken glass',
    SWAMP_PASTE: 'Swamp paste'
} as const;

export const SS_LOC = { LADDER_UP: 2517, LOOSE_PANEL: 2518, CRATES: 2519, CRANE: 2520, LADDER_DOWN: 1746 } as const;

export const SS_TILE = {
    BANK: new Tile(2655, 3283, 0),
    CAROLINE: new Tile(2716, 3302, 0),
    HOLGART_LAND: new Tile(2720, 3306, 0),
    SHORE: new Tile(2722, 3305, 0),
    KHAZARD_SHOP: new Tile(2641, 3171, 0),

    PLATFORM_ARRIVE: new Tile(2782, 3273, 0),
    HOLGART_PLATFORM: new Tile(2782, 3276, 0),
    BAILEY: new Tile(2763, 3277, 0),
    LADDER_FOOT: new Tile(2784, 3286, 0),
    DAMP_STICKS_SPAWN: new Tile(2784, 3289, 0),
    BROKEN_GLASS_SPAWN: new Tile(2765, 3289, 0),

    LADDER_TOP: new Tile(2784, 3286, 1),
    CRATES_STAND: new Tile(2764, 3286, 1),
    PANEL_STAND: new Tile(2766, 3288, 1),
    CRANE_STAND: new Tile(2769, 3290, 1),

    ISLAND_ARRIVE: new Tile(2800, 3320, 0),
    KENT: new Tile(2794, 3321, 0),
    HOLGART_ISLAND: new Tile(2798, 3321, 0)
} as const;

export const KHAZARD_SHOP = { npc: 'Shop keeper', anchor: SS_TILE.KHAZARD_SHOP };

export const CAROLINE: NpcStop = {
    npc: 'Caroline',
    anchor: SS_TILE.CAROLINE,
    leash: 6,
    prefer: ['I suppose so, how do I get there?']
};

export const HOLGART_LAND: NpcStop = {
    npc: 'Holgart',
    anchor: SS_TILE.HOLGART_LAND,
    leash: 6,
    prefer: ['Okay, lets do it.', "Okay, let's do it.", 'Will you take me there?']
};

export const HOLGART_PLATFORM: NpcStop = {
    npc: 'Holgart',
    anchor: SS_TILE.HOLGART_PLATFORM,
    leash: 6,
    prefer: ["Okay, let's go back."]
};

export const HOLGART_ISLAND: NpcStop = {
    npc: 'Holgart',
    anchor: SS_TILE.HOLGART_ISLAND,
    leash: 8,
    prefer: []
};

export const BAILEY: NpcStop = { npc: 'Bailey', anchor: SS_TILE.BAILEY, leash: 8, prefer: [] };

export const KENT: NpcStop = { npc: 'Kent', anchor: SS_TILE.KENT, leash: 8, prefer: [] };

export function onPlatform(tile: { x: number; z: number } | null | undefined): boolean {
    return tile !== null && tile !== undefined && tile.x >= 2758 && tile.x <= 2798 && tile.z >= 3268 && tile.z <= 3294;
}

export function onIsland(tile: { x: number; z: number } | null | undefined): boolean {
    return tile !== null && tile !== undefined && tile.x >= 2786 && tile.x <= 2804 && tile.z >= 3310 && tile.z <= 3328;
}
