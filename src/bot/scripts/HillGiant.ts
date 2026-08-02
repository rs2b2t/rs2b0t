import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { Bank } from '../api/hud/Bank.js';
import { Equipment } from '../api/hud/Equipment.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { COMBAT_STYLE_OPTIONS, parseCombatStyle, type MeleeCombatStyle } from '../api/CombatStyle.js';
import { DROP_DB } from '../api/combat/data/dropdb.js';
import { FOOD_OPTIONS, foodForms, foodCount as foodCountIn } from '../api/combat/food.js';
import { matchesCommonBankLoot } from '../api/Banking.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Locs } from '../api/queries/Locs.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { BIG_BONES, BRASS_KEY, LIMPWURT, PIT_SPOTS, bonesAction, keepOnDeposit, pickSpot, shouldEatForSpace, tripNeeds } from './HillGiantLogic.js';

const TARGET = 'Giant';

// Verified on a rev-274 engine: the hut door is opened by USING the key on it
// (oploc1 only says "The door is locked"), and the ladder inside drops into the
// Edgeville dungeon giant pit.
const BANK_TILE = new Tile(3253, 3420, 0);
const HUT_DOOR = new Tile(3115, 3450, 0);
const HUT_LADDER = new Tile(3116, 3452, 0);
const HUT_OUTSIDE = new Tile(3116, 3448, 0);
const KEY_SPAWN = new Tile(3131, 9862, 0);
const PIT_RADIUS = 14;

const DROPS: string[] = DROP_DB[TARGET] ?? [];
const DEFAULT_LOOT = [LIMPWURT, BIG_BONES];

