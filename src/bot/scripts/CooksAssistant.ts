import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Locs } from '../api/queries/Locs.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Traversal } from '../api/Traversal.js';

// Cook's Assistant — the iconic first F2P quest, entirely around Lumbridge. A
// believable "quester" newbie: talk to the Cook to start, then run the ingredient
// circuit — egg from the chicken pen, an empty bucket from the farmhouse milked on
// a cow, grain from the wheat field. Quest facts verified against rs2b2t-content
// (scripts/quests/quest_cook). Progress is inferred from inventory + dialog, never
// the `cookquest` varp (server-only, like the tutorial varp — ADR-0007).
//
// LIMITATION: the flour ingredient needs the Lumbridge windmill's level-2 hopper,
// and the web-walker has no transport edges for the mill ladders (only the castle
// stairs — see nav/data/transports.json), so the mill leg isn't automatable yet.
// The bot gathers what it can and loiters around Lumbridge re-asking the Cook —
// exactly the 2004 newbie who got stuck on the mill. Completing the quest is a
// follow-up: add the two windmill ladders to transports.json + a MakeFlour stage.

const COOK = new Tile(3209, 3215, 0); // Lumbridge castle kitchen
const EGG_PEN = new Tile(3227, 3300, 0); // egg ground spawn in the chicken pen
const FARMHOUSE = new Tile(3225, 3294, 0); // empty-bucket ground spawn
const COW_FIELD = new Tile(3255, 3288, 0); // cows east of the River Lum
const WHEAT_FIELD = new Tile(3158, 3300, 0); // wheat SW of the mill

const EGG = 'Egg';
const BUCKET = 'Bucket'; // empty
const MILK = 'Bucket of milk';
const GRAIN = 'Grain';

const walk = (t: Tile, log: (m: string) => void): Promise<boolean> => Traversal.walkTo(t, { radius: 3, timeoutMs: 90000, log: m => log(`  ${m}`) });

/**
 * The quest orchestrator. Ordered tasks, first valid per loop: dismiss random
 * events, advance any open dialogue, start the quest, then gather each missing
 * ingredient (walking to its spot when none is in reach), and finally loiter.
 */
export default class CooksAssistant extends TaskBot {
    override loopDelay = 600;

