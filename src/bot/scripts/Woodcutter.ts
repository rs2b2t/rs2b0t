import type { SettingsSchema } from '../runtime/Settings.js';
import GatheringBot, { GATHERING_SETTINGS } from './GatheringBot.js';
import { BURN_MODE_OPTIONS, FIRE_SPOT_OPTIONS } from './FiremakingLogic.js';
import { TICK_MANIP_UNSHIPPED_HELP, WC_TICK_MANIP_OPTIONS, tickManipUiOptions } from './TickManipLogic.js';
import { FORGETFUL_BANK_SETTING, TOOL_ACQUIRE_SETTING } from '../api/ToolAcquire.js';
import { WOODCUTTING_LOCATION_OPTIONS } from '../api/WoodcuttingLocations.js';

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
    leashRadius: GATHERING_SETTINGS.leashRadius,
    location: {
        type: 'string',
        default: 'Auto',
        options: WOODCUTTING_LOCATION_OPTIONS,
        label: 'Location / full inventory',
        help:
            'Chop camp + full-pack behaviour. Auto = if you start in the same 64×64 map square as a known tree camp, snap to the nearest such camp and bank there; otherwise freeform (start-tile leash + nearest bank). Named camps pin trees + bank. None = power-chop (drop logs; no bank). Burn mode requires a non-None location — it is forced off under None. Fire spots stay separate from chop camps.'
    },
    tickManip: {
        type: 'string',
        default: 'Off',
        options: tickManipUiOptions(WC_TICK_MANIP_OPTIONS),
        label: 'Tick manip',
        group: 'Tick manip',
        help: TICK_MANIP_UNSHIPPED_HELP
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
    },
    muleMode: GATHERING_SETTINGS.muleMode,
    mulePartner: GATHERING_SETTINGS.mulePartner,
    toolAcquire: TOOL_ACQUIRE_SETTING,
    forgetfulBank: FORGETFUL_BANK_SETTING,
    purgePackOnStart: GATHERING_SETTINGS.purgePackOnStart,
    packJunk: GATHERING_SETTINGS.packJunk
};

export default class Woodcutter extends GatheringBot {}
