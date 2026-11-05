import type { SettingsSchema } from '../../runtime/Settings.js';
import Tile from '../../geometry/Tile.js';
import { CUSTOM_LOCATION, POWER_MINE_CAMPS, POWER_MINE_LOCATION_OPTIONS } from './locations.js';

/** Help for rock N: only the selected camp's coordinate (or the custom-position hint). */
function rockHelp(n: number): (valueOf: (key: string) => string) => string {
    return valueOf => {
        const location = valueOf('location');
        if (location === CUSTOM_LOCATION) {
            return `Custom position — set Rock ${n} position (x,z). Pick this rock's click position or Exclude.`;
        }
        const camp = POWER_MINE_CAMPS.find(candidate => candidate.name === location) ?? POWER_MINE_CAMPS[0]!;
        const rock = camp.rocks?.[n - 1];
        if (!rock) {
            return 'This location has fewer rocks; leave Exclude.';
        }
        return `Coordinates — ${rock.x},${rock.z}: ${n}. Pick this rock's click position or Exclude.`;
    };
}

/** Settings for the standalone iron power miner. */
export const POWER_MINER_SETTINGS: SettingsSchema = {
    location: {
        type: 'string',
        default: 'Legends Guild Iron (east)',
        options: [...POWER_MINE_LOCATION_OPTIONS],
        label: 'Location',
        help:
            'Verified iron camps. Legends Guild east is the fastest measured camp (50k/hr on a busy ' +
            'server); Rellekka is the quieter alternative with no monsters. Wilderness Hobgoblin is ' +
            'dense but has aggressive hobgoblins. Use Custom Position for anything else.'
    },
    customLocation: {
        type: 'tile',
        default: new Tile(2714, 3331, 0),
        label: 'Custom position (x,z)',
        help: 'Used when Location is Use Custom Position.',
        showIf: { key: 'location', anyOf: [CUSTOM_LOCATION] }
    },
    rock1At: {
        type: 'tile',
        default: new Tile(0, 0, 0),
        label: 'Rock 1 position (x,z)',
        help: 'Custom route: coordinates of rock 1. Order comes from Rock 1 order.',
        showIf: { key: 'location', anyOf: [CUSTOM_LOCATION] }
    },
    rock2At: {
        type: 'tile',
        default: new Tile(0, 0, 0),
        label: 'Rock 2 position (x,z)',
        help: 'Custom route: coordinates of rock 2. Order comes from Rock 2 order.',
        showIf: { key: 'location', anyOf: [CUSTOM_LOCATION] }
    },
    rock3At: {
        type: 'tile',
        default: new Tile(0, 0, 0),
        label: 'Rock 3 position (x,z)',
        help: 'Custom route: coordinates of rock 3. Order comes from Rock 3 order.',
        showIf: { key: 'location', anyOf: [CUSTOM_LOCATION] }
    },
    rock4At: {
        type: 'tile',
        default: new Tile(0, 0, 0),
        label: 'Rock 4 position (x,z)',
        help: 'Custom route: coordinates of rock 4. Order comes from Rock 4 order.',
        showIf: { key: 'location', anyOf: [CUSTOM_LOCATION] }
    },
    rock5At: {
        type: 'tile',
        default: new Tile(0, 0, 0),
        label: 'Rock 5 position (x,z)',
        help: 'Custom route: coordinates of rock 5. Order comes from Rock 5 order.',
        showIf: { key: 'location', anyOf: [CUSTOM_LOCATION] }
    },
    rock6At: {
        type: 'tile',
        default: new Tile(0, 0, 0),
        label: 'Rock 6 position (x,z)',
        help: 'Custom route: coordinates of rock 6. Order comes from Rock 6 order.',
        showIf: { key: 'location', anyOf: [CUSTOM_LOCATION] }
    },
    rock1: {
        type: 'string',
        default: '1',
        options: ['Exclude', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        label: 'Rock 1 order',
        help: rockHelp(1),
    },
    rock2: {
        type: 'string',
        default: '2',
        options: ['Exclude', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        label: 'Rock 2 order',
        help: rockHelp(2),
    },
    rock3: {
        type: 'string',
        default: '3',
        options: ['Exclude', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        label: 'Rock 3 order',
        help: rockHelp(3),
    },
    rock4: {
        type: 'string',
        default: '4',
        options: ['Exclude', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        label: 'Rock 4 order',
        help: rockHelp(4),
    },
    rock5: {
        type: 'string',
        default: '5',
        options: ['Exclude', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        label: 'Rock 5 order',
        help: rockHelp(5),
        showIf: { key: 'location', anyOf: ['Legends Guild Iron (east)', 'Legends Guild Iron (west)', 'Rellekka Mine', 'Wilderness Hobgoblin Mine', 'Fight Arena Mine', CUSTOM_LOCATION] },
    },
    rock6: {
        type: 'string',
        default: '6',
        options: ['Exclude', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        label: 'Rock 6 order',
        help: rockHelp(6),
        showIf: { key: 'location', anyOf: ['Legends Guild Iron (east)', 'Legends Guild Iron (west)', 'Rellekka Mine', 'Wilderness Hobgoblin Mine', 'Fight Arena Mine', CUSTOM_LOCATION] },
    },
    rock7: {
        type: 'string',
        default: '7',
        options: ['Exclude', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        label: 'Rock 7 order',
        help: rockHelp(7),
        showIf: { key: 'location', anyOf: ['Rellekka Mine', 'Wilderness Hobgoblin Mine', 'Fight Arena Mine'] },
    },
    rock8: {
        type: 'string',
        default: '8',
        options: ['Exclude', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        label: 'Rock 8 order',
        help: rockHelp(8),
        showIf: { key: 'location', anyOf: ['Rellekka Mine', 'Wilderness Hobgoblin Mine'] },
    },
    rock9: {
        type: 'string',
        default: '9',
        options: ['Exclude', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        label: 'Rock 9 order',
        help: rockHelp(9),
        showIf: { key: 'location', anyOf: ['Rellekka Mine', 'Wilderness Hobgoblin Mine'] },
    },
    dropMode: {
        type: 'string',
        default: 'Every 2 ores',
        options: ['Every ore', 'Every 2 ores', 'Every 3 ores', 'Every 4 ores'],
        label: 'Drop batch',
        help:
            'Drop batch size: 1 drops on each mining cycle; 2-4 wait for that many ores, then drop ' +
            'them together. Two ores + click measured fastest (55k/hr); 4 + click is the event cap.'
    },
    diagnostics: {
        type: 'boolean',
        default: true,
        label: 'Timing diagnostics',
        help: 'Log ore gaps, respawn waits and drop counts for live tuning.'
    }
};
