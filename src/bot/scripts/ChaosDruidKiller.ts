import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { PeriodicBank } from '../api/tasks/PeriodicBank.js';
import { PERIODIC_BANK_SETTINGS, parseBankStrategy, depositMatcher } from '../api/Banking.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Skills } from '../api/hud/Skills.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Locs } from '../api/queries/Locs.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import { Traversal } from '../api/Traversal.js';
import type { SettingsSchema } from '../runtime/Settings.js';

/** Tunable parameters (panel + `?ChaosDruidKiller.<key>=...`). */
export const SETTINGS: SettingsSchema = {
    loot: {
        type: 'string',
        default: 'herb, law rune',
        label: 'Loot (name contains, comma-sep)',
        help: 'pick up only drops whose name contains one of these; everything else is left'
    },
    leashRadius: { type: 'number', default: 8, min: 3, max: 20, label: 'Leash radius (tiles)' },
    fightHpGate: { type: 'number', default: 40, min: 0, max: 100, label: 'Stop fighting below HP%' },
    restUntilHp: { type: 'number', default: 65, min: 0, max: 100, label: 'Rest until HP%' },
    ...PERIODIC_BANK_SETTINGS
};

// --- Edgeville dungeon banking route (fixed waypoints) ---
const DRUID = 'Chaos druid';
const UNDERGROUND_Z = 6400; // dungeon tiles sit above this; surface below it
const LADDER = { name: 'Ladder', op: 'Climb-up', tile: new Tile(3096, 9867, 0) }; // dungeon -> surface (3096,3468)
const TRAPDOOR = { name: 'Trapdoor', tile: new Tile(3097, 3468, 0), stand: new Tile(3096, 3468, 0) }; // surface -> dungeon (Open then Climb-down); stand = the climb-up landing tile, adjacent to it
const BANK = { name: 'Bank booth', op: 'Use-quickly', stand: new Tile(3094, 3491, 0) }; // Edgeville bank

/**
 * Kills Chaos druids in the Edgeville (wilderness) dungeon, loots the herb /
 * law-rune drops, and banks them: when the pack fills it climbs the dungeon
 * ladder, web-walks to the Edgeville bank, deposits the loot, then climbs back
 * down and returns to the druids. Start it standing among the druids
 * (~3110,9928) — that tile becomes the anchor it fights around and returns to.
 *
 * The web-walker can't cross the dungeon ladder (it's not a transport edge), so
 * the up/down climbs are scripted while every walk segment uses the walker.
 */
export default class ChaosDruidKiller extends TaskBot {
    override loopDelay = 600;

    private anchor: Tile | null = null;
    private loot: string[] = [];
    private leash = 8;
    private fightHpGate = 0.4;
    private restHp = 0.65;
    bankCommon = true;

    private kills = 0;
    private looted = 0;
    private trips = 0;
    private deaths = 0;
    private status = 'starting';
    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.loot = this.settings
            .str('loot', 'herb, law rune')
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
        this.leash = this.settings.num('leashRadius', 8);
        this.fightHpGate = this.settings.num('fightHpGate', 40) / 100;
        this.restHp = this.settings.num('restUntilHp', 65) / 100;
        this.bankCommon = this.settings.bool('bankCommonJunk', true);

