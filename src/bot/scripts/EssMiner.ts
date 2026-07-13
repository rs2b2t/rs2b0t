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
import { Quests } from '../api/hud/Quests.js';
import { Skills } from '../api/hud/Skills.js';
import { Locs } from '../api/queries/Locs.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Traversal } from '../api/Traversal.js';
import { walkOpening } from '../api/walkOpening.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { BEST_AVAILABLE, ESS_ITEM, PICK_OPTIONS, inEssMine, requiredMiningLevel, resolvePick } from './EssMinerLogic.js';

// Varrock East bank + Aubury's rune shop + the essence mine — decoded from the
// packed server maps and content (2026-07-12 ess-miner spec). Booths line
// (3252-3256,3419); Aubury (op4 = Teleport, quest-gated server-side) is 16
// tiles due south with the shop door between. The teleport lands on one of 22
// random spots in mapsquare 45_75, where four 5x5 "Rune Essence" crystals and
// four "Portal" exits live — ALL in-mine movement rides OPLOC interacts (the
// server walks us); the web-walker has no data for the region and is never
// used inside it. The portal returns to Aubury's shop (3253,3401).
const BANK_STAND = new Tile(3253, 3418, 0);
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const AUBURY_TILE = new Tile(3253, 3402, 0);
const AUBURY = 'Aubury';
const TELEPORT_OP = 'Teleport';
const ESS_LOC = 'Rune Essence';
const MINE_OP = 'Mine';
const PORTAL_LOC = 'Portal';
const PORTAL_OP = 'Use';
const OBSTACLE = ['door', 'gate'];
// One Mine click auto-repeats server-side until the pack is full; re-click
// only if the essence count stalls this long (a dialog ate the action).
const STALL_MS = 20_000;
// Consecutive teleport attempts that changed nothing before we stop — the
// server refuses silently (a plain game message) when the quest gate fails.
const MAX_TELEPORT_FAILS = 3;

export const SETTINGS: SettingsSchema = {
    pickaxe: { type: 'string', default: BEST_AVAILABLE, options: PICK_OPTIONS, label: 'Pickaxe', help: 'Best available walks Rune→Bronze against your Mining level (worn → inventory → bank withdraw); a specific tier stops if you can\'t use or don\'t own it' }
};

// Active run config (ADR-0006 single-script module state).
let PICK_CHOICE: string = BEST_AVAILABLE;

function essCount(): number {
    return Inventory.count(ESS_ITEM);
}
/** Everything held: worn equipment + pack (the engine checks both). */
function heldNames(): string[] {
    return [...Equipment.items(), ...Inventory.items()].map(i => i.name ?? '').filter(n => n.length > 0);
}
function inMine(): boolean {
    const t = Game.tile();
    return t !== null && inEssMine(t.x, t.z);
}
/** Deposit filter: the essence + the shared junk list. A pickaxe matches
 *  neither, so it stays with us whether worn or carried. */
function essDeposit(bankCommon: boolean): (name: string) => boolean {
    return depositMatcher(name => name.toLowerCase() === ESS_ITEM.toLowerCase(), bankCommon);
}

/**
 * Rune essence miner: start anywhere; bank at Varrock East, teleport in with
 * Aubury (needs Rune Mysteries complete), one-click mine the essence crystal
 * until the pack fills, portal back, deposit, repeat. One setting: which
 * pickaxe to use (default: best available, resolved worn → pack → bank
 * exactly like the engine's pickaxe_checker).
 */
export default class EssMiner extends TaskBot {
    override loopDelay = 600;

    private trips = 0;
    private banked = 0;
    private mined = 0;
    private status = 'starting';
    questRefused = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        PICK_CHOICE = this.settings.str('pickaxe', BEST_AVAILABLE);

        if (Quests.status('Rune Mysteries') !== 'complete') {
            this.log('EssMiner needs Rune Mysteries completed for Aubury\'s teleport — run the RuneMysteries bot first.');
            throw new Error('EssMiner: Rune Mysteries required');
        }
        const gate = requiredMiningLevel(PICK_CHOICE);
        if (gate !== null && Skills.level('mining') < gate) {
            this.log(`EssMiner: Mining ${gate} required for the ${PICK_CHOICE} pickaxe (have ${Skills.level('mining')}) — stopping.`);
            throw new Error('EssMiner: unusable pickaxe selection');
        }