    private started = false;
    private cookTalks = 0;
    private status = 'starting';

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.log('off to see the Cook about that cake…');
        this.add(new AdvanceDialog(this), new StartQuest(this), new GetEgg(this), new GetBucket(this), new MilkCow(this), new PickGrain(this), new Loiter(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const have = [Inventory.contains(EGG) ? 'egg' : '', Inventory.contains(MILK) ? 'milk' : '', Inventory.contains(GRAIN) ? 'grain' : ''].filter(Boolean).join(' ') || 'nothing yet';
        const lines = [`Cook's Assistant — ${this.status}`, `started: ${this.started}   have: ${have}`, `tick ${Game.tick()}`];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#ffd27b';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void {
        this.status = s;
    }
    isStarted(): boolean {
        return this.started;
    }
    markStarted(): void {
        this.started = true;
    }
    noteCookTalk(): void {
        // Safety: an account that already started the quest gets no "I'll help"
        // option, only a reminder — so after a couple of Cook conversations,
        // assume the quest is running and move on to gathering.
        if (++this.cookTalks >= 2) {
            this.started = true;
        }
    }
    log2(m: string): void {
        this.log(m);
    }
}

/** Click through any open dialogue; pick the quest-progressing option. */
class AdvanceDialog implements Task {
    constructor(private bot: CooksAssistant) {}
    validate(): boolean {
        return ChatDialog.canContinue() || ChatDialog.options().length > 0;
    }
    async execute(): Promise<void> {
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            // "What's wrong?" then "Yes, I'll help you." are both first-in-menu
            // in the start dialogue; prefer them by keyword, else take the first.
            // chooseOption(match) matches by substring; undefined picks the first.
            const accept = opts.find(o => /i'?ll help|yes.*help|help you/i.test(o));
            const choice = accept ?? opts.find(o => /what'?s wrong|quest|help|yes/i.test(o));
            if (accept) {
                this.bot.markStarted();
            }
            await ChatDialog.chooseOption(choice);
            return;
        }
        await ChatDialog.continue();
    }
}

/** Until the quest is started, go to the Cook and talk to him. */
class StartQuest implements Task {
    constructor(private bot: CooksAssistant) {}
    validate(): boolean {
        return !this.bot.isStarted();
    }
    async execute(): Promise<void> {
        const cook = Npcs.query().name('Cook').action('Talk-to').nearest();
        if (cook && cook.distance() <= 4) {
            this.bot.setStatus('asking the Cook about the quest');
            if (await cook.interact('Talk-to')) {
                this.bot.noteCookTalk();
                await Execution.delayUntil(() => ChatDialog.canContinue() || ChatDialog.options().length > 0, 5000);
            }
            return;
        }
        this.bot.setStatus('heading to the Cook');
        await walk(COOK, m => this.bot.log2(m));
    }
}

/** Grab an egg from the chicken-pen ground spawn. */
class GetEgg implements Task {
    constructor(private bot: CooksAssistant) {}
    validate(): boolean {
        return this.bot.isStarted() && !Inventory.contains(EGG);
    }
    async execute(): Promise<void> {
        const egg = GroundItems.query().name(EGG).within(12).nearest();
        if (egg) {
            this.bot.setStatus('grabbing an egg');
            if (await egg.interact('Take')) {
                await Execution.delayUntil(() => Inventory.contains(EGG), 5000);
            }
            return;
        }
        this.bot.setStatus('off to the chicken pen for an egg');
        await walk(EGG_PEN, m => this.bot.log2(m));
    }
}

/** Grab the empty bucket from the farmhouse ground spawn (for the milk). */
class GetBucket implements Task {
    constructor(private bot: CooksAssistant) {}
    validate(): boolean {
        return this.bot.isStarted() && !Inventory.contains(BUCKET) && !Inventory.contains(MILK);
    }
    async execute(): Promise<void> {
        const bucket = GroundItems.query().name(BUCKET).within(12).nearest();
        if (bucket) {
            this.bot.setStatus('grabbing a bucket');
            if (await bucket.interact('Take')) {
                await Execution.delayUntil(() => Inventory.contains(BUCKET), 5000);
            }
            return;
        }
        this.bot.setStatus('off to the farmhouse for a bucket');
        await walk(FARMHOUSE, m => this.bot.log2(m));
    }
}

/** Use the empty bucket on a cow to fill it with milk. */
class MilkCow implements Task {
    constructor(private bot: CooksAssistant) {}
    validate(): boolean {
        return this.bot.isStarted() && Inventory.contains(BUCKET) && !Inventory.contains(MILK);
    }
    async execute(): Promise<void> {
        const cow = Npcs.query().name('Cow').within(10).nearest();
        const bucket = Inventory.first(BUCKET);
        if (cow && bucket && cow.distance() <= 4) {
            this.bot.setStatus('milking a cow');
            if (await bucket.useOn(cow)) {
                await Execution.delayUntil(() => Inventory.contains(MILK), 5000);
            }
            return;
        }
        this.bot.setStatus('off to the field to milk a cow');
        await walk(COW_FIELD, m => this.bot.log2(m));
    }
}

/** Pick grain from the wheat field (the newbie's stab at the flour ingredient). */
class PickGrain implements Task {
    constructor(private bot: CooksAssistant) {}
    validate(): boolean {
        return this.bot.isStarted() && !Inventory.contains(GRAIN);
    }
    async execute(): Promise<void> {
        const wheat = Locs.query().name('Wheat').action('Pick').within(8).nearest();
        if (wheat) {
            this.bot.setStatus('picking grain');
            if (await wheat.interact('Pick')) {
                await Execution.delayUntil(() => Inventory.contains(GRAIN), 5000);
            }
            return;
        }
        this.bot.setStatus('off to the wheat field');
        await walk(WHEAT_FIELD, m => this.bot.log2(m));
    }
}

/**
 * Gathered what's reachable but can't mill flour — mill about Lumbridge like a
 * stuck newbie, drifting back to the Cook now and then for the reminder.
 */
class Loiter implements Task {
    constructor(private bot: CooksAssistant) {}
    validate(): boolean {
        return true;
    }
    async execute(): Promise<void> {
        if (Math.random() < 0.3) {
            this.bot.setStatus('back to the Cook, still stuck on the flour');
            await walk(COOK, m => this.bot.log2(m));
            const cook = Npcs.query().name('Cook').action('Talk-to').nearest();
            if (cook && cook.distance() <= 4) {
                await cook.interact('Talk-to');
                await Execution.delayUntil(() => ChatDialog.canContinue() || ChatDialog.options().length > 0, 4000);
            }
            return;
        }
        this.bot.setStatus('milling about Lumbridge');
        const dx = Math.floor(Math.random() * 11) - 5;
        const dz = Math.floor(Math.random() * 11) - 5;
        await Traversal.walkTo(new Tile(COOK.x + dx, COOK.z + dz, 0), { radius: 2, timeoutMs: 20000 });
        await Execution.delayTicks(3 + Math.floor(Math.random() * 6));
    }
}
