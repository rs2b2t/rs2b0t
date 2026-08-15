// Host-driven buy / repair / smith execution for gather scripts.

// Why: planning stays pure in {@link ToolAcquire}, and this module owns the bank → walk → shop/NPC/anvil choreography so GatheringBot does not grow another 400-line private method block.
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Bank, withdrawOp } from '../../api/bank/Bank.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Shop } from '../../api/shop/Shop.js';
import { Locs } from '../../api/locs/Locs.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { bestPickaxe, canWieldTool, toolAttackLevel } from '../../api/acquisition/Tools.js';
import {
    COINS,
    HAMMER,
    acquireKeepNames,
    buyPlansCost,
    walkToToolVendor,
    type FishingGearBuyPlan,
    type ToolAcquirePlan,
    type ToolVendor
} from '../../api/acquisition/ToolAcquire.js';

/** Script-facing hooks needed to run acquire plans without owning a bot class. */
export interface ToolAcquireHost {
    setStatus(s: string): void;
    log(m: string): void;
    openBankAt(stand: Tile, log: (m: string) => void): Promise<boolean>;
    waitBankReady(log: (m: string) => void): Promise<boolean>;
    bankPace(log?: (m: string) => void): Promise<void>;
    closeScriptBank(log: (m: string) => void, opts?: { allowForgetful?: boolean }): Promise<void>;
    walkToToolVendor?(vendor: ToolVendor, log: (m: string) => void): Promise<boolean>;
    heldCount(name: string): number;
    gearKeepNamesList(): string[];
    prepareWornSurplusForDeposit(log: (m: string) => void, extraKeep?: readonly string[]): Promise<void>;
    depositSurplusGatherTools(log: (m: string) => void, extraKeep?: readonly string[]): Promise<void>;
    withdrawCoinsFor(need: number, log: (m: string) => void): Promise<boolean>;
    equipTools(
        names: readonly string[],
        log: (m: string) => void,
        opts?: { bankDisplaced?: boolean }
    ): Promise<boolean>;
    /** Defer acquire for N game ticks. */
    markAcquireBackoff(ticks?: number): void;
    attackLevel(): number;
    miningLevel(): number;
    /** Repair dialogue (Bob / Nurmof prefer options). */
    driveDialog(prefer: readonly string[], log: (m: string) => void): Promise<boolean>;
}

async function walkVendor(host: ToolAcquireHost, vendor: ToolVendor, log: (m: string) => void): Promise<boolean> {
    if (host.walkToToolVendor) {
        return host.walkToToolVendor(vendor, log);
    }
    return walkToToolVendor(vendor, log);
}

export async function executeToolAcquirePlan(
    host: ToolAcquireHost,
    plan: ToolAcquirePlan,
    log: (m: string) => void = m => host.log(`  ${m}`),
    opts: { bankPrepared?: boolean } = {}
): Promise<boolean> {
    if (plan.kind === 'repair') {
        return executeRepairPlan(host, plan, log);
    }
    if (plan.kind === 'buy') {
        return executeBuyPlans(host, [plan], log, opts);
    }
    return executeSmithPlan(host, plan, log, opts);
}

/** Buy several fishing gear lines at one vendor in a single bank fund + shop visit. */
export async function executeFishingGearShopCart(
    host: ToolAcquireHost,
    plans: readonly FishingGearBuyPlan[],
    log: (m: string) => void = m => host.log(`  ${m}`),
    opts: { bankPrepared?: boolean } = {}
): Promise<boolean> {
    if (plans.length === 0) {
        return false;
    }
    if (plans.length === 1) {
        return executeBuyPlans(host, [plans[0]!], log, opts);
    }
    return executeBuyPlans(host, plans, log, opts);
}

