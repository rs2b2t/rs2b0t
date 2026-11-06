import { reader } from '../../../../adapter/ClientAdapter.js';
import type { WorldTile } from '../../../../adapter/ClientAdapter.js';
import { Input } from '../../../../input/Input.js';
import { Bank } from '../../../bank/Bank.js';
import { Equipment } from '../../../equipment/Equipment.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { executeStep, openBankLeg } from '../exec/steps.js';
import { resumePreparation } from './resumePreparation.js';
import type { QuestModule, QuestSnapshot, QuestStep } from './types.js';

type Log = (message: string) => void;
export interface RecoveryItem { id: number; name: string | null; count: number; noted?: boolean }
export interface QuestBankResetPort {
    inventory(): RecoveryItem[] | null;
    equipment(): RecoveryItem[];
    tile(): WorldTile | null;
    inCombat(): boolean;
    openBank(module: QuestModule, log: Log): Promise<boolean>;
    closeBank(): Promise<boolean>;
    bankInventory(): Promise<RecoveryItem[] | null>;
    depositAll(): Promise<void>;
    unequip(id: number): Promise<boolean>;
    withdraw(id: number, qty: number): Promise<boolean>;
    equip(id: number): Promise<boolean>;
    runStep(step: QuestStep, module: QuestModule, log: Log): Promise<boolean>;
}

const livePort: QuestBankResetPort = {
    inventory: () => Bank.isOpen()
        ? reader.bankSideSnapshotReady() ? Inventory.items() : null
        : reader.inventorySnapshotReady() && reader.inventorySize() === 28 ? Inventory.items() : null,
    equipment: () => Equipment.items(),
    tile: () => Game.tile(),
    inCombat: () => Game.inCombat(),
    openBank: async (module, log) => Bank.isOpen() ? Bank.waitReady(4000, log)
        : openBankLeg('recovery: no reachable bank', module.bank === 'nearest' ? undefined : module.bank, log),
    closeBank: () => Bank.close(),
    bankInventory: async () => await Bank.backpackReady() ? Inventory.items() : null,
    depositAll: () => Bank.depositInventory(),
    unequip: async id => {
        const worn = reader.equipment().find(item => item.id === id);
        if (!worn) return true;
        const op = worn.ops.findIndex(op => op?.toLowerCase() === 'remove');
        if (op < 0 || !(await Input.invButton(id, worn.slot, worn.comId, op + 1))) return false;
        return Execution.delayUntil(() => !reader.equipment().some(item => item.id === id), 3000);
    },
    withdraw: async (id, qty) => {
        await Bank.setNoteMode(false);
        return Bank.withdrawXById(id, qty);
    },
    equip: async id => {
        const item = Inventory.items().find(item => item.id === id);
        const op = item?.actions().find(op => /^(wield|wear|equip)$/i.test(op));
        const before = Equipment.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
        if (!item || !op || !(await item.interact(op))) return false;
        return Execution.delayUntil(() => Equipment.items().some(item => item.id === id && item.count > before), 3000);
    },
    runStep: (step, module, log) => executeStep(step, module.hops ?? [], log)
};

function totals(items: RecoveryItem[]): RecoveryItem[] {
    const counts = new Map<number, RecoveryItem>();
    for (const item of items) {
        if (item.count <= 0) continue;
        const found = counts.get(item.id);
        if (found) found.count += item.count;
        else counts.set(item.id, { id: item.id, name: item.name, count: item.count, noted: item.noted });
    }
    return [...counts.values()];
}

const count = (items: RecoveryItem[], id: number): number => items.reduce((sum, item) => sum + (item.id === id ? item.count : 0), 0);

export class QuestBankReset {
    private saved: { module: QuestModule; inventory: RecoveryItem[]; equipment: RecoveryItem[] } | null = null;
    private prepared = false;
    private restoring = false;
    reason = '';

    constructor(private readonly food: string | null = null, private readonly port: QuestBankResetPort = livePort) {}

    get pending(): boolean { return this.saved !== null; }
    get banked(): boolean { return this.prepared; }
    get supplies(): { item: string; id: number; count: number }[] {
        return this.saved ? totals([...this.saved.inventory, ...this.saved.equipment])
            .map(item => ({ item: item.name ?? `#${item.id}`, id: item.id, count: item.count })) : [];
    }

    async tick(module: QuestModule, snap: QuestSnapshot, log: Log): Promise<boolean> {
        return await this.prepare(module, snap, log) && this.restore(log);
    }

