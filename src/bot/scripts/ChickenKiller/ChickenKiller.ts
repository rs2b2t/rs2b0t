import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../../api/tasks/DeathRecovery.js';
import { PeriodicBank } from '../../api/tasks/PeriodicBank.js';
import { PERIODIC_BANK_SETTINGS, depositAllExcept, parseBankStrategy, type BankDestination } from '../../api/bank/Banking.js';
import {
    COMBAT_STYLE_OPTIONS,
    RANGE_STYLE_OPTIONS,
    describeCombatStyle,
    parseCombatStyle,
    parseRangeStyle,
    type MeleeCombatStyle
} from '../../api/combat/CombatStyle.js';
import { Autocast } from '../../api/magic/Autocast.js';
import { castsAvailable, runeWithdrawList } from '../../api/combat/CombatStyleLogic.js';
import { SPELL_DB } from '../../data/spelldb.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Npcs, type Npc } from '../../api/npcs/Npcs.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Bank } from '../../api/bank/Bank.js';
import { Skills } from '../../api/skills/Skills.js';
import { Paint } from '../../paint/Paint.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { CANT_REACH, GameMessages } from '../../api/chatbox/gameMessages.js';
import { RecoveryHints } from '../../runtime/RecoveryHints.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { Reach } from '../../api/walking/Reach.js';

const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic'];

const SHOW_MAGE = { key: 'combatStyle', anyOf: ['mage'] };
const SHOW_RANGE = { key: 'combatStyle', anyOf: ['range'] };
const SHOW_MELEE = { key: 'combatStyle', anyOf: ['melee'] };

/** Legacy ChickenKiller saved `combatStyle` as a melee training style. */
const LEGACY_MELEE = new Set(['attack', 'strength', 'controlled', 'defence', 'accurate', 'aggressive', 'defensive', 'shared']);

export const SETTINGS: SettingsSchema = {
    leashRadius: { type: 'number', default: 12, min: 3, max: 30, label: 'Leash radius (tiles)' },
    fightHpGate: { type: 'number', default: 45, min: 0, max: 100, label: 'Stop fighting below HP%' },
    restUntilHp: { type: 'number', default: 70, min: 0, max: 100, label: 'Rest until HP%' },
    targetName: { type: 'string', default: 'Chicken', label: 'Target NPC name' },
    lootMatch: { type: 'string', default: 'bones', label: 'Loot name match (| = OR)', help: 'e.g. "cow hide|bones"' },
    buryBones: { type: 'boolean', default: true, label: 'Bury bones?' },
    combatStyle: {
        type: 'string',
        default: 'melee',
        options: ['melee', 'mage', 'range'],
        label: 'Combat style',
        help:
            'melee / mage / range — same shape as AutoFighter. '
            + 'Older saves that stored attack/strength/controlled/defence still work as melee.'
    },
    meleeStyle: {
        type: 'string',
        default: 'strength',
        options: COMBAT_STYLE_OPTIONS,
        label: 'Melee style',
        group: 'Combat',
        showIf: SHOW_MELEE,
        help: 'which melee stat to train; re-applied each login since com_mode is not saved'
    },
    spell: {
        type: 'string',
        default: 'Wind Strike',
        options: Object.keys(SPELL_DB),
        label: 'Autocast spell',
        group: 'Combat',
        showIf: SHOW_MAGE,
        help: 'kept armed via autocast — a staff must be wielded'
    },
    runesWithdraw: {
        type: 'number',
        default: 100,
        min: 1,
        max: 1000,
        label: 'Casts of runes per bank trip',
        group: 'Combat',
        showIf: SHOW_MAGE,
        help: 'when periodic banking is on, top runes up to this many casts (staff free runes skipped)'
    },
    rangeStyle: {
        type: 'string',
        default: 'rapid',
        options: RANGE_STYLE_OPTIONS,
        label: 'Ranged style',
        group: 'Combat',
        showIf: SHOW_RANGE
    },
    ammo: {
        type: 'string',
        default: 'Bronze arrow',
        label: 'Ammo (kept + bank withdraw)',
        group: 'Combat',
        showIf: SHOW_RANGE
    },
    ammoWithdraw: {
        type: 'number',
        default: 200,
        min: 1,
        max: 5000,
        label: 'Ammo per bank trip',
        group: 'Combat',
        showIf: SHOW_RANGE,
        help: 'when periodic banking is on, withdraw ammo up to this count after deposit'
    },
    ...PERIODIC_BANK_SETTINGS
};

