import type { SettingsSchema } from '../../runtime/Settings.js';
import { MINING_LOCATION_OPTION_LABELS, MINING_LOCATION_OPTIONS } from '../../data/miningLocations.js';
import { ROCK_OPTIONS } from '../../data/miningRocks.js';
import { FORGETFUL_BANK_SETTING, TOOL_ACQUIRE_SETTING } from '../../api/acquisition/ToolAcquire.js';
import { GATHERING_SETTINGS } from './GatheringBot.js';
import { MINER_FOOD_SETTINGS } from './MinerLogic.js';
import { MINE_TICK_MANIP_OPTIONS, TICK_MANIP_UNSHIPPED_HELP, tickManipUiOptions } from './TickManipLogic.js';

export const MINER_SETTINGS: SettingsSchema = {
    rocks: {
        type: 'string[]',
        default: ['Iron'],
        options: ROCK_OPTIONS,
        label: 'Rock types',
        help:
            'Which rocks to mine — every rock is named "Rocks" in-game, so pick the ore types here (multi-select). Empty = mine any rock.'
    },
    leashRadius: GATHERING_SETTINGS.leashRadius,
    location: {
        type: 'string',
        default: 'Auto',
        options: MINING_LOCATION_OPTIONS,
        optionLabels: MINING_LOCATION_OPTION_LABELS,
        label: 'Location / full inventory',
        help:
            'Mine camp + full-pack behaviour. Auto = snap to a camp in your map square, otherwise stay at your start tile. Use Closest = nearest camp by distance. Use Start Position = freeform around your start tile + nearest bank. Use Custom Position = freeform around the custom tile. Named camps pin spot + bank. Camps with aggressive NPCs show a recommended combat level (2× highest aggro + 1). Power-mine via Bank=false (drop ore; configured food still restocks from the nearest bank). Legacy None also power-mines.'
    },
    customLocation: GATHERING_SETTINGS.customLocation,
    bank: GATHERING_SETTINGS.bank,
    bankLocation: GATHERING_SETTINGS.bankLocation,
    ...MINER_FOOD_SETTINGS,
    tickManip: {
        type: 'string',
        default: 'Off',
        options: tickManipUiOptions(MINE_TICK_MANIP_OPTIONS),
        label: 'Tick manip',
        group: 'Tick manip',
        help: TICK_MANIP_UNSHIPPED_HELP
    },
    muleMode: GATHERING_SETTINGS.muleMode,
    mulePartner: GATHERING_SETTINGS.mulePartner,
    toolAcquire: TOOL_ACQUIRE_SETTING,
    forgetfulBank: FORGETFUL_BANK_SETTING,
    // Required for harness / live control of start purge (default true).
    purgePackOnStart: GATHERING_SETTINGS.purgePackOnStart,
    packJunk: GATHERING_SETTINGS.packJunk,
    withdrawCoins: GATHERING_SETTINGS.withdrawCoins,
    bankTeleport: GATHERING_SETTINGS.bankTeleport,
    teleCasts: GATHERING_SETTINGS.teleCasts
};
