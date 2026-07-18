/**
 * Fishing methods for the Fisher preset. Every fishing spot in the game is named
 * "Fishing spot" but exposes a PAIR of ops, and the four spot types are:
 *   Net/Bait, Lure/Bait, Cage/Harpoon, Net/Harpoon   (verified in content
 *   scripts/skill_fishing/configs/fishing.npc).
 *
 * The same op can appear on two different spots and catch DIFFERENT fish at
 * DIFFERENT levels — "Net" is Shrimps/Anchovies on the Net/Bait spot but
 * Mackerel/Cod/Bass on the Net/Harpoon spot; "Bait" is Sardine/Herring on
 * Net/Bait but Pike on Lure/Bait. So a method is (op to click) + the OTHER op
 * that identifies the right spot (`pair`). Harpoon catches Tuna/Swordfish on
 * BOTH harpoon spots, so it needs no pair (any spot offering Harpoon works).
 */
export interface FishingMethod {
    /** Dropdown label (the settings panel snaps to this string). */
    name: string;
    /** The op to click on the Fishing spot. */
    op: string;
    /** The other op that must also be on the spot, to pick the right one of two
     *  spots that share `op`. Omit to match any spot offering `op`. */
    pair?: string;
    /** The equipment this method uses (exact item names, pack-verified) — the
     *  ONLY things a bank trip keeps; everything else in the pack is deposited
     *  (big-net junk, caskets, whatever the run accumulated). */
    gear: string[];
    /** Restrict to these "Fishing spot" npc ids. Needed when the op PAIR is
     *  ambiguous: the Net/Harpoon spot (sharks) and the regular
     *  Net/Harpoon spot (tuna/swordfish via Net=mackerel) present identical
     *  ops — only the npc id tells them apart. Omit to match any spot. */
    spotIds?: number[];
}

/** "Fishing spot" npc ids of the Net/Harpoon spots (category
 *  memberfish, pack/npc.pack) — Harpoon on THESE is sharks (76 Fishing);
 *  the Fishing Guild cluster is 313. */
export const SHARK_SPOT_IDS: number[] = [313, 322, 334, 1191, 1333];

/** Whirlpool spot variants (fishing anti-macro): the worked spot is
 *  npc_changetype'd into one of these for 60 ticks; it does NOT auto-continue
 *  the fishing, but RE-clicking it a few times swallows the fishing
 *  equipment. Same "Fishing spot" name and ops as the real thing — the
 *  Fisher's find() refuses them by id so the re-click can never happen. */
export const WHIRLPOOL_IDS: Set<number> = new Set([403, 404, 405, 406]);

export const FISHING_METHODS: FishingMethod[] = [
    { name: 'Small net — shrimp/anchovy', op: 'Net', pair: 'Bait', gear: ['Small fishing net'] }, // Net/Bait spot: Shrimps (1), Anchovies (15)
    { name: 'Bait rod — sardine/herring', op: 'Bait', pair: 'Net', gear: ['Fishing rod', 'Fishing bait'] }, // Net/Bait spot: Sardine (5), Herring (10)
    { name: 'Fly fishing — trout/salmon', op: 'Lure', pair: 'Bait', gear: ['Fly fishing rod', 'Feather'] }, // Lure/Bait spot: Trout (20), Salmon (30)
    { name: 'Bait rod — pike', op: 'Bait', pair: 'Lure', gear: ['Fishing rod', 'Fishing bait'] }, // Lure/Bait spot: Pike (25)
    { name: 'Big net — mackerel/cod/bass', op: 'Net', pair: 'Harpoon', gear: ['Big fishing net'] }, // Net/Harpoon spot: Mackerel (16), Cod (23), Bass (46)
    { name: 'Lobster cage — lobster', op: 'Cage', pair: 'Harpoon', gear: ['Lobster pot'] }, // Cage/Harpoon spot: Lobster (40)
    { name: 'Harpoon — tuna/swordfish', op: 'Harpoon', gear: ['Harpoon'] }, // Cage/Harpoon OR Net/Harpoon spot: Tuna (35), Swordfish (50)
    { name: 'Harpoon — sharks', op: 'Harpoon', pair: 'Net', gear: ['Harpoon'], spotIds: SHARK_SPOT_IDS } // Net/Harpoon spot (Fishing Guild): Shark (76)
];

export const FISHING_METHOD_OPTIONS = FISHING_METHODS.map(m => m.name);

/** Resolve a dropdown label to its method (falls back to the first method). */
export function resolveFishMethod(name: string): FishingMethod {
    return FISHING_METHODS.find(m => m.name === name) ?? FISHING_METHODS[0];
}
