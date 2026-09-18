import type { ItemAlias } from '../api/market/aliasTypes.js';

/** User-facing aliases that cannot be derived from object debugnames. @see tools/items/gen-namecollisions.ts */
// Why: Four hides share one display name and are distinguished only by id.
export const ITEM_ALIASES: Readonly<Record<number, ItemAlias>> = {
    // Crystal key halves. Both objs carry the same name and the same desc, differing only in model.
// The loop/tooth labels appear only in a server-content comment.
    985: { words: ['tooth'], label: 'Tooth half of key' },
    987: { words: ['loop'], label: 'Loop half of key' },

    // Green dragonhide debugnames omit the color token.
    1745: { words: ['green'], label: 'Green dragon leather' },
    1065: { words: ['green'], label: 'Green dragon vambraces' },
    1099: { words: ['green'], label: 'Green dragonhide chaps' },
    1135: { words: ['green'], label: 'Green dragonhide body' },

    // Unstrung bows. The strung twin keeps the plain name and needs no entry.
    48: { words: ['u', 'unstrung'], label: 'Longbow (u)' },
    50: { words: ['u', 'unstrung'], label: 'Shortbow (u)' },
    54: { words: ['u', 'unstrung'], label: 'Oak shortbow (u)' },
    56: { words: ['u', 'unstrung'], label: 'Oak longbow (u)' },
    58: { words: ['u', 'unstrung'], label: 'Willow longbow (u)' },
    60: { words: ['u', 'unstrung'], label: 'Willow shortbow (u)' },
    62: { words: ['u', 'unstrung'], label: 'Maple longbow (u)' },
    64: { words: ['u', 'unstrung'], label: 'Maple shortbow (u)' },
    66: { words: ['u', 'unstrung'], label: 'Yew longbow (u)' },
    68: { words: ['u', 'unstrung'], label: 'Yew shortbow (u)' },
    70: { words: ['u', 'unstrung'], label: 'Magic longbow (u)' },
    72: { words: ['u', 'unstrung'], label: 'Magic shortbow (u)' },

    // Holy book page debugnames differ by an internal single-letter code.
    3827: { words: ['saradomin', 'sara'], label: 'Saradomin torn page 1' },
    3828: { words: ['saradomin', 'sara'], label: 'Saradomin torn page 2' },
    3829: { words: ['saradomin', 'sara'], label: 'Saradomin torn page 3' },
    3830: { words: ['saradomin', 'sara'], label: 'Saradomin torn page 4' },
    3831: { words: ['zamorak', 'zammy'], label: 'Zamorak torn page 1' },
    3832: { words: ['zamorak', 'zammy'], label: 'Zamorak torn page 2' },
    3833: { words: ['zamorak', 'zammy'], label: 'Zamorak torn page 3' },
    3834: { words: ['zamorak', 'zammy'], label: 'Zamorak torn page 4' },
    3835: { words: ['guthix'], label: 'Guthix torn page 1' },
    3836: { words: ['guthix'], label: 'Guthix torn page 2' },
    3837: { words: ['guthix'], label: 'Guthix torn page 3' },
    3838: { words: ['guthix'], label: 'Guthix torn page 4' },

    // Strung and unstrung amulets share a name; use natural label order.
    1673: { words: ['unstrung'], label: 'Gold amulet (u)' },
    1675: { words: ['unstrung'], label: 'Sapphire amulet (u)' },
    1677: { words: ['unstrung'], label: 'Emerald amulet (u)' },
    1679: { words: ['unstrung'], label: 'Ruby amulet (u)' },
    1681: { words: ['unstrung'], label: 'Diamond amulet (u)' },
    1683: { words: ['unstrung'], label: 'Dragonstone amulet (u)' },
    1692: { words: ['strung'], label: 'Gold amulet' },
    1694: { words: ['strung'], label: 'Sapphire amulet' },
    1696: { words: ['strung'], label: 'Emerald amulet' },
    1698: { words: ['strung'], label: 'Ruby amulet' },
    1700: { words: ['strung'], label: 'Diamond amulet' },
    1702: { words: ['strung'], label: 'Dragonstone amulet' }
};

/** Shorthand a customer types instead of the display name, keyed by the lowercased name. */
// Common trade shorthand for dragonhide armor.
export const NAME_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
    dragonhide: ['dhide', 'd hide', 'hide'],
    'dragon leather': ['dleather', 'd leather'],
    'dragonhide body': ['dhide body', 'd body', 'hide body'],
    'dragonhide chaps': ['dhide chaps', 'd chaps', 'hide chaps'],
    'dragon vambraces': ['dhide vambs', 'd vambs', 'vambs', 'vambraces'],
    'half of a key': ['half key', 'key half'],
    'sapphire amulet': ['sapp amulet', 'sapp ammy'],
    'emerald amulet': ['emmy amulet', 'emerald ammy'],
    'dragonstoneamulet': ['dragonstone amulet', 'dstone amulet', 'dstone ammy']
};
