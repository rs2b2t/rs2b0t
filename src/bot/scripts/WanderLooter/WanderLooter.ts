import { TaskBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems, type GroundItem } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { foodCount as countFood, shouldEatFood } from '../../api/combat/food.js';
import { Skills } from '../../api/skills/Skills.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import { Navigator } from '../../event/webwalk/Navigator.js';
import { Paint } from '../../paint/Paint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { scriptFood } from '../../api/loadout/loadoutPlan.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { type SettingsSchema } from '../../runtime/Settings.js';
import Tile from '../../geometry/Tile.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';
import {
    BankRun,
    EatFood,
    FleeLowHealth,
    IdleBank,
    LootDrops,
    Wander,
    eatOne
} from './WanderLooterTasks.js';
import {
    DANGER_RADIUS,
    DANGER_WINDOW_MS,
    DEFAULT_LOOT,
    LootBlacklist,
    matchesLoot
} from './WanderLooterLogic.js';

export const SETTINGS: SettingsSchema = {
    loot: {
        type: 'string[]',
        default: DEFAULT_LOOT,
        label: 'Loot item names (exact)',
        help: 'exact item names, case-insensitive; defaults to the current event drop',
        csvToggle: 'lootMode'
    },
    lootMode: {
        type: 'string',
        default: 'list',
        options: ['list', 'csv'],
        optionLabels: { list: 'List (chips)', csv: 'CSV (text + copy/paste)' },
        label: 'Loot entry mode',
        help: 'List = add items one at a time. CSV = paste a comma-separated list.'
    },
    food: { type: 'string', default: '', label: 'Food to eat', help: 'exact item name (e.g. Shark, Monkfish, Trout). Leave blank to use the loadout food, falling back to Trout' },
    foodWithdraw: { type: 'number', default: 0, min: 0, max: 27, label: 'Food to carry', group: 'Food & safety' },
    panicHp: { type: 'number', default: 25, min: 0, max: 100, label: 'Flee below HP% (no food)', group: 'Food & safety' },
    bankAtLootSlots: { type: 'number', default: 28, min: 1, max: 28, label: 'Bank at loot slots', group: 'Banking' },
    wanderDistance: { type: 'number', default: 30, min: 5, max: 60, label: 'Wander distance (tiles)', group: 'Wandering' },
    bankAfterMinutes: { type: 'number', default: 10, min: 1, max: 240, label: 'Bank after no loot (minutes)', group: 'Wandering' }
};

export default class WanderLooter extends TaskBot {
    override loopDelay = 600;

    readonly blacklist = new LootBlacklist();

    lastLootAt = Date.now();

    private lootNamesValue: string[] = [...DEFAULT_LOOT];
    private foodNameValue = 'Trout';
    private foodWithdrawValue = 0;
    private panicValue = 0.25;
    private bankAtValue = 28;
    private wanderDistanceValue = 30;
    private bankAfterValue = 600_000;
    private lastHp = 0;
    private lastDamageAt = 0;
    private lastDamageTile: Tile | null = null;
    private recentPickup: { id: number; tile: Tile; at: number } | null = null;
    private lastWanderDir: readonly [number, number] | null = null;
    private status = 'starting';
    private startedAt = Date.now();
    private looted = 0;
    private bankTrips = 0;
    private wanders = 0;
    private eats = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.lootNamesValue = this.settings.list('loot', DEFAULT_LOOT).map(name => name.trim()).filter(Boolean);
        if (this.lootNamesValue.length === 0) {
            throw new Error('WanderLooter: loot list is empty');
        }
        this.foodNameValue = this.settings.str('food', '').trim() || scriptFood(this.settings, 'Trout');
        this.foodWithdrawValue = this.settings.num('foodWithdraw', 0);
        this.panicValue = this.settings.num('panicHp', 25) / 100;
        this.bankAtValue = this.settings.num('bankAtLootSlots', 28);
        this.wanderDistanceValue = this.settings.num('wanderDistance', 30);
        this.bankAfterValue = this.settings.num('bankAfterMinutes', 10) * 60_000;
        const now = Date.now();
        this.startedAt = now;
        this.lastLootAt = now;

        Sustain.set(async () => {
            await eatOne(this);
        });

        this.add(
            new ContinueDialog(),
            new EatFood(this),
            new FleeLowHealth(this),
            new BankRun(this),
            new IdleBank(this),
            new LootDrops(this),
            new Wander(this)
        );

