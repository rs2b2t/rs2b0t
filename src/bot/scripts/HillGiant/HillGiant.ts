import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../../api/tasks/DeathRecovery.js';
import { Bank } from '../../api/bank/Bank.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { Skills } from '../../api/skills/Skills.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { COMBAT_STYLE_OPTIONS, describeCombatStyle, parseCombatStyle, type MeleeCombatStyle } from '../../api/combat/CombatStyle.js';
import { DROP_DB } from '../../data/dropdb.js';
import { foodForms, foodCount as foodCountIn, foodHealAmount, shouldEatToUseFood } from '../../api/combat/food.js';
import { matchesCommonBankLoot } from '../../api/bank/Banking.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Locs } from '../../api/locs/Locs.js';
import { Npcs, type Npc } from '../../api/npcs/Npcs.js';
import { matchesEntityName } from '../../api/query/Query.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { BIG_BONES, BRASS_KEY, LIMPWURT, PIT_SPOTS, bonesAction, isHillGiantKill, keepOnDeposit, pickSpot, shouldBank, shouldEatForSpace, tripNeeds } from './HillGiantLogic.js';
import { scriptFood } from '../../api/loadout/loadoutPlan.js';
import { LOADOUT_SETTING } from '../../api/loadout/loadoutSetting.js';

const TARGET = 'Giant';

