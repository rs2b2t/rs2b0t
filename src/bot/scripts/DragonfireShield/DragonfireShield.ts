import { reader } from '../../adapter/ClientAdapter.js';
import { Bank } from '../../api/bank/Bank.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems, type GroundItem } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Npcs, talkOp } from '../../api/npcs/Npcs.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Modals } from '../../api/ui/widgets/Modals.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';
import { Paint } from '../../paint/Paint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import {
    BANK_REACH,
    BANK_STAND,
    BOOTH,
    BOOTH_OP,
    DUKE,
    DUKE_STAND,
    MAX_TALK_GUARD,
    SHIELD,
    SHIELD_ID,
    STAND_REACH,
    decide,
    type PackState
} from './DragonfireShieldLogic.js';

/** How long one Duke farm trip runs before the floor is looted and banked. */
const TALK_OPEN_MS = 8000;
const RECEIVE_MS = 6000;
const WALK_MS = 180_000;

export const SETTINGS: SettingsSchema = {
    tripSecs: {
        type: 'number',
        default: 50,
        min: 20,
        max: 600,
        label: 'Farm seconds per trip',
        help: 'How long each trip keeps taking free shields from Duke Horacio before looting the floor pile and banking'
    },
    carryNotes: {
        type: 'boolean',
        default: true,
        label: 'Carry noted shields',
        help: 'Withdraws the banked noted Dragonfire shield stack to carry to the Duke each trip'
    }
};

function shieldIsNote(item: { id: number }): boolean {
    return item.id !== SHIELD_ID;
}

export default class DragonfireShield extends TaskBot {
    override loopDelay = 600;

    private status = 'starting';
    private startedAt = Date.now();
    farmed = 0;
    trips = 0;
    tripActive = false;
    tripDeadline = 0;
    noteId = -1;

    tripSecs = 50;
    carryNotes = true;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.startedAt = Date.now();
        this.tripSecs = this.settings.num('tripSecs', 50);
        this.carryNotes = this.settings.bool('carryNotes', true);
        this.noteId = this.findNoteId();
        this.log(`DragonfireShield: ${this.tripSecs}s trips, carrying notes: ${this.carryNotes}, note obj ${this.noteId === -1 ? '(none)' : `#${this.noteId}`}`);
        this.add(new ContinueDialog(), new FarmShields(this), new LootShields(this), new BankTrip(this), new GoToDuke(this));
    }

