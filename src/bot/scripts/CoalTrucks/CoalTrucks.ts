import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import type Tile from '../../geometry/Tile.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { depositAllExcept } from '../../api/bank/Banking.js';
import { Bank } from '../../api/bank/Bank.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { Skills } from '../../api/skills/Skills.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { Locs, type Loc } from '../../api/locs/Locs.js';
import { GameMessages } from '../../api/chatbox/gameMessages.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { GAS_ROCK_IDS } from '../../data/miningRocks.js';
import { bestPickaxe } from '../../api/acquisition/Tools.js';
import {
    COAL,
    COAL_MINING_LEVEL,
    COAL_ROCK_IDS,
    MINE_ANCHOR,
    MAX_PULLS_PER_HAUL,
    MINE_AREA,
    MINE_OP,
    MINE_STALL_MS,
    MINE_START_MS,
    MINE_TRUCK,
    MINE_TRUCK_STAND,
    REMOVE_OP,
    ROCK_LOC,
    SEERS_BANK,
    SEERS_TRUCK,
    SEERS_TRUCK_STAND,
    TRUCK_LEASH,
    TRUCK_LOC,
    TRUCK_MAX,
    classifyDeposit,
    classifyRemove,
    decide,
    mineWaitDone,
    truckFullAfterDeposit,
    truckEmptyAfterRemove,
    type DepositResult,
    type MineView,
    type Phase,
    type RemoveResult
} from './CoalTrucksLogic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const MESSAGE_WAIT_MS = 5000;
const RESPAWN_WAIT_TICKS = 5;
const ROCK_LEASH = 12;
const MAX_BANK_FAILS = 6;

export default class CoalTrucks extends LoopingBot {
    override loopDelay = 0;

    private phase: Phase = 'fill';
    private truckEmpty = false;
    private truckFull = false;
    private pullsThisHaul = 0;
    private depositedEstimate = 0;
    private banked = 0;
    private trips = 0;
    private bankFails = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpStart = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.startedAt = Date.now();
        this.xpStart = Skills.xp('mining');

        const level = Skills.level('mining');
        if (level < COAL_MINING_LEVEL) {
            this.log(`CoalTrucks: Mining ${COAL_MINING_LEVEL} required to mine coal (have ${level}). Stopping.`);
            throw new Error('CoalTrucks: Mining level too low');
        }

