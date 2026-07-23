import type { ShopRecord } from '#/bot/shops/types.js';

export interface ParsedInv {
    inv: string;
    scope: string;
    allstock: boolean;
    stock: { obj: string; baseline: number; restockTicks: number }[];
}

export interface ParsedKeeper {
    npc: string;
    name: string;
    ownedShops: string[];
    sell: number;
    buy: number;
    delta: number;
    title: string;
}

export interface ParsedObj { name: string; cost: number; stackable: boolean; members: boolean }

interface Block { id: string; lines: string[] }

function blocks(text: string): Block[] {
    const out: Block[] = [];
    let cur: Block | null = null;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        const head = /^\[([a-z0-9_]+)\]$/.exec(line);
        if (head) {
            cur = { id: head[1], lines: [] };
            out.push(cur);
        } else if (cur && line.length > 0 && !line.startsWith('//')) {
            cur.lines.push(line);
        }
    }
    return out;
}

function field(lines: string[], key: string): string | undefined {
    const prefix = `${key}=`;
    const hit = lines.find(l => l.startsWith(prefix));
    return hit?.slice(prefix.length);
}

export function parseInvShops(text: string): ParsedInv[] {
    const out: ParsedInv[] = [];
    for (const b of blocks(text)) {
        const stock: ParsedInv['stock'] = [];
        for (const line of b.lines) {
            const m = /^stock\d+=([a-z0-9_]+),(\d+),(\d+)$/.exec(line);
            if (m) {
                stock.push({ obj: m[1], baseline: Number(m[2]), restockTicks: Number(m[3]) });
            }
        }
        if (stock.length > 0) {
            out.push({ inv: b.id, scope: field(b.lines, 'scope') ?? '', allstock: field(b.lines, 'allstock') === 'yes', stock });
        }
    }
    return out;
}

export function parseNpcKeepers(text: string): ParsedKeeper[] {
    const out: ParsedKeeper[] = [];
    for (const b of blocks(text)) {
        const owned = b.lines
            .map(l => /^param=owned_shop,([a-z0-9_]+)$/.exec(l)?.[1])
            .filter((s): s is string => s !== undefined);
        if (owned.length === 0) {
            continue;
        }
        const num = (key: string, fallback: number): number => {
            const m = b.lines.find(l => l.startsWith(`param=${key},`));
            return m ? Number(m.slice(`param=${key},`.length)) : fallback;
        };
        const title = b.lines.find(l => l.startsWith('param=shop_title,'))?.slice('param=shop_title,'.length) ?? '';
        out.push({
            npc: b.id,
            name: field(b.lines, 'name') ?? b.id,
            ownedShops: owned,
            sell: num('shop_sell_multiplier', 100),
            buy: num('shop_buy_multiplier', 60),
            delta: num('shop_delta', 10),
            title
        });
    }
    return out;
}

export function parseObjDefs(text: string): Record<string, ParsedObj> {
    const out: Record<string, ParsedObj> = {};
    for (const b of blocks(text)) {
        out[b.id] = {
            name: field(b.lines, 'name') ?? b.id,
            cost: Number(field(b.lines, 'cost') ?? '1'),
            stackable: field(b.lines, 'stackable') === 'yes',
            members: field(b.lines, 'members') === 'yes'
        };
    }
    return out;
}

export function joinShopDb(
    invs: ParsedInv[],
    keepers: ParsedKeeper[],
    objs: Record<string, ParsedObj>
): Record<string, ShopRecord> {
    const db: Record<string, ShopRecord> = {};
    for (const inv of invs) {
        const owners = keepers.filter(k => k.ownedShops.includes(inv.inv));
        if (owners.length === 0) {
            continue;
        }
        const first = owners[0];
        db[inv.inv] = {
            inv: inv.inv,
            title: first.title,
            keepers: owners.map(o => o.name),
            sell: first.sell,
            buy: first.buy,
            delta: first.delta,
            scope: inv.scope,
            allstock: inv.allstock,
            items: inv.stock.map(s => {
                const o = objs[s.obj] ?? { name: s.obj, cost: 1, stackable: false, members: false };
                return { obj: s.obj, name: o.name, baseline: s.baseline, restockTicks: s.restockTicks, cost: o.cost, stackable: o.stackable, members: o.members };
            })
        };
    }
    return db;
}
