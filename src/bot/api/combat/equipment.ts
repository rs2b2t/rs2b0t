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

export const STAFFS: string[] = [
    'Staff', 'Magic staff',
    'Staff of air', 'Staff of water', 'Staff of earth', 'Staff of fire',
    'Battlestaff', 'Air battlestaff', 'Water battlestaff', 'Earth battlestaff', 'Fire battlestaff',
    'Mystic air staff', 'Mystic water staff', 'Mystic earth staff', 'Mystic fire staff'
];
