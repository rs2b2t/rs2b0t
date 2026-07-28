import type { SettingsSchema } from '../runtime/Settings.js';
import GatheringBot, { GATHERING_SETTINGS } from './GatheringBot.js';
import { BURN_MODE_OPTIONS, FIRE_SPOT_OPTIONS } from './FiremakingLogic.js';

/**
 * Woodcutter — GatheringBot preset for trees + optional chop-then-burn.
 *
 * Skill mode is still selected by the presence of `treeName` / `burnMode` /
 * `fireSpot` in the settings schema (see GatheringBot.onStart). This class is
 * the dedicated script entry so Woodcutting stays separate from Miner/Fisher
 * registry presets that also use GatheringBot.
 */
export const WOODCUTTER_SETTINGS: SettingsSchema = {
    treeName: {
        type: 'string',
        default: 'Tree',
        options: ['Tree', 'Oak', 'Willow', 'Maple tree', 'Yew', 'Magic tree'],
        label: 'Tree name',
        help: 'In-game scenery name to chop (exact match). Pick a common tree from the list.'
    },
    chopAction: {
        type: 'string',
        default: 'Chop down',
        label: 'Chop action',
        help: 'Right-click op on the tree (usually Chop down).'
    },
    leashRadius: GATHERING_SETTINGS.leashRadius,
    location: {
        type: 'string',
        default: 'Auto',
        options: ['Auto', 'None'],
        label: 'Full inventory',
        help:
            'What to do when the pack is full of logs. Auto = bank-path mode: bank the logs (if burn is Off) and restock axe/tinderbox from the bank. None = power-chop (drop logs; no bank). Burn mode requires Auto — it is forced off under None.'
    },
    burnMode: {
        type: 'string',
        default: 'Off',
        options: [...BURN_MODE_OPTIONS],
        label: 'Burn mode',
        group: 'Firemaking',
        help:
            'Off = keep/bank logs (see Full inventory). Chop then burn = when the pack is full, walk to a fire plot and light the logs instead of banking them (needs tinderbox + Full inventory Auto). Choosing Chop then burn reveals Fire spot below.'
    },
    fireSpot: {
        type: 'string',
        default: 'Auto',
        options: ['Auto', ...FIRE_SPOT_OPTIONS],
        label: 'Fire spot',
        group: 'Firemaking',
        showIf: { key: 'burnMode', anyOf: ['Chop then burn'] },
        help:
            'Shown only when Burn mode is Chop then burn. Where to light fires. Auto = burn near where you started the script until the pack is empty (repaths/expands when tiles fill with fires). Named spots = fixed bank-side strips (Varrock East, Draynor, …).'
    }
};

export default class Woodcutter extends GatheringBot {}
