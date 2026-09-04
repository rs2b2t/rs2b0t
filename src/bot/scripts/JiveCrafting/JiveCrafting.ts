import { Bank } from '../../api/bank/Bank.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Skills } from '../../api/skills/Skills.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { walkOpening } from '../../event/webwalk/walkOpening.js';
import Tile from '../../geometry/Tile.js';
import { jiveFrame } from '../../paint/jive.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { GOLD_BAR, JEWELLERY, PACK, PRODUCT_OPTIONS, craftable, decide, jewelByName, makeOp, withdrawPlan, type Jewel, type PackState, type Step } from './logic.js';

/** Al Kharid: the bank stand SmelterBot uses and the tile east of the furnace. */
const BANK_STAND = new Tile(3269, 3167, 0);
const FURNACE_STAND = new Tile(3275, 3185, 0);
const FURNACE = 'Furnace';
const FURNACE_REACH = 8;
const BOOTH = 'Bank booth';
const BOOTH_OP = 'Use-quickly';
const OBSTACLES = ['door', 'gate'];
const PANEL_WAIT_MS = 6000;
/** Ticks with no bar consumed before the batch is judged stalled; the furnace takes one every three. */
const STALL_TICKS = 12;
const CRAFT_HOLD_TICKS = 40;
const BATCH: Record<string, number> = { 'Make 10': 10, 'Make 5': 5, Make: 1 };

export const SETTINGS: SettingsSchema = {
    product: { type: 'string', default: 'Sapphire ring', options: PRODUCT_OPTIONS, label: 'Product', help: 'which gold jewel to make this session' }
};

export default class JiveCrafting extends TaskBot {
    override loopDelay = 600;

    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private made = 0;
    private trips = 0;
    private banked = 0;

    jewel: Jewel = JEWELLERY[1]!;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const pick = this.settings.str('product', 'Sapphire ring');
        const jewel = jewelByName(pick);
        if (!jewel) {
            ScriptRunner.stop(`[crafting] unknown product '${pick}'`);
            return;
        }
        this.jewel = jewel;
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('crafting');

        const level = Skills.level('crafting');
        if (level < jewel.level) {
            ScriptRunner.stop(`[crafting] ${jewel.label} needs Crafting ${jewel.level}, this account has ${level}`);
            return;
        }
        this.log(`[crafting] making ${jewel.label} from ${GOLD_BAR}${jewel.gem ? ` + ${jewel.gem}` : ''} with the ${jewel.mould}, bank ${BANK_STAND}, furnace ${FURNACE_STAND}`);
        this.add(new ContinueDialog(), new BankTrip(this), new Craft(this));
    }

    override recoveryAnchor(): Tile | null {
        return BANK_STAND;
    }

    setStatus(s: string): void {
        this.status = s;
    }

    pack(): PackState {
        return {
            mould: Inventory.contains(this.jewel.mould),
            bars: Inventory.count(GOLD_BAR),
            gems: this.jewel.gem ? Inventory.count(this.jewel.gem) : 0
        };
    }

    step(): Step {
        return decide(this.pack(), this.jewel);
    }

    noteMade(n: number): void {
        this.made += n;
    }

    noteTrip(banked: number): void {
        this.trips++;
        this.banked += banked;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const { frame: p, page, section } = jiveFrame(ctx, {
            script: 'JiveCrafting',
            status: this.status,
            pages: ['Statistics', 'Options'],
            sections: ['Overview', 'Supplies']
        });
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = Skills.xp('crafting') - this.xpAtStart;

        if (page === 'Options') {
            p.statGrid([
                [{ text: `Product: ${this.jewel.label}` }, { text: `Needs: Crafting ${this.jewel.level}` }],
                [{ text: `Bank: ${BANK_STAND.x},${BANK_STAND.z}` }, { text: `Furnace: ${FURNACE_STAND.x},${FURNACE_STAND.z}` }]
            ]);
        } else if (section === 'Overview') {
            p.statGrid([
                [{ text: `Runtime: ${fmtDuration(mins)}` }, { text: `Made: ${this.made}` }],
                [{ text: `Xp/hr: ${mins > 0.5 ? `${((xp / mins) * 60 / 1000).toFixed(1)}k` : 'n/a'}` }, { text: `Trips: ${this.trips}` }],
                [{ text: `Banked: ${this.banked}` }, { text: `Crafting: ${Skills.level('crafting')}` }]
            ]);
            p.bar('Pack', Inventory.used() / PACK);
        } else {
            const pack = this.pack();
            p.statGrid([
                [{ text: `Bars: ${pack.bars}` }, { text: `${this.jewel.gem ?? 'Gems'}: ${this.jewel.gem ? pack.gems : 'n/a'}` }],
                [{ text: `Mould: ${pack.mould ? 'held' : 'missing'}` }, { text: `Can make: ${craftable(pack, this.jewel)}` }]
            ]);
        }

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}

// Why: everything but the mould goes in, leftover bars and gems included, so the withdrawal always starts from a known pack and a stray stack never shrinks the load.
class BankTrip implements Task {
    constructor(private bot: JiveCrafting) {}

