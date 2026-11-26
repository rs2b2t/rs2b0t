import type { WorldTile } from '../adapter/ClientAdapter.js';

export const DRAGONFIRE_SHIELD = 'Dragonfire shield'; // content display name for antidragonbreathshield

type SecondaryId =
    | 'blue_dragon_scale'
    | 'red_spiders_eggs'
    | 'snape_grass'
    | 'eye_of_newt'
    | 'chocolate_dust'
    | 'white_berries'
    | 'toads_legs'
    | 'unicorn_horn_dust';

type SecondaryMode = 'loot' | 'buy' | 'buy_grind' | 'loot_process' | 'bank_grind';

export interface SecondarySource {
    id: SecondaryId;
    /** Inventory / ground display name. */
    name: string;
    mode: SecondaryMode;
    /** Where to stand / search. Absent on bank_grind, which lives at the nearest bank. */
    anchor?: WorldTile;
    searchRadius: number;
    bank?: WorldTile;
    bankName?: string;
    /** Dangerous route, withdraw food. */
    takeFood: boolean;
    /** Needs anti-dragon shield equipped or carried. */
    needShield: boolean;
    keyName?: string;
    /** Ground / shop source name when different from product (e.g. Swamp toad → Toad's legs). */
    sourceName?: string;
    shopNpc?: string;
    shopStand?: WorldTile;
    /** For buy_grind: pestle shop. */
    toolShopNpc?: string;
    toolShopStand?: WorldTile;
    toolName?: string;
    grindFrom?: string;
}

export const SECONDARY_SOURCES: readonly SecondarySource[] = [
    {
        id: 'red_spiders_eggs',
        name: "Red spiders' eggs",
        mode: 'loot',
        anchor: { x: 3120, z: 9952, level: 0 },
        searchRadius: 14,
        bank: { x: 3094, z: 3493, level: 0 },
        bankName: 'Edgeville',
        takeFood: true,
        needShield: false
    },
    {
        id: 'snape_grass',
        name: 'Snape grass',
        mode: 'loot',
        // peninsula west of Crafting Guild (map m45_51 spawns)
        anchor: { x: 2908, z: 3294, level: 0 },
        searchRadius: 16,
        bank: { x: 3013, z: 3355, level: 0 },
        bankName: 'Falador East',
        takeFood: true,
        needShield: false
    },
    {
        id: 'eye_of_newt',
        name: 'Eye of newt',
        mode: 'buy',
        anchor: { x: 3012, z: 3259, level: 0 },
        searchRadius: 6,
        bank: { x: 3093, z: 3243, level: 0 },
        bankName: 'Draynor',
        takeFood: false,
        needShield: false,
        shopNpc: 'Betty',
        shopStand: { x: 3012, z: 3259, level: 0 }
    },
    {
        id: 'chocolate_dust',
        name: 'Chocolate dust',
        mode: 'buy_grind',
        anchor: { x: 3014, z: 3204, level: 0 },
        searchRadius: 6,
        bank: { x: 3093, z: 3243, level: 0 },
        bankName: 'Draynor',
        takeFood: false,
        needShield: false,
        shopNpc: 'Wydin',
        shopStand: { x: 3014, z: 3204, level: 0 },
        toolShopNpc: 'Jatix',
        toolShopStand: { x: 2899, z: 3427, level: 0 },
        toolName: 'Pestle and mortar',
        grindFrom: 'Chocolate bar'
    },
    {
        id: 'white_berries',
        name: 'White berries',
        mode: 'loot',
        // red dragon isle (wilderness), needs dragonfire shield
        anchor: { x: 3216, z: 3812, level: 0 },
        searchRadius: 12,
        // Why: the Deserted Keep lever lands beside the Ardougne lever, so every trip home ends in Ardougne; Edgeville was two spirit trees further each way.
        bank: { x: 2616, z: 3332, level: 0 },
        bankName: 'Ardougne West',
        takeFood: true,
        needShield: true
    },
    {
        id: 'toads_legs',
        name: "Toad's legs",
        mode: 'loot_process',
        // swamp toads in Tree Gnome Stronghold
        anchor: { x: 2415, z: 3514, level: 0 },
        searchRadius: 18,
        bank: { x: 2449, z: 3482, level: 1 },
        bankName: 'Grand Tree',
        takeFood: false,
        needShield: false,
        sourceName: 'Swamp toad'
    },
    {
        id: 'blue_dragon_scale',
        name: 'Blue dragon scale',
        mode: 'loot',
        anchor: { x: 2906, z: 9804, level: 0 },
        searchRadius: 9,
        bank: { x: 2946, z: 3369, level: 0 },
        bankName: 'Falador West',
        takeFood: true,
        needShield: true,
        keyName: 'Dusty key'
    },
    {
        id: 'unicorn_horn_dust',
        name: 'Unicorn horn dust',
        mode: 'bank_grind',
        searchRadius: 6,
        takeFood: false,
        needShield: false,
        toolName: 'Pestle and mortar',
        grindFrom: 'Unicorn horn'
    }
];

export function secondarySourceByName(name: string): SecondarySource | null {
    const want = name.trim().toLowerCase();
    return SECONDARY_SOURCES.find(s => s.name.toLowerCase() === want || s.id === want) ?? null;
}

export function secondarySourceById(id: SecondaryId): SecondarySource {
    const s = SECONDARY_SOURCES.find(x => x.id === id);
    if (!s) {
        throw new Error(`unknown secondary ${id}`);
    }
    return s;
}
