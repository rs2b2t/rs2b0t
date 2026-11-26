export function createPickaxes() {
    return [
        { id: 1275, name: 'Rune pickaxe' },
        { id: 1271, name: 'Adamant pickaxe' },
        { id: 1273, name: 'Mithril pickaxe' },
        { id: 1269, name: 'Steel pickaxe' },
        { id: 1267, name: 'Iron pickaxe' },
        { id: 1265, name: 'Bronze pickaxe' }
    ] as const;
}

export const PICKAXES = createPickaxes();
