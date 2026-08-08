// docs/CLUES.md#teleports
import { ALL_TELEPORT_DESTINATIONS } from '#/bot/nav/teleportCatalog.js';
import { meetsRequires } from '#/bot/nav/requires.js';
import type { TeleportDestination } from '#/bot/nav/teleportCatalog.js';
import type { WorldState } from '#/bot/nav/types.js';

export interface TeleportKit {
    /** Runes the castable spells consume, and the per-cast count of the hungriest. */
    runes: { name: string; perCast: number }[];
    /**
     * Jewellery the account may rub. Name *prefixes* — charges render as
     * "Amulet of glory(4)" — so they are matched by prefix and never withdrawn by
     * name; a trail uses one only if the account already carries it.
     */
    jewelleryPrefixes: string[];
    /**
     * Spell teleportIds the account can cast, for an honest log line. Jewellery is
     * left out: the kit cannot know whether the account carries a charged glory,
     * so listing one here would claim a hop that may not exist.
     */
    usable: string[];
}

/**
 * Whether the account could use this destination if it held the runes. Everything
 * in `requires` except the runes themselves and the pack space to hold them —
 * magic level, members, quest unlocks. Stocking is what fills the item gap, so
 * checking it here would keep every kit permanently empty.
 */
function castable(dest: TeleportDestination, state: WorldState): boolean {
    if (dest.family === 'lever') {
        return false;
    }
    return meetsRequires({ ...dest.requires, items: undefined, freeSlots: undefined }, state).ok;
}

/**
 * The teleport kit for one account. Derived from the catalog so a new destination
 * cannot leave its runes being banked, and gated on what the account can cast so
 * a low-magic trail does not carry four spellbooks' worth of dead runes.
 */
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
