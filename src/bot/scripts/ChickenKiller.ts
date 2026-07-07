import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Skills } from '../api/hud/Skills.js';
import { Traversal } from '../api/Traversal.js';
import { RecoveryHints } from '../runtime/RecoveryHints.js';
import type { SettingsSchema } from '../runtime/Settings.js';

/** Tunable parameters (shown in the panel; also `?ChickenKiller.<key>=...`). */
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
        options: ['attack', 'strength', 'defence'],
        label: 'Combat style',
        help: 'which combat stat to train (unarmed); re-applied each login since com_mode is not saved'
    }
};

// combat style name -> com_mode value (aggressive = Strength xp).
const STYLE_MODE: Record<string, number> = { attack: 0, accurate: 0, strength: 1, aggressive: 1, defence: 2, defense: 2, defensive: 2 };

/**
 * Slice 3 exit-criterion bot: kills a configurable target NPC (settings:
 * targetName, default 'Chicken'), loots ground items matching lootMatch and
 * optionally buries bones, unattended. Anchors to wherever it was started —
 * stand among the target NPCs. Also fronts the CowKiller preset (same class,
 * different settings defaults — see scripts/index.ts).
 *
 * Hardening: fights are target-tracked (a kill is the target dying, not our
 * health bar clearing), death is detected via the chat event and recovered
 * by web-walking home from the respawn, and an HP gate stops new fights when
 * low. Random events: dialog events (genie/old man/dwarf) are clicked
 * through by ContinueDialog; attack events (swarm/mage) are survived via the
 * HP gate + death recovery; teleport-away events recover through
 * ReturnToAnchor where a walkable path home exists (the enclosed maze is not
 * solvable in v1).
 */
export default class ChickenKiller extends TaskBot {
    override loopDelay = 600;

    private anchor: Tile | null = null;
    private buried = 0;
    private kills = 0;
    private feathers = 0;
    private deaths = 0;
    private status = 'starting';
    died = false;

    // resolved from settings in onStart (defaults match SETTINGS)
    private leash = 12;
    private gatherFeathers = false;
    private fightHpGate = 0.45;
    private restHp = 0.7;
    private target = 'Chicken';
    private loot = ['bones'];
    private buryEnabled = true;
    private combatMode = 1; // com_mode target: 1 = aggressive (Strength xp)

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.leash = this.settings.num('leashRadius', 12);
        this.gatherFeathers = this.settings.bool('gatherFeathers', false);
        this.fightHpGate = this.settings.num('fightHpGate', 45) / 100;
        this.restHp = this.settings.num('restUntilHp', 70) / 100;
        this.target = this.settings.str('targetName', 'Chicken');
        this.loot = this.settings.str('lootMatch', 'bones').toLowerCase().split('|').map(s => s.trim()).filter(s => s.length > 0);
        this.buryEnabled = this.settings.bool('buryBones', true);
        this.combatMode = STYLE_MODE[this.settings.str('combatStyle', 'strength').toLowerCase()] ?? 1;

        const hinted = RecoveryHints.takeAnchor();
        const here = Game.tile()!;
        this.anchor = hinted ?? new Tile(here.x, here.z, here.level);
        RecoveryHints.anchor = this.anchor;
        if (hinted) {
            this.log(`recovery restart — keeping original anchor ${this.anchor}`);
        }
        this.log(`anchored at ${this.anchor}, hunting ${this.target}, leash ${this.leash}${this.gatherFeathers ? ', gathering feathers' : ''}`);