        this.log(
            `WanderLooter starting — loot [${this.lootNamesValue.join(', ')}], food '${this.foodNameValue}'x${this.foodWithdrawValue}, `
            + `bank at ${this.bankAtValue} slots, wander ${this.wanderDistanceValue} tiles when idle, `
            + `bank after ${this.bankAfterValue / 60_000}m without loot`
        );
    }

    override onStop(): void {
        Sustain.set(null);
    }

    override async loop(): Promise<number | void> {
        this.observeHealth();
        return super.loop();
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#f0c060' });
        p.title(`WanderLooter — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Looted: ${this.looted}`, `Trips: ${this.bankTrips}`);
        p.row(`Wanders: ${this.wanders}`, `Blocked: ${this.blacklist.count()}`, `Food: ${this.foodCount()}`);
        p.row(this.recentPickup ? `Recent loot: ${this.recentPickup.tile}` : 'Wandering');
        p.bar('HP', Skills.hpFraction());
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    lootNames(): string[] {
        return this.lootNamesValue;
    }

    foodName(): string {
        return this.foodNameValue;
    }

    foodWithdraw(): number {
        return this.foodWithdrawValue;
    }

    panicAt(): number {
        return this.panicValue;
    }

    bankAt(): number {
        return this.bankAtValue;
    }

    wanderDistance(): number {
        return this.wanderDistanceValue;
    }

    bankAfterMs(): number {
        return this.bankAfterValue;
    }

    setStatus(status: string): void {
        this.status = status;
    }

    foodCount(): number {
        return countFood(Inventory.items(), this.foodNameValue);
    }

    needEat(): boolean {
        return shouldEatFood(this.foodNameValue, {
            hp: Skills.effective('hitpoints'),
            maxHp: Skills.level('hitpoints'),
            foodCount: this.foodCount()
        });
    }

    lootSlots(): number {
        return Inventory.items().filter(item => matchesLoot(item.name, this.lootNamesValue)).length;
    }

    findLoot(): GroundItem | null {
        return GroundItems.query()
            .action('Take')
            .where(item => matchesLoot(item.name, this.lootNamesValue))
            .where(item => !this.blacklist.blocked(item.id, item.tile()))
            .where(item => Reachability.walkable(item.tile()))
            .nearest();
    }

    findLootAt(id: number, tile: WorldTile): GroundItem | null {
        return GroundItems.query()
            .where(item => item.id === id && item.tile().equals(tile))
            .nearest();
    }

    /** Cheap candidate filter; {@link canWalkTo} does the door-aware route check. */
    canWanderTo(tile: Tile): boolean {
        const here = Game.tile();
        if (here === null) {
            return false;
        }
        if (tile.level === here.level) {
            return true;
        }
        return here.level > 0
            && tile.level === here.level - 1
            && tile.x === here.x
            && tile.z === here.z;
    }

    /** Scene-local reach first (fast), then the webwalk graph so doors and stairs count. */
    async canWalkTo(tile: Tile): Promise<boolean> {
        const here = Game.tile();
        if (here === null) {
            return false;
        }
        if (tile.level === here.level
            && Reachability.walkable(tile)
            && Reachability.canReach(tile, { maxSteps: 2048 })) {
            return true;
        }
        const path = await Navigator.findPath(here, tile, {
            policy: { useTeleports: false },
            timeoutMs: 5000
        });
        return path.ok;
    }

    noteLoot(now: number): void {
        this.lastLootAt = now;
        this.looted++;
    }

    noteBank(): void {
        this.bankTrips++;
    }

    /** Tracks damage and blacklists a pickup tile when a hit lands beside it soon after looting. */
    observeHealth(now = Date.now()): number {
        const hp = Skills.effective('hitpoints');
        const tile = Game.tile();
        if (this.recentPickup && now - this.recentPickup.at > DANGER_WINDOW_MS) {
            this.recentPickup = null;
        }
        if (this.lastHp > 0 && hp < this.lastHp && tile) {
            this.lastDamageAt = now;
            this.lastDamageTile = Tile.from(tile);
            const pickup = this.recentPickup;
            if (pickup
                && now - pickup.at <= DANGER_WINDOW_MS
                && pickup.tile.distanceTo(tile) <= DANGER_RADIUS) {
                this.blacklist.markUnsafe(pickup.id, pickup.tile);
                this.log(`blacklisting loot at ${pickup.tile} for 30m — took damage after looting`);
                this.recentPickup = null;
            }
        }
        this.lastHp = hp;
        return hp;
    }

    damageNear(tile: WorldTile, now = Date.now()): boolean {
        return this.lastDamageTile !== null
            && now - this.lastDamageAt <= DANGER_WINDOW_MS
            && this.lastDamageTile.distanceTo(tile) <= DANGER_RADIUS;
    }

    notePickup(id: number, tile: WorldTile, now: number): void {
        this.recentPickup = { id, tile: Tile.from(tile), at: now };
    }

    noteWander(from?: WorldTile, to?: WorldTile): void {
        if (from && to && from.level === to.level) {
            const dx = Math.sign(to.x - from.x);
            const dz = Math.sign(to.z - from.z);
            this.lastWanderDir = dx === 0 && dz === 0 ? null : [dx, dz];
        }
        this.wanders++;
    }

    wanderDirection(): readonly [number, number] | null {
        return this.lastWanderDir;
    }

    restartIdleTimer(): void {
        this.lastLootAt = Date.now();
    }

    countEat(): void {
        this.eats++;
    }

    trips(): number {
        return this.bankTrips;
    }
}
