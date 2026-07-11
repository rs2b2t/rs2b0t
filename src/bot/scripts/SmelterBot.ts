import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Locs } from '../api/queries/Locs.js';
import { walkOpening } from '../api/walkOpening.js';
import { Reachability } from '../api/Reachability.js';
import { actions, reader } from '../adapter/ClientAdapter.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import {
    BAR_OPTIONS,
    recipeForBar,
    withdrawPlan,
    countPrimary,
    lastPrimaryIndex,
    type Recipe
} from './SmelterBotLogic.js';

const DEFAULT_BANK_STAND = new Tile(3269, 3167, 0);
// The Al Kharid furnace loc sits at (3272,3185); the web-walker approaches from
// the EAST, so stand on the walkable tile just east of it — adjacent to the loc
// (so the smelt interact lands) and on the reachable side (the west/south tiles
// are split off from the approach by the furnace structure). Verified live.
const DEFAULT_FURNACE_STAND = new Tile(3273, 3185, 0);
const BOOTH = { op: 'Use-quickly' };

export const SETTINGS: SettingsSchema = {
    bar: { type: 'string', default: 'Bronze', options: [...BAR_OPTIONS], label: 'Bar to smelt', help: 'withdraw plan + coal ratio are derived from this' },
    bankStand: { type: 'tile', default: DEFAULT_BANK_STAND, label: 'Bank stand tile (x,z)' },
    furnaceStand: { type: 'tile', default: DEFAULT_FURNACE_STAND, label: 'Furnace stand tile (x,z)' },
    furnaceName: { type: 'string', default: 'Furnace', label: 'Furnace loc name' },
    bankBooth: { type: 'string', default: 'Bank booth', label: 'Bank booth loc name' },
    obstacle: { type: 'string', default: 'door, gate', label: 'Openable obstacles (contains)', help: 'the bank-building door on the route' },
    leashRadius: { type: 'number', default: 8, min: 2, max: 20, label: 'Furnace search radius (tiles)' }
};

/**
 * Al Kharid smelt-and-bank loop. Withdraw a pack of ore per the chosen bar's
 * recipe, cross to the Furnace (opening the bank-building door), smelt every bar
 * by using the LAST primary ore on the furnace one at a time, then return and
 * bank the whole pack (bars + any leftover), and repeat. Runs off bank-fed ore;
 * stops cleanly when the bank can no longer supply a full set. Start it at the
 * Al Kharid bank.
 */
export default class SmelterBot extends TaskBot {
    override loopDelay = 600;

    private smelted = 0;
    private trips = 0;
    private status = 'starting';

    private recipe: Recipe = recipeForBar('Bronze')!;
    private bankStand = DEFAULT_BANK_STAND;
    private furnaceStand = DEFAULT_FURNACE_STAND;
    private furnaceName = 'Furnace';
    private boothName = 'Bank booth';
    private obstacle: string[] = ['door', 'gate'];
    private leash = 8;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const barName = this.settings.str('bar', 'Bronze');
        this.recipe = recipeForBar(barName) ?? recipeForBar('Bronze')!;
        this.bankStand = this.settings.tile('bankStand', DEFAULT_BANK_STAND);
        this.furnaceStand = this.settings.tile('furnaceStand', DEFAULT_FURNACE_STAND);
        this.furnaceName = this.settings.str('furnaceName', 'Furnace');
        this.boothName = this.settings.str('bankBooth', 'Bank booth');
        this.obstacle = this.settings.str('obstacle', 'door, gate').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        this.leash = this.settings.num('leashRadius', 8);

