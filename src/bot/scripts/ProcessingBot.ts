import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory, InvItem } from '../api/hud/Inventory.js';
import { Locs } from '../api/queries/Locs.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Traversal } from '../api/Traversal.js';
import { Loc, Npc } from '../api/entities/index.js';
import type { SettingsSchema } from '../runtime/Settings.js';

/** Shared parameter schema for any processing preset (cook/fletch/smith/…). */
export const PROCESSING_SETTINGS: SettingsSchema = {
    material: { type: 'string', default: 'Raw shrimps', label: 'Material', help: 'inventory item to use up — substring match (e.g. Raw shrimps / Logs / Grimy)' },
    targetType: { type: 'string', default: 'loc', label: "Use on ('loc'/'item'/'npc'/'self')", help: 'loc = fire/range/anvil/altar; item = a carried item (Knife); self = an op on the material itself (Clean)' },
    target: { type: 'string', default: 'Range', label: 'Use-on target / op', help: "Range / Fire / Anvil / Altar / Knife — or, for 'self', the op name like Clean" },
    product: { type: 'string', default: '', label: 'Make-X product (optional)', help: 'if a "What would you like to make?" menu appears, pick the option containing this' },
    leashRadius: { type: 'number', default: 8, min: 2, max: 30, label: 'Leash radius (tiles, loc target)' }
};

/**
 * One bot for all "use material on a thing repeatedly" skills: cooking (raw
 * food → range/fire), fletching (knife → logs), smithing (bar → anvil),
 * runecrafting (essence → altar), herblore (ingredient → vial). Each cycle:
 * find the material + the use-on target, use one on the other, answer the
 * make-X menu if one opens, wait for the action to take, and repeat until the
 * material runs out. Fully settings-driven, like GatheringBot.
 */
export default class ProcessingBot extends TaskBot {
    override loopDelay = 600;

    private anchor: Tile | null = null;
    private made = 0;
    private status = 'starting';

    private material = 'Raw shrimps';
    private targetType = 'loc';
    private target = 'Range';
    private product = '';
    private leash = 8;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.material = this.settings.str('material', 'Raw shrimps');
        this.targetType = this.settings.str('targetType', 'loc').toLowerCase();
        this.target = this.settings.str('target', 'Range');
        this.product = this.settings.str('product', '').toLowerCase();
        this.leash = this.settings.num('leashRadius', 8);

        const here = Game.tile()!;
        this.anchor = new Tile(here.x, here.z, here.level);
        this.log(`processing '${this.material}' on ${this.targetType} '${this.target}'${this.product ? ` → make *${this.product}*` : ''}, anchored at ${this.anchor}`);