export const HILL_GIANT_SETTINGS: SettingsSchema = {
    meleeStyle: { type: 'string', default: 'strength', options: COMBAT_STYLE_OPTIONS, label: 'Melee style', help: 'which melee stat to train; re-applied each login since com_mode is not saved' },
    weapon: { type: 'string', default: '', label: 'Weapon to wield', help: 'kept wielded, withdrawn from the bank when missing and re-worn after a death. Leave blank to fight with whatever you are already wearing.' },
    food: { type: 'string', default: 'Trout', options: FOOD_OPTIONS, label: 'Food', group: 'Food & healing' },
    foodWithdraw: { type: 'number', default: 12, min: 1, max: 27, label: 'Food per trip', group: 'Food & healing' },
    eatAtHp: { type: 'number', default: 50, min: 1, max: 99, label: 'Eat below HP%', group: 'Food & healing' },
    loot: { type: 'string[]', default: DEFAULT_LOOT, options: DROPS, label: 'Loot to pick up', group: 'Banking & loot', help: 'limpwurt roots and big bones by default; everything picked up is banked' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Also grab shared gems/junk', group: 'Banking & loot' },
    buryBones: { type: 'boolean', default: false, label: 'Bury big bones', group: 'Banking & loot', help: 'bury Big bones for Prayer xp instead of banking them' },
    lootSlots: { type: 'number', default: 14, min: 1, max: 27, label: 'Bank after this many loot slots', group: 'Banking & loot' }
};

function hpFrac(): number {
    const max = Skills.level('hitpoints');
    return max > 0 ? Skills.effective('hitpoints') / max : 1;
}

export default class HillGiant extends TaskBot {
    private meleeStyle: MeleeCombatStyle = 'strength';
    private weapon = '';
    private foodName = 'Trout';
    private foodPerTrip = 12;
    private eatAt = 0.5;
    private lootSet = new Set<string>();
    private bankCommon = true;
    private buryBones = false;
    private lootSlots = 14;

    private spot: Tile = PIT_SPOTS[0] as Tile;
    private kills = 0;
    private looted = 0;
    private buried = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.meleeStyle = parseCombatStyle(this.settings.str('meleeStyle', 'strength'));
        this.weapon = this.settings.str('weapon', '').trim();
        this.foodName = this.settings.str('food', 'Trout');
        this.foodPerTrip = this.settings.num('foodWithdraw', 12);
        this.eatAt = this.settings.num('eatAtHp', 50) / 100;
        this.bankCommon = this.settings.bool('bankCommonJunk', true);
        this.buryBones = this.settings.bool('buryBones', false);
        this.lootSlots = this.settings.num('lootSlots', 14);
        this.lootSet = new Set(this.settings.list('loot', DEFAULT_LOOT).map((n: string) => n.toLowerCase()));
        if (this.buryBones) {
            this.lootSet.add(BIG_BONES.toLowerCase());
        }
        this.rerollSpot();
        this.startedAt = Date.now();

        this.log(`HillGiant — ${this.meleeStyle}, food '${this.foodName}' x${this.foodPerTrip} (eat<${Math.round(this.eatAt * 100)}%), ${bonesAction(this.buryBones)}ing big bones, spot ${this.spot}`);

        this.add(
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: this.spot,
                radius: PIT_RADIUS,
                onDeath: () => {
                    this.setStatus('died — recovering');
                    this.log('died! walking back and re-wielding whatever gear survived');
                },
                walkBack: () => this.travelToPit()
            }),
            new Eat(this),
            new GearEquip(this),
            new BuryBones(this),
            new BankRun(this),
            new FetchKey(this),
            new EnterPit(this),
            new LootCorpse(this),
            new Fight(this)
        );
    }

    override recoveryAnchor(): Tile | null {
        return this.spot;
    }
    override grindTargets(): string[] {
        return [TARGET.toLowerCase()];
    }

    setStatus(s: string): void {
        this.status = s;
    }
    countKill(): void {
        this.kills++;
    }
    countLoot(): void {
        this.looted++;
    }
    countBurial(): void {
        this.buried++;
    }
    countTrip(): void {
        this.trips++;
    }

    // A fresh spot each trip keeps several bots from stacking on one corner.
    rerollSpot(): void {
        this.spot = pickSpot(Math.random()) as Tile;
    }

    wantsWeapon(): string {
        return this.weapon;
    }

    cfg() {
        return { food: this.foodName, foodPerTrip: this.foodPerTrip, eatAt: this.eatAt, lootSet: this.lootSet, bankCommon: this.bankCommon, buryBones: this.buryBones, lootSlots: this.lootSlots, spot: this.spot, meleeStyle: this.meleeStyle };
    }

    foodInPack(): number {
        return foodCountIn(Inventory.items(), this.foodName);
    }
    hasKey(): boolean {
        return Inventory.contains(BRASS_KEY);
    }
    inPit(): boolean {
        const here = Game.tile();
        return here !== null && here.z > 9000 && this.spot.distanceTo(new Tile(here.x, here.z, here.level)) <= PIT_RADIUS + 12;
    }
    lootUsed(): number {
        return Inventory.used() - this.foodInPack() - (this.hasKey() ? 1 : 0);
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#b06a3b' });
        p.title(`HillGiant — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const perHr = mins > 0.5 ? Math.round((this.kills / mins) * 60) : 0;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Kills: ${this.kills}`, `Kills/hr: ${perHr}`);
        p.row(`Looted: ${this.looted}`, `Buried: ${this.buried}`, `Trips: ${this.trips}`);
        p.row(`Food: ${this.foodInPack()}`, `Key: ${this.hasKey() ? 'yes' : 'no'}`, `Spot: ${this.spot.x},${this.spot.z}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    async walkTo(dest: Tile, what: string): Promise<boolean> {
        const here = Game.tile();
        if (here && Math.max(Math.abs(here.x - dest.x), Math.abs(here.z - dest.z)) <= 3 && here.level === dest.level) {
            return true;
        }
        this.setStatus(`walking to ${what}`);
        return Traversal.walkResilient(dest, { radius: 3, attempts: 2, timeoutMs: 90_000, log: m => this.log(`  ${m}`) });
    }

    /** Bank -> hut door (key) -> ladder -> the trip's pit spot. */
    async travelToPit(): Promise<boolean> {
        if (this.inPit()) {
            return this.walkTo(this.spot, 'the pit spot');
        }
        // Stop OUTSIDE the door: the ladder is behind it, so pathing straight to
        // the ladder just makes the walker batter a door only the key can open.
        if (!(await this.walkTo(HUT_OUTSIDE, 'the hill giant hut'))) {
            this.log('could not reach the hill giant hut — retrying');
            return false;
        }
        if (!(await this.openHutDoor())) {
            return false;
        }
        if (!(await this.walkTo(HUT_LADDER, 'the hut ladder'))) {
            this.log('unlocked the hut but could not reach the ladder — retrying');
            return false;
        }
        const ladder = Locs.query().name('Ladder').action('Climb-down').within(6).nearest();
        if (!ladder) {
            this.log('no ladder down in the hut — repathing');
            return false;
        }
        this.setStatus('climbing down to the giants');
        if (!(await ladder.interact('Climb-down'))) {
            this.log('the hut ladder refused the climb — retrying');
            return false;
        }
        if (!(await Execution.delayUntil(() => (Game.tile()?.z ?? 0) > 9000, 8000))) {
            this.log('did not arrive underground — retrying');
            return false;
        }
        return this.walkTo(this.spot, 'the pit spot');
    }

    /** The hut door only opens by using the brass key on it. */
    private async openHutDoor(): Promise<boolean> {
        const here = Game.tile();
        if (here && here.z > 9000) {
            return true;
        }
        const shutDoor = () => Locs.query().name('Door').where(l => l.tile().x === HUT_DOOR.x && l.tile().z === HUT_DOOR.z).nearest();
        const door = shutDoor();
        if (!door) {
            // an opened door stops occupying the locked tile
            return true;
        }
        const key = Inventory.first(BRASS_KEY);
        if (!key) {
            this.log(`no ${BRASS_KEY} to unlock the hut`);
            return false;
        }
        this.setStatus('unlocking the hut door');
        if (!(await key.useOn(door))) {
            this.log('the hut door refused the key — retrying');
            return false;
        }
        if (!(await Execution.delayUntil(() => shutDoor() === null, 5000))) {
            this.log('the hut door stayed shut after using the key — retrying');
            return false;
        }
        this.log('unlocked the hut door');
        return true;
    }
}

class Eat implements Task {
    constructor(private bot: HillGiant) {}
    validate(): boolean {
        const { eatAt } = this.bot.cfg();
        return (hpFrac() < eatAt || shouldEatForSpace(Inventory.free(), this.bot.foodInPack())) && this.bot.foodInPack() > 0;
    }
    async execute(): Promise<void> {
        const { food } = this.bot.cfg();
        const item = Inventory.items().find(i => foodForms(food).includes((i.name ?? '').toLowerCase()));
        if (!item) {
            return;
        }
        const forSpace = Inventory.free() === 0 && hpFrac() >= this.bot.cfg().eatAt;
        this.bot.setStatus(forSpace ? `eating ${item.name} for a free slot` : `eating ${item.name} (${Math.round(hpFrac() * 100)}% hp)`);
        const before = Inventory.used();
        await item.interact('Eat');
        await Execution.delayUntil(() => Inventory.used() < before, 3000);
    }
}

/** Keeps the chosen weapon wielded — on the first trip and after a death. */
class GearEquip implements Task {
    private fails = 0;
    constructor(private bot: HillGiant) {}
    validate(): boolean {
        const weapon = this.bot.wantsWeapon();
        return weapon !== '' && this.fails < 5 && !Equipment.contains(weapon) && Inventory.contains(weapon);
    }
    async execute(): Promise<void> {
        const weapon = this.bot.wantsWeapon();
        this.bot.setStatus(`wielding ${weapon}`);
        if (await Equipment.equip(weapon)) {
            this.bot.log(`wielded ${weapon}`);
            this.fails = 0;
        } else {
            this.fails++;
            this.bot.log(`could not wield ${weapon} (attempt ${this.fails}/5)`);
        }
    }
}

class BuryBones implements Task {
    constructor(private bot: HillGiant) {}
    validate(): boolean {
        return this.bot.cfg().buryBones && Inventory.contains(BIG_BONES);
    }
    async execute(): Promise<void> {
        const bones = Inventory.first(BIG_BONES);
        if (!bones) {
            return;
        }
        this.bot.setStatus('burying big bones');
        const before = Inventory.count(BIG_BONES);
        await bones.interact('Bury');
        if (await Execution.delayUntil(() => Inventory.count(BIG_BONES) < before, 4000)) {
            this.bot.countBurial();
        }
    }
}

class BankRun implements Task {
    constructor(private bot: HillGiant) {}
    validate(): boolean {
        const { lootSlots } = this.bot.cfg();
        const outOfFood = this.bot.foodInPack() === 0 && Inventory.free() === 0;
        return this.bot.lootUsed() >= lootSlots || outOfFood;
    }
    async execute(): Promise<void> {
        const { food, foodPerTrip, lootSlots } = this.bot.cfg();
        this.bot.setStatus('banking');
        if (!(await this.bot.walkTo(BANK_TILE, 'the Varrock East bank'))) {
            return;
        }
        if (!(await Bank.openNearest('Bank booth', 'Use-quickly', m => this.bot.log(`  ${m}`)))) {
            return;
        }
        const keep = keepOnDeposit(food).map(n => n.toLowerCase());
        await Bank.depositAllMatching(name => !keep.includes(name.toLowerCase()));

        const needs = tripNeeds(this.bot.hasKey(), this.bot.foodInPack(), foodPerTrip);
        if (needs.key) {
            if (Bank.count(BRASS_KEY) > 0) {
                await Bank.withdrawX(BRASS_KEY, 1);
            } else {
                this.bot.log(`no ${BRASS_KEY} banked — fetching one from the Edgeville dungeon`);
            }
        }
        const weapon = this.bot.wantsWeapon();
        if (weapon !== '' && !Equipment.contains(weapon) && !Inventory.contains(weapon)) {
            if (Bank.count(weapon) > 0) {
                await Bank.withdrawX(weapon, 1);
            } else {
                this.bot.log(`no ${weapon} banked to replace the lost one — fighting unarmed until one is banked`);
            }
        }
        if (needs.food > 0) {
            if (Bank.count(food) === 0) {
                await Bank.close();
                this.bot.log(`out of ${food} in the bank. Stopping.`);
                ScriptRunner.stop();
                return;
            }
            await Bank.withdrawX(food, needs.food);
        }
        await Bank.close();
        this.bot.countTrip();
        // a new spot each trip spreads bots around the pit
        this.bot.rerollSpot();
        this.bot.log(`trip ${lootSlots} slots banked; next spot ${this.bot.cfg().spot}`);
    }
}

/** The issue's fallback when the bank has no key: take the dungeon ground spawn. */
class FetchKey implements Task {
    constructor(private bot: HillGiant) {}
    validate(): boolean {
        return !this.bot.hasKey() && !this.bot.inPit();
    }
    async execute(): Promise<void> {
        this.bot.setStatus(`fetching a ${BRASS_KEY}`);
        // the Edgeville trapdoor is a curated transport, so the walker takes
        // itself down into the dungeon on the way to the spawn tile
        if (!(await this.bot.walkTo(KEY_SPAWN, `the ${BRASS_KEY} spawn`))) {
            this.bot.log(`could not reach the ${BRASS_KEY} spawn in the Edgeville dungeon`);
            return;
        }
        const key = GroundItems.query().name(BRASS_KEY).within(8).nearest();
        if (!key) {
            this.bot.log(`no ${BRASS_KEY} on the floor yet — waiting for the respawn`);
            await Execution.delayTicks(5);
            return;
        }
        const before = Inventory.used();
        await key.interact('Take');
        if (await Execution.delayUntil(() => Inventory.used() > before, 4000)) {
            this.bot.log(`picked up the ${BRASS_KEY}`);
        }
    }
}

class EnterPit implements Task {
    constructor(private bot: HillGiant) {}
    validate(): boolean {
        return this.bot.hasKey() && !this.bot.inPit();
    }
    async execute(): Promise<void> {
        await this.bot.travelToPit();
    }
}

class LootCorpse implements Task {
    constructor(private bot: HillGiant) {}
    private find() {
        const { lootSet, bankCommon } = this.bot.cfg();
        return GroundItems.query()
            .where(g => {
                const name = (g.name ?? '').toLowerCase();
                return lootSet.has(name) || (bankCommon && matchesCommonBankLoot(g.name ?? '', g.id));
            })
            .within(PIT_RADIUS)
            .nearest();
    }
    validate(): boolean {
        return this.bot.inPit() && Inventory.free() > 0 && this.find() !== null;
    }
    async execute(): Promise<void> {
        const drop = this.find();
        if (!drop) {
            return;
        }
        this.bot.setStatus(`looting ${drop.name}`);
        const before = Inventory.used();
        await drop.interact('Take');
        if (await Execution.delayUntil(() => Inventory.used() > before, 4000)) {
            this.bot.countLoot();
            this.bot.log(`looted ${drop.name}`);
        }
    }
}

class Fight implements Task {
    constructor(private bot: HillGiant) {}
    private target(): Npc | null {
        const { spot } = this.bot.cfg();
        return Npcs.query()
            .name(TARGET)
            .where(n => spot.distanceTo(new Tile(n.tile().x, n.tile().z, 0)) <= PIT_RADIUS && !n.targetsAnotherPlayer())
            .nearest();
    }
    validate(): boolean {
        return this.bot.inPit() && !Game.inCombat() && this.target() !== null;
    }
    async execute(): Promise<void> {
        const giant = this.target();
        if (!giant) {
            return;
        }
        this.bot.setStatus(`attacking ${TARGET}`);
        if (await giant.interact('Attack')) {
            this.bot.countKill();
            await Execution.delayUntil(() => !Game.inCombat(), 60_000);
        }
    }
}