type FightKind = 'melee' | 'mage' | 'range';

export default class ChickenKiller extends TaskBot {
    override loopDelay = 600;

    private anchor: Tile | null = null;
    private buried = 0;
    private kills = 0;
    private deaths = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    died = false;

    private leash = 12;
    private fightHpGate = 0.45;
    private restHp = 0.7;
    private target = 'Chicken';
    private loot = ['bones'];
    private buryEnabled = true;

    private fightKind: FightKind = 'melee';
    private meleeStyle: MeleeCombatStyle = 'strength';
    private rangeMode = 1;
    private spell = 'Wind Strike';
    private runesWithdraw = 100;
    private ammo = 'Bronze arrow';
    private ammoWithdraw = 200;
    private trackedGear: string[] = [];

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.leash = this.settings.num('leashRadius', 12);
        this.fightHpGate = this.settings.num('fightHpGate', 45) / 100;
        this.restHp = this.settings.num('restUntilHp', 70) / 100;
        this.target = this.settings.str('targetName', 'Chicken');
        this.loot = this.settings
            .str('lootMatch', 'bones')
            .toLowerCase()
            .split('|')
            .map(s => s.trim())
            .filter(s => s.length > 0);
        this.buryEnabled = this.settings.bool('buryBones', true);
        this.parseCombatSettings();
        this.trackedGear = Equipment.items()
            .map(i => i.name ?? '')
            .filter(n => n.length > 0);

        const hinted = RecoveryHints.takeAnchor();
        const here = Game.tile()!;
        this.anchor = this.selectAnchor(new Tile(here.x, here.z, here.level), hinted);
        RecoveryHints.anchor = this.anchor;
        if (hinted) {
            this.log(`recovery restart — keeping original anchor ${this.anchor}`);
        }
        this.startedAt = Date.now();
        this.xpAtStart = COMBAT_SKILLS.reduce((n, sk) => n + Skills.xp(sk), 0);
        this.log(
            `anchored at ${this.anchor}, hunting ${this.target}, leash ${this.leash}, style ${this.fightKind}`
                + (this.fightKind === 'mage'
                    ? ` (${this.spell})`
                    : this.fightKind === 'range'
                        ? ` (${this.rangeMode === 0 ? 'accurate' : this.rangeMode === 1 ? 'rapid' : 'longrange'}, ${this.ammo})`
                        : ` (${this.meleeStyle})`)
        );

