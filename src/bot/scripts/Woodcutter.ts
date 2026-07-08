import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { Banking } from '../api/Banking.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Skills } from '../api/hud/Skills.js';
import { Locs } from '../api/queries/Locs.js';
import type { SettingsSchema } from '../runtime/Settings.js';

/** Tunable parameters (panel + `?Woodcutter.<key>=...`). */
export const SETTINGS: SettingsSchema = {
    treeName: { type: 'string', default: 'Tree', label: 'Tree name', help: 'e.g. Tree, Oak, Willow' },
    chopAction: { type: 'string', default: 'Chop down', label: 'Chop action' },
    leashRadius: { type: 'number', default: 15, min: 3, max: 30, label: 'Leash radius (tiles)' },
    bankName: { type: 'string', default: 'Bank booth', label: 'Bank object name', help: 'the loc to bank at, e.g. Bank booth' },
    bankOp: { type: 'string', default: 'Use-quickly', label: 'Bank object action', help: 'e.g. Use-quickly, Use, Bank' }
};

/** An inventory item is logs if its name contains "log" (Logs, Oak logs, Willow logs, …). */
function isLogs(name: string | null | undefined): boolean {
    return (name ?? '').toLowerCase().includes('log');
}

/** Total logs (of any kind) currently in the backpack. */
function logsHeld(): number {
    return Inventory.items()
        .filter(i => isLogs(i.name))
        .reduce((sum, i) => sum + i.count, 0);
}

/**
 * Chops trees and BANKS the logs at the nearest bank, forever. Anchors to
 * wherever it was started — stand near trees with an axe (inventory or wielded)
 * and within scene range of a bank booth. When the pack fills it walks to the
 * nearest bank booth in the scene, deposits every kind of logs, and returns to
 * the trees. If no bank is in the scene it warns and drops instead, so it never
 * hard-stalls. Uses the event bus for xp/level/inventory tracking.
 */
export default class Woodcutter extends TaskBot {
    override loopDelay = 600;

    private anchor: Tile | null = null;
    private logsChopped = 0;
    private banked = 0;
    private trips = 0;
    private xpGained = 0;
    private status = 'starting';
    private chopping = false;

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

        this.add(new ContinueDialog(this), new BankLogs(this), new Chop(this), new ReturnToAnchor(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [`Woodcutter — ${this.status}`, `chopped ${this.logsChopped}  banked ${this.banked} (${this.trips} trips)`, `wc xp +${this.xpGained}  lvl ${Skills.level('woodcutting')}  tick ${Game.tick()}`];
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

    /** Set by the skill.xp listener; consumed by Chop to detect progress. */
    consumeChopProgress(): boolean {
        const was = this.chopping;
        this.chopping = false;
        return was;
    }
}

class ContinueDialog implements Task {
    constructor(private bot: Woodcutter) {}

    validate(): boolean {
        return ChatDialog.canContinue();
    }

    async execute(): Promise<void> {
        this.bot.setStatus('continuing dialog');
        await ChatDialog.continue();
    }
}

/** Full pack -> walk to the nearest bank booth in the scene, deposit all logs, return to the trees. */
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

/** Fallback when no bank is reachable: drop every log so the bot keeps chopping. */
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

        // wait for chopping to take hold: a log, the swing animation starting, or
        // a timeout (walking to the tree takes a moment). Nothing => click refused.
        await Execution.delayUntil(() => Inventory.used() > before || Game.animating() || ChatDialog.canContinue(), 12000);
        if (Inventory.used() === before && !Game.animating()) {
            await Execution.delayTicks(2);
            return;
        }

        // Stay on the tree WHILE we're swinging — key the loop on the chop
        // ANIMATION, not on the tree loc (which reads absent between logs on a
        // standing oak and caused re-clicks). An oak keeps animating and yields
        // many logs, so we wait instead of re-clicking; a normal tree falls after
        // one log, the animation stops, and we return at once for the next tree.
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
                continue; // got a log — keep swinging the same tree
            }
            if (!Game.animating()) {
                return; // stopped swinging with no new log — tree fell/depleted; find the next
            }
            // still animating after 8s with no log — a slow tree; keep waiting
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
        // don't wrestle the banking trip: only re-anchor when we've drifted off with an empty-ish pack
        return here !== null && this.bot.getAnchor().distanceTo(here) > this.bot.leashRadius() && !Inventory.isFull();
    }

    async execute(): Promise<void> {
        this.bot.setStatus('returning to anchor');
        await Traversal.walkTo(this.bot.getAnchor(), { radius: 3, timeoutMs: 90000 });
    }
}
