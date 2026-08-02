import { TaskBot, type Task } from '../api/Bot.js';
import { FOOD_OPTIONS, foodCount as countFood, isFoodItem } from '../api/combat/food.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Equipment } from '../api/hud/Equipment.js';
import { Inventory, type InvItem } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { Skills } from '../api/hud/Skills.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Locs } from '../api/queries/Locs.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { GameMessages } from '../events/gameMessages.js';
import {
    chaosDruidArea,
    chaosDruidBankReason,
    chaosDruidBankRunReady,
    chaosDruidDropMerges,
    chaosDruidEatReady,
    chaosDruidFoodShortfall,
    chaosDruidLootSpaceAction,
    chaosDruidRespawned,
    DRUID_LOCATION_NAMES,
    DRUID_SPOTS,
    inChaosDruidField,
    inEdgevilleDungeon,
    isChaosDruidLoot,
    yanilleZone,
    type ChaosDruidBankReason,
    type DruidLocationName,
    type DruidSpot
} from './ChaosDruidLogic.js';

export const SETTINGS: SettingsSchema = {
    location: {
        type: 'string',
        default: 'Edgeville Dungeon',
        options: DRUID_LOCATION_NAMES,
        label: 'Location',
        help: 'Tower: picklock the door (46 Thieving). Yanille: Chaos druid warriors past the 40 Agility ledge — bring a slash weapon or knife for the entrance web',
        group: 'Location'
    },
    food: {
        type: 'string',
        default: 'Lobster',
        options: FOOD_OPTIONS,
        label: 'Food',
        group: 'Food & healing'
    },
    foodWithdraw: {
        type: 'number',
        default: 12,
        min: 1,
        max: 27,
        label: 'Food per trip',
        group: 'Food & healing'
    },
    eatAtHp: {
        type: 'number',
        default: 55,
        min: 1,
        max: 99,
        label: 'Eat below HP%',
        group: 'Food & healing'
    },
    panicHp: {
        type: 'number',
        default: 35,
        min: 1,
        max: 98,
        label: 'Bank below HP% (no food)',
        help: 'leave the dungeon when food is gone and HP reaches this threshold',
        group: 'Food & healing'
    }
};

const LADDER = { name: 'Ladder', op: 'Climb-up', stand: new Tile(3096, 9868, 0) };
const TRAPDOOR = { name: 'Trapdoor', stand: new Tile(3096, 3468, 0) };
const BANK_BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const INTERMEDIATE_GATE = new Tile(3103, 9909, 0);
const WILDERNESS_GATE = new Tile(3130, 9914, 0);
const TOWER_DOOR = { name: 'Door', op: 'Pick Lock', stand: new Tile(2565, 3356, 0) };
const TOWER_BOUNDS = { minX: 2560, maxX: 2564, minZ: 3352, maxZ: 3360 };
const LEDGE = { name: 'Balancing ledge', op: 'Walk-across' };
const LEDGE_NORTH_STAND = new Tile(2580, 9520, 0);
const LEDGE_SOUTH_STAND = new Tile(2580, 9512, 0);
const MAX_LEDGE_FALL_STREAK = 8;
const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints'];

function hpFraction(): number {
    return Skills.hpFraction();
}

function bankReason(bot: ChaosDruidKiller): ChaosDruidBankReason | null {
    bot.observeLifecycle();
    return chaosDruidBankReason({
        tripPrepared: bot.tripPrepared,
        inventoryFull: Inventory.isFull(),
        wantedLootVisible: GroundItems.query()
            .where(item => isChaosDruidLoot(item.name))
            .within(bot.spot.radius + 3)
            .nearest() !== null,
        foodCount: bot.foodCount(),
        hpFraction: hpFraction(),
        panicHpFraction: bot.panicHpFraction
    });
}

