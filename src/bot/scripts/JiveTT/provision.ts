import { Bank } from '../../api/bank/Bank.js';
import { nearestBank } from '../../api/bank/BankLocations.js';
import { openClueBank } from '../../api/ai/clues/bankAccess.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { liveCatalog } from '../../api/market/catalog.js';
import { Skills } from '../../api/skills/Skills.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { escapeRunesFor } from '../../api/combat/hunting/supply.js';
import Tile from '../../geometry/Tile.js';
import { levelerTravelZones } from '../AccountLeveler/travel.js';
import { canonicalId, countStock, planPack, potionPack } from './stock.js';
import type { ItemStack, JiveSettings, JiveSite, PackLine, PackPlan } from './types.js';

export async function freshBank(log: (message: string) => void): Promise<boolean> {
    if (Bank.isOpen() && !(await Bank.close())) return false;
    const here = Game.tile();
    const bank = here && nearestBank(here);
    if (!bank) return false;
    if (!(await Traversal.walkResilient(Tile.from(bank.tile), { radius: 3, attempts: 2, timeoutMs: 90000, avoidZones: levelerTravelZones(), log }))) return false;
    return await openClueBank(log) && await Bank.waitReady();
}

export function escapeManifest(teleport: string, casts = 1): PackLine[] {
    const catalog = liveCatalog();
    return escapeRunesFor(teleport).runes.map(rune => {
        const item = catalog.items.find(i => i.name.toLowerCase() === rune.rune.toLowerCase());
        if (!item) throw new Error(`Escape rune missing from catalog: ${rune.rune}`);
        return { id: item.id, count: rune.count * casts, stackable: true, purpose: 'escape' };
    });
}

export function huntingPack(site: JiveSite, settings: JiveSettings, stock: readonly ItemStack[]): PackPlan {
    const lines: PackLine[] = [{ id: 385, count: settings.sharks, stackable: false, purpose: 'food' }, ...escapeManifest(site.escapeTeleportId, 2)];
    for (const [family, target] of [['prayer', settings.prayerDoses], ['attack', settings.superDoses], ['strength', settings.superDoses], ['defence', settings.superDoses], ['antifire', site.requirements.antifire ? 3 : 0], ['antipoison', site.requirements.antipoison ? 3 : 0]] as const) {
        if (!target) continue;
        const potions = potionPack(stock, family, target);
        if (!potions) return { kind: 'blocked', reason: `Missing ${family} doses: need ${target}` };
        lines.push(...potions);
    }
    for (const id of site.requirements.items.filter(id => id !== 1540)) lines.push({ id, count: 1, stackable: false, purpose: 'entry' });
    if ((site.requirements.access ?? []).includes('brimhaven-axe-route')) {
        const axe = [1351, 1349, 1353, 1361, 1355, 1357, 1359].find(id => countStock(stock, id) > 0);
        if (!axe) return { kind: 'blocked', reason: 'An owned axe is required for Brimhaven' };
        lines.push({ id: axe, count: 1, stackable: false, purpose: 'entry' });
    }
    if (site.requirements.entryCoins) lines.push({ id: 995, count: site.requirements.entryCoins, stackable: true, purpose: 'entry' });
    return planPack(lines, 1);
}

export function missingPack(plan: PackPlan, stock: readonly ItemStack[]): string | null {
    if (plan.kind === 'blocked') return plan.reason;
    const missing = plan.items.filter(i => countStock(stock, i.id) < i.count);
    return missing.length ? missing.map(i => `${i.purpose}: item ${i.id} x${i.count - countStock(stock, i.id)}`).join(', ') : null;
}

export async function equipOwned(ids: readonly number[], log: (message: string) => void): Promise<boolean> {
    if (!Bank.ready()) return false;
    await Bank.setNoteMode(false);
    for (const id of ids) {
        if (Equipment.items().some(i => i.id === id)) continue;
        if (!Inventory.countById(id) && !(await Bank.withdrawXById(id, 1))) return false;
    }
    if (!(await Bank.close())) return false;
    for (const id of ids) {
        if (Equipment.items().some(i => i.id === id)) continue;
        const item = Inventory.items().find(i => i.id === id && !i.noted);
        if (!item?.name || !(await Equipment.equip(item.name)) || !Equipment.items().some(i => i.id === id)) return false;
    }
    return await openClueBank(log) && await Bank.waitReady();
}

export async function packInventory(plan: PackPlan, log: (message: string) => void): Promise<boolean> {
    if (plan.kind !== 'ready' || !Bank.ready()) return false;
    await Bank.depositInventory();
    if (Inventory.used() !== 0) return false;
    await Bank.setNoteMode(false);
    for (const item of plan.items) {
        if (!(await Bank.withdrawXById(item.id, item.count))) return false;
    }
    const ready = plan.items.every(item => countStock(Inventory.items(), item.id, true) >= item.count);
    if (!ready) { log('Withdrawn supplies do not match the trip manifest'); return false; }
    return await Bank.close() && plan.items.every(item => countStock(Inventory.items(), item.id, true) >= item.count);
}

export function escapeReady(teleport: string): boolean {
    return Skills.level('magic') >= escapeRunesFor(teleport).level && escapeManifest(teleport).every(i => countStock(Inventory.items(), i.id, true) >= i.count);
}

export async function healAtBank(log: (message: string) => void): Promise<boolean> {
    for (let attempt = 0; attempt < 10 && Skills.effective('hitpoints') < Skills.level('hitpoints'); attempt++) {
        if (!Bank.ready() && !(await openClueBank(log) && await Bank.waitReady())) return false;
        if (!Inventory.countById(385) && !(await Bank.withdrawXById(385, 1))) return false;
        if (!(await Bank.close())) return false;
        const shark = Inventory.items().find(i => i.id === 385 && !i.noted);
        const hp = Skills.effective('hitpoints');
        if (!shark || !(await shark.interact('Eat')) || !(await Execution.delayUntilTicks(() => Skills.effective('hitpoints') > hp, 3))) return false;
    }
    return Skills.effective('hitpoints') >= Skills.level('hitpoints') && await openClueBank(log) && await Bank.waitReady();
}

export function normalized(items: readonly ItemStack[]): ItemStack[] {
    const catalog = liveCatalog();
    const counts = new Map<number, number>();
    for (const item of items) {
        const id = catalog.unnotedOf.get(item.id) ?? canonicalId(item.id);
        counts.set(id, (counts.get(id) ?? 0) + item.count);
    }
    return [...counts].map(([id, count]) => ({ id, count }));
}