        this.add(new MakeDialog(this), new Process(this), new ReturnToAnchor(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [`Processing — ${this.status}`, `${this.material}: ${this.made} used`, `left ${this.materialCount()}  tick ${Game.tick()}`];
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
    recordMade(n: number): void {
        this.made += n;
    }
    getAnchor(): Tile {
        return this.anchor!;
    }
    leashRadius(): number {
        return this.leash;
    }
    productMatch(): string {
        return this.product;
    }

    materialItem(): InvItem | null {
        const wanted = this.material.toLowerCase();
        return Inventory.items().find(i => i.name?.toLowerCase().includes(wanted)) ?? null;
    }
    materialCount(): number {
        const wanted = this.material.toLowerCase();
        return Inventory.items().filter(i => i.name?.toLowerCase().includes(wanted)).reduce((n, i) => n + Math.max(1, i.count), 0);
    }

    targetName(): string {
        return this.target;
    }
    isSelfOp(): boolean {
        return this.targetType === 'self';
    }
    /** For 'self' targetType, the op to run on the material itself (e.g. Clean). */
    selfOp(): string {
        return this.target;
    }

    /** Resolve the use-on target: a carried item, a nearby loc, or a nearby npc. */
    findTarget(): InvItem | Loc | Npc | null {
        const name = this.target.toLowerCase();
        if (this.targetType === 'item') {
            return Inventory.items().find(i => i.name?.toLowerCase().includes(name)) ?? null;
        }
        const anchor = this.anchor!;
        const within = this.leash;
        if (this.targetType === 'npc') {
            return Npcs.query().name(this.target).where(n => n.tile().distanceTo(anchor) <= within).nearest();
        }
        return Locs.query().name(this.target).where(l => l.tile().distanceTo(anchor) <= within).nearest();
    }
}

/**
 * Stay on a running action while it keeps eating the material — a make-10
 * fletch batch, a continuous craft, a one-shot cook. Returns once the material
 * stops dropping (animation ended, batch done) so the caller can act again
 * without cancelling an in-progress batch by re-interacting too early.
 */
async function rideAction(bot: ProcessingBot): Promise<void> {
    for (let guard = 0; guard < 200; guard++) {
        if (bot.materialItem() === null || ChatDialog.isMakeMenu() || ChatDialog.canContinue()) {
            return;
        }
        const mark = bot.materialCount();
        // wait for the next unit to be consumed; ~4s covers slow per-item
        // actions (fletching/smithing). No consumption in that window = done.
        const progressed = await Execution.delayUntil(() => bot.materialCount() < mark || ChatDialog.isMakeMenu() || ChatDialog.canContinue(), 4000);
        const now = bot.materialCount();
        if (now < mark) {
            bot.recordMade(mark - now);
        } else if (!progressed || !Game.animating()) {
            return;
        }
    }
}

class MakeDialog implements Task {
    constructor(private bot: ProcessingBot) {}

    validate(): boolean {
        return ChatDialog.isMakeMenu();
    }

    async execute(): Promise<void> {
        this.bot.setStatus('choosing product');
        const want = this.bot.productMatch();
        const start = this.bot.materialCount();
        if (!(await ChatDialog.make(want || undefined))) {
            this.bot.log(`make menu open but couldn't pick *${want}* — products: [${ChatDialog.makeProducts().join(', ')}]`);
            await Execution.delayTicks(1);
            return;
        }
        // ride the batch here — if we returned now, Process would re-open the
        // menu next loop and cancel it before anything is produced
        await Execution.delayUntil(() => Game.animating() || this.bot.materialCount() < start || ChatDialog.isMakeMenu(), 3000);
        await rideAction(this.bot);
    }
}

class Process implements Task {
    constructor(private bot: ProcessingBot) {}

    validate(): boolean {
        return this.bot.materialItem() !== null && (this.bot.isSelfOp() || this.bot.findTarget() !== null) && !ChatDialog.isOpen();
    }

    async execute(): Promise<void> {
        const material = this.bot.materialItem();
        if (!material) {
            return;
        }

        const before = this.bot.materialCount();
        if (this.bot.isSelfOp()) {
            this.bot.setStatus(`${this.bot.selfOp()} ${material.name}`);
            if (!(await material.interact(this.bot.selfOp()))) {
                this.bot.log(`no '${this.bot.selfOp()}' op on ${material.name} — ops=[${material.actions().join(', ')}]`);
                await Execution.delayTicks(2);
                return;
            }
        } else {
            const target = this.bot.findTarget();
            if (!target) {
                return;
            }
            this.bot.setStatus(`using ${material.name} on ${this.bot.targetName()}`);
            if (!(await material.useOn(target))) {
                this.bot.log(`couldn't use ${material.name} on ${this.bot.targetName()}`);
                await Execution.delayTicks(2);
                return;
            }
        }

        // wait for: a make menu to open, the action to start (anim), the
        // material to be consumed, or a blocking dialog
        await Execution.delayUntil(() => ChatDialog.isMakeMenu() || Game.animating() || this.bot.materialCount() < before || ChatDialog.canContinue(), 8000);
        if (ChatDialog.isMakeMenu()) {
            return; // MakeDialog selects the product and rides the batch
        }

        // no menu (cook/craft on a loc): ride the action ourselves
        await rideAction(this.bot);
    }
}

class ReturnToAnchor implements Task {
    constructor(private bot: ProcessingBot) {}
    validate(): boolean {
        const here = Game.tile();
        return here !== null && this.bot.getAnchor().distanceTo(here) > this.bot.leashRadius() + 4;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('returning to anchor');
        await Traversal.walkTo(this.bot.getAnchor(), { radius: 3, timeoutMs: 90000 });
    }
}
