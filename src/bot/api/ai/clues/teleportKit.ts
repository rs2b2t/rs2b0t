// docs/reference/clues-mechanics.md#teleports
import { ALL_TELEPORT_DESTINATIONS } from '#/bot/event/webwalk/teleportCatalog.js';
import { meetsRequires } from '#/bot/event/webwalk/requires.js';
import type { TeleportDestination } from '#/bot/event/webwalk/teleportCatalog.js';
import type { WorldState } from '#/bot/event/webwalk/types.js';

export interface TeleportKit {
    /** Runes the castable spells consume, and the per-cast count of the hungriest. */
    runes: { name: string; perCast: number }[];
    /**
     * Jewellery the account may rub, as name prefixes.
     * Why: charges render as "Amulet of glory(4)", so these match by prefix, are never withdrawn by name, and are used only when the account already carries one.
     */
    jewelleryPrefixes: string[];
    /**
     * Spell teleportIds the account can cast, for an honest log line.
     * Why: jewellery is left out because the kit can't know whether the account carries a charged glory.
     */
    usable: string[];
}

/**
 * Whether the account could use this destination if it held the runes: magic level, members, quest unlocks.
 * Why: runes and pack space are excluded because stocking fills that gap, and checking it here would keep every kit empty.
 */
function castable(dest: TeleportDestination, state: WorldState): boolean {
    if (dest.family === 'lever') {
        return false;
    }
    return meetsRequires({ ...dest.requires, items: undefined, freeSlots: undefined }, state).ok;
}

// Why: derived from the catalog so a new destination can't leave its runes being banked.
// Why: gated on what the account can cast so a low-magic trail doesn't carry 4 spellbooks' worth of dead runes.

/** The teleport kit for one account. */
export function teleportKitFor(state: WorldState): TeleportKit {
    const runes = new Map<string, number>();
    const jewellery = new Set<string>();
    const usable: string[] = [];

    for (const dest of ALL_TELEPORT_DESTINATIONS) {
        if (!castable(dest, state)) {
            continue;
        }
        if (dest.family === 'spell') {
            usable.push(dest.teleportId);
        }
        for (const item of dest.requires?.items ?? []) {
            runes.set(item.name, Math.max(runes.get(item.name) ?? 0, item.count));
        }
        for (const name of dest.itemNameMatch ?? []) {
            jewellery.add(name.toLowerCase());
        }
    }

    return {
        runes: [...runes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, perCast]) => ({ name, perCast })),
        jewelleryPrefixes: [...jewellery].sort(),
        usable
    };
}

/** Whether an inventory item is part of this account's kit and must not be banked. */
export function isTeleportItem(name: string, kit: TeleportKit): boolean {
    const n = name.toLowerCase();
    return kit.runes.some(r => r.name.toLowerCase() === n) || kit.jewelleryPrefixes.some(p => n.startsWith(p));
}
