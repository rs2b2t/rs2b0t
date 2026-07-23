import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { EventSignal } from '../api/EventSignal.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { depositMatcher } from '../api/Banking.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Equipment } from '../api/hud/Equipment.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Quests } from '../api/hud/Quests.js';
import { Skills } from '../api/hud/Skills.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Locs } from '../api/queries/Locs.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Traversal } from '../api/Traversal.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { SettingsStore } from '../runtime/Settings.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { BEST_AVAILABLE, ESS_ITEM, PICK_OPTIONS, inEssMine, requiredMiningLevel, resolvePick, withdrawOneOp } from './EssMinerLogic.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

const BANK_STAND = new Tile(3251, 3420, 0);
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const AUBURY_TILE = new Tile(3253, 3402, 0);
const AUBURY = 'Aubury';
const TELEPORT_OP = 'Teleport';
const ESS_LOC = 'Rune Essence';
const MINE_OP = 'Mine';
const PORTAL_LOC = 'Portal';
const PORTAL_OP = 'Use';
const AUBURY_LEASH = 8;
const STALL_MS = 20_000;
const MAX_TELEPORT_FAILS = 3;
const MAX_BANK_FAILS = 6;
const RUNE_MYSTERIES = 'Rune Mysteries Quest';

export const SETTINGS: SettingsSchema = {
    pickaxe: { type: 'string', default: BEST_AVAILABLE, options: PICK_OPTIONS, label: 'Pickaxe', help: 'Best available walks Rune→Bronze against your Mining level (worn → inventory → bank withdraw); a specific tier stops if you can\'t use or don\'t own it' }
};

let PICK_CHOICE: string = BEST_AVAILABLE;

function essCount(): number {
    return Inventory.count(ESS_ITEM);
}
function heldNames(): string[] {
    return [...Equipment.items(), ...Inventory.items()].map(i => i.name ?? '').filter(n => n.length > 0);
}
function inMine(): boolean {
    const t = Game.tile();
    return t !== null && inEssMine(t.x, t.z);
}
function essDeposit(): (name: string) => boolean {
    return depositMatcher(name => name.toLowerCase() === ESS_ITEM.toLowerCase(), true);
}

export default class EssMiner extends TaskBot {
    override loopDelay = 600;

    private trips = 0;
    private banked = 0;
    private mined = 0;
    private bankFails = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    questRefused = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        PICK_CHOICE = this.settings.str('pickaxe', BEST_AVAILABLE);
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('mining');

        if (Quests.status(RUNE_MYSTERIES) !== 'complete') {
            this.log('EssMiner needs Rune Mysteries completed for Aubury\'s teleport — complete it with the AIOQuester bot first.');
            throw new Error('EssMiner: Rune Mysteries required');
        }
        const gate = requiredMiningLevel(PICK_CHOICE);
        if (gate !== null && Skills.level('mining') < gate) {
            this.log(`EssMiner: Mining ${gate} required for the ${PICK_CHOICE} pickaxe (have ${Skills.level('mining')}) — stopping.`);
            throw new Error('EssMiner: unusable pickaxe selection');
        }

        this.on('chat.message', e => {
            if (/need to have completed the rune mysteries/i.test(e.text)) {
                this.questRefused = true;
            }
        });

        this.log(`EssMiner starting — pickaxe '${PICK_CHOICE}', bank ${BANK_STAND}, Aubury ${AUBURY_TILE}`);

        this.add(
            new ContinueDialog(),
            new MineEss(this),
            new UsePortal(this),
            new BankEss(this),
            new GetPick(this),
            new TeleportIn(this)
        );
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#8be9fd' });
        p.title(`EssMiner — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('mining') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Mining lvl: ${Skills.level('mining')}`, `XP/hr: ${xph}`);
        p.row(`Trips: ${this.trips}`, `Banked: ${this.banked}`, `Pack: ${essCount()}`);
        p.text(`Essence mined this run: ${this.mined}`, '#8a919a');

