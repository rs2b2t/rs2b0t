import Tile from '../../geometry/Tile.js';
import type { MeleeCombatStyle } from '../../api/combat/CombatStyle.js';

export const TARGET = 'Moss giant';

// Brimhaven moss giant island: safespot disabled, so multicombat walk-and-fight.
export const FIELD_TILE = new Tile(2698, 3206, 0);
// Ardougne south-east bank by Captain Barnaby's pier, the boat launch point.
export const BANK_TILE = new Tile(2655, 3283, 0);
// Stand tile on the Ardougne pier next to Captain Barnaby; anchoring here before sailing makes the outbound boat hop fire from a clean, in-range spot instead of mid-walk (a failed hop repaths via the wrong port).
export const PIER_TILE = new Tile(2683, 3272, 0);

export const BOAT_FARE = 30; // Ardougne <-> Brimhaven each way
export const FIELD_RADIUS = 10;
// How far from the field tile the bot will roam to find/engage moss giants.
export const HUNT_RADIUS = 25;

export const ASSERT_BATCH = 5;
export const ASSERT_RETRY_MS = 60_000;

export type CombatStyle = 'melee' | 'mage' | 'range';

// Mutable runtime config shared across modules so per-concern files stay decoupled.
export interface RuntimeConfig {
    style: CombatStyle;
    meleeStyle: MeleeCombatStyle;
    rangeMode: number;
    weapon: string;
    spell: string;
    ammo: string;
    foodName: string;

    panicHp: number;
    runesWithdraw: number;
    ammoWithdraw: number;
    foodWithdraw: number;

    lootSet: Set<string>;
    bankCommon: boolean;
    buryBones: boolean;
    cake: boolean;
    lootAmmo: boolean;

    fieldTile: Tile;
    bankTile: Tile;
}

export const cfg: RuntimeConfig = {
    style: 'melee',
    meleeStyle: 'strength',
    rangeMode: 1,
    weapon: '',
    spell: 'Wind Strike',
    ammo: 'Iron arrow',
    foodName: 'Lobster',

    panicHp: 0.25,
    runesWithdraw: 150,
    ammoWithdraw: 500,
    foodWithdraw: 20,

    lootSet: new Set<string>(),
    bankCommon: true,
    buryBones: false,
    cake: false,
    lootAmmo: true,

    fieldTile: FIELD_TILE,
    bankTile: BANK_TILE
};
