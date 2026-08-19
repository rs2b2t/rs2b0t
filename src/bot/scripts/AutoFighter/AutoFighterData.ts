import Tile from '../../geometry/Tile.js';
import { matchesAny } from '../../api/inventory/packRules.js';

export const START_POSITION = 'Start position';
export const CUSTOM_COORDINATES = 'Custom coordinates';
export const SPOT_OPTIONS = [START_POSITION, CUSTOM_COORDINATES];
export const BANKING_OPTIONS = ['Auto', 'None'];
export const DEFAULT_CUSTOM_SPOT = new Tile(3273, 3427, 0);
export const BURIAL_BONE_NAME = 'Bones';

interface BoneBurialState {
    enabled: boolean;
    inCombat: boolean;
    bankOpen: boolean;
    boneCount: number;
    inventoryFull: boolean;
}

export function resolveKillingSpot(mode: string, start: Tile, custom: Tile): Tile {
    return Tile.from(mode.trim().toLowerCase() === CUSTOM_COORDINATES.toLowerCase() ? custom : start);
}

export function autoBankEnabled(mode: string): boolean {
    return mode.trim().toLowerCase() === 'auto';
}

export function isBurialBone(name: string | null): boolean {
    return name?.trim().toLowerCase() === BURIAL_BONE_NAME.toLowerCase();
}

export function wantsAutoFighterLoot(name: string | null, configured: string[], buryBones: boolean): boolean {
    return matchesAny(name, configured) || (buryBones && isBurialBone(name));
}

/** Fight.validate is false while Game.inCombat(), so retaliate-off + an attacking random (strange fruit) never picks a new target. */
export function autoRetaliateShouldEnable(on: boolean): boolean {
    return !on;
}

export function assertAutoRetaliateOn(on: boolean): void {
    if (!on) {
        throw new Error('[AutoFighter] could not enable Auto Retaliate');
    }
}

export function shouldBuryRegularBones(state: BoneBurialState): boolean {
    // A full backpack is deliberately not a blocker: burying creates the slot
    // needed to pick up the next drop.
    return state.enabled && !state.inCombat && !state.bankOpen && state.boneCount > 0;
}

export const DEFAULT_LOOT = [
    'clue scroll',
    'uncut sapphire', 'uncut emerald', 'uncut ruby', 'uncut diamond',
    'half of a key',
    'chaos talisman', 'nature talisman'
];
