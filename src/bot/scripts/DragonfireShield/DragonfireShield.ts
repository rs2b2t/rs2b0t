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
import { Quests } from '../../api/ui/questlog/Quests.js';
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
    COINS_ID,
    DUKE,
    DUKE_STAND,
    GATE_FEE,
    MAX_TALK_GUARD,
    PRINCE_ALI_QUEST,
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
    firstDropAt = 0;
    redroppedAt = 0;
    noteId = -1;

    tripSecs = 50;
    carryNotes = true;
    gateFee = 0;
    initialSetupDone = false;
    /** False until a bank trip found shields to bank; stops the "notes missing" re-bank when starting from an empty bank. */
    hasBankedShields = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.startedAt = Date.now();
        this.tripSecs = this.settings.num('tripSecs', 50);
        this.carryNotes = this.settings.bool('carryNotes', true);
        this.noteId = this.findNoteId();
        await Execution.delayUntil(() => Quests.status(PRINCE_ALI_QUEST) !== 'unknown', 5000);
        this.gateFee = Quests.status(PRINCE_ALI_QUEST) === 'complete' ? 0 : GATE_FEE;
        this.log(
            `DragonfireShield: ${this.tripSecs}s trips, carrying notes: ${this.carryNotes}, note obj ${this.noteId === -1 ? '(none)' : `#${this.noteId}`}, ` +
                `Prince Ali Rescue=${Quests.status(PRINCE_ALI_QUEST)} gate fee=${this.gateFee}`
        );
        this.add(new ContinueDialog(), new LootShields(this), new FarmShields(this), new BankTrip(this), new GoToDuke(this));
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
        const coins = Inventory.countById(COINS_ID);
        return Math.max(
            0,
            used - unNoted - Math.min(used, this.notesHeld() > 0 ? 1 : 0) - Math.min(used, coins > 0 ? 1 : 0)
        );
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
        for (let guard = 0; guard < 40; guard++) {
            const it = Inventory.items().find(i => i.id === id);
            if (!it) {
                return;
            }
            const before = Inventory.countById(id);
            const clicked = await it.interact('Drop');
            const dropped = await Execution.delayUntil(() => Inventory.countById(id) < before, 3000);
            this.log(`drop #${id}: ${before} -> ${Inventory.countById(id)} (clicked=${clicked} dropped=${dropped})`);
            if (!clicked) {
                await Execution.delayTicks(1);
            }
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
            this.log('openDuke: no Duke Horacio in the scene');
            return false;
        }
        const op = talkOp(npc.actions())!;
        const t = npc.tile();
        this.log(`openDuke: interact '${op}' @ ${t.x},${t.z},${t.level}`);
        await npc.interact(op);
        const opened = await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), TALK_OPEN_MS);
        this.log(`openDuke: opened=${opened} canContinue=${ChatDialog.canContinue()} options=${ChatDialog.options().length}`);
        return opened;
    }

    /** Drive one full Duke conversation, picking the "I seek a shield..." option, until the dialogue closes. */
    async dukeGivesShield(): Promise<boolean> {
        let steps = 0;
        let sawOptions: string[] = [];
        for (let i = 0; i < MAX_TALK_GUARD; i++) {
            if (ChatDialog.canContinue()) {
                steps++;
                await ChatDialog.continue();
                await Execution.delayTicks(1);
                continue;
            }
            const opts = ChatDialog.options();
            if (opts.length > 0) {
                const pick = opts.find(o => /shield/i.test(o));
                sawOptions = opts;
                this.log(`duke dialog: options=[${opts.join(' | ')}] pick='${pick ?? opts[0]}'`);
                await ChatDialog.chooseOption(pick ?? opts[0]);
                await Execution.delayTicks(2);
                continue;
            }
            if (!ChatDialog.isOpen()) {
                break;
            }
            await Execution.delayTicks(1);
        }
        const modalsBefore = Modals.isOpen();
        await this.closeModalsOnce();
        this.log(`duke dialog: done steps=${steps} optionsSeen=${sawOptions.length} modals ${modalsBefore}->${Modals.isOpen()}`);
        return !ChatDialog.isOpen();
    }

    pack(): PackState {
        const unNoted = Inventory.countById(SHIELD_ID);
        const notes = this.notesHeld();
        const coins = Inventory.countById(COINS_ID);
        const used = Inventory.used();
        return {
            atStand: this.atStand(),
            atBank: this.atBank(),
            full: Inventory.isFull(),
            free: Inventory.free(),
            unNoted,
            notes,
            // Why: the carried coin stack is the gate toll, so it must not count as junk the bank loop clears.
            junk: Math.max(0, used - unNoted - Math.min(used, notes > 0 ? 1 : 0) - Math.min(used, coins > 0 ? 1 : 0)),
            ground: this.atStand() && !this.tripActive ? this.groundShields().length : 0,
            tripActive: this.tripActive,
            wantNotes: this.carryNotes,
            hasBankedShields: this.hasBankedShields
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
        if (!p.atStand || p.full) {
            return false;
        }
        if (p.tripActive) {
            return true;
        }
        // Why: the floor pile is the depot, so the farm keeps adding to it across windows; only the pack has to be clear.
        if (p.unNoted > 0 || p.junk > 0) {
            return false;
        }
        return p.free >= 1;
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        const here = Game.tile();
        bot.log(`FarmShields: start @ ${here ? `${here.x},${here.z},${here.level}` : '?'} free=${Inventory.free()} unNoted=${Inventory.countById(SHIELD_ID)} notes=${bot.notesHeld()} ground=${bot.groundShields().length}`);
        if (!bot.tripActive) {
            bot.setStatus('starting a farm trip');
            await bot.dropFarmCargo();
            bot.tripActive = true;
            bot.firstDropAt = 0;
            bot.tripDeadline = Date.now() + bot.tripSecs * 1000;
            bot.log(`FarmShields: trip ${bot.tripSecs}s window (anchored to the first drop), pack now free=${Inventory.free()}`);
        }

        let cycles = 0;
        while (bot.tripActive && Date.now() < bot.tripDeadline && !Inventory.isFull()) {
            if (EventSignal.pending() || !bot.atStand() || ChatDialog.isOpen()) {
                bot.log(`FarmShields: breaking cycle (event=${EventSignal.pending()} atStand=${bot.atStand()} dialog=${ChatDialog.isOpen()})`);
                break;
            }
            // Why: a ground pile that can already fill the pack makes more farming pointless, so end the trip and loot.
            if (bot.groundShields().length >= Inventory.free()) {
                bot.log(`FarmShields: ground pile can fill the pack (${bot.groundShields().length} >= ${Inventory.free()} free) — ending trip early`);
                bot.tripActive = false;
                break;
            }
            if (Equipment.contains(SHIELD)) {
                bot.log('FarmShields: shield is equipped — unequipping');
                await Equipment.unequip(SHIELD);
            }
            await bot.closeModalsOnce();
            if (Inventory.countById(SHIELD_ID) > 0) {
                await bot.dropById(SHIELD_ID);
            }
            const before = Inventory.countById(SHIELD_ID);
            const opened = bot.atStand() && (await bot.openDuke());
            if (!opened) {
                bot.log(`FarmShields: duke did not open a dialog (before=${before}) — retry`);
                await Execution.delayTicks(2);
                continue;
            }
            if (!(await bot.dukeGivesShield())) {
                bot.log('FarmShields: duke dialogue did not finish cleanly');
            }
            const got = await Execution.delayUntil(() => Inventory.countById(SHIELD_ID) > before, RECEIVE_MS);
            if (!got) {
                bot.log(`FarmShields: no shield received (inv still ${Inventory.countById(SHIELD_ID)}) — retry`);
                await Execution.delayTicks(2);
                continue;
            }
            bot.log(`FarmShields: shield received (inv ${before} -> ${Inventory.countById(SHIELD_ID)})`);
            await bot.dropById(SHIELD_ID);
            if (bot.firstDropAt === 0) {
                bot.firstDropAt = Date.now();
                bot.tripDeadline = bot.firstDropAt + bot.tripSecs * 1000;
                bot.log(`FarmShields: first drop @ +0s, window ends in ${bot.tripSecs}s`);
            }
            bot.farmed++;
            cycles++;
            bot.setStatus(`farming (${bot.farmed} shields)`);
        }
        bot.tripActive = false;
        bot.log(`FarmShields: trip ended after ${cycles} cycle(s), ${bot.farmed} farmed, pack free=${Inventory.free()}`);
    }
}