    override recoveryAnchor(): Tile | null {
        return BANK_STAND;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#ffb347' });
        p.title(`DragonfireShield — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const rem = this.tripActive ? Math.max(0, Math.round((this.tripDeadline - Date.now()) / 1000)) : 0;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Trips: ${this.trips}`);
        p.row(`Shields farmed: ${this.farmed}`, this.tripActive ? `Trip: ${rem}s left` : 'Trip: idle');
        p.row(`Held: ${Inventory.countById(SHIELD_ID)} un-noted`, `${Inventory.items().filter(i => shieldIsNote(i)).length} other slots`);

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(s: string): void {
        this.status = s;
    }

    findNoteId(): number {
        const note = reader.objCatalog().find(o => o.certlink === SHIELD_ID && o.certtemplate !== -1);
        return note ? note.id : -1;
    }

    atStand(): boolean {
        const here = Game.tile();
        return here !== null && here.level === DUKE_STAND.level && DUKE_STAND.distanceTo(here) <= STAND_REACH;
    }

    atBank(): boolean {
        const here = Game.tile();
        return here !== null && here.level === BANK_STAND.level && BANK_STAND.distanceTo(here) <= BANK_REACH;
    }

    notesHeld(): number {
        return this.noteId === -1 ? 0 : Inventory.countById(this.noteId);
    }

    junkHeld(): number {
        const used = Inventory.used();
        const unNoted = Inventory.countById(SHIELD_ID);
        return Math.max(0, used - unNoted - Math.min(used, this.notesHeld() > 0 ? 1 : 0));
    }

    groundShields(): GroundItem[] {
        return GroundItems.query()
            .withinOf(DUKE_STAND, 1)
            .where(g => g.tile().level === DUKE_STAND.level && (g.id === SHIELD_ID || g.id === this.noteId))
            .results();
    }

    canLoot(g: GroundItem): boolean {
        if (Inventory.free() > 0) {
            return true;
        }
        const held = Inventory.countById(g.id) > 0;
        const stacks = reader.objCatalog().some(o => o.id === g.id && (o.stackable || o.stackVariant));
        return held && stacks;
    }

    async closeModalsOnce(): Promise<void> {
        for (let i = 0; i < 3 && Modals.isOpen(); i++) {
            await Modals.close();
        }
    }

    async dropById(id: number): Promise<void> {
        for (let guard = 0; guard < 12; guard++) {
            const it = Inventory.items().find(i => i.id === id);
            if (!it) {
                return;
            }
            const before = Inventory.countById(id);
            if (!(await it.interact('Drop'))) {
                await Execution.delayTicks(1);
                continue;
            }
            await Execution.delayUntil(() => Inventory.countById(id) < before, 3000);
        }
    }

    /** Drop every farm item (notes and un-noted shields) so the pack is clear to keep receiving. */
    async dropFarmCargo(): Promise<void> {
        await this.dropById(SHIELD_ID);
        if (this.noteId !== -1) {
            await this.dropById(this.noteId);
        }
    }

    async openDuke(): Promise<boolean> {
        const npc = Npcs.query().name(DUKE).where(n => talkOp(n.actions()) !== null).nearest();
        if (!npc) {
            this.log('no Duke Horacio in the scene');
            return false;
        }
        await npc.interact(talkOp(npc.actions())!);
        return Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), TALK_OPEN_MS);
    }

    /** Drive one full Duke conversation, picking the "I seek a shield..." option, until the dialogue closes. */
    async dukeGivesShield(): Promise<boolean> {
        for (let i = 0; i < MAX_TALK_GUARD; i++) {
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
                await Execution.delayTicks(1);
                continue;
            }
            const opts = ChatDialog.options();
            if (opts.length > 0) {
                const pick = opts.find(o => /shield/i.test(o));
                if (!pick) {
                    this.log(`no shield option in [${opts.join(' | ')}]`);
                }
                await ChatDialog.chooseOption(pick ?? opts[0]);
                await Execution.delayTicks(2);
                continue;
            }
            if (!ChatDialog.isOpen()) {
                break;
            }
            await Execution.delayTicks(1);
        }
        await this.closeModalsOnce();
        return !ChatDialog.isOpen();
    }

    pack(): PackState {
        const unNoted = Inventory.countById(SHIELD_ID);
        const notes = this.notesHeld();
        const used = Inventory.used();
        return {
            atStand: this.atStand(),
            atBank: this.atBank(),
            full: Inventory.isFull(),
            free: Inventory.free(),
            unNoted,
            notes,
            junk: Math.max(0, used - unNoted - Math.min(used, notes > 0 ? 1 : 0)),
            ground: this.atStand() && !this.tripActive ? this.groundShields().length : 0,
            tripActive: this.tripActive,
            wantNotes: this.carryNotes
        };
    }

    step(): ReturnType<typeof decide> {
        return decide(this.pack());
    }
}

class FarmShields implements Task {
    constructor(private bot: DragonfireShield) {}

    validate(): boolean {
        const p = this.bot.pack();
        return p.atStand && !p.full && (p.tripActive || p.free >= 1);
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        if (!bot.tripActive) {
            bot.setStatus('starting a farm trip');
            await bot.dropFarmCargo();
            bot.tripActive = true;
            bot.tripDeadline = Date.now() + bot.tripSecs * 1000;
            bot.log('farm trip started');
        }

        let cycles = 0;
        while (bot.tripActive && Date.now() < bot.tripDeadline && !Inventory.isFull()) {
            if (EventSignal.pending() || !bot.atStand() || ChatDialog.isOpen()) {
                break;
            }
            if (Equipment.contains(SHIELD)) {
                await Equipment.unequip(SHIELD);
            }
            await bot.closeModalsOnce();
            if (Inventory.countById(SHIELD_ID) > 0) {
                await bot.dropById(SHIELD_ID);
            }
            const before = Inventory.countById(SHIELD_ID);
            const opened = bot.atStand() && (await bot.openDuke());
            if (!opened) {
                await Execution.delayTicks(2);
                continue;
            }
            if (!(await bot.dukeGivesShield())) {
                bot.log('duke dialogue did not finish cleanly');
            }
            const got = await Execution.delayUntil(() => Inventory.countById(SHIELD_ID) > before, RECEIVE_MS);
            if (!got) {
                await Execution.delayTicks(2);
                continue;
            }
            await bot.dropById(SHIELD_ID);
            bot.farmed++;
            cycles++;
            bot.setStatus(`farming (${bot.farmed} shields)`);
        }
        bot.tripActive = false;
        if (cycles > 0) {
            bot.log(`farm cycle ended after ${cycles} shield(s)`);
        }
    }
}

