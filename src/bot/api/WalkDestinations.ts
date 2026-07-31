import Tile from '../api/Tile.js';

export interface WalkDestination {
    name: string;
    tile: Tile;
}

export const WALK_DESTINATIONS: WalkDestination[] = [
    { name: 'Lumbridge', tile: new Tile(3221, 3218, 0) }, // centre (home teleport)
    { name: 'Varrock', tile: new Tile(3213, 3424, 0) }, // centre (teleport)
    { name: 'Falador', tile: new Tile(2965, 3378, 0) }, // centre (teleport)
    { name: 'Ardougne', tile: new Tile(2661, 3301, 0) }, // centre (teleport)
    { name: 'Rellekka', tile: new Tile(2668, 3660, 0) }, // centre
    { name: 'Taverley', tile: new Tile(2895, 3435, 0) }, // centre
    { name: 'Draynor', tile: new Tile(3093, 3243, 0) }, // bank
    { name: 'Al Kharid', tile: new Tile(3269, 3167, 0) }, // bank
    { name: 'Edgeville', tile: new Tile(3094, 3493, 0) }, // bank
    { name: "Seers' Village", tile: new Tile(2725, 3491, 0) }, // bank
    { name: 'Yanille', tile: new Tile(2612, 3092, 0) } // bank
];

export const WALK_OPTIONS = WALK_DESTINATIONS.map(d => d.name);

export function resolveDestination(name: string): WalkDestination | null {
    const key = name.trim().toLowerCase();
    return WALK_DESTINATIONS.find(d => d.name.toLowerCase() === key) ?? null;
}