// Why: on a rev-274 engine the hut door opens by using the key on it — oploc1 only says "The door is locked".
// Why: the ladder inside the hut drops into the Edgeville dungeon giant pit.
// Why: Varrock West is closer to the Edgeville dungeon hut than East (#428).
const BANK_TILE = new Tile(3185, 3440, 0);
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
    loadout: { ...LOADOUT_SETTING, group: 'Food & healing' },
    foodWithdraw: { type: 'number', default: 12, min: 1, max: 27, label: 'Food per trip', group: 'Food & healing' },

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
    died = false;
    private meleeStyle: MeleeCombatStyle = 'strength';
    private weapon = '';
    private foodName = 'Trout';
    private foodPerTrip = 12;

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
        this.foodName = scriptFood(this.settings, 'Trout');
        this.foodPerTrip = this.settings.num('foodWithdraw', 12);

        this.bankCommon = this.settings.bool('bankCommonJunk', true);
        this.buryBones = this.settings.bool('buryBones', false);
        this.lootSlots = this.settings.num('lootSlots', 14);
        this.lootSet = new Set(this.settings.list('loot', DEFAULT_LOOT).map((n: string) => n.toLowerCase()));
        if (this.buryBones) {
            this.lootSet.add(BIG_BONES.toLowerCase());
        }
        this.rerollSpot();
        this.startedAt = Date.now();

        this.log(`HillGiant — ${this.meleeStyle}, food '${this.foodName}' x${this.foodPerTrip} (smart-eat), ${bonesAction(this.buryBones)}ing big bones, spot ${this.spot}`);

        this.add(
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: this.spot,
                radius: PIT_RADIUS,
                onDeath: () => {
                    this.died = true;
                    this.setStatus('died — recovering');
                    this.log('died! walking back and re-wielding whatever gear survived');
                },
                onRecovered: () => {
                    this.died = false;
                },
                walkBack: () => this.travelToPit()
            }),
            new Eat(this),
            new GearEquip(this),
            new SetAttackStyle(this),
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
        this.log(`giant down — ${this.kills} kill${this.kills === 1 ? '' : 's'}`);
    }
    killCount(): number {
        return this.kills;
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

    targetMeleeStyle(): MeleeCombatStyle {
        return this.meleeStyle;
    }

    cfg() {
        return { food: this.foodName, foodPerTrip: this.foodPerTrip, lootSet: this.lootSet, bankCommon: this.bankCommon, buryBones: this.buryBones, lootSlots: this.lootSlots, spot: this.spot, meleeStyle: this.meleeStyle };
    }

    needEat(): boolean {
        const n = this.foodInPack();
        if (n <= 0) {
            return false;
        }
        return shouldEatToUseFood({
            hp: Skills.effective('hitpoints'),
            maxHp: Skills.level('hitpoints'),
            heal: foodHealAmount(this.foodName),
            foodCount: n
        });
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
        // the ladder makes the walker batter a door only the key can open.
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
        return (this.bot.needEat() || shouldEatForSpace(Inventory.free(), this.bot.foodInPack())) && this.bot.foodInPack() > 0;
    }
    async execute(): Promise<void> {
        const { food } = this.bot.cfg();
        const item = Inventory.items().find(i => foodForms(food).includes((i.name ?? '').toLowerCase()));
        if (!item) {
            return;
        }
        const forSpace = Inventory.free() === 0 && !this.bot.needEat();
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

/**
 * com_mode is not persisted — re-assert the chosen melee style (Accurate/Aggressive/
 * Controlled/Defensive) whenever the varp disagrees. Style clicks are legal mid-fight.
 */
class SetAttackStyle implements Task {
    private fails = 0;
    private retryAt = 0;
    private announced = false;
    constructor(private bot: HillGiant) {}
    validate(): boolean {
        return !Game.hasCombatStyle(this.bot.targetMeleeStyle()) && Date.now() >= this.retryAt;
    }
    async execute(): Promise<void> {
        const style = this.bot.targetMeleeStyle();
        this.bot.setStatus('setting combat style');
        Game.setCombatStyle(style);
        if (await Execution.delayUntil(() => Game.hasCombatStyle(style), 3000)) {
            this.fails = 0;
            if (!this.announced) {
                this.announced = true;
                const resolution = Game.combatStyleResolution(style);
                this.bot.log(`combat style: ${resolution ? describeCombatStyle(resolution) : style}`);
            }
        } else if (++this.fails >= 5) {
            this.fails = 0;
            this.retryAt = Date.now() + 60_000;
            this.bot.log(`could not set melee style '${style}' (combat tab not ready?) — retrying in 60s`);
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
        const { lootSlots, food } = this.bot.cfg();
        return shouldBank({
            freeSlots: Inventory.free(),
            foodInPack: this.bot.foodInPack(),
            lootSlotsTarget: lootSlots,
            usedLootSlots: this.bot.lootUsed(),
            hp: Skills.effective('hitpoints'),
            maxHp: Skills.level('hitpoints'),
            heal: foodHealAmount(food)
        });
    }
    async execute(): Promise<void> {
        const { food, foodPerTrip, lootSlots } = this.bot.cfg();
        this.bot.setStatus('banking for food/loot');
        if (!(await this.bot.walkTo(BANK_TILE, 'the Varrock West bank'))) {
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
                ScriptRunner.stop(`out of ${food} in the bank`);
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
    /** Engaged giant index — held across Eat/Loot yields so the kill is counted on despawn (#479). */
    private targetIdx: number | null = null;

    constructor(private bot: HillGiant) {}

    private livingTarget(): Npc | null {
        const { spot } = this.bot.cfg();
        return Npcs.query()
            .name(TARGET)
            .action('Attack')
            .where(n => spot.distanceTo(new Tile(n.tile().x, n.tile().z, 0)) <= PIT_RADIUS && !n.targetsAnotherPlayer() && !n.inCombat)
            .nearest();
    }

    private byIndex(idx: number): Npc | null {
        return Npcs.all().find(n => n.index === idx && matchesEntityName(n.name, TARGET)) ?? null;
    }

    validate(): boolean {
        if (!this.bot.inPit()) {
            this.targetIdx = null;
            return false;
        }
        // Keep running after we engage so despawn is observed even if Eat/Loot preempted us.
        if (this.targetIdx !== null) {
            return true;
        }
        return !Game.inCombat() && this.livingTarget() !== null;
    }

    async execute(): Promise<void> {
        if (this.targetIdx === null) {
            const giant = this.livingTarget();
            if (!giant) {
                return;
            }
            this.bot.setStatus(`attacking ${TARGET}`);
            if (!(await giant.interact('Attack'))) {
                return;
            }
            // Arm tracking only after the click lands — never countKill here (#479).
            this.targetIdx = giant.index;
            await Execution.delayUntil(
                () => Game.inCombat()
                    || this.byIndex(this.targetIdx!) === null
                    || ChatDialog.canContinue()
                    || EventSignal.pending(),
                5000
            );
        }

        if (ChatDialog.canContinue() || EventSignal.pending() || this.bot.died) {
            this.targetIdx = null;
            return;
        }

        this.bot.setStatus('fighting');
        const deadline = performance.now() + 90_000;
        while (performance.now() < deadline) {
            if (EventSignal.pending() || ChatDialog.canContinue() || this.bot.died) {
                this.targetIdx = null;
                return;
            }
            if (this.targetIdx !== null && isHillGiantKill(this.byIndex(this.targetIdx) !== null)) {
                this.bot.countKill();
                this.targetIdx = null;
                await Execution.delayTicks(2);
                return;
            }
            // Yield for food — keep targetIdx so the next Fight pass still counts the despawn.
            if (this.bot.needEat()) {
                return;
            }
            const cur = this.targetIdx !== null ? this.byIndex(this.targetIdx) : null;
            if (cur && !Game.inCombat() && !cur.inCombat) {
                await Execution.delayTicks(3);
                if (this.targetIdx !== null && isHillGiantKill(this.byIndex(this.targetIdx) !== null)) {
                    this.bot.countKill();
                }
                this.targetIdx = null;
                return;
            }
            await Execution.delayTicks(2);
        }
        this.targetIdx = null;
    }
}
