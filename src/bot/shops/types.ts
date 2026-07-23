export interface NavPointLike { x: number; z: number; level: number }

export interface ShopItemDef {
    obj: string;
    name: string;
    baseline: number;
    restockTicks: number;
    cost: number;
    stackable: boolean;
    members: boolean;
}

export interface ShopRecord {
    inv: string;
    title: string;
    keepers: string[];
    sell: number;
    buy: number;
    delta: number;
    scope: string;
    allstock: boolean;
    items: ShopItemDef[];
}

export type BuyPolicy = { kind: 'buyout' } | { kind: 'floor'; pct: number };

interface GateSpec {
    quest?: string;
    skill?: { name: string; level: number };
    qp?: number;
}

interface RouteShop {
    shopId: string;
    keeperNpc: string;
    stand: NavPointLike;
    buys: { obj: string; policy?: BuyPolicy }[];
}

export interface RouteCluster {
    id: string;
    bank: { stand: NavPointLike; boothName: string; boothOp: string; banker?: string };
    shops: RouteShop[];
    gates: GateSpec[];
    keep?: string[];
    wield?: string[];
    waypoints?: NavPointLike[];
    setting?: string;
    haulBank?: { stand: NavPointLike; banker: string };
}

export interface Route {
    clusters: RouteCluster[];
    ring: string[];
}

export interface Seen { count: number; atMs: number }
export type SeenMap = Record<string, Record<string, Seen>>;

export interface AccountView {
    qp: number;
    quests: Record<string, boolean>;
    skills: Record<string, number>;
}