        this.log(`CoalTrucks — mine ${MINE_ANCHOR}, truck ${MINE_TRUCK}, Seers truck ${SEERS_TRUCK}, bank ${SEERS_BANK}`);
        this.log('no combat handling: the level-27 giant bats here are aggressive below 55 combat');
        if (!this.hasPickaxe()) {
            this.log('no pickaxe held — banking at Seers for one before mining');
        }
    }

    override grindTargets(): string[] {
        return [ROCK_LOC];
    }

    override recoveryAnchor(): Tile {
        return MINE_ANCHOR;
    }

    override async loop(): Promise<void> {
        const wasDraining = this.phase === 'drain';
        const action = decide({
            phase: this.phase,
            packFull: Inventory.isFull(),
            coalHeld: Inventory.count(COAL),
            rockAvailable: this.findRock() !== null,
            truckEmpty: this.truckEmpty,
            truckFull: this.truckFull,
            pullsThisHaul: this.pullsThisHaul,
            hasPickaxe: this.hasPickaxe(),
            atMine: this.atMine()
        });

        switch (action.kind) {
            case 'mine':
                await this.mine();
                break;
            case 'await-rocks':
                this.status = 'waiting for a coal respawn';
                await Execution.delayTicks(RESPAWN_WAIT_TICKS);
                break;
            case 'deposit':
                await this.deposit();
                break;
            case 'travel-to-seers':
                this.status = 'heading to the Seers truck';
                this.phase = 'run';
                if (!this.at(SEERS_TRUCK_STAND, 1)) {
                    this.log('walking to the Seers truck to unload');
                }
                if (await this.walkTo(SEERS_TRUCK_STAND, 1)) {
                    this.phase = 'drain';
                    this.truckEmpty = false;
                    this.pullsThisHaul = 0;
                }
                break;
            case 'remove':
                await this.remove();
                break;
            case 'bank':
                await this.bank();
                break;
            case 'travel-to-mine':
                this.status = 'walking back to the mine';
                if (await this.walkTo(MINE_ANCHOR, 4)) {
                    this.phase = 'fill';
                    this.truckEmpty = false;
                    this.truckFull = false;
                    // Only a completed drain closes a cycle; a mid-fill pickaxe detour
                    // must not zero a truck that is already part-loaded.
                    if (wasDraining) {
                        this.depositedEstimate = 0;
                        this.trips++;
                    }
                }
                break;
        }

        await Execution.delayTicks(1);
    }

    /** The one pickaxe worth keeping — a spare or an unusable tier is junk and gets banked. */
    private heldPickaxe(): string | null {
        const held = [...Equipment.items(), ...Inventory.items()].map(i => i.name ?? '');
        return bestPickaxe(Skills.level('mining'), name => held.some(n => n.toLowerCase() === name.toLowerCase()));
    }

    private hasPickaxe(): boolean {
        return this.heldPickaxe() !== null;
    }

    private atMine(): boolean {
        const here = Game.tile();
        return here !== null && MINE_ANCHOR.distanceTo(here) <= MINE_AREA;
    }

    private findRock(): Loc | null {
        return Locs.query()
            .name(ROCK_LOC)
            .action(MINE_OP)
            .where(loc => COAL_ROCK_IDS.includes(loc.id) && !GAS_ROCK_IDS.has(loc.id))
            .where(loc => loc.tile().distanceTo(MINE_ANCHOR) <= ROCK_LEASH)
            .nearest();
    }

    private truckAt(expected: Tile): Loc | null {
        return Locs.query()
            .name(TRUCK_LOC)
            .where(loc => loc.tile().distanceTo(expected) <= TRUCK_LEASH)
            .nearest();
    }

    private async mine(): Promise<void> {
        const rock = this.findRock();
        if (!rock) {
            await Execution.delayTicks(2);
            return;
        }
        this.status = 'mining coal';
        const before = Inventory.count(COAL);
        if (!(await rock.interact(MINE_OP))) {
            await Execution.delayTicks(2);
            return;
        }
        // Why: a rock yields one coal and depletes, so this returns on the gain and lets the next loop pick a live rock.
        // Why: waiting out the stall on a spent rock costs the 20s — measured 1 coal / 20s, against ~1 coal / 2s once this returns early.
        // Why: a swing that stops is the other way out, since a stolen rock or a manual click ends it with no coal and no gain condition fires.
        // Why: two stages, because the swing has not begun yet and a bare `!animating` would be true at once and re-click forever.
        const view = (): MineView => ({
            gained: Inventory.count(COAL) > before,
            packFull: Inventory.isFull(),
            animating: Game.animating(),
            interrupted: EventSignal.pending() || ChatDialog.canContinue()
        });
        await Execution.delayUntil(() => mineWaitDone('start', view()), MINE_START_MS);
        await Execution.delayUntil(() => mineWaitDone('sustain', view()), MINE_STALL_MS);
    }

    private async deposit(): Promise<void> {
        this.status = 'loading the truck';
        if (!(await this.walkTo(MINE_TRUCK_STAND, 1))) {
            return;
        }
        const truck = this.truckAt(MINE_TRUCK);
        const coal = Inventory.first(COAL);
        if (!truck || !coal) {
            await Execution.delayTicks(2);
            return;
        }
        const held = Inventory.count(COAL);
        const mark = GameMessages.mark();
        if (!(await coal.useOn(truck))) {
            await Execution.delayTicks(2);
            return;
        }
        const result = await this.awaitDeposit(mark);
        if (result === 'none') {
            this.log('deposit produced no message — retrying');
            return;
        }
        if (result === 'wrong-item') {
            this.status = 'wrong item used — stopped';
            ScriptRunner.stop('CoalTrucks: the truck refused the item we used on it');
            return;
        }
        // Same race as the pull: the message can beat the inventory by a tick, and a true
        // 12-coal deposit then reads as 0. "full" moves nothing, so it has nothing to wait for.
        if (result === 'all' || result === 'partial') {
            await Execution.delayUntil(() => Inventory.count(COAL) < held, 2000);
        }
        const moved = held - Inventory.count(COAL);
        this.depositedEstimate = Math.min(TRUCK_MAX, this.depositedEstimate + moved);
        this.truckFull = truckFullAfterDeposit(result);
        this.log(`put ${moved} coal in the truck (${result})${this.truckFull ? ' — capped, topping the pack up before the run' : ''}`);
    }

    private async remove(): Promise<void> {
        this.status = 'unloading the truck';
        if (!(await this.walkTo(SEERS_TRUCK_STAND, 1))) {
            return;
        }
        const truck = this.truckAt(SEERS_TRUCK);
        if (!truck) {
            await Execution.delayTicks(2);
            return;
        }
        const before = Inventory.count(COAL);
        const mark = GameMessages.mark();
        if (!(await truck.interact(REMOVE_OP))) {
            await Execution.delayTicks(2);
            return;
        }
        const result = await this.awaitRemove(mark);
        if (result === 'none') {
            this.log('Remove-coal produced no message — retrying');
            return;
        }
        if (result === 'no-space') {
            return;
        }
        // The message can beat the inventory by a tick, so settle before counting or
        // a live pull logs as "took 0".
        await Execution.delayUntil(() => Inventory.count(COAL) > before, 2000);
        this.pullsThisHaul++;
        this.truckEmpty = truckEmptyAfterRemove(result);
        const budgetSpent = !this.truckEmpty && this.pullsThisHaul >= MAX_PULLS_PER_HAUL;
        this.log(`took ${Inventory.count(COAL) - before} coal from the truck (${result})`
            + `${budgetSpent ? ' — pull budget spent, the remainder rides to the next cycle' : ''}`);
    }

    private async bank(): Promise<void> {
        this.status = 'banking the coal';
        if (!(await this.walkTo(SEERS_BANK, 4))) {
            return;
        }
        if (!(await Bank.openBooth(SEERS_BANK, BOOTH.name, BOOTH.op, m => this.log(`  ${m}`)))) {
            if (++this.bankFails >= MAX_BANK_FAILS) {
                this.status = 'cannot reach the bank — stopped';
                ScriptRunner.stop('CoalTrucks: could not open the Seers bank');
                return;
            }
            this.log('could not open the bank — will retry');
            return;
        }
        this.bankFails = 0;
        try {
            const held = Inventory.count(COAL);
            // Why: random events leave coins and junk the truck will not take, and anything kept squats a coal slot on every future load.
            // Why: the keep-list is the one pickaxe in use, spares included.
            const keep = this.heldPickaxe();
            await Bank.depositAllMatching(depositAllExcept(keep ? [keep] : []));
            await Execution.delayTicks(1);
            const moved = held - Inventory.count(COAL);
            this.banked += moved;
            if (moved > 0) {
                this.log(`banked ${moved} coal (${this.banked} this run)`);
            }
            await this.ensurePickaxe();
        } finally {
            await Bank.close();
        }
    }

    private async ensurePickaxe(): Promise<void> {
        if (this.hasPickaxe()) {
            return;
        }
        const fromBank = bestPickaxe(Skills.level('mining'), name => Bank.count(name) > 0);
        if (!fromBank) {
            this.status = 'no pickaxe — stopped';
            ScriptRunner.stop('CoalTrucks: no usable pickaxe held or banked');
            return;
        }
        if (await Bank.withdraw(fromBank)) {
            this.log(`withdrew a ${fromBank}`);
        }
    }

    private async awaitDeposit(mark: number): Promise<DepositResult> {
        let out: DepositResult = 'none';
        await Execution.delayUntil(() => {
            out = classifyDeposit(GameMessages.since(mark).map(m => m.text));
            return out !== 'none';
        }, MESSAGE_WAIT_MS);
        return out;
    }

    private async awaitRemove(mark: number): Promise<RemoveResult> {
        let out: RemoveResult = 'none';
        await Execution.delayUntil(() => {
            out = classifyRemove(GameMessages.since(mark).map(m => m.text));
            return out !== 'none';
        }, MESSAGE_WAIT_MS);
        return out;
    }

    private at(dest: Tile, radius: number): boolean {
        const here = Game.tile();
        return here !== null && dest.distanceTo(here) <= radius;
    }

    private async walkTo(dest: Tile, radius: number): Promise<boolean> {
        if (this.at(dest, radius)) {
            return true;
        }
        return Traversal.walkResilient(dest, { radius, attempts: 6, timeoutMs: 300_000, log: m => this.log(`  ${m}`) });
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#d0d0d0' });
        p.title(`CoalTrucks — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = Skills.xp('mining') - this.xpStart;
        const xpHour = mins > 0.5 ? `${((xp / mins) * 60 / 1000).toFixed(1)}k` : '—';

        p.row(`Runtime: ${fmtDuration(mins)}`, `Mining: ${Skills.level('mining')}`, `XP/hr: ${xpHour}`);
        p.row(`Phase: ${this.phase}`, `Banked: ${this.banked}`, `Trips: ${this.trips}`);
        p.row(`Pack: ${Inventory.count(COAL)} coal`, `Truck: ~${this.depositedEstimate}/${TRUCK_MAX} (est)`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
