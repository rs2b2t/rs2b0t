import Tile from '#/bot/api/Tile.js';

/**
 * Talk-clue NPC anchors, keyed by CLUE obj id (NOT display name — two easy clues
 * both talk to a "Bartender": id 2686 = Blue Moon Inn, Varrock and id 2696 =
 * Rusty Anchor, Port Sarim, at completely different tiles). Each tile is the
 * NPC's exact spawn read from the map's `==== NPC ====` section
 * (rs2b2t-content/maps); gotoNpc arrives within 1 tile and talkThrough re-finds
 * the NPC within NPC_LEASH, so a counter-front arrival is fine.
 *
 * Audited offline by tools/clues/audit-clues.ts (anchor pathable + a matching
 * NPC spawn within leash), so a bad tile fails the pack-gated test before it
 * abandons live.
 */
export const TALK_ANCHORS: Record<number, Tile> = {
    2681: new Tile(3207, 3233, 0), // Hans — Lumbridge Castle courtyard
    2683: new Tile(3288, 3190, 0), // Zeke — Al Kharid scimitar stall
    2684: new Tile(3276, 3193, 0), // Tanner (Ellis) — Al Kharid tannery
    2686: new Tile(3226, 3399, 0), // Bartender — Blue Moon Inn, Varrock
    2693: new Tile(2977, 3342, 0), // Squire — White Knights' Castle, Falador
    2696: new Tile(3045, 3257, 0), // Bartender — Rusty Anchor Inn, Port Sarim
    2697: new Tile(3100, 3258, 0), // Ned — Draynor Village wheat field (smoke target)
    2698: new Tile(2952, 3451, 0), // Doric — Doric's hut, north of Falador
    2699: new Tile(2885, 3449, 0), // Gaius — weapon shop, Taverley
    2701: new Tile(2803, 3430, 0), // Arhein — Catherby waterfront
    2702: new Tile(2761, 3497, 0), // Sir Kay — Camelot Castle
    3496: new Tile(3028, 3216, 0), // Captain Tobias — Port Sarim docks
    3513: new Tile(2734, 3581, 0), // Louisa — Sinclair Mansion (Seers' area)
    3514: new Tile(3361, 3242, 0), // Jeed — Duel Arena, east of Al Kharid

    // Medium anagram / speak-to clues (Task 3). Tiles = the NPC's exact spawn
    // from the content maps' `==== NPC ====` sections (rs2b2t-content/maps).
    2841: new Tile(2678, 3086, 1), // Hazelmere — green-spider island E of Yanille (upstairs)
    2843: new Tile(3209, 3215, 0), // Cook — Lumbridge Castle kitchen
    2845: new Tile(2611, 3269, 0), // Zoo keeper — Ardougne zoo (E of river)
    2847: new Tile(3232, 3423, 0), // Lowe — Varrock archery store, by the east bank
    2848: new Tile(2779, 3211, 0), // Hajedy — Brimhaven cart, north dock
    2849: new Tile(3272, 3182, 0), // Kebab seller — Al Kharid kebab shop
    2851: new Tile(3015, 3504, 0), // Oracle — Ice Mountain, west of Edgeville
    2853: new Tile(2384, 3488, 0), // Gnome ball referee — Gnome Stronghold ball course
    2855: new Tile(2745, 3576, 1), // Donovan the Family Handyman — Sinclair Mansion, upstairs
    2856: new Tile(2733, 3472, 0), // Party Pete — party room, south of Seers' bank
    2857: new Tile(2542, 3169, 0), // King Bolren — Tree Gnome Village centre, by the spirit tree
    2858: new Tile(2939, 3154, 0), // Luthas — Karamja banana plantation, Musa Point
    3611: new Tile(2459, 3382, 0), // Femi — Gnome Stronghold entrance gate
    3612: new Tile(2390, 9810, 0), // Brimstail — SW Gnome Stronghold, hollowed-out rock cave
    3613: new Tile(2270, 4759, 0), // Saba — Death Plateau cave, Burthorpe
    3614: new Tile(3444, 3459, 0), // Ulizius — Mort Myre swamp gate, Morytania
    3615: new Tile(3493, 3471, 0), // Roavar — Hair of the Dog tavern, Canifis
    3616: new Tile(3358, 3276, 0), // Jaraah — Duel Arena hospital, east of Al Kharid
    3617: new Tile(2791, 3182, 0), // Kangai Mau — Brimhaven food store
    3618: new Tile(2650, 9393, 0) // Fycie — Feldip Hills cave, S of Yanille (Rantz area)
};
