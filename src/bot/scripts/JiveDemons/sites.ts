import Tile from '../../geometry/Tile.js';
import { TAVERLEY_BLUE, inBox, type DragonSite } from '../JiveDragons/sites.js';

// Why: the pocket sits behind the dusty-key gate on the far side of the blue lair, so the gate, the key, the bank, the escape and the walk-out are the blue site's, and only the tiles past the passage are its own.
// Why: the entrance corridor at x 2881..2887 runs between the blue lair and the pocket on the ladder side of the gate, so the area is three boxes that meet around it rather than one box that would swallow it.

const POCKET = inBox({ minX: 2850, maxX: 2880, minZ: 9762, maxZ: 9797, level: 0 });
const CORRIDOR = inBox({ minX: 2874, maxX: 2899, minZ: 9762, maxZ: 9775, level: 0 });

export const TAVERLEY_BLACK_DEMON: DragonSite = {
    ...TAVERLEY_BLUE,
    key: 'taverley-black-demon',
    label: 'Taverley Dungeon black demons',
    target: 'Black Demon',
    bones: '',
    approach: [new Tile(2893, 9790, 0), new Tile(2893, 9771, 0), new Tile(2875, 9774, 0)],
    safespots: [new Tile(2856, 9786, 0), new Tile(2857, 9786, 0), new Tile(2855, 9786, 0)],
    meleeAnchor: new Tile(2859, 9786, 0),
    inArea: t => TAVERLEY_BLUE.inArea(t) || POCKET(t) || CORRIDOR(t)
};

export const DEMON_SITES: Record<string, DragonSite> = { [TAVERLEY_BLACK_DEMON.key]: TAVERLEY_BLACK_DEMON };

export const SITE_OPTIONS: string[] = Object.keys(DEMON_SITES);

export function siteFor(key: string): DragonSite {
    return DEMON_SITES[key] ?? TAVERLEY_BLACK_DEMON;
}