        await this.prepareForTravel(new Tile(here.x, here.z, here.level));

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
        });

        this.add(
            new ContinueDialog(() => this.setStatus('continuing dialog')),
            new DeathRecovery(this, {
                anchor: this.getAnchor(),
                radius: 3,
                onDeath: () => {
                    this.setStatus('died — recovering');
                    this.countDeath();
                    this.log('died! waiting for respawn, then walking back to the anchor');
                },
                onRecovered: () => {
                    this.died = false;
                    this.log('back at the anchor');
                }
            }),
            new PeriodicBank({
                strategy: () => parseBankStrategy(this.settings.str('bankStrategy', 'Off')),
                itemsThreshold: () => this.settings.num('bankEveryItems', 15),
                minutesThreshold: () => this.settings.num('bankEveryMinutes', 10),
                countLoot: () => this.depositables(),
                deposit: depositAllExcept(this.keepList()),
                afterDeposit: () => this.afterBankDeposit(),
                destination: () => this.bankDestination(),
                returnTo: () => this.getAnchor(),
                setStatus: s => this.setStatus(s),
                log: m => this.log(m)
            }),
            new BuryBones(this),
            new LootDrops(this),
            new Rest(this),
            new ReequipGear(this),
            new SetCombatStyle(this),
            new ArmAutocast(this),
            new Fight(this),
            new ReturnToAnchor(this)
        );
    }

    private parseCombatSettings(): void {
        const raw = this.settings.str('combatStyle', 'melee').trim().toLowerCase();
        if (LEGACY_MELEE.has(raw)) {
            this.fightKind = 'melee';
            this.meleeStyle = parseCombatStyle(raw);
        } else if (raw === 'mage' || raw === 'range' || raw === 'melee') {
            this.fightKind = raw;
            this.meleeStyle = parseCombatStyle(this.settings.str('meleeStyle', 'strength'));
        } else {
            this.fightKind = 'melee';
            this.meleeStyle = parseCombatStyle(this.settings.str('meleeStyle', 'strength'));
        }
        this.spell = this.settings.str('spell', 'Wind Strike');
        this.runesWithdraw = this.settings.num('runesWithdraw', 100);
        this.rangeMode = parseRangeStyle(this.settings.str('rangeStyle', 'rapid'));
        this.ammo = this.settings.str('ammo', 'Bronze arrow');
        this.ammoWithdraw = this.settings.num('ammoWithdraw', 200);
    }

    override grindTargets(): string[] {
        return [this.target.toLowerCase()];
    }

    override recoveryAnchor(): Tile | null {
        return this.anchor;
    }

    protected selectAnchor(here: Tile, hinted: Tile | null): Tile {
        return hinted ?? here;
    }

    protected async prepareForTravel(_start: Tile): Promise<void> {}

    /**
     * After periodic bank deposit: restock ammo/runes when fighting with style supplies.
     * CowKiller chains toll coins via override + super.
     */
    protected async afterBankDeposit(): Promise<void> {
        await this.restockStyleSupplies();
    }

    protected bankDestination(): BankDestination | null {
        return null;
    }

    leashRadius(): number {
        return this.leash;
    }
    hpGate(): number {
        return this.fightHpGate;
    }
    restTarget(): number {
        return this.restHp;
    }
    targetName(): string {
        return this.target;
    }
    lootTerms(): string[] {
        return this.loot;
    }
    wantsLoot(name: string | null): boolean {
        const n = (name ?? '').toLowerCase();
        return this.loot.some(t => n.includes(t));
    }
    acceptsLootAt(_tile: Tile): boolean {
        return true;
    }
    carriedLoot(): number {
        return Inventory.items().filter(i => this.wantsLoot(i.name)).length;
    }
    keepList(): string[] {
        const keep: string[] = [];
        if (this.shouldBury()) {
            keep.push('Bones');
        }
        if (this.fightKind === 'range') {
            keep.push(this.ammo);
        }
        if (this.fightKind === 'mage') {
            for (const { rune } of runeWithdrawList(this.spell, this.wieldedNames(), 1)) {
                keep.push(rune);
            }
        }
        for (const g of this.trackedGear) {
            if (!keep.some(k => k.toLowerCase() === g.toLowerCase())) {
                keep.push(g);
            }
        }
        return keep;
    }
    depositables(): number {
        const keep = new Set(this.keepList().map(s => s.toLowerCase()));
        return Inventory.items().filter(i => (i.name ?? '').length > 0 && !keep.has((i.name ?? '').toLowerCase())).length;
    }
    shouldBury(): boolean {
        return this.buryEnabled;
    }

    fightStyle(): FightKind {
        return this.fightKind;
    }
    targetMeleeStyle(): MeleeCombatStyle {
        return this.meleeStyle;
    }
    targetRangeMode(): number {
        return this.rangeMode;
    }
    targetSpell(): string {
        return this.spell;
    }
    ammoName(): string {
        return this.ammo;
    }
    ammoWithdrawCount(): number {
        return this.ammoWithdraw;
    }
    runesWithdrawCount(): number {
        return this.runesWithdraw;
    }
    trackedGearNames(): string[] {
        return this.trackedGear;
    }
    wieldedNames(): string[] {
        return Equipment.items().map(i => i.name ?? '');
    }
    castsLeft(): number {
        return castsAvailable(this.spell, this.wieldedNames(), rune => Inventory.count(rune));
    }
    wieldedAmmo(): number {
        return Equipment.items().find(i => (i.name ?? '').toLowerCase() === this.ammo.toLowerCase())?.count ?? 0;
    }
    totalAmmo(): number {
        return Inventory.count(this.ammo) + this.wieldedAmmo();
    }

    protected async restockStyleSupplies(): Promise<void> {
        if (!Bank.isOpen()) {
            return;
        }
        if (this.fightKind === 'melee') {
            return;
        }
        if (this.fightKind === 'mage') {
            this.setStatus('withdrawing runes');
            for (const { rune, count } of runeWithdrawList(this.spell, this.wieldedNames(), this.runesWithdraw)) {
                if (Inventory.count(rune) < count) {
                    const got = await withdrawTo(rune, count);
                    this.log(`withdrew ${got} ${rune} (${Inventory.count(rune)}/${count})`);
                }
            }
            this.log(`runes restocked: ${this.castsLeft()} casts left`);
            return;
        }
        this.setStatus(`restocking ${this.ammo}`);
        const got = await withdrawTo(this.ammo, this.ammoWithdraw);
        if (got > 0) {
            this.log(`withdrew ${got} ${this.ammo} (${this.totalAmmo()} total in quiver + inventory)`);
        }
        if (Inventory.count(this.ammo) > 0 && this.wieldedAmmo() === 0) {
            if (await Equipment.equip(this.ammo)) {
                this.log(`equipped ${this.ammo} (${this.wieldedAmmo()} in quiver)`);
            } else {
                this.log(`WARNING: could not equip ${this.ammo} — will retry from inventory`);
            }
        }
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#5be05b' });
        p.title(`${this.target} Killer — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xpGained = COMBAT_SKILLS.reduce((n, s) => n + Skills.xp(s), 0) - this.xpAtStart;
        const xph = mins > 0.5 ? `${(((xpGained / mins) * 60) / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Kills: ${this.kills}`, `XP/hr: ${xph}`);
        const supply =
            this.fightKind === 'mage'
                ? `Casts: ${this.castsLeft()}`
                : this.fightKind === 'range'
                    ? `Ammo: ${this.totalAmmo()}`
                    : `Style: ${this.meleeStyle}`;
        p.row(supply, `Buried: ${this.buried}`, `Deaths: ${this.deaths}`);
        p.bar('HP', Skills.hpFraction());

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(status: string): void {
        this.status = status;
    }

    countBurial(): void {
        this.buried++;
    }

    countKill(): void {
        this.kills++;
    }

    countDeath(): void {
        this.deaths++;
    }

    getAnchor(): Tile {
        return this.anchor!;
    }
}

async function withdrawTo(name: string, target: number): Promise<number> {
    const start = Inventory.count(name);
    for (let guard = 0; guard < 40 && Inventory.count(name) < target && !Inventory.isFull(); guard++) {
        const before = Inventory.count(name);
        const need = target - before;
        if (need > 10 && (await Bank.withdrawX(name, need))) {
            if (Inventory.count(name) > before) {
                continue;
            }
            break;
        }
        await Bank.withdraw(name, need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1');
        if (!(await Execution.delayUntil(() => Inventory.count(name) > before, 2500))) {
            break;
        }
    }
    return Inventory.count(name) - start;
}

class SetCombatStyle implements Task {
    private announced = false;
    private fails = 0;
    private retryAt = 0;
    constructor(private bot: ChickenKiller) {}

    private selected(): boolean {
        const kind = this.bot.fightStyle();
        if (kind === 'mage') {
            return true;
        }
        if (kind === 'range') {
            return Game.combatMode() === this.bot.targetRangeMode();
        }
        return Game.hasCombatStyle(this.bot.targetMeleeStyle());
    }

    validate(): boolean {
        return this.bot.fightStyle() !== 'mage' && !Game.inCombat() && !this.selected() && Date.now() >= this.retryAt;
    }

    async execute(): Promise<void> {
        this.bot.setStatus('setting combat style');
        if (this.bot.fightStyle() === 'range') {
            Game.setCombatMode(this.bot.targetRangeMode());
        } else {
            Game.setCombatStyle(this.bot.targetMeleeStyle());
        }
        const ok = await Execution.delayUntil(() => this.selected(), 3000);
        if (ok) {
            this.fails = 0;
            if (!this.announced) {
                this.announced = true;
                if (this.bot.fightStyle() === 'range') {
                    const mode = this.bot.targetRangeMode();
                    this.bot.log(
                        `ranged style set to ${mode === 0 ? 'accurate' : mode === 1 ? 'rapid' : 'longrange'}`
                    );
                } else {
                    const resolution = Game.combatStyleResolution(this.bot.targetMeleeStyle());
                    if (resolution) {
                        this.bot.log(`combat style set to ${describeCombatStyle(resolution)}`);
                    }
                }
            }
        } else if (++this.fails >= 5) {
            this.fails = 0;
            this.retryAt = Date.now() + 60_000;
            this.bot.log(`could not set the ${this.bot.fightStyle()} attack style — retrying in 60s`);
        }
    }
}

class ArmAutocast implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private bot: ChickenKiller) {}
    validate(): boolean {
        if (this.bot.fightStyle() !== 'mage' || Autocast.armed() || Date.now() < this.retryAt) {
            return false;
        }
        if (this.bot.castsLeft() < 1) {
            return false;
        }
        return Autocast.staffTabAttached();
    }
    async execute(): Promise<void> {
        const spell = this.bot.targetSpell();
        this.bot.setStatus(`arming autocast: ${spell}`);
        await Execution.delayTicks(3);
        if (await Autocast.arm(spell, m => this.bot.log(m))) {
            this.fails = 0;
        } else if (++this.fails >= 5) {
            this.fails = 0;
            this.retryAt = Date.now() + 60_000;
            this.bot.log(`WARNING: could not arm autocast for '${spell}' — retrying in 60s`);
        }
    }
}

class ReequipGear implements Task {
    private lastFailLogAt = 0;
    constructor(private bot: ChickenKiller) {}
    private candidates(): string[] {
        const gear = [...this.bot.trackedGearNames()];
        if (this.bot.fightStyle() === 'range') {
            const ammo = this.bot.ammoName();
            if (!gear.some(g => g.toLowerCase() === ammo.toLowerCase())) {
                gear.push(ammo);
            }
        }
        return gear;
    }
    validate(): boolean {
        return this.candidates().some(g => !Equipment.contains(g) && Inventory.first(g) !== null);
    }
    async execute(): Promise<void> {
        for (const item of this.candidates()) {
            if (Equipment.contains(item)) {
                continue;
            }
            const inv = Inventory.first(item);
            if (!inv) {
                continue;
            }
            this.bot.setStatus(`re-equipping ${item}`);
            if (await Equipment.equip(item)) {
                this.bot.log(`equipped ${item}`);
            } else if (Date.now() > this.lastFailLogAt) {
                this.lastFailLogAt = Date.now() + 30_000;
                this.bot.log(`WARNING: could not equip ${item} — retrying`);
            }
        }
    }
}

class BuryBones implements Task {
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        return this.bot.shouldBury() && Inventory.contains('Bones');
    }

    async execute(): Promise<void> {
        this.bot.setStatus('burying bones');
        const bones = Inventory.first('Bones');
        if (!bones) {
            return;
        }

        const before = Inventory.used();
        if (!bones.interact('Bury')) {
            this.bot.log(`no Bury op on bones? ops=[${bones.actions().join(', ')}]`);
            await Execution.delayTicks(2);
            return;
        }

        if (await Execution.delayUntil(() => Inventory.used() < before, 3000)) {
            this.bot.countBurial();
            this.bot.log('buried bones');
        }
    }
}

// Why: the scene can keep a ground stack visible after Take fails — already taken by another bot, client desync, or multibox.
// Why: without a skip, LootDrops spins on the same ghost pile (#424), so the tile and id are blacklisted for a while, as FireGiant does.

/** How long a failed pickup keeps its tile and id blacklisted. */
const LOOT_SKIP_MS = 30_000;
const lootSkip = new Map<string, number>();

function lootDropKey(id: number, tile: Tile): string {
    return `${id}|${tile.x}|${tile.z}|${tile.level}`;
}

class LootDrops implements Task {
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        return !Game.inCombat() && this.find() !== null && !Inventory.isFull();
    }

    async execute(): Promise<void> {
        const drop = this.find();
        if (!drop) {
            return;
        }

        const name = drop.name ?? 'loot';
        this.bot.setStatus(`looting ${name} at ${drop.tile()}`);
        const id = drop.id;
        const tile = drop.tile();
        const key = lootDropKey(id, tile);
        const find = () =>
            GroundItems.query()
                .where(item => item.id === id && item.tile().equals(tile))
                .nearest();
        const before = Inventory.used();
        const countBefore = Inventory.count(name);
        const status = await Reach.entityOp({
            find,
            op: 'Take',
            // Stackables may not free a pack slot; also watch the named count.
            expect: () => Inventory.used() > before || Inventory.count(name) > countBefore,
            expectMs: 6000,
            what: name,
            log: message => this.bot.log(message)
        });
        if (status === 'done' && (Inventory.used() > before || Inventory.count(name) > countBefore)) {
            lootSkip.delete(key);
            this.bot.log(`looted ${name}`);
        } else if (status === 'retry' || status === 'unreachable') {
            lootSkip.set(key, performance.now() + LOOT_SKIP_MS);
            this.bot.log(
                `loot attempt did not complete — ignoring ${name} at ${tile.x},${tile.z} for ${LOOT_SKIP_MS / 1000}s (#424)`
            );
        }
    }

    private find() {
        const terms = this.bot.lootTerms();
        const now = performance.now();
        return GroundItems.query()
            .where(g => terms.some(t => t.length > 0 && (g.name?.toLowerCase() ?? '').includes(t)))
            .where(g => this.bot.acceptsLootAt(g.tile()))
            .where(g => (lootSkip.get(lootDropKey(g.id, g.tile())) ?? 0) < now)
            .within(this.bot.leashRadius() + 4)
            .nearest();
    }
}

class Rest implements Task {
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        return !Game.inCombat() && Skills.hpFraction() < this.bot.hpGate();
    }

    async execute(): Promise<void> {
        this.bot.setStatus(`resting (${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp)`);
        await Execution.delayUntil(
            () => Skills.hpFraction() >= this.bot.restTarget() || Game.inCombat() || ChatDialog.canContinue(),
            120000
        );
    }
}

