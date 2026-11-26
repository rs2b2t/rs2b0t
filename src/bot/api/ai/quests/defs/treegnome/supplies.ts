import { Equipment } from '../../../../equipment/Equipment.js';
import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { FOOD_FLOAT, QuestFood } from '../../food.js';
import { questWornGear } from '../../gear.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { selectTieredGear } from '../../tieredGear.js';
import { settleScene } from '../../exec/prompts.js';
import { LOGS_WANTED, TG_ITEM, TG_NPC, TG_TILE } from './areas.js';

/** Axes in descending chop speed; the shop sells the iron one. */
export const AXES: readonly { id: number; name: string }[] = [
    { id: 1359, name: 'Rune axe' },
    { id: 1357, name: 'Adamant axe' },
    { id: 1361, name: 'Black axe' },
    { id: 1355, name: 'Mithril axe' },
    { id: 1353, name: 'Steel axe' },
    { id: 1349, name: 'Iron axe' },
    { id: 1351, name: 'Bronze axe' }
];

const SHOP_AXE = 'Iron axe';
const SHOP_AXE_GP = 300;

export const FOOD_LOW = 3;
export const FOOD_TARGET = FOOD_FLOAT;

export function hasAxe(snap: QuestSnapshot): boolean {
    return AXES.some(axe => (snap.invIds?.get(axe.id) ?? 0) > 0 || (snap.wornIds?.has(axe.id) ?? false));
}

export const scanBank = (): QuestStep => ({ kind: 'scanBank', bank: TG_TILE.BANK });

/** Bank first, Aemad second; an unread bank may hold one. */
export function sourceAxe(snap: QuestSnapshot): QuestStep | null {
    if (hasAxe(snap)) {
        return null;
    }
    if (snap.bankKnown !== true) {
        return scanBank();
    }
    const inBank = AXES.find(axe => (snap.bankIds?.get(axe.id) ?? 0) > 0);
    if (inBank) {
        return { kind: 'withdraw', items: [{ name: inBank.name, qty: 1, id: inBank.id }], bank: TG_TILE.BANK };
    }
    return {
        kind: 'buy',
        item: SHOP_AXE,
        qty: 1,
        shop: { npc: TG_NPC.AEMAD, anchor: TG_TILE.AXE_SHOP },
        estGp: SHOP_AXE_GP
    };
}

/** Top the pack back up before a fight the engine's one-shot food withdrawal cannot cover. */
export function topUpFood(snap: QuestSnapshot): QuestStep | null {
    const name = QuestFood.name?.trim();
    if (!name) {
        return null;
    }
    const key = name.toLowerCase();
    if ((snap.inv.get(key) ?? 0) >= FOOD_LOW) {
        return null;
    }
    if (snap.bankKnown !== true) {
        return scanBank();
    }
    const stock = snap.bank?.get(key) ?? 0;
    if (stock === 0) {
        return null;
    }
    const want = Math.min(FOOD_TARGET - (snap.inv.get(key) ?? 0), stock);
    return { kind: 'withdraw', items: [{ name, qty: want }], bank: TG_TILE.BANK };
}

const CHOP_MS = 25_000;
const CHOP_RADIUS = 9;
/** Passes with every tree in reach a stump before the leg reports it. */
const STUMP_PATIENCE = 30;

export async function chopLogs(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(TG_TILE.TREES, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    let stumped = 0;
    while (Inventory.countById(TG_ITEM.LOGS.id) < LOGS_WANTED) {
        const tree = Locs.query().name('Tree').action('Chop down').within(CHOP_RADIUS).nearest();
        if (!tree) {
            // Why: a felled tree is a stump for a few seconds, and the cluster is small enough that all of it can be down at once.
            if (++stumped >= STUMP_PATIENCE) {
                log('every Tree around the battlefield chop stand is a stump');
                return false;
            }
            await Execution.delayTicks(2);
            continue;
        }
        stumped = 0;
        const before = Inventory.countById(TG_ITEM.LOGS.id);
        if (!(await tree.interact('Chop down'))) {
            return false;
        }
        await Execution.delayUntil(() => Inventory.countById(TG_ITEM.LOGS.id) > before, CHOP_MS);
        await Sustain.run();
    }
    return true;
}

// Why: the warlord's config carries no per-style defence, so the fastest weapon wins and the slot list is plain best-available melee.
const GEAR_SLOTS = [
    ['scimitar', 'longsword', 'sword', 'mace', 'battleaxe', 'warhammer'],
    ['platebody', 'chainbody'],
    ['platelegs', 'plateskirt'],
    ['full helm', 'med helm'],
    ['kiteshield', 'sq shield']
] as const;

/** Names `equip` has refused; a re-picked piece burns the run. */
const unwearable = new Set<string>();

function plannedGear(snap: QuestSnapshot): string[] {
    const declared = Object.values(questWornGear(snap));
    if (declared.length === 0) {
        return selectTieredGear(snap, GEAR_SLOTS, unwearable);
    }
    return declared.filter(name => !unwearable.has(name.toLowerCase()) && !snap.worn.has(name.toLowerCase()));
}

async function wearAll(names: readonly string[], log: (m: string) => void): Promise<boolean> {
    for (const name of names) {
        if (Equipment.contains(name) || (await Equipment.equip(name))) {
            continue;
        }
        log(`cannot wear ${name} — level or quest requirement; moving on without it`);
        unwearable.add(name.toLowerCase());
    }
    return true;
}

/** Wield the best melee kit the bank and pack can offer, or null when dressed. */
export function armForTheWarlord(snap: QuestSnapshot): QuestStep | null {
    if (snap.bankKnown !== true) {
        return scanBank();
    }
    const wanted = plannedGear(snap);
    if (wanted.length === 0) {
        return null;
    }
    const missing = wanted.filter(name => (snap.inv.get(name.toLowerCase()) ?? 0) === 0);
    if (missing.length > 0) {
        return { kind: 'withdraw', items: missing.map(name => ({ name, qty: 1 })), bank: TG_TILE.BANK };
    }
    return { kind: 'custom', name: `wear ${wanted.join(', ')}`, run: log => wearAll(wanted, log) };
}
