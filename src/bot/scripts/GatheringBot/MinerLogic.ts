import { FOOD_OPTIONS } from '../../api/combat/food.js';
import type { SettingsSchema } from '../../runtime/Settings.js';

export const MINER_FOOD_SETTINGS = {
    food: {
        type: 'string',
        default: 'Lobster',
        options: FOOD_OPTIONS,
        label: 'Food',
        group: 'Food & healing',
        help: 'Food carried into the mine. It is eaten when the full heal fits, or when a full pack needs one more ore slot.'
    },
    foodWithdraw: {
        type: 'number',
        default: 0,
        min: 0,
        max: 27,
        label: 'Food to withdraw',
        group: 'Food & healing',
        help: 'Exact food target for each trip. 0 disables food; otherwise the bot restocks from the selected camp bank before mining and whenever it runs out.'
    }
} satisfies SettingsSchema;

export interface MinerFoodConfig {
    name: string;
    target: number;
}

/** Resolve the opt-in Miner food settings into a usable trip configuration. */
export function minerFoodConfig(name: string, target: number): MinerFoodConfig | null {
    const normalizedName = name.trim();
    if (normalizedName.length === 0 || !Number.isFinite(target)) {
        return null;
    }
    const normalizedTarget = Math.max(0, Math.min(27, Math.floor(target)));
    return normalizedTarget > 0 ? { name: normalizedName, target: normalizedTarget } : null;
}

/**
 * Eat when the configured food's heal fits, or consume one slot
 * from a full pack so mining can continue with another ore.
 */
export function shouldEatMinerFood(opts: { hp: number; maxHp: number; heal: number; foodCount: number; inventoryFull: boolean }): boolean {
    if (opts.foodCount <= 0) {
        return false;
    }
    if (opts.inventoryFull) {
        return true;
    }
    if (opts.hp <= 0 || opts.maxHp <= 0 || opts.heal <= 0) {
        return false;
    }
    return opts.hp + opts.heal <= opts.maxHp;
}

type MinerFoodWithdrawalPlan = { ok: true; withdraw: number } | { ok: false; withdraw: 0; reason: 'bank-stock' | 'pack-space'; missing: number };

/** Plan an exact top-up without silently accepting a short bank or a cramped pack. */
export function planMinerFoodWithdrawal(opts: { target: number; held: number; banked: number; freeSlots: number }): MinerFoodWithdrawalPlan {
    const target = Math.max(0, Math.floor(opts.target));
    const held = Math.max(0, Math.floor(opts.held));
    const banked = Math.max(0, Math.floor(opts.banked));
    const freeSlots = Math.max(0, Math.floor(opts.freeSlots));
    const shortfall = Math.max(0, target - held);
    if (shortfall === 0) {
        return { ok: true, withdraw: 0 };
    }
    if (held + freeSlots < target) {
        return { ok: false, withdraw: 0, reason: 'pack-space', missing: target - held - freeSlots };
    }
    if (held + banked < target) {
        return { ok: false, withdraw: 0, reason: 'bank-stock', missing: target - held - banked };
    }
    return { ok: true, withdraw: shortfall };
}

/** Restock once at startup, then only after the carried food has been consumed. */
export function minerFoodRestockNeeded(opts: { configured: boolean; foodCount: number; startupPending: boolean }): boolean {
    return opts.configured && (opts.startupPending || opts.foodCount <= 0);
}
