import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { PeriodicBank } from '../api/tasks/PeriodicBank.js';
import { PERIODIC_BANK_SETTINGS, depositAllExcept, parseBankStrategy } from '../api/Banking.js';
import { COMBAT_STYLE_OPTIONS, parseCombatStyle } from '../api/CombatStyle.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Skills } from '../api/hud/Skills.js';
import { Paint } from '../api/hud/Paint.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { Traversal } from '../api/Traversal.js';
import { CANT_REACH, GameMessages } from '../events/gameMessages.js';
import { RecoveryHints } from '../runtime/RecoveryHints.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints'];

export const SETTINGS: SettingsSchema = {
    gatherFeathers: { type: 'boolean', default: false, label: 'Gather feathers?', help: 'Also pick up the feathers chickens drop' },
    leashRadius: { type: 'number', default: 12, min: 3, max: 30, label: 'Leash radius (tiles)' },
    fightHpGate: { type: 'number', default: 45, min: 0, max: 100, label: 'Stop fighting below HP%' },
    restUntilHp: { type: 'number', default: 70, min: 0, max: 100, label: 'Rest until HP%' },
    targetName: { type: 'string', default: 'Chicken', label: 'Target NPC name' },
    lootMatch: { type: 'string', default: 'bones', label: 'Loot name match (| = OR)', help: 'e.g. "cow hide|bones"' },
    buryBones: { type: 'boolean', default: true, label: 'Bury bones?' },
    combatStyle: {
        type: 'string',
        default: 'strength',
        options: COMBAT_STYLE_OPTIONS,
        label: 'Combat style',
        help: 'which combat stat to train (unarmed); re-applied each login since com_mode is not saved'
    },
    ...PERIODIC_BANK_SETTINGS
};

export default class ChickenKiller extends TaskBot {
    override loopDelay = 600;

    private anchor: Tile | null = null;
    private buried = 0;
    private kills = 0;
    private feathers = 0;
    private deaths = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    died = false;

    private leash = 12;
    private gatherFeathers = false;
    private fightHpGate = 0.45;
    private restHp = 0.7;
    private target = 'Chicken';
    private loot = ['bones'];
    private buryEnabled = true;
    private combatMode = 1;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.leash = this.settings.num('leashRadius', 12);
        this.gatherFeathers = this.settings.bool('gatherFeathers', false);
        this.fightHpGate = this.settings.num('fightHpGate', 45) / 100;
        this.restHp = this.settings.num('restUntilHp', 70) / 100;
        this.target = this.settings.str('targetName', 'Chicken');
        this.loot = this.settings.str('lootMatch', 'bones').toLowerCase().split('|').map(s => s.trim()).filter(s => s.length > 0);
        this.buryEnabled = this.settings.bool('buryBones', true);
        this.combatMode = parseCombatStyle(this.settings.str('combatStyle', 'strength'));

