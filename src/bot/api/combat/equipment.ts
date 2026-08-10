export const BOWS: string[] = [
    'Shortbow', 'Longbow',
    'Oak shortbow', 'Oak longbow',
    'Willow shortbow', 'Willow longbow',
    'Maple shortbow', 'Maple longbow',
    'Yew shortbow', 'Yew longbow',
    'Magic shortbow', 'Magic longbow'
];

export const DARTS: string[] = ['Bronze dart', 'Iron dart', 'Steel dart', 'Black dart', 'Mithril dart', 'Adamant dart', 'Rune dart'];

/**
 * One-handed melee weapons, so the shield slot stays free.
 *
 * Attack style comes from the labels the client offers for whatever is wielded
 * ("aggressive" → strength), so a dagger's Stab/Lunge and a longsword's
 * Chop/Slash resolve without any per-weapon mapping here.
 */
export const MELEE_WEAPONS: string[] = [
    'Bronze scimitar', 'Iron scimitar', 'Steel scimitar', 'Black scimitar', 'Mithril scimitar', 'Adamant scimitar', 'Rune scimitar',
    'Bronze sword', 'Iron sword', 'Steel sword', 'Black sword', 'Mithril sword', 'Adamant sword', 'Rune sword',
    'Bronze longsword', 'Iron longsword', 'Steel longsword', 'Black longsword', 'Mithril longsword', 'Adamant longsword', 'Rune longsword',
    'Dragon longsword',
    'Bronze dagger', 'Iron dagger', 'Steel dagger', 'Black dagger', 'Mithril dagger', 'Adamant dagger', 'Rune dagger', 'Dragon dagger'
];

export const STAFFS: string[] = [
    'Staff', 'Magic staff',
    'Staff of air', 'Staff of water', 'Staff of earth', 'Staff of fire',
    'Battlestaff', 'Air battlestaff', 'Water battlestaff', 'Earth battlestaff', 'Fire battlestaff',
    'Mystic air staff', 'Mystic water staff', 'Mystic earth staff', 'Mystic fire staff'
];
