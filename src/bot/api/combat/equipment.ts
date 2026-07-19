// Curated wielded-weapon options for the combat bots' style-gated dropdowns
// (display names, matching Equipment/Inventory strings). Era-appropriate 2004
// bows and staves — enough to pick a weapon without free text. STAFFS covers the
// autocast-capable staves (elemental/mystic/battlestaves provide a free rune per
// STAFF_RUNES; the plain Staff/Magic staff autocast too, just paying every rune).

export const BOWS: string[] = [
    'Shortbow', 'Longbow',
    'Oak shortbow', 'Oak longbow',
    'Willow shortbow', 'Willow longbow',
    'Maple shortbow', 'Maple longbow',
    'Yew shortbow', 'Yew longbow',
    'Magic shortbow', 'Magic longbow'
];

// One-handed melee weapons (leave the shield slot free — needed alongside an
// anti-dragon shield). Scimitars/swords/longswords, bronze → rune.
export const MELEE_WEAPONS: string[] = [
    'Bronze scimitar', 'Iron scimitar', 'Steel scimitar', 'Black scimitar', 'Mithril scimitar', 'Adamant scimitar', 'Rune scimitar',
    'Bronze sword', 'Iron sword', 'Steel sword', 'Black sword', 'Mithril sword', 'Adamant sword', 'Rune sword',
    'Bronze longsword', 'Iron longsword', 'Steel longsword', 'Black longsword', 'Mithril longsword', 'Adamant longsword', 'Rune longsword'
];

export const STAFFS: string[] = [
    'Staff', 'Magic staff',
    'Staff of air', 'Staff of water', 'Staff of earth', 'Staff of fire',
    'Battlestaff', 'Air battlestaff', 'Water battlestaff', 'Earth battlestaff', 'Fire battlestaff',
    'Mystic air staff', 'Mystic water staff', 'Mystic earth staff', 'Mystic fire staff'
];