        const hinted = RecoveryHints.takeAnchor();
        const here = Game.tile()!;
        this.anchor = hinted ?? new Tile(here.x, here.z, here.level);
        RecoveryHints.anchor = this.anchor;
        if (hinted) {
            this.log(`recovery restart — keeping original anchor ${this.anchor}`);
        }
        this.startedAt = Date.now();
        this.xpAtStart = COMBAT_SKILLS.reduce((n, sk) => n + Skills.xp(sk), 0);
        this.log(`anchored at ${this.anchor}, hunting ${this.target}, leash ${this.leash}${this.gatherFeathers ? ', gathering feathers' : ''}`);

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
                returnTo: () => this.getAnchor(),
                setStatus: (s) => this.setStatus(s),
                log: (m) => this.log(m)
            }),
            new BuryBones(this),
            new LootDrops(this),
            new LootFeathers(this),
            new Rest(this),
            new SetCombatStyle(this),
            new Fight(this),
            new ReturnToAnchor(this)
        );
    }

    override grindTargets(): string[] {
        return [this.target.toLowerCase()];
    }

    override recoveryAnchor(): Tile | null {
        return this.anchor;
    }

    leashRadius(): number {
        return this.leash;
    }
    wantsFeathers(): boolean {
        return this.gatherFeathers;
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
    carriedLoot(): number {
        return Inventory.items().filter(i => this.wantsLoot(i.name)).length;
    }
    keepList(): string[] {
        return this.shouldBury() ? ['Bones'] : [];
    }
    depositables(): number {
        const keep = new Set(this.keepList().map(s => s.toLowerCase()));
        return Inventory.items().filter(i => (i.name ?? '').length > 0 && !keep.has((i.name ?? '').toLowerCase())).length;
    }
    shouldBury(): boolean {
        return this.buryEnabled;
    }
    countFeathers(): void {
        this.feathers++;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#5be05b' });
        p.title(`${this.target} Killer — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xpGained = COMBAT_SKILLS.reduce((n, s) => n + Skills.xp(s), 0) - this.xpAtStart;
        const xph = mins > 0.5 ? `${((xpGained / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Kills: ${this.kills}`, `XP/hr: ${xph}`);
        if (this.gatherFeathers) {
            p.row(`Buried: ${this.buried}`, `Feathers: ${this.feathers}`, `Deaths: ${this.deaths}`);
        } else {
            p.row(`Buried: ${this.buried}`, `Deaths: ${this.deaths}`);
        }
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
    targetCombatMode(): number {
        return this.combatMode;
    }
}

class SetCombatStyle implements Task {
    private announced = false;
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        return !Game.inCombat() && Game.combatMode() !== this.bot.targetCombatMode();
    }

    async execute(): Promise<void> {
        const mode = this.bot.targetCombatMode();
        this.bot.setStatus('setting combat style');
        Game.setCombatStyle(mode);
        const ok = await Execution.delayUntil(() => Game.combatMode() === mode, 3000);
        if (ok && !this.announced) {
            this.announced = true;
            this.bot.log(`combat style set to ${['accurate', 'aggressive', 'defensive'][mode] ?? '?'} (training ${['Attack', 'Strength', 'Defence'][mode] ?? '?'})`);
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
        const before = Inventory.used();
        if (!drop.interact('Take')) {
            this.bot.log(`no Take op on ground ${name}? ops=[${drop.actions().join(', ')}]`);
            await Execution.delayTicks(2);
            return;
        }

        if (await Execution.delayUntil(() => Inventory.used() > before, 6000)) {
            this.bot.log(`looted ${name}`);
        } else {
            this.bot.log('loot timed out (unreachable?)');
        }
    }

    private find() {
        const terms = this.bot.lootTerms();
        return GroundItems.query()
            .where(g => terms.some(t => t.length > 0 && (g.name?.toLowerCase() ?? '').includes(t)))
            .within(this.bot.leashRadius() + 4)
            .nearest();
    }
}

class LootFeathers implements Task {
    constructor(private bot: ChickenKiller) {}

    private find() {
        return GroundItems.query()
            .name('Feather')
            .within(this.bot.leashRadius() + 4)
            .nearest();
    }

    validate(): boolean {
        return this.bot.wantsFeathers() && !Game.inCombat() && !Inventory.isFull() && this.find() !== null;
    }

    async execute(): Promise<void> {
        const drop = this.find();
        if (!drop) {
            return;
        }

        this.bot.setStatus(`looting feathers at ${drop.tile()}`);
        const before = Inventory.first('Feather')?.count ?? 0;
        await drop.interact('Take');
        if (await Execution.delayUntil(() => (Inventory.first('Feather')?.count ?? 0) > before, 5000)) {
            this.bot.countFeathers();
            this.bot.log('looted feathers');
        }
    }
}

class Rest implements Task {
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        return !Game.inCombat() && Skills.hpFraction() < this.bot.hpGate();
    }

    async execute(): Promise<void> {
        this.bot.setStatus(`resting (${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp)`);
        await Execution.delayUntil(() => Skills.hpFraction() >= this.bot.restTarget() || Game.inCombat() || ChatDialog.canContinue(), 120000);
    }
}

class Fight implements Task {
    private misses = 0;

    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        return !Game.inCombat() && Skills.hpFraction() >= this.bot.hpGate() && this.findTarget() !== null;
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
                await Traversal.walkResilient(mob.tile(), { radius: 1, attempts: 3, timeoutMs: 45_000, log: m => this.bot.log(`  ${m}`) });
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
        await Traversal.walkTo(this.bot.getAnchor(), { radius: 3, timeoutMs: 90000 });
    }
}