export async function executeRepairPlan(
    host: ToolAcquireHost,
    plan: Extract<ToolAcquirePlan, { kind: 'repair' }>,
    log: (m: string) => void
): Promise<boolean> {
    host.setStatus(`repair: ${plan.brokenName} @ ${plan.vendor.keeper}`);
    host.log(`acquire: repair ${plan.brokenName} via ${plan.vendor.keeper}`);

    if (Equipment.contains(plan.brokenName) && !Inventory.isFull()) {
        await Equipment.unequip(plan.brokenName);
    }

    if (!(await host.openBankAt(plan.vendor.bankStand, log))) {
        log('acquire: could not open bank before repair — trying vendor with what we hold');
    } else if (await host.waitBankReady(log)) {
        const keep = new Set(acquireKeepNames(plan, host.gearKeepNamesList()).map(n => n.toLowerCase()));
        await Bank.depositAllMatching(name => name.length > 0 && !keep.has(name.toLowerCase()));
        await Execution.delayUntilTicks(() => Bank.loaded() || !Bank.isOpen(), 5);
        await host.bankPace();
        await host.prepareWornSurplusForDeposit(log, acquireKeepNames(plan, host.gearKeepNamesList()));
        await host.depositSurplusGatherTools(log, acquireKeepNames(plan, host.gearKeepNamesList()));
        // Nurmof repairs cost gp — do not walk without the float when withdraw fails.
        if (!(await host.withdrawCoinsFor(1000, log))) {
            if (Inventory.count(COINS) < 1) {
                log('acquire: no repair float in pack after bank — abort (will buy if affordable)');
                host.markAcquireBackoff(50);
                await host.closeScriptBank(log, { allowForgetful: false });
                return false;
            }
            log('acquire: coin withdraw short — continuing with held coins (Bob free / partial float)');
        }
        await host.closeScriptBank(log, { allowForgetful: false });
        // Unequip broken tool after bank if pack now has room.
        if (Equipment.contains(plan.brokenName) && !Inventory.isFull()) {
            await Equipment.unequip(plan.brokenName);
            await Execution.delayTicks(1);
        }
    }

    if (host.heldCount(plan.brokenName) <= 0) {
        log(`acquire: no ${plan.brokenName} held after bank — abort repair`);
        host.markAcquireBackoff(35);
        return false;
    }

    if (!(await walkVendor(host, plan.vendor, log))) {
        log(`acquire: could not reach ${plan.vendor.keeper}`);
        host.markAcquireBackoff(75);
        return false;
    }

    const broken = Inventory.first(plan.brokenName);
    if (!broken) {
        log(`acquire: ${plan.brokenName} not in pack to use on ${plan.vendor.keeper}`);
        host.markAcquireBackoff(35);
        return false;
    }
    const vendor = Npcs.query().name(plan.vendor.keeper).within(12).nearest();
    if (!vendor) {
        log(`acquire: no '${plan.vendor.keeper}' nearby for repair`);
        host.markAcquireBackoff(50);
        return false;
    }

    const beforeBroken = host.heldCount(plan.brokenName);
    log(`acquire: use ${plan.brokenName} on ${plan.vendor.keeper}`);
    if (!(await broken.useOn(vendor))) {
        log(`acquire: use-on ${plan.vendor.keeper} failed — will retry / buy`);
        host.markAcquireBackoff(25);
        return false;
    }
    if (!(await Execution.delayUntilTicks(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 14))) {
        log(`acquire: ${plan.vendor.keeper} never opened repair dialogue`);
        host.markAcquireBackoff(50);
        return false;
    }
    if (!(await host.driveDialog(plan.prefer, log))) {
        log(`acquire: repair dialogue with ${plan.vendor.keeper} failed — will retry / buy`);
        host.markAcquireBackoff(35);
        return false;
    }
    await Execution.delayTicks(2);
    const afterBroken = host.heldCount(plan.brokenName);
    if (afterBroken < beforeBroken) {
        host.log(`acquire: repaired ${plan.brokenName} at ${plan.vendor.keeper}`);
        return true;
    }
    if (plan.label === 'pickaxe' && bestPickaxe(host.miningLevel(), n => host.heldCount(n) > 0)) {
        host.log(`acquire: usable pick after ${plan.vendor.keeper} repair`);
        return true;
    }
    log(`acquire: ${plan.vendor.keeper} did not repair — try buy path`);
    host.markAcquireBackoff(25);
    return false;
}

/**
 * Fund once (vendor bankStand), open shop once, buy every line, close once.
 * All plans must share the same vendor keeper.
 */
