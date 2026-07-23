import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { Banking } from '../api/Banking.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Locs } from '../api/queries/Locs.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

export const SETTINGS: SettingsSchema = {
    treeName: { type: 'string', default: 'Tree', label: 'Tree name', help: 'e.g. Tree, Oak, Willow' },
    chopAction: { type: 'string', default: 'Chop down', label: 'Chop action' },
    leashRadius: { type: 'number', default: 15, min: 3, max: 30, label: 'Leash radius (tiles)' },
    bankName: { type: 'string', default: 'Bank booth', label: 'Bank object name', help: 'the loc to bank at, e.g. Bank booth' },
    bankOp: { type: 'string', default: 'Use-quickly', label: 'Bank object action', help: 'e.g. Use-quickly, Use, Bank' }
};

function isLogs(name: string | null | undefined): boolean {
    return (name ?? '').toLowerCase().includes('log');
}

function logsHeld(): number {
    return Inventory.items()
        .filter(i => isLogs(i.name))
        .reduce((sum, i) => sum + i.count, 0);
}

export default class Woodcutter extends TaskBot {
    override loopDelay = 600;

    private anchor: Tile | null = null;
    private logsChopped = 0;
    private banked = 0;
    private trips = 0;
    private xpGained = 0;
    private status = 'starting';
    private chopping = false;
    private startedAt = Date.now();
    private xpAtStart = 0;

    private leash = 15;
    private treeName = 'Tree';
    private chopAction = 'Chop down';
    private bankObject = 'Bank booth';
    private bankAction = 'Use-quickly';

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.leash = this.settings.num('leashRadius', 15);
        this.treeName = this.settings.str('treeName', 'Tree');
        this.chopAction = this.settings.str('chopAction', 'Chop down');
        this.bankObject = this.settings.str('bankName', 'Bank booth');
        this.bankAction = this.settings.str('bankOp', 'Use-quickly');

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('woodcutting');

        const here = Game.tile()!;
        this.anchor = new Tile(here.x, here.z, here.level);
        this.log(`anchored at ${this.anchor}, chopping ${this.treeName}, banking at ${this.bankObject}, woodcutting lvl ${Skills.level('woodcutting')}`);

        const bank = Locs.query().name(this.bankObject).nearest();
        if (bank) {
            this.log(`nearest ${this.bankObject} in scene at ${bank.tile()} (${bank.tile().distanceTo(this.anchor)} tiles away)`);
        } else {
            this.log(`WARNING: no '${this.bankObject}' in the scene — start me within scene range of a bank, or I'll drop logs when full`);
        }

        this.on('skill.xp', e => {
            if (e.name === 'woodcutting') {
                this.xpGained += e.delta;
                this.chopping = true;
            }
        });
        this.on('skill.level', e => {
            this.log(`level up! ${e.name} ${e.previous} -> ${e.level}`);
        });
        this.on('inventory.changed', e => {
            if (isLogs(e.name) && e.count > e.previousCount) {
                this.logsChopped++;
            }
        });