class Fight implements Task {
    private misses = 0;

    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        if (Game.inCombat() || Skills.hpFraction() < this.bot.hpGate()) {
            return false;
        }
        if (this.bot.fightStyle() === 'mage' && this.bot.castsLeft() < 1) {
            return false;
        }
        if (this.bot.fightStyle() === 'range' && this.bot.totalAmmo() < 1) {
            return false;
        }
        return this.findTarget() !== null;
    }

    async execute(): Promise<void> {
        const mob = this.findTarget();
        if (!mob) {
            return;
        }

        const name = this.bot.targetName();
        this.bot.setStatus(`attacking ${name} at ${mob.tile()}`);
        const mark = GameMessages.mark();
        if (!mob.interact('Attack')) {
            this.bot.log(`no Attack op on ${name}? ops=[${mob.actions().join(', ')}]`);
            await Execution.delayTicks(2);
            return;
        }

        const engaged = await Execution.delayUntil(() => Game.inCombat() || ChatDialog.canContinue(), 5000);
        if (!engaged || ChatDialog.canContinue()) {
            if (!engaged && (GameMessages.sawSince(mark, CANT_REACH) || ++this.misses >= 2)) {
                this.bot.log(`can't engage ${name} — a shut gate/fence in the way; walking through it`);
                this.bot.setStatus('crossing the pen gate');
                await Traversal.walkResilient(mob.tile(), {
                    radius: 1,
                    attempts: 3,
                    timeoutMs: 45_000,
                    log: m => this.bot.log(`  ${m}`)
                });
                this.misses = 0;
            }
            return;
        }
        this.misses = 0;

        this.bot.setStatus('fighting');
        const deadline = performance.now() + 90000;
        let reattacks = 0;

        while (performance.now() < deadline) {
            if (ChatDialog.canContinue() || this.bot.died) {
                return;
            }

            if (this.bot.fightStyle() === 'range' && this.bot.wieldedAmmo() === 0 && Inventory.count(this.bot.ammoName()) > 0) {
                this.bot.log('ammo left inventory — reloading quiver');
                return;
            }
            if (this.bot.fightStyle() === 'range' && this.bot.totalAmmo() < 1) {
                this.bot.log('out of ammo — breaking off');
                return;
            }
            if (this.bot.fightStyle() === 'mage' && this.bot.castsLeft() < 1) {
                this.bot.log('out of runes — breaking off');
                return;
            }

            const me = Game.tile();
            if (!me || mob.tile().distanceTo(me) > this.bot.leashRadius() + 8) {
                this.bot.log('displaced mid-fight — abandoning target');
                return;
            }

            const engagedMob = this.resnapshot(mob);
            if (!engagedMob) {
                this.bot.countKill();
                this.bot.log(`${name} killed`);
                return;
            }

            if (engagedMob.health === 0 && engagedMob.snap.totalHealth > 0) {
                await Execution.delayUntil(() => this.resnapshot(mob) === null, 10000);
                this.bot.countKill();
                this.bot.log(`${name} killed`);
                return;
            }

            if (!Game.inCombat() && !engagedMob.inCombat) {
                if (reattacks >= 2) {
                    this.bot.log(`target disengaged twice — abandoning this ${name.toLowerCase()}`);
                    return;
                }

                reattacks++;
                engagedMob.interact('Attack');
                await Execution.delayUntil(() => Game.inCombat() || ChatDialog.canContinue(), 5000);
                continue;
            }

            await Execution.delayTicks(2);
        }
    }

    private resnapshot(mob: Npc): Npc | null {
        const name = this.bot.targetName().toLowerCase();
        return Npcs.all().find(n => n.index === mob.index && n.name?.toLowerCase() === name) ?? null;
    }

    private findTarget() {
        const anchor = this.bot.getAnchor();
        return Npcs.query()
            .name(this.bot.targetName())
            .action('Attack')
            .where(n => !n.inCombat && n.tile().distanceTo(anchor) <= this.bot.leashRadius())
            .nearest();
    }
}

class ReturnToAnchor implements Task {
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        const here = Game.tile();
        return here !== null && this.bot.getAnchor().distanceTo(here) > this.bot.leashRadius();
    }

    async execute(): Promise<void> {
        this.bot.setStatus('returning to anchor');
        this.bot.log(`web-walking to the hunting anchor ${this.bot.getAnchor()}`);
        await Traversal.walkResilient(this.bot.getAnchor(), {
            radius: 3,
            timeoutMs: 120_000,
            log: message => this.bot.log(`  ${message}`)
        });
    }
}