class LootShields implements Task {
    constructor(private bot: DragonfireShield) {}

    validate(): boolean {
        const p = this.bot.pack();
        if (!p.atStand || p.tripActive || p.ground === 0) {
            return false;
        }
        // Why: once the pack is full there is no room to pick up anything, so loot must let the bank take over.
        if (p.full) {
            return false;
        }
        // Why: after redropping a partial load, let the farm start the next window instead of
        // immediately re-picking the pile it just put down.
        return Date.now() - this.bot.redroppedAt > 3000;
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        bot.setStatus('looting the shield pile');
        bot.log(`LootShields: ${bot.groundShields().length} ground stack(s), free=${Inventory.free()}`);
        let taken = 0;
        for (let guard = 0; guard < 80; guard++) {
            const pile = bot.groundShields();
            if (pile.length === 0) {
                break;
            }
            const drop = pile[0];
            if (!bot.canLoot(drop)) {
                bot.log(`LootShields: cannot pick up #${drop.id} (pack free=${Inventory.free()}) — bank instead`);
                break;
            }
            const before = Inventory.countById(drop.id);
            const clicked = await drop.interact('Take');
            const got = await Execution.delayUntil(() => {
                const now = Inventory.countById(drop.id);
                const stillThere = bot.groundShields().some(
                    g => g.id === drop.id && g.snap.tile.x === drop.snap.tile.x && g.snap.tile.z === drop.snap.tile.z
                );
                return now > before || !stillThere;
            }, 4000);
            bot.log(`LootShields: take #${drop.id} clicked=${clicked} got=${got} inv=${Inventory.countById(drop.id)}`);
            taken++;
        }
        bot.log(`LootShields: picked ${taken} stack(s), free=${Inventory.free()}`);
        // Why: a coin stack and any junk each cost a slot, so a full load is 28 minus those.
        const capacity = 28 - (Inventory.countById(COINS_ID) > 0 ? 1 : 0) - bot.junkHeld();
        const used = Inventory.used();
        if (used >= capacity || Inventory.isFull()) {
            bot.log(`LootShields: pack ${used}/${capacity} — full load, taking it to the bank`);
            return;
        }
        bot.log(`LootShields: pack ${used}/${capacity} — partial, redropping to pile for another window`);
        await bot.dropFarmCargo();
        bot.redroppedAt = Date.now();
        bot.log(`LootShields: redropped, pack free=${Inventory.free()} ground=${bot.groundShields().length}`);
    }
}

