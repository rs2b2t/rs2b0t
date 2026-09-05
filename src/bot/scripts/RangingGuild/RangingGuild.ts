import { actions, reader } from '../../adapter/ClientAdapter.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import type Tile from '../../geometry/Tile.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Reach } from '../../api/walking/Reach.js';
import { Banking, depositAllExcept } from '../../api/bank/Banking.js';
import { Bank } from '../../api/bank/Bank.js';
import { withdrawOp } from '../../api/bank/bankOps.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Modals } from '../../api/ui/widgets/Modals.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { GameMessages } from '../../api/chatbox/gameMessages.js';
import { Skills } from '../../api/skills/Skills.js';
import { Paint } from '../../paint/Paint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { Supervisor } from '../../runtime/Supervisor.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import {
    ARCHERY_TICKET,
    BOWS,
    BRONZE_ARROW,
    BRONZE_ARROW_NAME,
    COINS,
    COINS_NAME,
    ENTRY_FEE,
    FIRE_OP,
    JUDGE,
    JUDGE_PREFS,
    JUDGE_STAND,
    MERCHANT,
    MERCHANT_STAND,
    RANGED_REQUIRED,
    RUNE_ARROW,
    RUNE_ARROWS_PER_TRADE,
    SEERS_BANK,
    SHOTS_PER_ROUND,
    STAND,
    TARGET,
    TARGET_RESULT_MODAL,
    TICKET_NAME,
    TICKET_SHOP_MODAL,
    TICKET_SHOP_RUNE_ARROWS,
    TICKETS_PER_RUNE_ARROWS,
    VARP_TARGET_COUNT,
    VARP_TARGET_HIT,
    VARP_TARGET_SCORE,
    bestBow,
    classifyShot,
    decide,
    hitLabel,
    hitPoints,
    isBow,
    pickOption,
    type ShotRefusal,
    type WorldView
} from './RangingGuildLogic.js';

export const RANGING_GUILD_SETTINGS: SettingsSchema = {
    coinsPerTrip: {
        type: 'number',
        default: 10_000,
        min: ENTRY_FEE,
        max: 1_000_000,
        label: 'Coins per bank trip',
        help: '200 coins buys a round of ten shots; the bot banks for more when the pack runs dry'
    }
};

const KEEP = [...BOWS.map(b => b.name), COINS_NAME, TICKET_NAME, BRONZE_ARROW_NAME];
const CHAT_MS = 20_000;
const CHAT_IDLE_TICKS = 3;
const SHOT_MS = 6000;
const MODAL_MS = 1500;
const SHOP_MS = 5000;
const MAX_FAILURES = 12;
/** Recovery passes with no progress between them before the script gives up for good. */
const MAX_RECOVERIES = 3;
const MAX_BANK_FAILS = 4;
const TARGET_RANGE = 12;

/** Plays the Ranging Guild archery competition for tickets and turns every 2000 into 50 rune arrows. */
export default class RangingGuild extends LoopingBot {
    override loopDelay = 0;

