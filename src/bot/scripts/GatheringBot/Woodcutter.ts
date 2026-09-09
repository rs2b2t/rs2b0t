import type { SettingsSchema } from '../../runtime/Settings.js';
import GatheringBot, { GATHERING_SETTINGS } from './GatheringBot.js';
import { BURN_MODE_OPTIONS, FIRE_SPOT_OPTIONS } from '../../api/firemaking/Firemaking.js';
import { TICK_MANIP_UNSHIPPED_HELP, WC_TICK_MANIP_OPTIONS, tickManipUiOptions } from './TickManipLogic.js';
import { FORGETFUL_BANK_SETTING, TOOL_ACQUIRE_SETTING } from '../../api/acquisition/ToolAcquire.js';
import { WOODCUTTING_LOCATION_OPTIONS } from '../../data/woodcuttingLocations.js';

// Why: skill mode is selected by the presence of `treeName`, `burnMode` and `fireSpot` in the settings schema (see GatheringBot.onStart).
// Why: this class is the dedicated script entry, so Woodcutting stays separate from the Miner and Fisher registry presets that also use GatheringBot.

/** Woodcutter, GatheringBot preset for trees plus optional chop-then-burn. */
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
        default: 'Use Start Position',
        options: WOODCUTTING_LOCATION_OPTIONS,
        label: 'Location / full inventory',
        help:
            'Chop camp + full-pack behaviour. Use Start Position = if you start in the same 64×64 map square as a known tree camp, snap to the nearest such camp and bank there; otherwise freeform (start-tile leash + nearest bank) — like AutoFighter Use Start Position. Use Custom Position = freeform around the custom tile below. Named camps pin trees + bank. Use Closest = nearest camp by distance. Bank setting controls full-pack behaviour: true = bank logs, false = power-chop (drop logs; no bank). Burn mode requires a non-power location — it is forced off when Bank=false. Fire spots stay separate from chop camps.'
    },
    customLocation: {
        type: 'tile',
        default: { x: 3200, z: 3200, level: 0 },
        label: 'Custom position (x,z)',
        help: 'when Location is Use Custom Position, gather around this tile instead of your start tile — like AutoFighter Use Custom Position',
        showIf: { key: 'location', anyOf: ['Use Custom Position'] }
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