class LootShields implements Task {
    constructor(private bot: DragonfireShield) {}

    validate(): boolean {
        const p = this.bot.pack();
        return p.atStand && !p.tripActive && p.ground > 0;
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        bot.setStatus('looting the shield pile');
        let taken = 0;
        for (let guard = 0; guard < 40; guard++) {
            const pile = bot.groundShields();
            if (pile.length === 0) {
                break;
            }
            const drop = pile[0];
            if (!bot.canLoot(drop)) {
                break;
            }
            const before = Inventory.countById(drop.id);
            if (!(await drop.interact('Take'))) {
                await Execution.delayTicks(2);
                continue;
            }
            await Execution.delayUntil(() => {
                const now = Inventory.countById(drop.id);
                return now > before || !bot.groundShields().some(g => g.id === drop.id && g.snap.tile === drop.snap.tile);
            }, 4000);
            taken++;
        }
        if (taken > 0) {
            bot.log(`looted ${taken} ground shield stack(s)`);
        }
    }
}

class BankTrip implements Task {
    constructor(private bot: DragonfireShield) {}

    validate(): boolean {
        const p = this.bot.pack();
        if (p.full) {
            return true;
        }
        if (p.atStand && !p.tripActive && p.ground === 0 && (p.unNoted > 0 || p.notes > 0 || p.junk > 0)) {
            return true;
        }
        if (p.atBank && (p.unNoted > 0 || p.junk > 0 || (p.wantNotes && p.notes === 0 && p.free > 0))) {
            return true;
        }
        return false;
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        bot.setStatus('banking');
        if (Equipment.contains(SHIELD)) {
            await Equipment.unequip(SHIELD);
        }
        if (!bot.atBank()) {
            if (!(await Traversal.walkResilient(BANK_STAND, {
                radius: 2, attempts: 4, timeoutMs: WALK_MS, log: m => bot.log(`  ${m}`),
            }))) {
                bot.log('could not reach the Al Kharid bank — retry');
                return;
            }
        }

        const opened = (await Bank.openBooth(
            { x: BANK_STAND.x, z: BANK_STAND.z, level: BANK_STAND.level },
            BOOTH,
            BOOTH_OP,
            m => bot.log(`  ${m}`),
        )) || (await Bank.openNearest(BOOTH, BOOTH_OP, m => bot.log(`  ${m}`)));
        if (!opened) {
            bot.log('could not open the bank — retry');
            return;
        }

        await Bank.depositAllMatching(() => true, m => bot.log(`  ${m}`));
        if (bot.carryNotes && bot.noteId !== -1) {
            const free = Inventory.free();
            if (free > 0) {
                await Bank.withdrawXById(SHIELD_ID, free, bot.noteId);
                bot.log(`withdrew ${free} noted ${SHIELD}(s)`);
            }
        } else if (bot.carryNotes && bot.noteId === -1) {
            bot.log('no noted shield in the bank — farming without notes');
        }
        await Bank.close();
        await Execution.delayTicks(1);
        bot.trips++;
        bot.log(`trip ${bot.trips}: total ${bot.farmed} shield(s) farmed`);
    }
}

class GoToDuke implements Task {
    constructor(private bot: DragonfireShield) {}

    validate(): boolean {
        const p = this.bot.pack();
        if (p.full) {
            return false;
        }
        if (p.atStand) {
            return false;
        }
        if (p.atBank && (p.unNoted > 0 || p.junk > 0 || (p.wantNotes && p.notes === 0 && p.free > 0))) {
            return false;
        }
        return true;
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        bot.setStatus('walking to Duke Horacio');
        await Traversal.walkResilient(DUKE_STAND, {
            radius: 1, attempts: 6, timeoutMs: WALK_MS, log: m => bot.log(`  ${m}`),
        });
    }
}