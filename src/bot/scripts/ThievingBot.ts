import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Skills } from '../api/hud/Skills.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Traversal } from '../api/Traversal.js';
import type { SettingsSchema } from '../runtime/Settings.js';

/** Tunable parameters (panel + `?ThievingBot.<key>=...`). */
export const SETTINGS: SettingsSchema = {
    target: { type: 'string', default: 'Man', label: 'NPC to thieve (name)', help: 'in-game name, e.g. Man / Woman / Farmer / Master Farmer' },
    action: { type: 'string', default: 'Pickpocket', label: 'Action', help: 'right-click op, e.g. Pickpocket / Steal-from' },
    food: { type: 'string', default: '', label: 'Food to eat (name contains)', help: 'eat this when HP drops from failed steals; blank = no eating (short runs only)' },
    eatAtHp: { type: 'number', default: 50, min: 0, max: 100, label: 'Eat below HP%' },
    dropMatch: { type: 'string', default: '', label: 'Drop when full (name contains)', help: 'drop these when the pack fills; blank = just idle when full (coins stack, so rarely fills)' },
    leashRadius: { type: 'number', default: 6, min: 2, max: 20, label: 'Leash radius (tiles)' }
};

function hpFraction(): number {
    const base = Skills.level('hitpoints');
    return base > 0 ? Skills.effective('hitpoints') / base : 1;
}

/**
 * Pickpockets an NPC in a loop: find the target by name + steal-op within a
 * leash of the start tile, steal, and (if given food) eat when a failed steal
 * knocks HP below the gate. Structurally the NPC-op cousin of GatheringBot —
 * stealing is an NPC action, not a loc action — with a combat-style HP gate
 * bolted on. Coins stack into one slot so the pack rarely fills; set dropMatch
 * to shed bulky loot for sustained runs. Start it standing by the targets.
 */
export default class ThievingBot extends TaskBot {
    override loopDelay = 600;

    private anchor: Tile | null = null;
    private target = 'Man';
    private action = 'Pickpocket';
    private food = '';
    private eatAtHp = 0.5;
    private dropMatch = '';
    private leash = 6;

    private steals = 0;
    private eats = 0;
    private status = 'starting';

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.target = this.settings.str('target', 'Man');
        this.action = this.settings.str('action', 'Pickpocket');
        this.food = this.settings.str('food', '').toLowerCase();
        this.eatAtHp = this.settings.num('eatAtHp', 50) / 100;
        this.dropMatch = this.settings.str('dropMatch', '').toLowerCase();
        this.leash = this.settings.num('leashRadius', 6);

        const here = Game.tile()!;
        this.anchor = new Tile(here.x, here.z, here.level);
        this.log(`thieving '${this.target}' (${this.action}) within ${this.leash} of ${this.anchor}${this.food ? `, eating *${this.food}* below ${Math.round(this.eatAtHp * 100)}% hp` : ''}`);

        // count successful steals for the overlay (chat confirms the pick)
        this.on('chat.message', e => {
            if (/you (pick|steal|manage to steal)/i.test(e.text)) {
                this.steals++;
            }
        });

        this.add(new ContinueDialog(), new EatFood(this), new DropJunk(this), new Steal(this), new ReturnToAnchor(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [`ThievingBot — ${this.status}`, `${this.target}: ${this.steals} steals  ate ${this.eats}`, `hp ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}  tick ${Game.tick()}`];
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
    targetName(): string {
        return this.target;
    }
    actionName(): string {
        return this.action;
    }
    foodKeyword(): string {
        return this.food;
    }
    eatGate(): number {
        return this.eatAtHp;
    }
    dropKeyword(): string {
        return this.dropMatch;
    }
    countEat(): void {
        this.eats++;
    }
}

class ContinueDialog implements Task {
    validate(): boolean {
        return ChatDialog.canContinue();
    }
    async execute(): Promise<void> {
        await ChatDialog.continue();
    }
}

/** HP dropped from a failed steal: eat, if we're carrying food. */
class EatFood implements Task {
    constructor(private bot: ThievingBot) {}
    private food() {
        const kw = this.bot.foodKeyword();
        return kw ? Inventory.items().find(i => i.name?.toLowerCase().includes(kw)) ?? null : null;
    }
    validate(): boolean {
        return hpFraction() < this.bot.eatGate() && this.food() !== null;
    }
    async execute(): Promise<void> {
        const food = this.food();
        if (!food) {
            return;
        }
        this.bot.setStatus('eating');
        const before = Skills.effective('hitpoints');
        await food.interact('Eat');
        await Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
        this.bot.countEat();
    }
}

/** Shed bulky loot when the pack fills (coins stack, so this is rare). */
class DropJunk implements Task {
    constructor(private bot: ThievingBot) {}
    private junk() {
        const kw = this.bot.dropKeyword();
        return kw ? Inventory.items().filter(i => i.name?.toLowerCase().includes(kw)) : [];
    }
    validate(): boolean {
        return Inventory.isFull() && this.junk().length > 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('dropping junk');
        for (let guard = 0; guard < 28; guard++) {
            const item = this.junk()[0];
            if (!item) {
                break;
            }
            const before = Inventory.used();
            await item.interact('Drop');
            await Execution.delayUntil(() => Inventory.used() < before, 3000);
        }
    }
}

/** Steal from the nearest target, then wait out the attempt (success or stun). */
class Steal implements Task {
    constructor(private bot: ThievingBot) {}

    private find() {
        const anchor = this.bot.getAnchor();
        const within = this.bot.leashRadius();
        return Npcs.query()
            .name(this.bot.targetName())
            .action(this.bot.actionName())
            .where(n => n.tile().distanceTo(anchor) <= within)
            .nearest();
    }

    validate(): boolean {
        // a stuffed pack with no droppable junk = idle (handled by DropJunk otherwise)
        return !Inventory.isFull() && this.find() !== null;
    }

    async execute(): Promise<void> {
        const npc = this.find();
        if (!npc) {
            return;
        }
        this.bot.setStatus(`${this.bot.actionName()} ${this.bot.targetName()} at ${npc.tile()}`);
        if (!(await npc.interact(this.bot.actionName()))) {
            await Execution.delayTicks(2);
            return;
        }
        // one steal resolves in a couple ticks; a failure stuns us for a few more
        // (the engine ignores inputs while stunned, so the next loop simply
        // retries). Wait out the attempt, yielding to EatFood between loops.
        await Execution.delayUntil(() => ChatDialog.canContinue() || hpFraction() < this.bot.eatGate(), 3000);
    }
}

class ReturnToAnchor implements Task {
    constructor(private bot: ThievingBot) {}
    validate(): boolean {
        const here = Game.tile();
        return here !== null && this.bot.getAnchor().distanceTo(here) > this.bot.leashRadius() + 4;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('returning to anchor');
        await Traversal.walkTo(this.bot.getAnchor(), { radius: 2, timeoutMs: 60000 });
    }
}