        p.gap();
        const picked = p.select('pick', 'pickaxe', PICK_OPTIONS, PICK_CHOICE);
        if (picked && picked !== PICK_CHOICE) {
            this.switchPickaxe(picked);
        }
        ScriptRunner.paintControls(p);
        p.end();
    }

    private switchPickaxe(pick: string): void {
        const gate = requiredMiningLevel(pick);
        if (gate !== null && Skills.level('mining') < gate) {
            this.log(`can't switch to the ${pick} pickaxe: needs Mining ${gate} (have ${Skills.level('mining')})`);
            return;
        }
        PICK_CHOICE = pick;
        SettingsStore.save('EssMiner', 'pickaxe', pick);
        this.log(`pickaxe switched to ${pick} (from the paint)`);
    }

    setStatus(s: string): void { this.status = s; }
    countMined(delta: number): void { this.mined += delta; }
    countTrip(deposited: number): void { this.trips++; this.banked += deposited; }
    tripsTotal(): number { return this.trips; }
    countBankFail(): number { return ++this.bankFails; }
    resetBankFail(): void { this.bankFails = 0; }

    async walkTo(dest: Tile, radius = 2): Promise<void> {
        const here = Game.tile();
        if (here && dest.distanceTo(here) <= radius) { return; }
        await Traversal.walkResilient(dest, { radius, attempts: 6, timeoutMs: 240_000, log: m => this.log(`  ${m}`) });
    }
}

class MineEss implements Task {
    constructor(private bot: EssMiner) {}
    validate(): boolean { return inMine() && !Inventory.isFull(); }
    async execute(): Promise<void> {
        const rock = Locs.query().name(ESS_LOC).action(MINE_OP).nearest();
        if (!rock) { await Execution.delayTicks(2); return; }
        this.bot.setStatus('mining rune essence');
        if (!(await rock.interact(MINE_OP))) { await Execution.delayTicks(2); return; }
        this.bot.log('mining rune essence');
        let count = essCount();
        let lastGain = performance.now();
        while (!Inventory.isFull()) {
            if (EventSignal.pending() || ChatDialog.canContinue() || !inMine()) { return; }
            const now = essCount();
            if (now > count) {
                this.bot.countMined(now - count);
                count = now;
                lastGain = performance.now();
            }
            if (performance.now() - lastGain > STALL_MS) { return; }
            await Execution.delayTicks(2);
        }
        this.bot.log(`pack full (${essCount()} rune essence)`);
    }
}

class UsePortal implements Task {
    constructor(private bot: EssMiner) {}
    validate(): boolean { return inMine() && Inventory.isFull(); }
    async execute(): Promise<void> {
        const portal = Locs.query().name(PORTAL_LOC).action(PORTAL_OP).nearest();
        if (!portal) { await Execution.delayTicks(2); return; }
        this.bot.setStatus('taking the portal back');
        this.bot.log('taking the portal back');
        if (!(await portal.interact(PORTAL_OP))) { await Execution.delayTicks(2); return; }
        await Execution.delayUntil(() => !inMine(), 15_000);
    }
}

