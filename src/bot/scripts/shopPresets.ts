import Tile from '../api/Tile.js';
import { SHOP_DB } from '../shops/data/shopdb.js';

export interface ShopPreset {
    label: string;
    keeper: string;
    shopStand: Tile;
    bankStand: Tile;
    banker?: string;
    boothName?: string;
    boothOp?: string;
}

export const SHOP_PRESETS: ShopPreset[] = [
    { label: 'Mage Arena runes — Lundail (Gundai bank)', keeper: 'Lundail', shopStand: new Tile(2535, 4719, 0), bankStand: new Tile(2533, 4714, 0), banker: 'Gundai' },
    { label: "Betty's runes — Port Sarim (Falador West bank)", keeper: 'Betty', shopStand: new Tile(3012, 3258, 0), bankStand: new Tile(2946, 3369, 0) },
    { label: "Aubury's runes — Varrock (Varrock East bank)", keeper: 'Aubury', shopStand: new Tile(3253, 3401, 0), bankStand: new Tile(3251, 3420, 0) },
    { label: "Lowe's arrows — Varrock (Varrock East bank)", keeper: 'Lowe', shopStand: new Tile(3231, 3421, 0), bankStand: new Tile(3251, 3420, 0) },
    { label: "Hickton's arrows — Catherby (Catherby bank)", keeper: 'Hickton', shopStand: new Tile(2821, 3442, 0), bankStand: new Tile(2809, 3441, 0) },
    { label: "Gerrant's feathers — Port Sarim (Draynor bank)", keeper: 'Gerrant', shopStand: new Tile(3013, 3224, 0), bankStand: new Tile(3092, 3243, 0) },
    { label: "Harry's feathers — Catherby (Catherby bank)", keeper: 'Harry', shopStand: new Tile(2834, 3444, 0), bankStand: new Tile(2809, 3441, 0) }
];

export function presetByLabel(label: string): ShopPreset | undefined {
    return SHOP_PRESETS.find(p => p.label === label);
}

export function presetBuyableNames(): string[] {
    const names = new Set<string>();
    for (const p of SHOP_PRESETS) {
        const rec = Object.values(SHOP_DB).find(r => r.keepers.includes(p.keeper));
        for (const it of rec?.items ?? []) { names.add(it.name); }
    }
    return [...names].sort();
}