        this.add(new ContinueDialog(() => this.setStatus('continuing dialog')), new BankLogs(this), new Chop(this), new ReturnToAnchor(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#5be05b' });
        p.title(`Woodcutter — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('woodcutting') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `WC lvl: ${Skills.level('woodcutting')}`, `XP/hr: ${xph}`);
        p.row(`Chopped: ${this.logsChopped}`, `Banked: ${this.banked}`, `Trips: ${this.trips}`);
        p.text(`Woodcutting XP gained: +${this.xpGained}`, '#8a919a');

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(status: string): void {
        this.status = status;
    }

    getAnchor(): Tile {
        return this.anchor!;
    }

    leashRadius(): number {
        return this.leash;
    }
    tree(): string {
        return this.treeName;
    }
    chop(): string {
        return this.chopAction;
    }
    bankName(): string {
        return this.bankObject;
    }
    bankOp(): string {
        return this.bankAction;
    }

    countBanked(n: number): void {
        this.banked += n;
        this.trips++;
    }

    consumeChopProgress(): boolean {
        const was = this.chopping;
        this.chopping = false;
        return was;
    }
}

class BankLogs implements Task {
    constructor(private bot: Woodcutter) {}

    validate(): boolean {
        return Inventory.isFull() || (logsHeld() > 0 && Inventory.used() >= 26);
    }

    async execute(): Promise<void> {
        const had = logsHeld();
        const deposit = (name: string) => isLogs(name);
        this.bot.setStatus('banking: heading to the nearest bank');
        const banked = await Banking.bankNearest({
            deposit,
            returnTo: this.bot.getAnchor(),
            boothName: this.bot.bankName(),
            boothOp: this.bot.bankOp(),
            log: m => this.bot.log(`  ${m}`)
        });
        if (!banked) {
            this.bot.setStatus('no bank reachable — dropping logs');
            this.bot.log('no bank reachable — dropping instead');
            await dropAllLogs(this.bot);
            return;
        }
        const deposited = had - logsHeld();
        if (deposited > 0) {
            this.bot.countBanked(deposited);
            this.bot.log(`banked ${deposited} logs`);
        }
    }
}

async function dropAllLogs(bot: Woodcutter): Promise<void> {
    bot.setStatus('dropping logs');
    for (let guard = 0; guard < 30; guard++) {
        const logs = Inventory.items().find(i => isLogs(i.name));
        if (!logs) {
            break;
        }
        const before = Inventory.used();
        if (!(await logs.interact('Drop'))) {
            bot.log(`no Drop op on ${logs.name}? ops=[${logs.actions().join(', ')}]`);
            return;
        }
        await Execution.delayUntil(() => Inventory.used() < before, 3000);
    }
}

class Chop implements Task {
    constructor(private bot: Woodcutter) {}

    validate(): boolean {
        return this.findTree() !== null && !Inventory.isFull();
    }

    async execute(): Promise<void> {
        const tree = this.findTree();
        if (!tree) {
            return;
        }

        this.bot.setStatus(`chopping ${this.bot.tree()} at ${tree.tile()}`);
        const before = Inventory.used();
        if (!(await tree.interact(this.bot.chop()))) {
            this.bot.log(`no '${this.bot.chop()}' op on ${this.bot.tree()}? ops=[${tree.actions().join(', ')}]`);
            await Execution.delayTicks(2);
            return;
        }

        await Execution.delayUntil(() => Inventory.used() > before || Game.animating() || ChatDialog.canContinue(), 12000);
        if (Inventory.used() === before && !Game.animating()) {
            await Execution.delayTicks(2);
            return;
        }

        for (let guard = 0; guard < 120; guard++) {
            if (Inventory.isFull() || ChatDialog.canContinue()) {
                return;
            }
            const mark = Inventory.used();
            await Execution.delayUntil(() => Inventory.used() > mark || !Game.animating() || Inventory.isFull() || ChatDialog.canContinue(), 8000);
            if (Inventory.isFull() || ChatDialog.canContinue()) {
                return;
            }
            if (Inventory.used() > mark) {
                continue;
            }
            if (!Game.animating()) {
                return;
            }
        }
    }

    private findTree() {
        const anchor = this.bot.getAnchor();
        return Locs.query()
            .name(this.bot.tree())
            .action(this.bot.chop())
            .where(l => l.tile().distanceTo(anchor) <= this.bot.leashRadius())
            .nearest();
    }
}

class ReturnToAnchor implements Task {
    constructor(private bot: Woodcutter) {}

    validate(): boolean {
        const here = Game.tile();
        return here !== null && this.bot.getAnchor().distanceTo(here) > this.bot.leashRadius() && !Inventory.isFull();
    }

    async execute(): Promise<void> {
        this.bot.setStatus('returning to anchor');
        await Traversal.walkTo(this.bot.getAnchor(), { radius: 3, timeoutMs: 90000 });
    }
}