async function eatOnce(bot: ChaosDruidKiller): Promise<boolean> {
    const food = bot.selectedFood();
    if (!food) {
        return false;
    }
    bot.setStatus(`eating ${food.name} (${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp)`);
    const beforeHp = Skills.effective('hitpoints');
    const beforeName = food.name;
    const beforeUsed = Inventory.used();
    if (!(await food.interact('Eat'))) {
        return false;
    }
    return Execution.delayUntil(
        () => Skills.effective('hitpoints') > beforeHp
            || Inventory.used() < beforeUsed
            || bot.selectedFood()?.name !== beforeName,
        4000
    );
}

async function dropOneFood(bot: ChaosDruidKiller): Promise<boolean> {
    const food = bot.selectedFood();
    if (!food) {
        return false;
    }
    const before = Inventory.used();
    bot.setStatus(`dropping ${food.name} for loot`);
    if (!(await food.interact('Drop'))) {
        return false;
    }
    const dropped = await Execution.delayUntil(() => Inventory.used() < before, 4000);
    if (dropped) {
        bot.countFoodSacrifice();
        bot.log(`dropped 1 ${food.name} to make room for a Chaos-druid drop`);
    }
    return dropped;
}

export default class ChaosDruidKiller extends TaskBot {
    override loopDelay = 600;

    foodName = 'Lobster';
    foodWithdraw = 12;
    eatHpFraction = 0.55;
    panicHpFraction = 0.35;
    tripPrepared = false;
    parked = false;
    died = false;
    locationName: DruidLocationName = 'Edgeville Dungeon';
    spot: DruidSpot = DRUID_SPOTS['Edgeville Dungeon'];

    private kills = 0;
    private looted = 0;
    private trips = 0;
    private deaths = 0;
    private foodSacrificed = 0;
    private ledgeFallStreak = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private lastArea = chaosDruidArea(null);

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const locationName = this.settings.str('location', 'Edgeville Dungeon') as DruidLocationName;
        if (!DRUID_SPOTS[locationName]) {
            this.park(`unknown location '${locationName}' — pick one of: ${DRUID_LOCATION_NAMES.join(', ')}`);
            return;
        }
        this.locationName = locationName;
        this.spot = DRUID_SPOTS[locationName];
        this.foodName = this.settings.str('food', 'Lobster');
        this.foodWithdraw = this.settings.num('foodWithdraw', 12);
        this.eatHpFraction = this.settings.num('eatAtHp', 55) / 100;
        this.panicHpFraction = this.settings.num('panicHp', 35) / 100;
        this.startedAt = Date.now();
        this.xpAtStart = COMBAT_SKILLS.reduce((sum, skill) => sum + Skills.xp(skill), 0);
        const startingArea = chaosDruidArea(Game.tile(), this.spot.dungeon);
        this.lastArea = startingArea;
        this.tripPrepared = this.inField() && this.foodCount() >= this.foodWithdraw;

        this.log(`ChaosDruidKiller starting — ${this.locationName} (${this.spot.npc}), ${this.foodWithdraw} ${this.foodName}, eat <${Math.round(this.eatHpFraction * 100)}%, bank without food <${Math.round(this.panicHpFraction * 100)}%, field ${this.spot.field.x},${this.spot.field.z}`);
        const req = this.spot.requires;
        if (req && Skills.level(req.skill) < req.level) {
            this.park(`${this.locationName} needs ${req.level} ${req.skill} — you have ${Skills.level(req.skill)}. Train it or pick another location, then restart.`);
        }
        if (startingArea === 'other-underground') {
            this.park(`started in an underground map this route cannot exit. Reach the surface or the ${this.locationName} field, then restart.`);
        }
        if (this.locationName === 'Yanille Dungeon'
            && !Equipment.items().some(item => /scimitar|sword|dagger|axe|halberd/i.test(item.name ?? ''))) {
            this.log('warning: no slash weapon wielded — the entrance web needs one (a carried knife is deposited every bank trip)');
        }

        this.on('chat.message', event => {
            if (/oh dear.*you are dead/i.test(event.text)) {
                this.noteDeath('death message detected');
            }
        });