export async function executeBuyPlans(
    host: ToolAcquireHost,
    plans: readonly Extract<ToolAcquirePlan, { kind: 'buy' }>[],
    log: (m: string) => void,
    opts: { bankPrepared?: boolean } = {}
): Promise<boolean> {
    if (plans.length === 0) {
        return false;
    }
    const vendor = plans[0]!.vendor;
    for (const p of plans) {
        if (p.vendor.keeper !== vendor.keeper) {
            log(`acquire: multi-buy mixed vendors (${p.vendor.keeper} vs ${vendor.keeper}) — abort`);
            return false;
        }
    }
    const totalCost = buyPlansCost(plans);
    const label = plans.map(p => `${p.qty}× ${p.name}`).join(' + ');
    host.setStatus(`buy: ${label}`);
    host.log(
        plans.length === 1
            ? `acquire: ${plans[0]!.reason} @ ${vendor.keeper} (${totalCost}gp)`
            : `acquire: multi-buy ${label} @ ${vendor.keeper} (${totalCost}gp)`
    );

    const skipBank = opts.bankPrepared === true && Inventory.count(COINS) >= totalCost;
    if (!skipBank) {
        if (!(await host.openBankAt(vendor.bankStand, log))) {
            log('acquire: could not open bank for coins');
            return false;
        }
        if (!(await host.waitBankReady(log))) {
            log('acquire: bank did not load for coin withdraw');
            return false;
        }
        const keepExtra = [...host.gearKeepNamesList(), ...plans.map(p => p.name)];
        const keep = new Set(acquireKeepNames(plans[0]!, keepExtra).map(n => n.toLowerCase()));
        await Bank.depositAllMatching(name => name.length > 0 && !keep.has(name.toLowerCase()));
        await Execution.delayUntilTicks(() => Bank.loaded() || !Bank.isOpen(), 5);
        await host.bankPace();
        await host.prepareWornSurplusForDeposit(log, acquireKeepNames(plans[0]!, keepExtra));
        await host.depositSurplusGatherTools(log, acquireKeepNames(plans[0]!, keepExtra));

        if (Inventory.count(COINS) + Bank.count(COINS) < totalCost) {
            log(`acquire: not enough coins for ${label} (${totalCost}gp)`);
            host.markAcquireBackoff(100);
            await host.closeScriptBank(log, { allowForgetful: false });
            return false;
        }
        if (!(await host.withdrawCoinsFor(totalCost, log))) {
            host.markAcquireBackoff(50);
            await host.closeScriptBank(log, { allowForgetful: false });
            return false;
        }
        await host.closeScriptBank(log, { allowForgetful: false });
    } else {
        log('acquire: bank already prepared — heading to shop');
        if (Bank.isOpen()) {
            await host.closeScriptBank(log, { allowForgetful: false });
        }
    }

    if (!(await walkVendor(host, vendor, log))) {
        log(`acquire: could not reach ${vendor.keeper}`);
        host.markAcquireBackoff(75);
        return false;
    }
    if (!(await Shop.open(vendor.keeper))) {
        log(`acquire: could not open ${vendor.keeper}'s shop`);
        host.markAcquireBackoff(50);
        return false;
    }

    let anyBought = false;
    const toEquip: string[] = [];
    const attack = host.attackLevel();
    for (const plan of plans) {
        const before = Inventory.count(plan.name);
        const bought = await Shop.buy(plan.name, plan.qty);
        const got = bought > 0 ? bought : Math.max(0, Inventory.count(plan.name) - before);
        if (got <= 0) {
            log(`acquire: bought 0× ${plan.name} — stock/coins`);
            continue;
        }
        anyBought = true;
        host.log(`acquire: bought ${got}× ${plan.name}`);
        if (plan.equip && canWieldTool(plan.name, attack)) {
            toEquip.push(plan.name);
        } else if (plan.equip) {
            log(`equip: skip ${plan.name} (need Attack ${toolAttackLevel(plan.name)})`);
        }
    }
    // Close shop before Wield — pack ops are Sell-* while the shop main modal is open.
    await Shop.close();
    await Execution.delayUntilTicks(() => !Shop.isOpen(), 5);
    await Execution.delayTicks(1);
    await Game.openSideTab(3);
    await Execution.delayTicks(1);
    if (toEquip.length > 0) {
        await host.equipTools(toEquip, log, { bankDisplaced: false });
    }

    if (!anyBought) {
        host.markAcquireBackoff(35);
        return false;
    }
    return true;
}

