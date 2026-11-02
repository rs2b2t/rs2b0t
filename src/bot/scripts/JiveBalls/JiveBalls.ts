import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { TaskBot } from '../../api/bot/Bot.js';
import { GameMessages } from '../../api/chatbox/gameMessages.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import Tile from '../../geometry/Tile.js';
import { Paint } from '../../paint/Paint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { SHEEP_SITES, chooseSite, type SheepSite } from './sites.js';

const SHEARS = 1735;
const WOOL = 1737;
const SHEEP = 43;
const SHEARS_SPAWN = new Tile(3152, 3306, 0);
const SHEAR_FAILED = /manages to get away|already been shorn|can't reach that/i;

export const SETTINGS: SettingsSchema = {
    location: {
        type: 'string', default: 'random', label: 'Sheep location',
        options: ['random', ...SHEEP_SITES.map(site => site.id)],
        optionLabels: { random: 'Random (weighted by flock size)', ...Object.fromEntries(SHEEP_SITES.map(site => [site.id, site.label])) },
        help: 'random picks once per run, favoring larger flocks. Select locations to spread bots across fields and worlds. Banks raw wool; gets shears from your bank or a free spawn'
    }
};

export default class JiveBalls extends TaskBot {
    override loopDelay = 100;

    private site: SheepSite = SHEEP_SITES[0];
    private status = 'starting';
    private startedAt = Date.now();
    private collected = 0;
    private banked = 0;
    private banking = false;
    private startup = false;
    private fetchingShears = false;
    private done = false;
    private retryAfter = new Map<number, number>();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        const site = chooseSite(this.settings.str('location', 'random'));
        if (!site) {
            this.done = true;
            this.requestFinish('unknown sheep location; select a JiveBalls location');
            return;
        }
        this.site = site;
        this.startedAt = Date.now();
        this.banking = !this.shears() || Inventory.countById(SHEARS) > 1 || Inventory.free() === 0
            || Inventory.items().some(i => i.id !== SHEARS && i.id !== WOOL);
        this.startup = this.banking;
        this.log(`JiveBalls: ${site.label}; shearing and banking raw wool`);
        this.add({ label: 'Gather wool', validate: () => !this.done && Game.ingame(), execute: () => this.run() });
    }

    override recoveryAnchor(): Tile {
        return this.fetchingShears ? SHEARS_SPAWN : this.site.pen;
    }

    private shears() {
        return Inventory.items().find(i => i.id === SHEARS && !i.noted);
    }

    private async run(): Promise<void> {
        if (!this.banking && Bank.isOpen()) {
            await Bank.close();
            return;
        }
        if (this.fetchingShears) {
            if (!this.shears()) {
                await this.fetchShears();
                return;
            }
            this.fetchingShears = false;
        }
        if (this.banking || !this.shears() || Inventory.free() === 0) {
            this.banking = true;
            await this.bank();
            return;
        }

        const here = Game.tile();
        if (!here || here.level !== this.site.pen.level || this.site.pen.distanceTo(here) > this.site.radius) {
            await this.goToFlock();
            return;
        }
        for (const [index, tick] of this.retryAfter) {
            if (tick <= Game.tick()) this.retryAfter.delete(index);
        }
        const candidates = Npcs.query().name('Sheep').withinOf(this.site.pen, this.site.radius)
            .where(n => n.id === SHEEP && n.tile().level === this.site.pen.level
                && !n.targetsAnotherPlayer() && !this.retryAfter.has(n.index)
                && Reachability.canReach(n.tile(), { adjacentOk: true, maxSteps: 2048 }))
            .results().sort((a, b) => a.distance() - b.distance()).slice(0, 3);
        const sheep = candidates[Math.floor(Math.random() * candidates.length)];
        if (!sheep) {
            if (this.site.pen.distanceTo(here) > 2 || !Reachability.canReach(this.site.pen)) {
                await this.goToFlock();
            } else {
                this.status = 'waiting for sheep to regrow';
                await Execution.delayTicks(2);
            }
            return;
        }

        this.status = 'shearing sheep';
        const before = Inventory.countById(WOOL);
        const mark = GameMessages.mark();
        if (await this.shears()!.useOn(sheep)) {
            await Execution.delayUntil(() => Inventory.countById(WOOL) > before || GameMessages.sawSince(mark, SHEAR_FAILED), 6000);
        }
        const gained = Inventory.countById(WOOL) - before;
        if (gained > 0) {
            this.collected += gained;
            Execution.noteProgress();
        } else {
            this.retryAfter.set(sheep.index, Game.tick() + 5);
        }
    }

    private async goToFlock(): Promise<void> {
        this.status = `walking to ${this.site.label}`;
        await Traversal.walkResilient(this.site.pen, { radius: 2, attempts: 3, timeoutMs: 180_000, log: m => this.log(m) });
    }

    private async bank(): Promise<void> {
        this.status = 'banking wool';
        if (!(await Banking.open({ stand: this.startup ? undefined : this.site.bank, log: m => this.log(m) }))
            || !(await Bank.waitReady()) || !(await Bank.backpackReady())) return;
        const before = Inventory.countById(WOOL);
        await Bank.depositAllMatching((_name, id) => id !== SHEARS);
        const deposited = Math.max(0, before - Inventory.countById(WOOL));
        this.banked += deposited;
        if (deposited > 0) Execution.noteProgress();
        if (Inventory.items().some(i => i.id !== SHEARS)) return;
        while (Inventory.countById(SHEARS) > 1) {
            const held = Inventory.countById(SHEARS);
            if (!(await Bank.deposit('Shears'))
                || !(await Execution.delayUntil(() => Inventory.countById(SHEARS) < held, 4000))) return;
        }

        if (!this.shears()) {
            if (Bank.countById(SHEARS) > 0) {
                await Bank.setNoteMode(false);
                if (!(await Bank.withdrawXById(SHEARS, 1))) return;
            } else {
                this.fetchingShears = true;
            }
        }
        this.banking = false;
        this.startup = false;
        await Bank.close();
    }

    private async fetchShears(): Promise<void> {
        this.status = 'collecting free shears';
        const here = Game.tile();
        if (!here || here.level !== 0 || SHEARS_SPAWN.distanceTo(here) > 3
            || !Reachability.canReach(SHEARS_SPAWN, { adjacentOk: true })) {
            await Traversal.walkResilient(SHEARS_SPAWN, { radius: 1, attempts: 3, timeoutMs: 180_000, log: m => this.log(m) });
            return;
        }
        const shears = GroundItems.query().withinOf(SHEARS_SPAWN, 2)
            .where(i => i.id === SHEARS && i.tile().level === 0).nearest();
        if (!shears) {
            this.status = 'waiting for shears to respawn';
            await Execution.delayTicks(2);
            return;
        }
        if (await shears.interact('Take')) {
            if (await Execution.delayUntil(() => !!this.shears(), 4000)) Execution.noteProgress();
        }
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#e8d7a3' });
        const minutes = (Date.now() - this.startedAt) / 60_000;
        p.title(`JiveBalls: ${this.status}`);
        p.row(this.site.label);
        p.row(`Collected: ${this.collected}`, `Banked: ${this.banked}`);
        p.row(`Runtime: ${fmtDuration(minutes)}`, `Wool/hr: ${minutes > 0 ? Math.round(this.collected * 60 / minutes) : 0}`);
        p.bar('Pack', Inventory.used() / 28);
        ScriptRunner.paintControls(p);
        p.end();
    }
}
