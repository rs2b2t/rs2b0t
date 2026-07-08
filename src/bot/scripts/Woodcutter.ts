import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { Bank } from '../api/hud/Bank.js';
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
        const booth = Locs.query().name(this.bot.bankName()).nearest();
        if (!booth) {
            // no bank reachable in the scene — drop so we never hard-stall, but shout about it
            this.bot.setStatus('no bank in scene — dropping logs');
            this.bot.log(`no '${this.bot.bankName()}' in the scene near the anchor — dropping instead. Start me next to a bank to bank the logs.`);
            await dropAllLogs(this.bot);
            return;
        }

        // Walk CLOSE to the booth (its own tile is solid/unreachable, so the
        // pathfinder stops a few tiles off on the reachable side — that's fine).
        // Then interact the booth directly; the engine routes us the last few
        // tiles to its accessible side and opens it (no hand-picked stand tile).
        this.bot.setStatus(`banking: heading to ${this.bot.bankName()} at ${booth.tile()}`);
        await Traversal.walkResilient(booth.tile(), { radius: 3, attempts: 3, timeoutMs: 90000, log: m => this.bot.log(`  ${m}`) });

        if (!(await Bank.openNearest(this.bot.bankName(), this.bot.bankOp(), m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }

        this.bot.setStatus('banking: depositing logs');
        const had = logsHeld();
        await Bank.depositAllMatching(name => isLogs(name));
        await Execution.delayUntil(() => logsHeld() === 0, 3000);

        const remaining = logsHeld();
        const deposited = had - remaining;
        if (deposited > 0) {
            this.bot.countBanked(deposited);
            this.bot.log(`banked ${deposited} logs`);
        }
        if (remaining > 0) {
            this.bot.log(`warning: ${remaining} logs still in the pack after depositing`);
        }

        this.bot.setStatus('banking: back to the trees');
        await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, timeoutMs: 90000, log: m => this.bot.log(`  ${m}`) });
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

        const treeTile = tree.tile();
        // Is the tree we're on still standing? A normal tree falls after ONE
        // log — the moment this goes false we return at once for the next tree
        // instead of waiting out the progress timeout (the "sits too long"
        // pause). Oaks/willows stay up and keep yielding, so we keep chopping
        // while they stand.
        const standing = () =>
            Locs.query()
                .name(this.bot.tree())
                .action(this.bot.chop())
                .where(l => l.tile().equals(treeTile))
                .nearest() !== null;

        this.bot.setStatus(`chopping ${this.bot.tree()} at ${treeTile}`);
        if (!tree.interact(this.bot.chop())) {
            this.bot.log(`no '${this.bot.chop()}' op on ${this.bot.tree()}? ops=[${tree.actions().join(', ')}]`);
            await Execution.delayTicks(2);
            return;
        }

        this.bot.consumeChopProgress();

        // wait until we get a log, the tree falls, or we time out
        const started = await Execution.delayUntil(() => this.bot.consumeChopProgress() || !standing() || ChatDialog.canContinue(), 12000);
        if (!started || !standing() || ChatDialog.canContinue()) {
            return; // fell after one log (normal tree), or never started
        }

        // keep chopping while the tree stands and yields (oaks/willows); a normal
        // tree falling flips standing() false and returns us immediately
        for (let guard = 0; guard < 60; guard++) {
            const progressed = await Execution.delayUntil(() => this.bot.consumeChopProgress() || !standing() || ChatDialog.canContinue() || Inventory.isFull(), 8000);
            if (!progressed || !standing() || ChatDialog.canContinue() || Inventory.isFull()) {
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
        // don't wrestle the banking trip: only re-anchor when we've drifted off with an empty-ish pack
        return here !== null && this.bot.getAnchor().distanceTo(here) > this.bot.leashRadius() && !Inventory.isFull();
    }

    async execute(): Promise<void> {
        this.bot.setStatus('returning to anchor');
        await Traversal.walkTo(this.bot.getAnchor(), { radius: 3, timeoutMs: 90000 });
    }
}
