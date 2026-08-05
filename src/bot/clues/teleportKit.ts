// docs/CLUES.md#teleports
import { ALL_TELEPORT_DESTINATIONS } from '#/bot/nav/teleportCatalog.js';

/**
 * Runes any catalog teleport consumes, and the per-cast count of the hungriest
 * spell that uses each. Derived from the catalog so the two cannot drift.
 */
export function teleportRunes(): { name: string; perCast: number }[] {
    const runes = new Map<string, number>();
    for (const dest of ALL_TELEPORT_DESTINATIONS) {
        for (const item of dest.requires?.items ?? []) {
            runes.set(item.name, Math.max(runes.get(item.name) ?? 0, item.count));
        }
    }
    return [...runes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, perCast]) => ({ name, perCast }));
}

/**
 * Jewellery the catalog rubs. These are name *prefixes* — charges render as
 * "Amulet of glory(4)" — so they are matched by prefix and never withdrawn by
 * name; a trail uses one only if the account already carries it.
 */
export function teleportJewelleryPrefixes(): string[] {
    const out = new Set<string>();
    for (const dest of ALL_TELEPORT_DESTINATIONS) {
        for (const name of dest.itemNameMatch ?? []) {
            out.add(name.toLowerCase());
        }
    }
    return [...out].sort();
}

/** Whether an inventory item is part of the teleport kit and must not be banked. */
export function isTeleportItem(name: string): boolean {
    const n = name.toLowerCase();
    return teleportRunes().some(r => r.name.toLowerCase() === n) || teleportJewelleryPrefixes().some(p => n.startsWith(p));
}
