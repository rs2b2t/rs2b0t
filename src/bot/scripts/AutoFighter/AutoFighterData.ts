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

/** CowKiller-style timed bank: Auto banking, a positive interval, loot in the pack, and the timer elapsed. */
export function shouldBankAfterMinutes(
    autoBank: boolean,
    everyMinutes: number,
    minutesSinceLastBank: number,
    lootCount: number
): boolean {
    if (!autoBank || everyMinutes <= 0 || lootCount <= 0) {
        return false;
    }
    return minutesSinceLastBank >= everyMinutes;
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

/** A weapon with a special is in hand and specials are turned on. Spells never spec. */
export function specialAvailable(enabled: boolean, style: string, cost: number | null): boolean {
    return enabled && style !== 'mage' && cost !== null;
}

/** Arm when the wielded weapon's special is affordable and the last one has already been spent. */
export function shouldArmSpecial(enabled: boolean, style: string, cost: number | null, energy: number, armed: boolean): boolean {
    return specialAvailable(enabled, style, cost) && !armed && energy >= (cost ?? 0);
}

/** Gate between re-clicking a stalled NPC: 5s so a brief face-target flicker does not spam Attack clicks. */
export const REATTACK_COOLDOWN_MS = 5000;

/** Stall rule: re-issue Attack when the engaged NPC's face target clears, past the cooldown. XP stalls are not evidence (misses/0-damage earn none). */
export function shouldReattackStall(
    engaged: boolean,
    stillAttacking: boolean,
    lastReattackAgoMs: number
): boolean {
    return engaged && !stillAttacking && lastReattackAgoMs >= REATTACK_COOLDOWN_MS;
}

/** The engine encodes an NPC facing a player as slot + base, see Npc.targetsMe. */
const NPC_SLOT_FACE_BASE = 32768;

/** NPC ownership: a snapshot is "ours" when its faceEntity encodes our player slot. */
export function npcIsEngagedWithUs(faceEntity: number, ourSlot: number): boolean {
    return faceEntity >= NPC_SLOT_FACE_BASE && faceEntity - NPC_SLOT_FACE_BASE === ourSlot;
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