class BankTrip implements Task {
    constructor(private bot: DragonfireShield) {}

    validate(): boolean {
        const p = this.bot.pack();
        if (p.full) {
            return true;
        }
        // Why: a fresh start is bank-first, so the toll coins and noted shields are loaded before the first farm trip.
        if (!this.bot.initialSetupDone) {
            return true;
        }
        if (p.atStand && !p.tripActive && p.ground === 0 && (p.unNoted > 0 || p.notes > 0 || p.junk > 0)) {
            return true;
        }
        if (p.atBank && (p.unNoted > 0 || p.junk > 0 || (p.wantNotes && p.hasBankedShields && p.notes === 0 && p.free > 0))) {
            return true;
        }
        return false;
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        bot.setStatus('banking');
        bot.log(`BankTrip: start atBank=${bot.atBank()} free=${Inventory.free()} unNoted=${Inventory.countById(SHIELD_ID)} notes=${bot.notesHeld()}`);
        if (Equipment.contains(SHIELD)) {
            bot.log('BankTrip: shield is equipped — unequipping');
            await Equipment.unequip(SHIELD);
        }
        if (!bot.atBank()) {
            const walked = await Traversal.walkResilient(BANK_STAND, {
                radius: 2, attempts: 4, timeoutMs: WALK_MS, log: m => bot.log(`  ${m}`),
            });
            bot.log(`BankTrip: walk to Al Kharid bank = ${walked}`);
            if (!walked) {
                return;
            }
        }

        const opened = (await Bank.openBooth(
            { x: BANK_STAND.x, z: BANK_STAND.z, level: BANK_STAND.level },
            BOOTH,
            BOOTH_OP,
            m => bot.log(`  ${m}`),
        )) || (await Bank.openNearest(BOOTH, BOOTH_OP, m => bot.log(`  ${m}`)));
        bot.log(`BankTrip: bank open = ${opened}`);
        if (!opened) {
            return;
        }
        bot.initialSetupDone = true;

        await Bank.depositAllMatching(() => true, m => bot.log(`  ${m}`));
        bot.log(`BankTrip: deposited, pack free=${Inventory.free()}`);
        const banked = Bank.countById(SHIELD_ID) + (bot.noteId === -1 ? 0 : Bank.countById(bot.noteId));
        bot.hasBankedShields = banked > 0;
        if (bot.carryNotes && bot.noteId !== -1) {
            if (banked > 0) {
                await Bank.setNoteMode(true);
                let ok = true;
                if (Bank.countById(SHIELD_ID) > 0) {
                    ok = (await Bank.withdrawXById(SHIELD_ID, Bank.countById(SHIELD_ID), bot.noteId)) && ok;
                }
                if (Bank.countById(bot.noteId) > 0) {
                    ok = (await Bank.withdrawXById(bot.noteId, Bank.countById(bot.noteId), bot.noteId)) && ok;
                }
                bot.log(`BankTrip: bring all banked shields as notes ok=${ok} notesHeld=${bot.notesHeld()} (bank had ${banked})`);
            } else {
                bot.log('BankTrip: no shields in the bank to bring (farming from scratch)');
            }
        } else if (bot.carryNotes && bot.noteId === -1) {
            bot.log('BankTrip: no noted shield row found — farming without notes');
        }
        if (bot.gateFee > 0) {
            const heldCoins = Inventory.countById(COINS_ID);
            const short = Math.max(0, bot.gateFee - heldCoins);
            if (short > 0) {
                await Bank.setNoteMode(false);
                const bankCoins = Bank.countById(COINS_ID);
                const took = Math.min(short, bankCoins);
                if (took > 0) {
                    const ok = await Bank.withdrawXById(COINS_ID, took);
                    bot.log(`BankTrip: gate fee ${bot.gateFee} - withdrew ${took} coins (pack ${Inventory.countById(COINS_ID)}) ok=${ok}`);
                } else {
                    bot.log(`BankTrip: gate fee ${bot.gateFee} but NO coins in the bank`);
                }
            } else {
                bot.log(`BankTrip: gate fee ${bot.gateFee} already held (${heldCoins} coins)`);
            }
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
        if (p.atBank && (p.unNoted > 0 || p.junk > 0 || (p.wantNotes && p.hasBankedShields && p.notes === 0 && p.free > 0))) {
            return false;
        }
        return true;
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        bot.setStatus('walking to Duke Horacio');
        const walked = await Traversal.walkResilient(DUKE_STAND, {
            radius: 1, attempts: 6, timeoutMs: WALK_MS, log: m => bot.log(`  ${m}`),
        });
        const here = Game.tile();
        bot.log(`GoToDuke: walk done=${walked} @ ${here ? `${here.x},${here.z},${here.level}` : '?'} atStand=${bot.atStand()}`);
    }
}