        const here = Game.tile()!;
        this.anchor = new Tile(here.x, here.z, here.level);
        this.log(`anchored at ${this.anchor}, leash ${this.leash}, looting [${this.loot.join(', ')}]`);
        if (here.z < UNDERGROUND_Z) {
            this.log('warning: not underground — start me standing among the Chaos druids in the dungeon');
        }

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
                    this.log('died! waiting for respawn, then heading back down to the druids');
                },
                onRecovered: () => {
                    this.died = false;
                },
                // the web-walker can't cross the dungeon ladder (see the
                // class doc comment) — climb down first, exactly like the
                // BankRun leg does, then walk the last stretch underground
                walkBack: async () => {
                    if ((Game.tile()?.z ?? 0) < UNDERGROUND_Z) {
                        const climbed = await this.descendToDungeon();
                        if (climbed) {
                            this.log('climbed back down to the dungeon');
                        }
                    }
                    const here = Game.tile();
                    if (here && this.getAnchor().distanceTo(here) > 3 && here.z > UNDERGROUND_Z) {
                        return this.gatedWalk(this.getAnchor(), 3);
                    }
                    return true;
                }
            }),
            new BankRun(this),
            new PeriodicBank({
                strategy: () => parseBankStrategy(this.settings.str('bankStrategy', 'Off')),
                itemsThreshold: () => this.settings.num('bankEveryItems', 15),
                minutesThreshold: () => this.settings.num('bankEveryMinutes', 10),
                countLoot: () => this.carriedLoot(),
                deposit: (name) => this.wantsLoot(name),
                commonJunk: () => this.bankCommon,
                returnTo: () => this.getAnchor(),
                setStatus: (s) => this.setStatus(s),
                log: (m) => this.log(m)
            }),
            new Loot(this),
            new Rest(this),
            new Fight(this),
            new ReturnToAnchor(this)
        );
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [`ChaosDruidKiller — ${this.status}`, `kills ${this.kills}  looted ${this.looted}  bank trips ${this.trips}${this.deaths ? `  deaths ${this.deaths}` : ''}`, `hp ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}  tick ${Game.tick()}`];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#9be05b';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void {
        this.status = s;
    }
    getAnchor(): Tile {
        return this.anchor!;
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
    wantsLoot(name: string | null): boolean {
        const n = name?.toLowerCase();
        return n !== undefined && this.loot.some(m => n.includes(m));
    }
    carriedLoot(): number {
        return Inventory.items().filter(i => this.wantsLoot(i.name)).length;
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
    countDeath(): void {
        this.deaths++;
    }

    // --- shared route helpers (climbs the walker can't do) ---

    /**
     * Web-walk to a dungeon tile, manually opening any Gate/Door we stall at —
     * the walker's own door handling is unreliable at the dungeon gates, so we
     * drive each stall: walk a segment, and if we didn't progress, open the
     * nearest closed gate and try again.
     */
    async gatedWalk(dest: Tile, radius = 2): Promise<boolean> {
        for (let seg = 0; seg < 12; seg++) {
            const here = Game.tile();
            if (here && dest.distanceTo(here) <= radius) {
                return true;
            }
            await Traversal.walkTo(dest, { radius, timeoutMs: 25000, log: m => this.log(`  ${m}`) });
            const after = Game.tile();
            if (after && dest.distanceTo(after) <= radius) {
                return true;
            }
            const gate = Locs.query().name('Gate', 'Door', 'Large door').where(l => l.distance() <= 2 && l.actions().some(a => /open/i.test(a))).nearest();
            if (gate) {
                const op = gate.actions().find(a => /open/i.test(a))!;
                this.log(`  opening ${gate.name} at ${gate.tile()}`);
                await gate.interact(op);
                await Execution.delayTicks(2);
            } else {
                await Execution.delayTicks(1);
            }
        }
        const here = Game.tile();
        return here !== null && dest.distanceTo(here) <= radius;
    }

    /** Walk to the dungeon ladder and climb to the surface. */
    async ascendToSurface(): Promise<boolean> {
        if ((Game.tile()?.z ?? 0) < UNDERGROUND_Z) {
            return true; // already on the surface (e.g. a retry after a failed bank open)
        }
        await this.gatedWalk(LADDER.tile, 2);
        for (let attempt = 0; attempt < 3; attempt++) {
            const ladder = Locs.query().name(LADDER.name).action(LADDER.op).nearest();
            if (!ladder) {
                await Execution.delayTicks(2);
                continue;
            }
            await ladder.interact(LADDER.op);
            if (await Execution.delayUntil(() => (Game.tile()?.z ?? 0) < UNDERGROUND_Z, 8000)) {
                return true;
            }
        }
        return (Game.tile()?.z ?? 0) < UNDERGROUND_Z;
    }

    /** Walk to the surface trapdoor and climb down into the dungeon. */
    async descendToDungeon(): Promise<boolean> {
        if ((Game.tile()?.z ?? 0) > UNDERGROUND_Z) {
            return true; // already underground
        }
        // gatedWalk opens the entrance-house door the plain walker stalls at
        await this.gatedWalk(TRAPDOOR.stand, 1);
        for (let attempt = 0; attempt < 6; attempt++) {
            const trap = Locs.query().name(TRAPDOOR.name).where(l => l.distance() <= 3).nearest();
            if (!trap) {
                await this.gatedWalk(TRAPDOOR.stand, 1);
                continue;
            }
            // closed trapdoor offers "Open"; opened one offers "Climb-down"
            const op = trap.actions().find(a => /climb-down/i.test(a)) ?? trap.actions().find(a => /open/i.test(a));
            if (!op) {
                await Execution.delayTicks(2);
                continue;
            }
            await trap.interact(op);
            if (await Execution.delayUntil(() => (Game.tile()?.z ?? 0) > UNDERGROUND_Z, /open/i.test(op) ? 2500 : 6000)) {
                return true;
            }
        }
        return (Game.tile()?.z ?? 0) > UNDERGROUND_Z;
    }
}

function hpFraction(): number {
    const base = Skills.level('hitpoints');
    return base > 0 ? Skills.effective('hitpoints') / base : 1;
}

class ContinueDialog implements Task {
    constructor(private bot: ChaosDruidKiller) {}
    validate(): boolean {
        return ChatDialog.canContinue();
    }
    async execute(): Promise<void> {
        await ChatDialog.continue();
    }
}

/** Full pack -> ladder up -> Edgeville bank -> deposit loot -> ladder down -> anchor. */
class BankRun implements Task {
    constructor(private bot: ChaosDruidKiller) {}

    validate(): boolean {
        return Inventory.isFull();
    }

    async execute(): Promise<void> {
        this.bot.setStatus('banking: climbing out');
        if (!(await this.bot.ascendToSurface())) {
            this.bot.log('could not climb the ladder — will retry');
            return;
        }

        this.bot.setStatus('banking: walking to Edgeville bank');
        await Traversal.walkTo(BANK.stand, { radius: 2, timeoutMs: 90000, log: m => this.bot.log(`  ${m}`) });

        if (!(await Bank.openBooth(BANK.stand, BANK.name, BANK.op, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }

        this.bot.setStatus('banking: depositing loot');
        await Bank.depositAllMatching(depositMatcher(name => this.bot.wantsLoot(name), this.bot.bankCommon));
        await Execution.delayTicks(1);
        this.bot.countTrip();
        this.bot.log('deposited the haul');

        // walking opens distance from the booth; the bank closes on its own
        this.bot.setStatus('banking: heading back down');
        if (!(await this.bot.descendToDungeon())) {
            this.bot.log('could not climb back down — will retry');
            return;
        }
        await this.bot.gatedWalk(this.bot.getAnchor(), 3);
        this.bot.log('back at the druids');
    }
}

/** Pick up wanted drops near the anchor when out of combat. */
class Loot implements Task {
    constructor(private bot: ChaosDruidKiller) {}

    private find() {
        return GroundItems.query()
            .where(g => this.bot.wantsLoot(g.name))
            .within(this.bot.leashRadius() + 4)
            .nearest();
    }

    validate(): boolean {
        return !Game.inCombat() && !Inventory.isFull() && this.find() !== null;
    }

    async execute(): Promise<void> {
        const drop = this.find();
        if (!drop) {
            return;
        }

        this.bot.setStatus(`looting ${drop.name} at ${drop.tile()}`);
        const before = Inventory.used();
        if (!(await drop.interact('Take'))) {
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => Inventory.used() > before, 5000)) {
            this.bot.countLoot();
        }
    }
}

/** Low HP and out of combat: stand down until we regen. */
class Rest implements Task {
    constructor(private bot: ChaosDruidKiller) {}
    validate(): boolean {
        return !Game.inCombat() && hpFraction() < this.bot.hpGate();
    }
    async execute(): Promise<void> {
        this.bot.setStatus(`resting (${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp)`);
        await Execution.delayUntil(() => hpFraction() >= this.bot.restTarget() || Game.inCombat() || ChatDialog.canContinue(), 120000);
    }
}

class Fight implements Task {
    constructor(private bot: ChaosDruidKiller) {}

    validate(): boolean {
        return !Game.inCombat() && hpFraction() >= this.bot.hpGate() && this.findDruid() !== null;
    }

    async execute(): Promise<void> {
        const druid = this.findDruid();
        if (!druid) {
            return;
        }

        this.bot.setStatus(`attacking ${DRUID} at ${druid.tile()}`);
        if (!(await druid.interact('Attack'))) {
            await Execution.delayTicks(2);
            return;
        }

        const engaged = await Execution.delayUntil(() => Game.inCombat() || ChatDialog.canContinue(), 5000);
        if (!engaged || ChatDialog.canContinue()) {
            return;
        }

        this.bot.setStatus('fighting');
        const deadline = performance.now() + 90000;
        let reattacks = 0;

        while (performance.now() < deadline) {
            if (ChatDialog.canContinue() || this.bot.died || Inventory.isFull()) {
                return;
            }

            const me = Game.tile();
            if (!me || druid.tile().distanceTo(me) > this.bot.leashRadius() + 10) {
                this.bot.log('displaced mid-fight — abandoning target');
                return;
            }

            const target = this.target(druid);
            if (!target) {
                this.bot.countKill();
                return;
            }
            if (target.health === 0 && target.snap.totalHealth > 0) {
                await Execution.delayUntil(() => this.target(druid) === null, 10000);
                this.bot.countKill();
                return;
            }
            if (!Game.inCombat() && !target.inCombat) {
                if (reattacks >= 2) {
                    return;
                }
                reattacks++;
                await target.interact('Attack');
                await Execution.delayUntil(() => Game.inCombat() || ChatDialog.canContinue(), 5000);
                continue;
            }
            await Execution.delayTicks(2);
        }
    }

    private target(druid: Npc): Npc | null {
        return Npcs.all().find(n => n.index === druid.index && n.name === DRUID) ?? null;
    }

    private findDruid() {
        const anchor = this.bot.getAnchor();
        return Npcs.query()
            .name(DRUID)
            .action('Attack')
            .where(n => !n.inCombat && n.tile().distanceTo(anchor) <= this.bot.leashRadius())
            .nearest();
    }
}

class ReturnToAnchor implements Task {
    constructor(private bot: ChaosDruidKiller) {}
    validate(): boolean {
        const here = Game.tile();
        // only re-anchor while we're underground; the bank run owns surface travel
        return here !== null && here.z > UNDERGROUND_Z && this.bot.getAnchor().distanceTo(here) > this.bot.leashRadius();
    }
    async execute(): Promise<void> {
        this.bot.setStatus('returning to anchor');
        await this.bot.gatedWalk(this.bot.getAnchor(), 3);
    }
}
