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
    3514: new Tile(3361, 3242, 0) // Jeed — Duel Arena, east of Al Kharid
};