    private status = 'starting';
    private startedAt = Date.now();
    private xpStart = 0;
    private rounds = 0;
    private shots = 0;
    private roundPoints = 0;
    private ticketsEarned = 0;
    private arrowsBought = 0;
    private trips = 0;
    private failures = 0;
    private recoveries = 0;
    private pendingRecovery: string | null = null;
    private bankFails = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.startedAt = Date.now();
        this.xpStart = Skills.xp('ranged');
        const level = Skills.level('ranged');
        if (level < RANGED_REQUIRED) {
            this.log(`RangingGuild: the guild door needs Ranged ${RANGED_REQUIRED} (have ${level}). Stopping.`);
            throw new Error('RangingGuild: Ranged level too low');
        }
        this.log(`RangingGuild: ${ENTRY_FEE} coins a round, ${TICKETS_PER_RUNE_ARROWS} tickets per ${RUNE_ARROWS_PER_TRADE} rune arrows, ${this.coinsPerTrip()} coins per bank trip`);
    }

    override recoveryAnchor(): Tile {
        return STAND;
    }

    override async loop(): Promise<void> {
        if (this.pendingRecovery !== null) {
            const msg = this.pendingRecovery;
            this.pendingRecovery = null;
            await this.recover(msg);
            return;
        }
        await this.settle();
        const action = decide(this.view());
        switch (action.kind) {
            case 'redeem':
                await this.redeem();
                break;
            case 'collect':
                await this.collect();
                break;
            case 'wield-bow':
                await this.wieldBow();
                break;
            case 'wield-arrows':
                await this.wieldArrows();
                break;
            case 'shoot':
                await this.shoot();
                break;
            case 'restock-arrows':
                await this.restockArrows();
                break;
            case 'enter':
                await this.enter();
                break;
            case 'bank':
                await this.bank();
                break;
        }
        await Execution.delayTicks(1);
    }

    private coinsPerTrip(): number {
        return this.settings.num('coinsPerTrip', 10_000);
    }

    private view(): WorldView {
        const worn = Equipment.items();
        return {
            targetCount: reader.varp(VARP_TARGET_COUNT),
            tickets: Inventory.countById(ARCHERY_TICKET),
            coins: Inventory.countById(COINS),
            bowWorn: worn.some(i => isBow(i.name)),
            bowHeld: Inventory.items().some(i => isBow(i.name)),
            bronzeWorn: worn.filter(i => i.id === BRONZE_ARROW).reduce((n, i) => n + i.count, 0),
            bronzeHeld: Inventory.countById(BRONZE_ARROW)
        };
    }

    // Why: a Ranged level-up box lands between shots, and `Reach.npcDialog` answers retry on sight of any open chat, so twelve judge talks in a row failed live against one box nobody clicked through.
    /** A result box, an idle ticket shop or a level-up page left up from the last pass swallows the next click. */
    private async settle(): Promise<void> {
        const main = Modals.main();
        if (main === TARGET_RESULT_MODAL || (main === TICKET_SHOP_MODAL && Inventory.countById(ARCHERY_TICKET) < TICKETS_PER_RUNE_ARROWS)) {
            await Modals.close();
        }
        await this.drainChat();
    }

    private async enter(): Promise<void> {
        this.status = 'paying the judge';
        if (!(await this.openJudge())) {
            return;
        }
        if (!(await this.driveChat(() => reader.varp(VARP_TARGET_COUNT) >= 1))) {
            this.fail('the judge did not start a round');
            return;
        }
        this.progress();
        this.roundPoints = 0;
        this.log(`paid ${ENTRY_FEE} coins for a round of ${SHOTS_PER_ROUND} (${Inventory.countById(COINS)} coins left)`);
    }

    private async restockArrows(): Promise<void> {
        this.status = 'buying arrows from the judge';
        if (!(await this.openJudge())) {
            return;
        }
        const restocked = await this.driveChat(() => {
            const v = this.view();
            return v.bronzeHeld + v.bronzeWorn > 0;
        });
        if (!restocked) {
            this.fail('the judge did not sell more arrows');
            return;
        }
        this.progress();
        this.log('bought 10 bronze arrows from the judge');
    }

    private async collect(): Promise<void> {
        this.status = 'collecting tickets';
        const score = reader.varp(VARP_TARGET_SCORE);
        const before = Inventory.countById(ARCHERY_TICKET);
        if (!(await this.openJudge())) {
            return;
        }
        if (!(await this.driveChat(() => reader.varp(VARP_TARGET_COUNT) === 0))) {
            this.fail('the judge did not pay out');
            return;
        }
        await Execution.delayUntil(() => Inventory.countById(ARCHERY_TICKET) > before, 2000);
        const gained = Inventory.countById(ARCHERY_TICKET) - before;
        this.rounds++;
        this.ticketsEarned += gained;
        this.progress();
        Supervisor.noteProgress();
        this.log(`round ${this.rounds}: scored ${score}, +${gained} tickets (${Inventory.countById(ARCHERY_TICKET)} held)`);
    }

    private async openJudge(): Promise<boolean> {
        await this.drainChat();
        const reach = await Reach.npcDialog({ name: JUDGE, near: JUDGE_STAND, log: m => this.log(`  ${m}`) });
        if (reach !== 'done') {
            this.fail(`could not talk to the judge (${reach})`);
            return false;
        }
        return true;
    }

    private async driveChat(goal: () => boolean): Promise<boolean> {
        const deadline = Date.now() + CHAT_MS;
        let idle = 0;
        while (Date.now() < deadline) {
            if (goal()) {
                await this.drainChat();
                return true;
            }
            const options = ChatDialog.options();
            if (options.length > 0) {
                const pick = pickOption(options, JUDGE_PREFS);
                if (pick === -1) {
                    this.log(`judge offered [${options.join(' | ')}], none of it wanted`);
                    return false;
                }
                await ChatDialog.chooseOption(options[pick]);
                continue;
            }
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
                continue;
            }
            if (!ChatDialog.isOpen() && ++idle >= CHAT_IDLE_TICKS) {
                return goal();
            }
            await Execution.delayTicks(1);
        }
        return goal();
    }

    private async drainChat(): Promise<void> {
        for (let i = 0; i < 6 && ChatDialog.canContinue(); i++) {
            await ChatDialog.continue();
        }
    }

    private async wieldBow(): Promise<void> {
        const bow = Inventory.items().find(i => isBow(i.name))?.name;
        if (!bow) {
            return;
        }
        this.status = `wielding the ${bow}`;
        if (!(await Equipment.equip(bow))) {
            this.fail(`could not wield the ${bow}`);
            return;
        }
        this.log(`wielded the ${bow}`);
    }

    private async wieldArrows(): Promise<void> {
        this.status = 'wielding bronze arrows';
        if (!(await Equipment.equip(BRONZE_ARROW_NAME))) {
            this.fail('could not wield the bronze arrows');
            return;
        }
        this.log(`wielded ${this.view().bronzeWorn} bronze arrows`);
    }

    private async shoot(): Promise<void> {
        if (!this.at(STAND, 1)) {
            this.status = 'walking to the range';
            await this.walkTo(STAND, 1);
            return;
        }
        this.status = 'shooting';
        const target = Locs.query().name(TARGET).action(FIRE_OP).within(TARGET_RANGE).nearest();
        if (!target) {
            this.fail('no target in the scene');
            await Execution.delayTicks(2);
            return;
        }
        const count = reader.varp(VARP_TARGET_COUNT);
        const mark = GameMessages.mark();
        if (!(await target.interact(FIRE_OP))) {
            this.fail('Fire-at was not sent');
            await Execution.delayTicks(2);
            return;
        }
        let refusal: ShotRefusal | null = null;
        await Execution.delayUntil(
            () => reader.varp(VARP_TARGET_COUNT) > count || (refusal = classifyShot(GameMessages.since(mark).map(m => m.text))) !== null,
            SHOT_MS
        );
        if (reader.varp(VARP_TARGET_COUNT) > count) {
            const hit = reader.varp(VARP_TARGET_HIT);
            const points = hitPoints(hit);
            this.shots++;
            this.roundPoints += points;
            this.progress();
            Supervisor.noteProgress();
            this.log(`shot ${count}/${SHOTS_PER_ROUND}: ${hitLabel(hit)} +${points} (round ${this.roundPoints})`);
            await Execution.delayUntil(() => Modals.main() === TARGET_RESULT_MODAL, MODAL_MS);
            await Modals.closeIfOpen();
            await this.drainChat();
            return;
        }
        if (refusal === null) {
            this.fail('the shot never landed');
            return;
        }
        if (refusal === 'too-close' || refusal === 'unreachable') {
            this.fail(`shot refused: ${refusal}`);
            return;
        }
        this.log(`shot refused: ${refusal}`);
    }

    private async redeem(): Promise<void> {
        this.status = 'buying rune arrows';
        if (Modals.main() !== TICKET_SHOP_MODAL) {
            if (!this.at(MERCHANT_STAND, 3)) {
                await this.walkTo(MERCHANT_STAND, 3);
                return;
            }
            const reach = await Reach.entityOp({
                find: () => Npcs.query().name(MERCHANT).nearest(),
                op: 'Talk-to',
                expect: () => Modals.main() === TICKET_SHOP_MODAL,
                expectMs: SHOP_MS,
                what: MERCHANT,
                log: m => this.log(`  ${m}`)
            });
            if (reach !== 'done') {
                this.fail(`could not open the ticket shop (${reach})`);
            }
            return;
        }
        const arrows = Inventory.countById(RUNE_ARROW);
        if (!actions.ifButton(TICKET_SHOP_RUNE_ARROWS)) {
            this.fail('the rune arrow button was not sent');
            return;
        }
        const bought = await Execution.delayUntil(() => Inventory.countById(RUNE_ARROW) >= arrows + RUNE_ARROWS_PER_TRADE, SHOP_MS);
        if (!bought) {
            this.fail('the ticket shop did not hand over the arrows');
            return;
        }
        this.arrowsBought += RUNE_ARROWS_PER_TRADE;
        this.progress();
        Supervisor.noteProgress();
        this.log(`bought ${RUNE_ARROWS_PER_TRADE} rune arrows for ${TICKETS_PER_RUNE_ARROWS} tickets (${Inventory.countById(ARCHERY_TICKET)} tickets, ${Inventory.countById(RUNE_ARROW)} rune arrows held)`);
    }

    private async bank(): Promise<void> {
        this.status = 'banking at Seers';
        if (!(await Banking.open({ stand: SEERS_BANK, log: m => this.log(`  ${m}`) }))) {
            if (++this.bankFails >= MAX_BANK_FAILS) {
                this.stop('could not open the Seers bank');
                return;
            }
            this.log('could not open the bank, will retry');
            return;
        }
        this.bankFails = 0;
        this.trips++;
        try {
            await Bank.depositAllMatching(depositAllExcept(KEEP));
            await Execution.delayTicks(1);
            const view = this.view();
            if (!view.bowWorn && !view.bowHeld) {
                const bow = bestBow(Skills.level('ranged'), name => Bank.count(name) > 0);
                if (!bow) {
                    this.stop('no bow held, worn or banked');
                    return;
                }
                if (!(await Bank.withdraw(bow))) {
                    this.fail(`could not withdraw the ${bow}`);
                    return;
                }
                this.log(`withdrew a ${bow}`);
            }
            const want = this.coinsPerTrip() - Inventory.countById(COINS);
            const banked = Bank.countById(COINS);
            if (want > 0 && banked > 0) {
                const taken = Math.min(want, banked);
                const stack = Bank.items().find(i => i.id === COINS);
                const all = stack ? withdrawOp(stack.ops, 'all') : null;
                const ok = taken >= banked && all ? await Bank.withdrawById(COINS, all) : await Bank.withdrawXById(COINS, taken);
                if (!ok) {
                    this.fail('could not withdraw coins');
                    return;
                }
                await Execution.delayTicks(1);
                this.log(`withdrew ${taken} coins (${banked - taken} left in the bank)`);
            }
            if (Inventory.countById(COINS) < ENTRY_FEE && Inventory.countById(ARCHERY_TICKET) < TICKETS_PER_RUNE_ARROWS) {
                this.stop(`out of coins, ${Inventory.countById(ARCHERY_TICKET)} tickets held, ${this.arrowsBought} rune arrows bought`);
            }
        } finally {
            await Bank.close();
        }
    }

    private progress(): void {
        this.failures = 0;
        this.recoveries = 0;
    }

    // Why: twelve misses in a row live were one level-up page and a stop, so a run of failures now clears whatever is up, walks back to the range and tries again, and only three such passes with nothing landing between them end the script.
    private fail(msg: string): void {
        this.failures++;
        this.log(`${msg} (${this.failures}/${MAX_FAILURES})`);
        if (this.failures >= MAX_FAILURES) {
            this.pendingRecovery = msg;
        }
    }

    private async recover(msg: string): Promise<void> {
        this.recoveries++;
        if (this.recoveries > MAX_RECOVERIES) {
            this.stop(`gave up after ${MAX_RECOVERIES} recoveries: ${msg}`);
            return;
        }
        this.status = `recovering (${this.recoveries}/${MAX_RECOVERIES})`;
        this.log(`recovering after ${MAX_FAILURES} failures (${this.recoveries}/${MAX_RECOVERIES}): ${msg}`);
        await Modals.closeIfOpen();
        await this.drainChat();
        await this.walkTo(STAND, 1);
        this.failures = 0;
    }

    private stop(reason: string): void {
        this.status = `stopped: ${reason}`;
        ScriptRunner.stop(`RangingGuild: ${reason}`);
    }

    private at(dest: Tile, radius: number): boolean {
        const here = Game.tile();
        return here !== null && dest.distanceTo(here) <= radius;
    }

    private async walkTo(dest: Tile, radius: number): Promise<boolean> {
        if (this.at(dest, radius)) {
            return true;
        }
        return Traversal.walkResilient(dest, { radius, attempts: 6, timeoutMs: 300_000, log: m => this.log(`  ${m}`) });
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#7fbf7f' });
        p.title(`RangingGuild: ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = Skills.xp('ranged') - this.xpStart;
        const xpHour = mins > 0.5 ? `${((xp / mins) * 60 / 1000).toFixed(1)}k` : '-';
        const ticketsHour = mins > 0.5 ? Math.round((this.ticketsEarned / mins) * 60) : 0;

        p.row(`Runtime: ${fmtDuration(mins)}`, `Ranged: ${Skills.level('ranged')}`, `XP/hr: ${xpHour}`);
        p.row(`Rounds: ${this.rounds}`, `Shots: ${this.shots}`, `Round: ${this.roundPoints} pts`);
        p.row(`Tickets: ${Inventory.countById(ARCHERY_TICKET)}`, `Earned: ${this.ticketsEarned} (${ticketsHour}/hr)`, `Rune arrows: ${this.arrowsBought}`);
        p.row(`Coins: ${Inventory.countById(COINS)}`, `Bank trips: ${this.trips}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