    validate(): boolean {
        return this.bot.step().kind === 'bank';
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        const jewel = bot.jewel;
        bot.setStatus('walking to the bank');
        if (!(await walkOpening(BANK_STAND, 0, OBSTACLES, m => bot.log(`  ${m}`)))) {
            bot.log('[crafting] walk to the bank failed, will retry');
            return;
        }
        if (!(await Bank.openBooth(BANK_STAND, BOOTH, BOOTH_OP, m => bot.log(`  ${m}`)))) {
            bot.log('[crafting] could not open the bank, will retry');
            return;
        }

        bot.setStatus('banking the load');
        const products = Inventory.count(jewel.item);
        const keep = jewel.mould.toLowerCase();
        await Bank.depositAllMatching(name => name.toLowerCase() !== keep);
        if (!(await Execution.delayUntil(() => Bank.isOpen() && Bank.loaded(), 5000))) {
            bot.log(Bank.isOpen() ? '[crafting] the bank list has not filled in, retrying this trip' : '[crafting] the bank window closed, retrying this trip');
            return;
        }

        const plan = withdrawPlan(jewel, Inventory.contains(jewel.mould), name => Bank.count(name));
        if (!plan.ok) {
            await Bank.close();
            bot.setStatus('stopped');
            ScriptRunner.stop(`[crafting] ${plan.reason}`);
            return;
        }
        const lines: [string, number][] = [];
        if (plan.mould) {
            lines.push([jewel.mould, 1]);
        }
        lines.push([GOLD_BAR, plan.bars]);
        if (jewel.gem && plan.gems > 0) {
            lines.push([jewel.gem, plan.gems]);
        }
        for (const [name, count] of lines) {
            if (!Bank.isOpen() || !Bank.loaded()) {
                bot.log('[crafting] the bank window closed mid-withdrawal, retrying this trip');
                return;
            }
            bot.setStatus(`withdrawing ${count} ${name}`);
            if (!(await Bank.withdrawX(name, count))) {
                bot.log(`[crafting] could not withdraw ${count} ${name}, retrying this trip`);
                return;
            }
        }
        await Bank.close();
        bot.noteTrip(products);
        bot.log(`[crafting] banked ${products} ${jewel.item}, took ${plan.mould ? `the ${jewel.mould}, ` : ''}${plan.bars} ${GOLD_BAR}${jewel.gem ? ` + ${plan.gems} ${jewel.gem}` : ''}`);
    }
}

class Craft implements Task {
    constructor(private bot: JiveCrafting) {}

    validate(): boolean {
        return this.bot.step().kind === 'craft' && !ChatDialog.canContinue();
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        const jewel = bot.jewel;
        const furnace = () => Locs.query().name(FURNACE).withinOf(FURNACE_STAND, FURNACE_REACH).nearest();
        const here = Game.tile();
        if (!here || FURNACE_STAND.distanceTo(here) > 1 || !furnace()) {
            bot.setStatus('walking to the furnace');
            if (!(await walkOpening(FURNACE_STAND, 1, OBSTACLES, m => bot.log(`  ${m}`)))) {
                bot.log('[crafting] walk to the furnace failed, will retry');
                return;
            }
        }

        if (!ChatDialog.isMainMakePanel()) {
            const oven = furnace();
            const bar = Inventory.first(GOLD_BAR);
            if (!oven || !bar) {
                await Execution.delayTicks(2);
                return;
            }
            bot.setStatus(`using a ${GOLD_BAR} on the furnace`);
            await bar.useOn(oven);
            if (!(await Execution.delayUntil(() => ChatDialog.isMainMakePanel() || ChatDialog.canContinue(), PANEL_WAIT_MS))) {
                await Execution.delayTicks(2);
                return;
            }
            if (!ChatDialog.isMainMakePanel()) {
                return;
            }
        }

        const before = Inventory.count(GOLD_BAR);
        const want = craftable(bot.pack(), jewel);
        const op = makeOp(want);
        bot.setStatus(`${op} ${jewel.label}`);
        if (!(await ChatDialog.makeFromPanel(jewel.item, op))) {
            bot.log(`[crafting] the furnace panel has no '${jewel.item}' with ${op}, it shows [${ChatDialog.mainMakeProducts().join(', ')}]`);
            await Execution.delayTicks(2);
            return;
        }

        bot.setStatus(`making ${jewel.label}`);
        const batch = Math.min(want, BATCH[op]!);
        let last = before;
        let idle = 0;
        // Why: one bounded hold per loop, so the mesbox that ends a short batch reaches ContinueDialog and a furnace that stopped taking bars is retried rather than waited on.
        await Execution.delayUntilTicks(() => {
            const now = Inventory.count(GOLD_BAR);
            if (now < last) {
                last = now;
                idle = 0;
            } else {
                idle++;
            }
            return before - now >= batch || now === 0 || ChatDialog.canContinue() || idle >= STALL_TICKS;
        }, CRAFT_HOLD_TICKS);
        bot.noteMade(Math.max(0, before - Inventory.count(GOLD_BAR)));
    }
}
