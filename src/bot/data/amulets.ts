const GOLD = { label: 'Gold amulet', unstrung: 1673, strung: 1692 } as const;
export const SAPPHIRE = { label: 'Sapphire amulet', unstrung: 1675, strung: 1694 } as const;
export const EMERALD = { label: 'Emerald amulet', unstrung: 1677, strung: 1696 } as const;
export const RUBY = { label: 'Ruby amulet', unstrung: 1679, strung: 1698 } as const;
export const DIAMOND = { label: 'Diamond amulet', unstrung: 1681, strung: 1700 } as const;
export const DRAGONSTONE = { label: 'Dragonstone amulet', unstrung: 1683, strung: 1702 } as const;

export const AMULETS = [GOLD, SAPPHIRE, EMERALD, RUBY, DIAMOND, DRAGONSTONE] as const;
export type Amulet = typeof AMULETS[number];
