/** Structural tile — keeps pure shop modules free of nav/client imports.
 *  The nav layer's NavPoint satisfies it. */
export interface NavPointLike { x: number; z: number; level: number }

/** One stocked item of a shop, from the content pack (authoritative). */
export interface ShopItemDef {
    obj: string;           // content obj id, e.g. 'deathrune'
    name: string;          // display name, e.g. 'Death rune' — what Shop.buy() takes
    baseline: number;      // stock converges here (±1 per restockTicks)
    restockTicks: number;  // engine ticks (600ms) per unit toward baseline
    cost: number;          // obj cost= — base value the price curve scales
    stackable: boolean;
    members: boolean;
}

export interface ShopRecord {
    inv: string;           // content inv id, e.g. 'runeshop'
    title: string;         // shop_title param (may be '')
    keepers: string[];     // display names; any of them opens this shop
    sell: number;          // shop_sell_multiplier, 1000 = 100% (price player pays)
    buy: number;           // shop_buy_multiplier (price player gets)
    delta: number;         // shop_delta per unit of stock deviation
    scope: string;         // 'shared' expected for world shops
    allstock: boolean;     // general store: accepts arbitrary player items
    items: ShopItemDef[];
}

export type BuyPolicy = { kind: 'buyout' } | { kind: 'floor'; pct: number };

export interface GateSpec {
    quest?: string;                            // journal name, needs 'complete'
    skill?: { name: string; level: number };   // base level requirement
    qp?: number;                               // minimum quest points
    members?: boolean;                         // needs a members world
}

export interface RouteShop {
    shopId: string;     // ShopRecord.inv
    keeperNpc: string;  // display name for Shop.open()
    stand: NavPointLike;
    /** Priority order — budget is allocated greedily in this order. */
    buys: { obj: string; policy?: BuyPolicy }[];
}

export interface RouteCluster {
    id: string;
    bank: { stand: NavPointLike; boothName: string; boothOp: string };
    shops: RouteShop[];
    gates: GateSpec[];  // ALL must pass
}

export interface Route {
    clusters: RouteCluster[];
    ring: string[];     // cluster ids in fixed cycle order
}

/** Last observed stock of one item at one shop (persisted per account). */
export interface Seen { count: number; atMs: number }
export type SeenMap = Record<string, Record<string, Seen>>;

/** Pure snapshot of the account, built by the runner from live APIs. */
export interface AccountView {
    members: boolean;
    qp: number;
    quests: Record<string, boolean>;    // journal name -> complete
    skills: Record<string, number>;     // lowercase skill -> base level
}