        // 274 content says "Oh dear you are dead!" (no comma); match loosely
        // so a punctuation tweak upstream can't silently break recovery
        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
        });

        this.add(
            new ContinueDialog(this),
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
    shouldBury(): boolean {
        return this.buryEnabled;
    }
    countFeathers(): void {
        this.feathers++;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [`${this.target} Killer — ${this.status}`, `kills ${this.kills}  buried ${this.buried}${this.gatherFeathers ? `  feathers ${this.feathers}` : ''}${this.deaths > 0 ? `  deaths ${this.deaths}` : ''}`, `hp ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}  tick ${Game.tick()}`];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#5be05b';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
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

function hpFraction(): number {
    const base = Skills.level('hitpoints');
    return base > 0 ? Skills.effective('hitpoints') / base : 1;
}

/**
 * Select the configured combat style (default aggressive = Strength xp) before
 * fighting. com_mode isn't persisted, so this re-asserts it whenever it drifts
 * (e.g. after a relogin), gated on being out of combat.
 */
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

class ContinueDialog implements Task {
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        return ChatDialog.canContinue();
    }

    async execute(): Promise<void> {
        this.bot.setStatus('continuing dialog');
        await ChatDialog.continue();
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

/** Loots any ground item whose lowercased name includes one of the configured lootMatch terms (e.g. "cow hide|bones"). */
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

/** Optional: pick up the feathers chickens drop (gatherFeathers setting). */
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
        // feathers stack, so watch the held count rise (not the slot count)
        const before = Inventory.first('Feather')?.count ?? 0;
        await drop.interact('Take');
        if (await Execution.delayUntil(() => (Inventory.first('Feather')?.count ?? 0) > before, 5000)) {
            this.bot.countFeathers();
            this.bot.log('looted feathers');
        }
    }
}

/** Low HP and out of combat: stand down until we regen (no new fights). */
class Rest implements Task {
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        return !Game.inCombat() && hpFraction() < this.bot.hpGate();
    }

    async execute(): Promise<void> {
        this.bot.setStatus(`resting (${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp)`);
        await Execution.delayUntil(() => hpFraction() >= this.bot.restTarget() || Game.inCombat() || ChatDialog.canContinue(), 120000);
    }
}

class Fight implements Task {
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        return !Game.inCombat() && hpFraction() >= this.bot.hpGate() && this.findTarget() !== null;
    }

    async execute(): Promise<void> {
        const mob = this.findTarget();
        if (!mob) {
            return;
        }

        const name = this.bot.targetName();
        this.bot.setStatus(`attacking ${name} at ${mob.tile()}`);
        if (!mob.interact('Attack')) {
            this.bot.log(`no Attack op on ${name}? ops=[${mob.actions().join(', ')}]`);
            await Execution.delayTicks(2);
            return;
        }

        const engaged = await Execution.delayUntil(() => Game.inCombat() || ChatDialog.canContinue(), 5000);
        if (!engaged || ChatDialog.canContinue()) {
            return;
        }

        // fight THIS mob until it dies — our own health bar clearing
        // mid-fight does not end the kill
        this.bot.setStatus('fighting');
        const deadline = performance.now() + 90000;
        let reattacks = 0;

        while (performance.now() < deadline) {
            if (ChatDialog.canContinue() || this.bot.died) {
                return; // dialog/death tasks take over next loop
            }

            const me = Game.tile();
            if (!me || mob.tile().distanceTo(me) > this.bot.leashRadius() + 8) {
                // we got moved (teleport/death), not the mob dying
                this.bot.log('displaced mid-fight — abandoning target');
                return;
            }

            const engagedMob = this.resnapshot(mob);
            if (!engagedMob) {
                // despawned: died (corpse removed after the death animation)
                this.bot.countKill();
                this.bot.log(`${name} killed`);
                return;
            }

            if (engagedMob.health === 0 && engagedMob.snap.totalHealth > 0) {
                // death animation playing — wait for the despawn, then count
                await Execution.delayUntil(() => this.resnapshot(mob) === null, 10000);
                this.bot.countKill();
                this.bot.log(`${name} killed`);
                return;
            }

            if (!Game.inCombat() && !engagedMob.inCombat) {
                // both disengaged but it's alive (wandered/blocked)
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

    /** Re-snapshot our engaged target by scene slot (name-checked). */
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