export async function executeSmithPlan(
    host: ToolAcquireHost,
    plan: Extract<ToolAcquirePlan, { kind: 'smith' }>,
    log: (m: string) => void,
    opts: { bankPrepared?: boolean } = {}
): Promise<boolean> {
    host.setStatus(`smith: ${plan.name}`);
    host.log(`acquire: ${plan.reason} @ Varrock anvil`);

    const materialsHeld = Inventory.count(HAMMER) >= 1 && Inventory.count(plan.bar) >= 1;
    // Honor bankPrepared when materials are already in pack (same contract as buy).
    const skipBank = opts.bankPrepared === true && materialsHeld;
    if (materialsHeld || skipBank) {
        log('acquire: smith materials already held — heading to anvil');
        if (Bank.isOpen()) {
            await host.closeScriptBank(log, { allowForgetful: false });
        }
    } else {
        if (!(await host.openBankAt(plan.vendorBank, log))) {
            log('acquire: could not open bank for smith materials');
            return false;
        }
        if (!(await host.waitBankReady(log))) {
            log('acquire: bank did not load for smith materials');
            return false;
        }
        const keep = new Set(acquireKeepNames(plan, host.gearKeepNamesList()).map(n => n.toLowerCase()));
        await Bank.depositAllMatching(name => name.length > 0 && !keep.has(name.toLowerCase()));
        await Execution.delayUntilTicks(() => Bank.loaded() || !Bank.isOpen(), 5);
        await host.bankPace();
        await host.prepareWornSurplusForDeposit(log, acquireKeepNames(plan, host.gearKeepNamesList()));
        await host.depositSurplusGatherTools(log, acquireKeepNames(plan, host.gearKeepNamesList()));

        if (Inventory.count(HAMMER) < 1) {
            const h = Bank.items().find(i => (i.name ?? '').toLowerCase() === HAMMER.toLowerCase());
            if (!h) {
                log('acquire: no hammer for smithing');
                host.markAcquireBackoff(100);
                await host.closeScriptBank(log, { allowForgetful: false });
                return false;
            }
            const one = withdrawOp(h.ops, '1') ?? 'Withdraw-1';
            await host.bankPace();
            await Bank.withdraw(HAMMER, one);
            await Execution.delayUntilTicks(() => Inventory.count(HAMMER) > 0, 5);
            await host.bankPace();
        }
        if (Inventory.count(plan.bar) < 1) {
            const b = Bank.items().find(i => (i.name ?? '').toLowerCase() === plan.bar.toLowerCase());
            if (!b) {
                log(`acquire: no ${plan.bar} in bank`);
                host.markAcquireBackoff(100);
                await host.closeScriptBank(log, { allowForgetful: false });
                return false;
            }
            const one = withdrawOp(b.ops, '1') ?? 'Withdraw-1';
            await host.bankPace();
            await Bank.withdraw(plan.bar, one);
            await Execution.delayUntilTicks(() => Inventory.count(plan.bar) > 0, 5);
            await host.bankPace();
        }
        await host.closeScriptBank(log, { allowForgetful: false });
    }

    if (Inventory.count(HAMMER) < 1 || Inventory.count(plan.bar) < 1) {
        log(`acquire: missing hammer or ${plan.bar} before anvil walk`);
        host.markAcquireBackoff(50);
        return false;
    }

    if (!(await Traversal.walkResilient(plan.anvilStand, { radius: 2, timeoutMs: 90_000, log }))) {
        log('acquire: could not reach anvil');
        return false;
    }
    const bar = Inventory.first(plan.bar);
    const anvil = Locs.query().name('Anvil').nearest();
    if (!bar || !anvil) {
        log('acquire: missing bar or anvil');
        return false;
    }
    const before = Inventory.count(plan.name);
    if (!(await bar.useOn(anvil))) {
        return false;
    }
    await Execution.delayUntilTicks(() => ChatDialog.isMainMakePanel() || ChatDialog.canContinue(), 10);
    if (ChatDialog.isMainMakePanel()) {
        // Prefer exact product name first — bare 'Axe' matches Battleaxe via includes().
        if (!(await ChatDialog.makeFromPanelMax(plan.name))) {
            await ChatDialog.makeFromPanelMax('Axe');
        }
    }
    await Execution.delayUntilTicks(() => Inventory.count(plan.name) > before || !Game.animating(), 20);
    if (Inventory.count(plan.name) <= before) {
        log(`acquire: smith did not produce ${plan.name}`);
        host.markAcquireBackoff(35);
        return false;
    }
    host.log(`acquire: smithed ${plan.name}`);
    if (ChatDialog.isMainMakePanel() || ChatDialog.isOpen()) {
        await Execution.delayUntilTicks(() => !ChatDialog.isMainMakePanel() && !ChatDialog.isOpen(), 5);
        await Execution.delayTicks(1);
    }
    await Game.openSideTab(3);
    await Execution.delayTicks(1);
    if (plan.equip && canWieldTool(plan.name, host.attackLevel())) {
        let equipped = await host.equipTools([plan.name], log, { bankDisplaced: false });
        if (!equipped && Inventory.first(plan.name) && !Equipment.contains(plan.name)) {
            log(`equip: retry ${plan.name} after smith`);
            await Execution.delayTicks(2);
            await Game.openSideTab(3);
            equipped = await host.equipTools([plan.name], log, { bankDisplaced: false });
        }
    } else if (plan.equip) {
        log(`equip: skip ${plan.name} (need Attack ${toolAttackLevel(plan.name)})`);
    }
    return true;
}