        // The teleport gate refuses with a plain game message (no dialog) —
        // catch it so a stale journal can't leave TeleportIn retrying forever.
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
        const lines = [
            `EssMiner — ${this.status}`,
            `trips ${this.trips}  ess banked ${this.banked}  pack ${essCount()}`,
            `mined ${this.mined}  tick ${Game.tick()}`
        ];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#8be9fd';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void { this.status = s; }
    countMined(delta: number): void { this.mined += delta; }
    countTrip(deposited: number): void { this.trips++; this.banked += deposited; }
    tripsTotal(): number { return this.trips; }
    bankCommon(): boolean { return this.settings.bool('bankCommonJunk', true); }

    /** Shared outside-travel: web-walk the long haul (start-anywhere), then a
     *  door-opening approach so the rune-shop/bank doors can't wedge us. */
    async walkTo(dest: Tile): Promise<void> {
        const here = Game.tile();
        if (here && dest.distanceTo(here) > 30) {
            await Traversal.walkResilient(dest, { radius: 3, attempts: 6, timeoutMs: 240_000, log: m => this.log(`  ${m}`) });
        }
        await walkOpening(dest, 1, OBSTACLE, m => this.log(m));
    }
}

class ContinueDialog implements Task {
    validate(): boolean { return ChatDialog.canContinue(); }
    async execute(): Promise<void> { await ChatDialog.continue(); }
}

/** In the mine with space: one Mine click on the nearest crystal auto-repeats
 *  server-side; babysit the count and only re-click on a genuine stall. */
class MineEss implements Task {
    constructor(private bot: EssMiner) {}
    validate(): boolean { return inMine() && !Inventory.isFull(); }
    async execute(): Promise<void> {
        const rock = Locs.query().name(ESS_LOC).action(MINE_OP).nearest();
        if (!rock) { await Execution.delayTicks(2); return; }
        this.bot.setStatus('mining rune essence');
        this.bot.log('mining rune essence');
        if (!(await rock.interact(MINE_OP))) { await Execution.delayTicks(2); return; }
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
            if (performance.now() - lastGain > STALL_MS) { return; } // revalidate → re-click
            await Execution.delayTicks(2);
        }
        this.bot.log(`pack full (${essCount()} rune essence)`);
    }
}

/** Full pack in the mine: step through the nearest Portal (lands at Aubury's). */
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

/** Outside with essence: bank it. The deposit filter never matches a pickaxe,
 *  so the pick survives every trip, worn or carried. */
class BankEss implements Task {
    constructor(private bot: EssMiner) {}
    validate(): boolean { return !inMine() && essCount() > 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('banking the essence');
        await this.bot.walkTo(BANK_STAND);
        if (!(await Bank.openBooth(BANK_STAND, BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }
        const n = essCount();
        await Bank.depositAllMatching(essDeposit(this.bot.bankCommon()));
        await Execution.delayTicks(1);
        this.bot.countTrip(n);
        this.bot.log(`banked ${n} rune essence (trip ${this.bot.tripsTotal()})`);
    }
}

/** No usable pick held: withdraw one per the setting; stop cleanly when the
 *  selection can't be satisfied anywhere (FlaxSpinner's out-of-stock shape). */
class GetPick implements Task {
    constructor(private bot: EssMiner) {}
    validate(): boolean {
        return !inMine() && resolvePick(PICK_CHOICE, Skills.level('mining'), heldNames(), []).kind !== 'held';
    }
    async execute(): Promise<void> {
        this.bot.setStatus('getting a pickaxe from the bank');
        await this.bot.walkTo(BANK_STAND);
        if (!(await Bank.openBooth(BANK_STAND, BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }
        if (Inventory.isFull()) {
            // make room for the withdraw (ess + junk only — never the pick)
            await Bank.depositAllMatching(essDeposit(this.bot.bankCommon()));
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
            const before = Inventory.used();
            if (!(await Bank.withdraw(res.item))) {
                this.bot.log(`could not withdraw ${res.item} — will retry`);
                return;
            }
            await Execution.delayUntil(() => Inventory.used() > before, 3000);
            this.bot.log(`withdrew ${res.item}`);
        }
    }
}

/** Ready (pick held, no essence carried): walk to Aubury through the shop door
 *  and take the direct Teleport op; arrival = mapsquare 45_75. */
class TeleportIn implements Task {
    private fails = 0;
    constructor(private bot: EssMiner) {}
    validate(): boolean {
        return !inMine() && essCount() === 0 && !Inventory.isFull()
            && resolvePick(PICK_CHOICE, Skills.level('mining'), heldNames(), []).kind === 'held';
    }
    async execute(): Promise<void> {
        const here = Game.tile();
        if (here && AUBURY_TILE.distanceTo(here) > 2) {
            this.bot.setStatus('heading to Aubury');
            await this.bot.walkTo(AUBURY_TILE);
        }
        const aubury = Npcs.query().name(AUBURY).action(TELEPORT_OP).nearest();
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