        const plan = withdrawPlan(this.recipe).map(p => `${p.count} ${p.ore}`).join(' + ');
        this.log(`SmelterBot smelting '${this.recipe.bar}' (${plan}) — bank ${this.bankStand}, furnace ${this.furnaceStand}`);
        this.add(new ContinueDialog(), new BankTrip(this), new SmeltTrip(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [
            `SmelterBot — ${this.status}`,
            `${this.recipe.bar}: smelted ${this.smelted}  bank trips ${this.trips}`,
            `ore left ${this.primaryCount()}  tick ${Game.tick()}`
        ];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#ffd479';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void { this.status = s; }
    recordSmelt(n: number): void { this.smelted += n; }
    countTrip(): void { this.trips++; }
    activeRecipe(): Recipe { return this.recipe; }
    furnaceLocName(): string { return this.furnaceName; }
    obstacleList(): string[] { return this.obstacle; }
    leashRadius(): number { return this.leash; }
    bankTile(): Tile { return this.bankStand; }
    furnaceTile(): Tile { return this.furnaceStand; }
    boothLocName(): string { return this.boothName; }
    primaryCount(): number { return countPrimary(Inventory.items(), this.recipe); }
    /** The LAST primary-ore InvItem in the pack (the smelt target), or null. */
    lastPrimary() {
        const items = Inventory.items();
        const idx = lastPrimaryIndex(items, this.recipe);
        return idx >= 0 ? items[idx] : null;
    }
}

class ContinueDialog implements Task {
    validate(): boolean { return ChatDialog.canContinue(); }
    async execute(): Promise<void> { await ChatDialog.continue(); }
}

/** No primary ore in the pack → cross to the bank, deposit EVERYTHING, withdraw a
 *  full ore mix per the recipe's withdraw plan. If the bank can't supply a full
 *  set of any ingredient, log the shortage and stop cleanly. */
class BankTrip implements Task {
    constructor(private bot: SmelterBot) {}
    validate(): boolean { return this.bot.primaryCount() === 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('banking');
        await walkOpening(this.bot.bankTile(), 0, this.bot.obstacleList(), m => this.bot.log(m));
        if (!(await Bank.openBooth(this.bot.bankTile(), this.bot.boothLocName(), BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }
        await Bank.depositInventory(); // bars + any leftover ore/junk — the whole pack
        await Execution.delayTicks(1);
        this.bot.countTrip();

        const recipe = this.bot.activeRecipe();
        const plan = withdrawPlan(recipe);

        // Pre-flight: confirm the bank can supply a FULL set of every ingredient.
        // If any is short, this trip can't produce whole bars — stop cleanly
        // (as StallGuard does) rather than idle-spin or half-fill a pack.
        for (const step of plan) {
            const bankItem = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(step.ore.toLowerCase()));
            const have = bankItem?.name ? Bank.count(bankItem.name) : 0;
            if (!bankItem || bankItem.name === null || have < step.count) {
                this.bot.log(`out of '${step.ore}' — bank has ${have}, need ${step.count} for a full trip of ${recipe.bar}. Stopping.`);
                this.bot.setStatus(`out of ${step.ore} — stopped`);
                ScriptRunner.stop();
                return;
            }
        }

        // Withdraw each ingredient. Read the REAL Withdraw-All op off the item's
        // OWN ops (label varies by build; a hardcoded one silently withdraws
        // nothing); fall back to Withdraw-10 batches. Coal/tin can share the same
        // 'Coal'/'Tin ore' bank name across the pack, so confirm by inventory
        // count of that specific ore.
        for (const step of plan) {
            const bankItem = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(step.ore.toLowerCase()));
            if (!bankItem || bankItem.name === null) {
                this.bot.log(`'${step.ore}' vanished from the bank mid-trip — stopping.`);
                ScriptRunner.stop();
                return;
            }
            const bankName = bankItem.name;
            const ops = bankItem.ops.filter((o): o is string => o !== null);
            this.bot.setStatus(`withdrawing ${step.count} ${bankName}`);
            const target = Inventory.count(bankName) + step.count;
            if (step.count >= 28) {
                const allOp = ops.find(o => /withdraw[\s-]*all/i.test(o));
                if (allOp) {
                    await Bank.withdraw(bankName, allOp);
                    await Execution.delayUntil(() => Inventory.count(bankName) >= target || Inventory.isFull() || Bank.count(bankName) === 0, 4000);
                    continue;
                }
            }
            // Withdraw-10 batches up to the needed count (works for partial sets
            // like steel's 9 iron / 18 coal, and when no Withdraw-All op exists).
            const tenOp = ops.find(o => /withdraw[\s-]*10/i.test(o)) ?? ops.find(o => /^withdraw/i.test(o)) ?? 'Withdraw-10';
            for (let n = 0; n < 6 && Inventory.count(bankName) < target && !Inventory.isFull() && Bank.count(bankName) > 0; n++) {
                const before = Inventory.count(bankName);
                await Bank.withdraw(bankName, tenOp);
                if (!(await Execution.delayUntil(() => Inventory.count(bankName) > before || Inventory.isFull(), 3000))) { break; }
            }
        }
        // walking closes the bank; SmeltTrip crosses to the furnace next tick
    }
}

/** Primary ore in the pack → cross to the furnace and smelt the LAST primary ore,
 *  one bar at a time, until none remain. */
class SmeltTrip implements Task {
    constructor(private bot: SmelterBot) {}
    validate(): boolean { return this.bot.primaryCount() > 0 && !ChatDialog.isOpen(); }
    async execute(): Promise<void> {
        const furnace = () => Locs.query().name(this.bot.furnaceLocName()).where(l => l.tile().distanceTo(this.bot.furnaceTile()) <= this.bot.leashRadius()).nearest();
        const here = Game.tile();
        if (!here || this.bot.furnaceTile().distanceTo(here) > 1 || !furnace()) {
            this.bot.setStatus('crossing to the furnace');
            await walkOpening(this.bot.furnaceTile(), 0, this.bot.obstacleList(), m => this.bot.log(m));
        }
        // The baked web-walker parks a couple tiles short of the Al Kharid furnace
        // (its building isn't routable in the baked collision pack), so close the
        // last gap with a LIVE scene walk over the client's live collision — the
        // same trick RandomEvents uses in the maze. Step toward the furnace loc
        // until we're beside it, then the smelt loop can use ore on it.
        const oven0 = furnace();
        if (oven0) {
            const ovenTile = oven0.tile();
            // nearest WALKABLE, live-reachable tile adjacent to the furnace (its
            // own tile is unwalkable, so we must step beside it, not onto it).
            const stand = (): Tile | null => {
                const me = Game.tile();
                const cands = [[1, 0], [0, 1], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]
                    .map(([dx, dz]) => new Tile(ovenTile.x + dx, ovenTile.z + dz, ovenTile.level))
                    .filter(t => reader.toLocal(t.x, t.z) !== null && Reachability.canReach(t, { maxSteps: 600 }));
                if (me) { cands.sort((a, b) => a.distanceTo(me) - b.distanceTo(me)); }
                return cands[0] ?? null;
            };
            for (let w = 0; w < 8; w++) {
                const now = Game.tile();
                if (now && ovenTile.distanceTo(now) <= 1) { break; }
                const target = stand();
                const local = target ? reader.toLocal(target.x, target.z) : null;
                if (!local) { await Execution.delayTicks(1); continue; }
                const before = Game.tile();
                actions.walkTo(local.lx, local.lz);
                await Execution.delayUntil(() => {
                    const t = Game.tile();
                    if (!t) { return false; }
                    return ovenTile.distanceTo(t) <= 1 || (before !== null && Math.max(Math.abs(before.x - t.x), Math.abs(before.z - t.z)) >= 1);
                }, 3000);
            }
        }
        // smelt the last primary ore repeatedly until none remain (bounded). The
        // primary is inv_del'd before any iron-fail roll, so the count drops on
        // both a smelt and a fail — progress tracking is correct either way.
        for (let n = 0; n < 30 && this.bot.primaryCount() > 0; n++) {
            if (ChatDialog.isMakeMenu() || ChatDialog.canContinue()) { return; }
            const ore = this.bot.lastPrimary();
            const oven = furnace();
            if (!ore || !oven) { await Execution.delayTicks(2); return; }
            this.bot.setStatus(`smelting ${this.bot.activeRecipe().bar}`);
            const before = this.bot.primaryCount();
            if (!(await ore.useOn(oven))) { await Execution.delayTicks(2); continue; }
            // wait for the bar to smelt (primary count drops), a menu, or a dialog
            if (await Execution.delayUntil(() => this.bot.primaryCount() < before || ChatDialog.isMakeMenu() || ChatDialog.canContinue(), 6000)) {
                if (this.bot.primaryCount() < before) { this.bot.recordSmelt(before - this.bot.primaryCount()); }
            }
        }
    }
}
