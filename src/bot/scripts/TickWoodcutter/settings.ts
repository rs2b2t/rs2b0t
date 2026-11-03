import type { SettingsSchema } from '../../runtime/Settings.js';
import Tile from '../../geometry/Tile.js';
import { WOODCUTTING_LOCATION_OPTIONS } from '../../data/woodcuttingLocations.js';
import { TOOL_ACQUIRE_SETTING } from '../../api/acquisition/ToolAcquire.js';

/** Settings for the standalone 3-tick woodcutter. */
export const TICK_WOODCUTTER_SETTINGS: SettingsSchema = {
    treeName: {
        type: 'string',
        default: 'Willow',
        options: ['Tree', 'Oak', 'Willow', 'Maple tree', 'Yew', 'Magic tree'],
        label: 'Tree name',
        help: 'In-game scenery name to chop.'
    },
    location: {
        type: 'string',
        default: 'Seers Willows',
        options: WOODCUTTING_LOCATION_OPTIONS,
        label: 'Location / full inventory',
        help:
            'Named camps pin the tree area and bank. Use Closest picks the nearest camp, ' +
            'Use Start Position / Use Custom Position are freeform.'
    },
    radius: {
        type: 'number',
        default: 24,
        min: 2,
        max: 64,
        label: 'Radius (tiles)',
        help: 'Search and return radius around the camp or custom position.'
    },
    customLocation: {
        type: 'tile',
        default: new Tile(3200, 3200, 0),
        label: 'Custom position (x,z)',
        help: 'Used when Location is Use Custom Position.',
        showIf: { key: 'location', anyOf: ['Use Custom Position'] }
    },
    bank: {
        type: 'boolean',
        default: false,
        label: 'Bank haul',
        help: 'On = bank logs at the camp bank. Off = power-drop, keeping one carrier log.'
    },
    toolAcquire: TOOL_ACQUIRE_SETTING,
    diagnostics: {
        type: 'boolean',
        default: true,
        label: 'Timing diagnostics',
        help: 'Log batch gaps and recoveries for live tuning.'
    }
};