        this.add(
            new ContinueDialog(),
            new Parked(this),
            new LocationGuard(this),
            new Eat(this),
            new BankRun(this),
            new GoToField(this),
            new Loot(this),
            new Regroup(this),
            new Fight(this),
            new Wait(this)
        );
    }

    override grindTargets(): string[] {
        return [this.spot.npc];
    }

    override recoveryAnchor(): Tile | null {
        return this.fieldTile();
    }

    fieldTile(): Tile {
        return new Tile(this.spot.field.x, this.spot.field.z, this.spot.field.level);
    }

    inField(): boolean {
        return inChaosDruidField(Game.tile(), this.spot);
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#9be05b' });
        p.title(`ChaosDruidKiller — ${this.status}`);
        p.row(`${this.locationName} — ${this.spot.npc}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const gained = COMBAT_SKILLS.reduce((sum, skill) => sum + Skills.xp(skill), 0) - this.xpAtStart;
        const xph = mins > 0.5 ? `${((gained / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Kills: ${this.kills}`, `XP/hr: ${xph}`);
        p.row(`Looted: ${this.looted}`, `Food: ${this.foodCount()}`, `Banks: ${this.trips}`);
        if (this.foodSacrificed > 0 || this.deaths > 0) {
            p.row(`Food used for space: ${this.foodSacrificed}`, `Deaths: ${this.deaths}`);
        }
        p.bar('HP', hpFraction());
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(status: string): void {
        this.status = status;
    }

    countKill(): void {
        this.kills++;
    }

    countLoot(): void {
        this.looted++;
    }

    countTrip(): void {
        this.trips++;
    }

    countFoodSacrifice(): void {
        this.foodSacrificed++;
    }

    foodCount(): number {
        return countFood(Inventory.items(), this.foodName);
    }

    selectedFood(): InvItem | null {
        if (Bank.isOpen()) {
            return null;
        }
        return Inventory.items().find(item => isFoodItem(item.name, this.foodName)) ?? null;
    }

    observeLifecycle(): void {
        const area = chaosDruidArea(Game.tile(), this.spot.dungeon);
        if (chaosDruidRespawned(this.lastArea, area, this.tripPrepared)) {
            this.noteDeath('surface respawn detected after leaving the dungeon unexpectedly');
        }
        if (area !== 'unknown') {
            this.lastArea = area;
        }
    }

    private noteDeath(source: string): void {
        if (!this.died) {
            this.deaths++;
        }
        this.died = true;
        this.tripPrepared = false;
        this.setStatus('died — restocking');
        this.log(`${source} — will bank for a fresh trip before returning`);
    }

    park(reason: string): void {
        if (this.parked) {
            return;
        }
        this.parked = true;
        this.setStatus(`stopped — ${reason}`);
        this.log(`STOPPED: ${reason}`);
    }

    async walkOpening(destination: Tile, radius: number): Promise<boolean> {
        const arrived = (): boolean => {
            const here = Game.tile();
            return here !== null && here.level === destination.level && destination.distanceTo(here) <= radius;
        };

        for (let attempt = 0; attempt < 12; attempt++) {
            if (arrived()) {
                return true;
            }
            await Traversal.walkTo(destination, {
                radius,
                timeoutMs: 25_000,
                log: message => this.log(`  ${message}`)
            });
            if (arrived()) {
                return true;
            }
            const obstacle = Locs.query()
                .name('Gate', 'Door', 'Large door')
                .within(5)
                .where(loc => loc.actions().some(action => /^open$/i.test(action)))
                .nearest();
            if (obstacle) {
                const open = obstacle.actions().find(action => /^open$/i.test(action))!;
                this.log(`opening ${obstacle.name} at ${obstacle.tile()}`);
                await obstacle.interact(open);
                await Execution.delayUntil(
                    () => !Locs.query().within(5).where(loc => loc.tile().x === obstacle.tile().x
                        && loc.tile().z === obstacle.tile().z
                        && loc.actions().some(action => /^open$/i.test(action))).first(),
                    4000
                );
            } else {
                await Execution.delayTicks(2);
            }
        }
        return arrived();
    }

    private async openNearestGate(): Promise<void> {
        const gate = Locs.query()
            .name('Gate')
            .within(6)
            .where(loc => loc.actions().some(action => /^open$/i.test(action)))
            .nearest();
        if (!gate) {
            return;
        }
        const open = gate.actions().find(action => /^open$/i.test(action))!;
        this.log(`opening ${gate.name} at ${gate.tile()}`);
        await gate.interact(open);
        await Execution.delayTicks(4);
    }

    private async crossDungeonGates(towardField: boolean): Promise<void> {
        const gates = towardField
            ? [INTERMEDIATE_GATE, WILDERNESS_GATE]
            : [WILDERNESS_GATE, INTERMEDIATE_GATE];
        for (const gate of gates) {
            await Traversal.walkResilient(gate, {
                radius: 4,
                attempts: 8,
                timeoutMs: 25_000,
                log: message => this.log(`  ${message}`)
            });
            await this.openNearestGate();
        }
    }

    async ascendToSurface(): Promise<boolean> {
        const area = chaosDruidArea(Game.tile(), this.spot.dungeon);
        if (area === 'surface') {
            return true;
        }
        if (area !== 'druid-dungeon') {
            this.park('cannot use the Edgeville ladder from a different underground map. Reach the surface, then restart.');
            return false;
        }
        this.setStatus('leaving the dungeon');
        await this.crossDungeonGates(false);
        if (!(await this.walkOpening(LADDER.stand, 2))) {
            this.log('could not reach the Edgeville dungeon ladder');
            return false;
        }
        for (let attempt = 0; attempt < 5; attempt++) {
            const ladder = Locs.query().name(LADDER.name).within(8).action(LADDER.op).nearest();
            if (!ladder) {
                await Execution.delayTicks(2);
                continue;
            }
            this.log(`climbing out via ${ladder.name} at ${ladder.tile()}`);
            await ladder.interact(LADDER.op);
            if (await Execution.delayUntil(() => !inEdgevilleDungeon(Game.tile()), 8000)) {
                this.tripPrepared = false;
                return true;
            }
        }
        return !inEdgevilleDungeon(Game.tile());
    }

    async descendToDungeon(): Promise<boolean> {
        const area = chaosDruidArea(Game.tile(), this.spot.dungeon);
        if (area === 'druid-dungeon') {
            return true;
        }
        if (area !== 'surface') {
            this.park('cannot reach the Edgeville trapdoor from a different underground map. Reach the surface, then restart.');
            return false;
        }
        this.setStatus('walking to the Edgeville trapdoor');
        if (!(await this.walkOpening(TRAPDOOR.stand, 1))) {
            this.log('could not reach the Edgeville trapdoor');
            return false;
        }
        for (let attempt = 0; attempt < 7; attempt++) {
            const trapdoor = Locs.query().name(TRAPDOOR.name).within(6).nearest();
            if (!trapdoor) {
                await Execution.delayTicks(2);
                continue;
            }
            const action = trapdoor.actions().find(op => /climb-down/i.test(op))
                ?? trapdoor.actions().find(op => /^open$/i.test(op));
            if (!action) {
                await Execution.delayTicks(2);
                continue;
            }
            this.log(`${action.toLowerCase()} ${trapdoor.name} at ${trapdoor.tile()}`);
            await trapdoor.interact(action);
            if (await Execution.delayUntil(() => inEdgevilleDungeon(Game.tile()), /^open$/i.test(action) ? 2500 : 8000)) {
                return true;
            }
        }
        return inEdgevilleDungeon(Game.tile());
    }

    insideTower(): boolean {
        const here = Game.tile();
        return here !== null && here.level === 0
            && here.x >= TOWER_BOUNDS.minX && here.x <= TOWER_BOUNDS.maxX
            && here.z >= TOWER_BOUNDS.minZ && here.z <= TOWER_BOUNDS.maxZ;
    }

    private async eatIfLow(): Promise<void> {
        if (hpFraction() < this.eatHpFraction && this.foodCount() > 0) {
            await eatOnce(this);
        }
    }

    /** The tower door only yields to op2 "Pick Lock"; success walks the player through. */
    private async pickTowerDoor(): Promise<boolean> {
        this.setStatus('picking the tower door lock');
        for (let attempt = 0; attempt < 20; attempt++) {
            if (this.insideTower()) {
                this.log('picked the tower lock — inside');
                return true;
            }
            await this.eatIfLow();
            const door = Locs.query().name(TOWER_DOOR.name).action(TOWER_DOOR.op).within(5).nearest();
            if (!door) {
                await Execution.delayTicks(2);
                continue;
            }
            const mark = GameMessages.mark();
            if (!(await door.interact(TOWER_DOOR.op))) {
                await Execution.delayTicks(2);
                continue;
            }
            await Execution.delayUntil(
                () => this.insideTower() || GameMessages.sawSince(mark, /fail to pick|trap on the lock|need level|members/i),
                8000
            );
            if (GameMessages.sawSince(mark, /need level \d+ thieving/i)) {
                this.park('the server refused the picklock (needs 46 Thieving). Train Thieving, then restart.');
                return false;
            }
            if (GameMessages.sawSince(mark, /members/i)) {
                this.park('the tower door is members-only on this world.');
                return false;
            }
            if (GameMessages.sawSince(mark, /trap on the lock/i)) {
                this.log('lock trap triggered — took damage, trying again');
            } else if (GameMessages.sawSince(mark, /fail to pick the lock/i)) {
                this.log('picklock failed — trying again');
            }
        }
        this.log('could not pick the tower lock after 20 tries — will retry');
        return this.insideTower();
    }

    private async towerToField(): Promise<boolean> {
        if (this.insideTower()) {
            this.died = false;
            return true;
        }
        this.setStatus('walking to the Chaos Druid Tower');
        if (!(await this.walkOpening(TOWER_DOOR.stand, 1))) {
            this.log('could not reach the tower door');
            return false;
        }
        return this.pickTowerDoor();
    }

    private async walkExact(dest: Tile): Promise<boolean> {
        const here = (): boolean => {
            const t = Game.tile();
            return t !== null && t.x === dest.x && t.z === dest.z && t.level === dest.level;
        };
        for (let attempt = 0; attempt < 4 && !here(); attempt++) {
            await Traversal.walkResilient(dest, {
                radius: 0,
                attempts: 6,
                timeoutMs: 25_000,
                log: message => this.log(`  ${message}`)
            });
        }
        return here();
    }

    /**
     * Cross the balancing ledge. A fail drops into the m40_149 pit for 20% of
     * current HP; the walker knows the pit stairs, so recovery is a plain walk.
     */
    private async crossLedge(dir: 'south' | 'north'): Promise<boolean> {
        const stand = dir === 'south' ? LEDGE_NORTH_STAND : LEDGE_SOUTH_STAND;
        this.setStatus('crossing the balancing ledge');
        await this.eatIfLow();
        if (!(await this.walkExact(stand))) {
            await Execution.delayTicks(2);
            return false;
        }
        const ledge = Locs.query().name(LEDGE.name).action(LEDGE.op).within(4).nearest();
        if (!ledge || !(await ledge.interact(LEDGE.op))) {
            await Execution.delayTicks(2);
            return false;
        }
        const farZone = dir === 'south' ? 'warrior' : 'north';
        const zone = (): string => {
            const t = Game.tile();
            return t === null ? 'unknown' : yanilleZone(t);
        };
        await Execution.delayUntil(() => zone() === farZone || zone() === 'pit', 15_000);
        if (zone() === farZone) {
            this.ledgeFallStreak = 0;
            this.log('crossed the balancing ledge');
            return true;
        }
        if (zone() === 'pit') {
            this.ledgeFallStreak++;
            this.log(`slipped off the ledge into the pit (fall ${this.ledgeFallStreak}) — recovering via the pit stairs`);
            if (this.ledgeFallStreak >= MAX_LEDGE_FALL_STREAK) {
                this.park(`fell off the balancing ledge ${MAX_LEDGE_FALL_STREAK} times in a row — is Agility high enough for this route?`);
            }
        }
        return false;
    }

    private async yanilleToField(): Promise<boolean> {
        for (let attempt = 0; attempt < 10 && !this.parked; attempt++) {
            const here = Game.tile();
            if (here === null) {
                return false;
            }
            if (this.inField()) {
                this.died = false;
                return true;
            }
            await this.eatIfLow();
            if (chaosDruidArea(here, this.spot.dungeon) === 'other-underground') {
                this.park('cannot route to Yanille from a different underground map. Reach the surface, then restart.');
                return false;
            }
            const zone = yanilleZone(here);
            if (zone === 'warrior') {
                this.setStatus('walking to the Chaos druid warriors');
                if (await Traversal.walkResilient(this.fieldTile(), {
                    radius: 4,
                    attempts: 8,
                    timeoutMs: 25_000,
                    log: message => this.log(`  ${message}`)
                })) {
                    this.died = false;
                    return true;
                }
                continue;
            }
            if (zone === 'north') {
                await this.crossLedge('south');
                continue;
            }
            // surface or pit: the walker knows the entrance web + staircase and the pit stairs
            this.setStatus(zone === 'pit' ? 'climbing out of the ledge pit' : 'walking to the Yanille dungeon');
            await Traversal.walkResilient(LEDGE_NORTH_STAND, {
                radius: 1,
                attempts: 8,
                timeoutMs: 60_000,
                log: message => this.log(`  ${message}`)
            });
        }
        return false;
    }

    /** Get to ground the webwalker can plan a bank route from. */
    private async leaveFieldForBank(): Promise<boolean> {
        if (this.locationName === 'Edgeville Dungeon') {
            return this.ascendToSurface();
        }
        if (this.locationName === 'Yanille Dungeon') {
            // Surfacing on purpose — without this the dungeon→surface jump reads
            // as a missed death (chaosDruidRespawned).
            this.tripPrepared = false;
            this.setStatus('leaving the Yanille dungeon');
            for (let attempt = 0; attempt < 10 && !this.parked; attempt++) {
                const here = Game.tile();
                if (here === null) {
                    return false;
                }
                if (yanilleZone(here) !== 'warrior') {
                    return true;
                }
                await this.crossLedge('north');
            }
            return false;
        }
        return true;
    }

    async bankAndRestock(reason: ChaosDruidBankReason): Promise<boolean> {
        this.setStatus(`banking — ${reason.replace('-', ' ')}`);
        this.log(`trip ended (${reason.replace('-', ' ')}) — preparing the next trip`);
        const bankStand = new Tile(this.spot.bankStand.x, this.spot.bankStand.z, this.spot.bankStand.level);
        if (Bank.isOpen()) {
            this.tripPrepared = false;
            this.log('bank was already open — resuming the interrupted restock');
        } else {
            if (!(await this.leaveFieldForBank())) {
                return false;
            }
            if (!(await this.walkOpening(bankStand, 2))) {
                this.log('could not reach the bank');
                return false;
            }
            if (!(await Bank.openBooth(bankStand, BANK_BOOTH.name, BANK_BOOTH.op, message => this.log(`  ${message}`)))) {
                this.log('could not open the bank');
                return false;
            }
        }

        this.setStatus('banking loot');
        // Normalize every trip instead of silently carrying leftovers above the
        // configured amount. Equipment is not in the backpack, so depositing the
        // whole pack banks the haul and gives the withdrawal an exact clean slate.
        await Bank.depositInventory();
        await Execution.delayTicks(1);

        const shortfall = chaosDruidFoodShortfall(this.foodWithdraw, 0);
        if (shortfall > 0) {
            await Execution.delayUntil(() => Bank.loaded(), 4000);
            const available = Bank.count(this.foodName);
            if (available < shortfall) {
                await Bank.close();
                this.park(`configured for ${this.foodWithdraw} ${this.foodName}, but only ${available} are in the bank. Add food, then restart.`);
                return false;
            }
            this.setStatus(`withdrawing ${shortfall} ${this.foodName}`);
            if (!(await Bank.withdrawX(this.foodName, shortfall))) {
                await Bank.close();
                this.log(`withdraw of ${shortfall} ${this.foodName} did not complete — will retry`);
                return false;
            }
        }

        if (!(await Bank.close())) {
            this.log('bank did not close cleanly — will retry before walking');
            return false;
        }
        if (this.foodCount() < this.foodWithdraw) {
            this.park(`restock verification failed: expected ${this.foodWithdraw} ${this.foodName}, found ${this.foodCount()}. Add food, then restart.`);
            return false;
        }

        this.tripPrepared = true;
        this.died = false;
        this.countTrip();
        this.log(`banked the haul and restocked exactly ${this.foodCount()} ${this.foodName}`);
        return true;
    }

    async goToField(): Promise<boolean> {
        if (this.locationName === 'Chaos Druid Tower') {
            return this.towerToField();
        }
        if (this.locationName === 'Yanille Dungeon') {
            return this.yanilleToField();
        }
        if (chaosDruidArea(Game.tile(), this.spot.dungeon) === 'other-underground') {
            this.park('cannot route to Edgeville from a different underground map. Reach the surface, then restart.');
            return false;
        }
        if (!inEdgevilleDungeon(Game.tile()) && !(await this.descendToDungeon())) {
            return false;
        }
        this.setStatus('walking to the Chaos druids');
        await this.crossDungeonGates(true);
        const arrived = await Traversal.walkResilient(this.fieldTile(), {
            radius: 4,
            attempts: 8,
            timeoutMs: 25_000,
            log: message => this.log(`  ${message}`)
        });
        if (arrived) {
            this.died = false;
            this.log(`arrived at the Chaos-druid field (${this.spot.field.x},${this.spot.field.z})`);
        } else {
            this.log('could not reach the Chaos-druid field — will retry');
        }
        return arrived;
    }
}

class Parked implements Task {
    constructor(private bot: ChaosDruidKiller) {}
    validate(): boolean {
        return this.bot.parked;
    }
    async execute(): Promise<void> {
        await Execution.delayTicks(10);
    }
}

class LocationGuard implements Task {
    constructor(private bot: ChaosDruidKiller) {}
    validate(): boolean {
        return chaosDruidArea(Game.tile(), this.bot.spot.dungeon) === 'other-underground';
    }
    execute(): void {
        this.bot.park('entered an underground map this route cannot exit. Reach the surface or the druid field, then restart.');
    }
}

class Eat implements Task {
    constructor(private bot: ChaosDruidKiller) {}
    validate(): boolean {
        return chaosDruidEatReady({
            bankOpen: Bank.isOpen(),
            hpFraction: hpFraction(),
            eatHpFraction: this.bot.eatHpFraction,
            foodCount: this.bot.foodCount()
        });
    }
    async execute(): Promise<void> {
        await eatOnce(this.bot);
    }
}

class BankRun implements Task {
    constructor(private bot: ChaosDruidKiller) {}
    validate(): boolean {
        return chaosDruidBankRunReady(Bank.isOpen(), bankReason(this.bot));
    }
    async execute(): Promise<void> {
        await this.bot.bankAndRestock(bankReason(this.bot) ?? 'prepare-trip');
    }
}

class GoToField implements Task {
    constructor(private bot: ChaosDruidKiller) {}
    validate(): boolean {
        return !this.bot.inField();
    }
    async execute(): Promise<void> {
        await this.bot.goToField();
    }
}

class Loot implements Task {
    constructor(private bot: ChaosDruidKiller) {}

    private find() {
        return GroundItems.query()
            .where(item => isChaosDruidLoot(item.name))
            .within(this.bot.spot.radius + 3)
            .nearest();
    }

    validate(): boolean {
        return !Game.inCombat() && this.find() !== null;
    }

    async execute(): Promise<void> {
        for (let attempt = 0; attempt < 4 && !Game.inCombat(); attempt++) {
            const drop = this.find();
            if (!drop) {
                return;
            }

            const space = chaosDruidLootSpaceAction({
                inventoryFull: Inventory.isFull(),
                mergesIntoExistingStack: chaosDruidDropMerges(
                    drop.name,
                    Inventory.items().map(item => item.name)
                ),
                foodCount: this.bot.foodCount(),
                hp: Skills.effective('hitpoints'),
                maxHp: Skills.level('hitpoints')
            });
            if (space === 'bank') {
                return;
            }
            if (space === 'eat-food') {
                await eatOnce(this.bot);
                continue;
            }
            if (space === 'drop-food') {
                await dropOneFood(this.bot);
                continue;
            }

            const name = drop.name ?? '';
            const beforeUsed = Inventory.used();
            const beforeCount = Inventory.count(name);
            this.bot.setStatus(`looting ${name}`);
            if (!(await drop.interact('Take'))) {
                await Execution.delayTicks(2);
                return;
            }
            if (await Execution.delayUntil(
                () => Inventory.used() > beforeUsed || Inventory.count(name) > beforeCount,
                5000
            )) {
                this.bot.countLoot();
                this.bot.log(`picked up ${name}`);
            }
            return;
        }
    }
}

class Regroup implements Task {
    constructor(private bot: ChaosDruidKiller) {}
    validate(): boolean {
        const here = Game.tile();
        return here !== null && this.bot.inField() && this.bot.fieldTile().distanceTo(here) > Math.min(5, this.bot.spot.radius);
    }
    async execute(): Promise<void> {
        this.bot.setStatus('returning to the druid camp');
        await this.bot.walkOpening(this.bot.fieldTile(), Math.min(4, this.bot.spot.radius - 1));
    }
}

class Fight implements Task {
    constructor(private bot: ChaosDruidKiller) {}

    validate(): boolean {
        return !Game.inCombat()
            && this.bot.inField()
            && bankReason(this.bot) === null
            && this.findDruid() !== null;
    }

    async execute(): Promise<void> {
        const druid = this.findDruid();
        if (!druid) {
            return;
        }

        this.bot.setStatus(`attacking ${this.bot.spot.npc} at ${druid.tile()}`);
        if (!(await druid.interact('Attack'))) {
            await Execution.delayTicks(2);
            return;
        }
        if (!(await Execution.delayUntil(() => Game.inCombat() || ChatDialog.canContinue(), 6000)) || ChatDialog.canContinue()) {
            return;
        }

        this.bot.setStatus(`fighting ${this.bot.spot.npc}`);
        const deadline = performance.now() + 90_000;
        let reattacks = 0;
        while (performance.now() < deadline) {
            if (this.bot.died || ChatDialog.canContinue()) {
                return;
            }
            if (hpFraction() < this.bot.eatHpFraction && this.bot.foodCount() > 0) {
                await eatOnce(this.bot);
            }
            if (this.bot.foodCount() === 0 && hpFraction() <= this.bot.panicHpFraction) {
                this.bot.log(`out of food at ${Math.round(hpFraction() * 100)}% HP — breaking off to bank`);
                return;
            }

            const target = this.target(druid);
            if (!target) {
                this.bot.countKill();
                this.bot.log(`${this.bot.spot.npc} down`);
                return;
            }
            if (target.health === 0 && target.snap.totalHealth > 0) {
                await Execution.delayUntil(() => this.target(druid) === null, 10_000);
                this.bot.countKill();
                this.bot.log(`${this.bot.spot.npc} down`);
                return;
            }
            if (!Game.inCombat() && !target.inCombat) {
                if (reattacks++ >= 2) {
                    return;
                }
                await target.interact('Attack');
                await Execution.delayUntil(() => Game.inCombat() || ChatDialog.canContinue(), 5000);
            }
            await Execution.delayTicks(2);
        }
    }

    private target(druid: Npc): Npc | null {
        return Npcs.all().find(npc => npc.index === druid.index && npc.name === this.bot.spot.npc) ?? null;
    }

    private findDruid(): Npc | null {
        const field = this.bot.fieldTile();
        return Npcs.query()
            .name(this.bot.spot.npc)
            .action('Attack')
            .where(npc => !npc.inCombat && npc.tile().distanceTo(field) <= this.bot.spot.radius)
            .nearest();
    }
}

class Wait implements Task {
    constructor(private bot: ChaosDruidKiller) {}
    validate(): boolean {
        return true;
    }
    async execute(): Promise<void> {
        this.bot.setStatus(Game.inCombat() ? 'fighting' : 'waiting for a druid or drop');
        await Execution.delayTicks(2);
    }
}
