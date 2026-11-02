import Tile from '../../geometry/Tile.js';

export interface SheepSite {
    id: string;
    label: string;
    pen: Tile;
    radius: number;
    bank: Tile;
    sheep: number;
}

export const SHEEP_SITES: SheepSite[] = [
    { id: 'lumbridge', label: 'Lumbridge (16 sheep, Draynor bank)', pen: new Tile(3198, 3266, 0), radius: 18, bank: new Tile(3093, 3243, 0), sheep: 16 },
    { id: 'varrock', label: 'Varrock south (5 sheep, Varrock East bank)', pen: new Tile(3245, 3347, 0), radius: 25, bank: new Tile(3253, 3420, 0), sheep: 5 },
    { id: 'falador', label: 'Falador west (3 sheep, Falador West bank)', pen: new Tile(2925, 3324, 0), radius: 10, bank: new Tile(2946, 3369, 0), sheep: 3 },
    { id: 'monastery', label: 'Monastery (3 sheep, Edgeville bank)', pen: new Tile(3052, 3518, 0), radius: 10, bank: new Tile(3094, 3493, 0), sheep: 3 },
    { id: 'ardougne', label: 'Ardougne north (10 sheep, north bank)', pen: new Tile(2654, 3367, 0), radius: 16, bank: new Tile(2616, 3332, 0), sheep: 10 }
];

export function chooseSite(choice: string, random: () => number = Math.random): SheepSite | null {
    if (choice !== 'random') return SHEEP_SITES.find(site => site.id === choice) ?? null;
    let draw = random() * SHEEP_SITES.reduce((total, site) => total + site.sheep, 0);
    for (const site of SHEEP_SITES) {
        draw -= site.sheep;
        if (draw < 0) return site;
    }
    return SHEEP_SITES[SHEEP_SITES.length - 1];
}