class BankEss implements Task {
    constructor(private bot: EssMiner) {}
    validate(): boolean { return !inMine() && essCount() > 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('banking the essence');
        await this.bot.walkTo(BANK_STAND);
        if (!(await Bank.openBooth(BANK_STAND, BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            if (this.bot.countBankFail() >= MAX_BANK_FAILS) {
                this.bot.log('EssMiner: couldn\'t reach the Varrock East bank — start with a pickaxe equipped or in your inventory, or start nearer Varrock. Stopping.');
                this.bot.setStatus('cannot reach the bank — stopped');
                ScriptRunner.stop();
                return;
            }
            this.bot.log('could not open the bank — will retry');
            return;
        }
        this.bot.resetBankFail();
        const n = essCount();
        await Bank.depositAllMatching(essDeposit());
        await Execution.delayTicks(1);
        this.bot.countTrip(n);
        this.bot.log(`banked ${n} rune essence (trip ${this.bot.tripsTotal()})`);
    }
}

class GetPick implements Task {
    constructor(private bot: EssMiner) {}
    validate(): boolean {
        return !inMine() && resolvePick(PICK_CHOICE, Skills.level('mining'), heldNames(), []).kind !== 'held';
    }
    async execute(): Promise<void> {
        this.bot.setStatus('getting a pickaxe from the bank');
        await this.bot.walkTo(BANK_STAND);
        if (!(await Bank.openBooth(BANK_STAND, BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            if (this.bot.countBankFail() >= MAX_BANK_FAILS) {
                this.bot.log('EssMiner: couldn\'t reach the Varrock East bank — start with a pickaxe equipped or in your inventory, or start nearer Varrock. Stopping.');
                this.bot.setStatus('cannot reach the bank — stopped');
                ScriptRunner.stop();
                return;
            }
            this.bot.log('could not open the bank — will retry');
            return;
        }
        this.bot.resetBankFail();
        if (Inventory.isFull()) {
            await Bank.depositAllMatching(essDeposit());
            await Execution.delayTicks(1);
        }
        const bankNames = Bank.items().map(i => i.name ?? '').filter(n => n.length > 0);
        const res = resolvePick(PICK_CHOICE, Skills.level('mining'), heldNames(), bankNames);
        if (res.kind === 'stop') {
            this.bot.log(`EssMiner: ${res.reason}. Stopping.`);
            this.bot.setStatus('no usable pickaxe — stopped');
            ScriptRunner.stop();
            return;
        }
        if (res.kind === 'withdraw') {
            const item = Bank.items().find(i => i.name?.toLowerCase() === res.item.toLowerCase());
            const withdrawOp = item ? withdrawOneOp(item.ops) : null;
            if (!withdrawOp) {
                this.bot.log(`no withdraw op on ${res.item} — will retry`);
                return;
            }
            const before = Inventory.used();
            if (!(await Bank.withdraw(res.item, withdrawOp))) {
                this.bot.log(`could not withdraw ${res.item} — will retry`);
                return;
            }
            await Execution.delayUntil(() => Inventory.used() > before, 3000);
            this.bot.log(`withdrew ${res.item}`);
        }
    }
}

class TeleportIn implements Task {
    private fails = 0;
    constructor(private bot: EssMiner) {}
    private find() {
        return Npcs.query().name(AUBURY).action(TELEPORT_OP).where(n => n.distance() <= AUBURY_LEASH).nearest();
    }
    validate(): boolean {
        return !inMine() && essCount() === 0 && !Inventory.isFull()
            && resolvePick(PICK_CHOICE, Skills.level('mining'), heldNames(), []).kind === 'held';
    }
    async execute(): Promise<void> {
        let aubury = this.find();
        if (!aubury) {
            this.bot.setStatus('heading to Aubury');
            await this.bot.walkTo(AUBURY_TILE);
            aubury = this.find();
        }
        if (!aubury) { await Execution.delayTicks(3); return; }
        this.bot.setStatus('teleporting to the essence mine');
        this.bot.log('teleporting to the essence mine');
        if (!(await aubury.interact(TELEPORT_OP))) { await Execution.delayTicks(2); return; }
        const arrived = await Execution.delayUntil(() => inMine(), 15_000);
        if (arrived) {
            this.fails = 0;
            return;
        }
        this.fails++;
        if (this.bot.questRefused || this.fails >= MAX_TELEPORT_FAILS) {
            this.bot.log(this.bot.questRefused
                ? 'Aubury refused the teleport — Rune Mysteries is not complete on the server. Stopping.'
                : `teleport did not land after ${this.fails} attempts. Stopping.`);
            this.bot.setStatus('teleport failed — stopped');
            ScriptRunner.stop();
            return;
        }
        this.bot.log('teleport did not land — retrying');
    }
}