    async prepare(module: QuestModule, snap: QuestSnapshot, log: Log): Promise<boolean> {
        if (this.saved && this.saved.module.record.id !== module.record.id) return this.fail('restore the previous quest loadout before switching quests', log);
        if (this.prepared) return true;
        if (this.port.inCombat()) return this.fail('leave combat before resetting the loadout', log);
        if (!this.saved) {
            let inventory = this.port.inventory();
            if (!inventory) return this.fail('waiting for a complete inventory snapshot', log);
            if (inventory.some(item => item.id === 431 && item.count > 0)) return this.fail('deliver the Karamja rum before a bank reset', log);
            if (inventory.some(item => [723, 724, 725, 726].includes(item.id) && item.count > 0)) return this.fail('finish the filled Legends bowl step before a bank reset', log);
            const tile = this.port.tile();
            if (!tile) return this.fail('waiting for a known tile before retreating', log);
            const step = module.recover?.(tile);
            if (step && !(await this.port.runStep(step, module, log))) return this.fail('quest recovery has not reached a safe bank route', log);
            const recovered = this.port.tile();
            const needsExit = recovered && (module.resumeAt?.(recovered) ?? (recovered.z >= 6400 || recovered.level > 0));
            if (needsExit && module.exit && !(await module.exit(log))) return this.fail('quest exit has not reached a safe bank route', log);
            const current = this.port.tile();
            if (!current || module.resumeAt?.(current)) return this.fail('this quest area needs an explicit safe exit before banking; finish or leave the area first', log);
            inventory = this.port.inventory();
            if (!inventory) return this.fail('waiting for a complete inventory snapshot after retreating', log);
            const plan = resumePreparation(module, { ...snap, journal: 'inProgress', freeSlots: 0 }, inventory, this.food);
            const keep = plan ? new Set(plan.keepIds) : null;
            const caps = new Map(plan?.caps.map(item => [item.id, item.qty]));
            this.saved = {
                module,
                inventory: totals(inventory).filter(item => item.id !== 995 && (!keep || keep.has(item.id)))
                    .map(item => ({ ...item, count: Math.min(item.count, caps.get(item.id) ?? item.count) })).filter(item => item.count > 0),
                equipment: totals(this.port.equipment())
            };
        }
        if (!(await this.clearLoadout(module, log))) return false;
        this.prepared = true;
        this.reason = '';
        return true;
    }

    async restore(log: Log): Promise<boolean> {
        const saved = this.saved;
        if (!saved) return true;
        if (this.port.inCombat()) return this.fail('leave combat before restoring the quest loadout', log);
        if (!this.restoring) {
            if (!(await this.clearLoadout(saved.module, log))) return false;
            this.restoring = true;
        }
        for (const item of saved.equipment) {
            const missing = item.count - count(this.port.equipment(), item.id);
            if (missing <= 0) continue;
            if (!(await this.port.openBank(saved.module, log))) return this.fail('cannot reopen the bank to restore equipment', log);
            const inventory = await this.port.bankInventory();
            if (!inventory) return this.fail('waiting for the bank backpack before restoring equipment', log);
            const draw = missing - count(inventory, item.id);
            if (draw > 0 && !(await this.port.withdraw(item.id, draw))) return this.fail(`cannot restore equipped item ${item.id}; keep this quest selected and check the bank`, log);
            if (!(await this.port.closeBank()) || !(await this.port.equip(item.id))
                || count(this.port.equipment(), item.id) < item.count) return this.fail(`could not re-equip item ${item.id}`, log);
        }
        if (!(await this.port.openBank(saved.module, log))) return this.fail('cannot reopen the bank to restore quest items', log);
        for (const item of saved.inventory) {
            const inventory = await this.port.bankInventory();
            if (!inventory) return this.fail('waiting for the bank backpack before restoring quest items', log);
            const missing = item.count - count(inventory, item.id);
            if (missing > 0 && !(await this.port.withdraw(item.id, missing))) return this.fail(`cannot restore quest item ${item.id}; keep this quest selected and check the bank`, log);
        }
        const inventory = await this.port.bankInventory();
        if (!inventory || saved.inventory.some(item => count(inventory, item.id) < item.count)) return this.fail('quest inventory restoration is incomplete', log);
        if (saved.equipment.some(item => count(this.port.equipment(), item.id) < item.count)) return this.fail('quest equipment restoration is incomplete', log);
        if (!(await this.port.closeBank())) return this.fail('could not close the bank after restoring the loadout', log);
        this.saved = null;
        this.prepared = false;
        this.restoring = false;
        this.reason = '';
        return true;
    }

    private async clearLoadout(module: QuestModule, log: Log): Promise<boolean> {
        if (!(await this.port.openBank(module, log))) return this.fail('cannot reach a bank for the loadout reset', log);
        if (!(await this.port.bankInventory())) return this.fail('waiting for the bank backpack before depositing', log);
        await this.port.depositAll();
        let inventory = await this.port.bankInventory();
        if (!inventory || inventory.some(item => item.count > 0)) return this.fail('the bank backpack still contains items after depositing', log);
        if (!(await this.port.closeBank())) return this.fail('could not close the bank to remove equipment', log);
        for (const item of this.port.equipment()) {
            if (!(await this.port.unequip(item.id))) return this.fail(`could not remove equipped item ${item.id}`, log);
        }
        if (this.port.equipment().some(item => item.count > 0)) return this.fail('equipment is still worn after removal', log);
        if (!(await this.port.openBank(module, log)) || !(await this.port.bankInventory())) return this.fail('cannot reopen the bank to deposit equipment', log);
        await this.port.depositAll();
        inventory = await this.port.bankInventory();
        if (!inventory || inventory.some(item => item.count > 0)) return this.fail('the bank backpack still contains removed equipment', log);
        return true;
    }

    private fail(reason: string, log: Log): false {
        this.reason = reason;
        log(`recovery: ${reason}`);
        return false;
    }
}
