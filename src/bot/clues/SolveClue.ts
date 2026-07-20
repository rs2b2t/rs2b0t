/**
 * The bank-first easy-clue solve flow — one Task shared by RockCrab (a clue
 * preempts crabbing) and the standalone ClueSolver bot. Banks at the NEAREST
 * known bank (api/BankLocations) rather than any hardcoded tile, dumps
 * everything except the clue/casket + food + spade, ensures a spade for dig
 * steps, then hands the pack to ClueExecutor. On a pending random event
 * ClueExecutor returns 'yield' and execute() simply returns so loop()
 * re-cycles and the Supervisor handles the event — validate() is still true
 * next loop (clue still held) and the idempotent re-identify resumes the
 * same step. Never loops on 'yield' here.
 */
import { EventSignal } from '#/bot/api/EventSignal.js';
import { Execution } from '#/bot/api/Execution.js';
import { Game } from '#/bot/api/Game.js';
import { nearestBank } from '#/bot/api/BankLocations.js';
import type { Task } from '#/bot/api/Bot.js';
import { Traversal } from '#/bot/api/Traversal.js';
import { Bank } from '#/bot/api/hud/Bank.js';
import { Inventory } from '#/bot/api/hud/Inventory.js';
import { ClueExecutor } from '#/bot/clues/ClueExecutor.js';
import { CASKET_IDS, CLUE_DB } from '#/bot/clues/data/cluedb.js';
import { ensureCoordTools, hasAllTrio, hasCoordClueHeld } from '#/bot/clues/AcquireTools.js';
import { TRIO } from '#/bot/clues/data/toolAcquire.js';

const BANK_NAME = 'Bank booth';
const BANK_OP = 'Use-quickly';
// Pocket money withdrawn with the spade: toll crossings on trail routes cost
// coins (Al Kharid gate = 10/pass, specialCrossings.ts) and the walker takes
// a detour when it can't pay — 100 covers a whole trail's worth of passes.
const CLUE_COINS = 100;

/** The held easy-clue SCROLL or reward CASKET obj id (what SolveClue works on), or null. */
export function heldClueLikeId(): number | null {
    const it = Inventory.items().find(i => CLUE_DB[i.id] !== undefined || CASKET_IDS[i.id] !== undefined);
    return it ? it.id : null;
}

/** The held easy-clue SCROLL id (not a reward casket) — bank-first only preps a scroll trail. */
export function heldClueScrollId(): number | null {
    const it = Inventory.items().find(i => CLUE_DB[i.id] !== undefined);
    return it ? it.id : null;
}

/** What the owning bot supplies: logging/status plumbing + its food config. */
export interface SolveClueHost {
    log(m: string): void;
    setStatus(s: string): void;
    /** An item name counts as food for the bank keep-set. */
    isFood(name: string | null | undefined): boolean;
    /** Food to top up before the trail; '' skips the top-up. */
    foodName(): string;
    foodWithdraw(): number;
    spadeName(): string;
    /** A held weapon name to keep + withdraw for kill-for-key riddles; '' = none. */
    weaponName?(): string;
    /** Master switch (a settings gate); default on. */
    enabled?(): boolean;
}

export class SolveClue implements Task {
    /** Bank-first is done ONCE per solve. A session flag, NOT a scroll id: each
     *  trail leg swaps the held scroll for a new id, so an id key would re-trek
     *  to the bank between every step. */
    private bankedThisSolve = false;

    /** Clue/casket we gave up on — stays in the pack, so validate() must stop
     *  re-firing on it for the rest of the session (or until it leaves). */
    private abandonedClueId: number | null = null;

    private status = 'idle';

    constructor(private readonly host: SolveClueHost) {}

    /** Overlay label: idle / banking / solving / event — yielding / abandoned. */
    clueStatus(): string {
        return this.status;
    }

    /** Call from the bot's death hook: force a food re-bank before resuming. */
    noteDeath(): void {
        this.bankedThisSolve = false;
    }

    validate(): boolean {
        if (!(this.host.enabled?.() ?? true) || EventSignal.pending()) {
            return false;
        }
        const id = heldClueLikeId();
        // Clear a stale abandon flag once that clue is no longer the held one, so a
        // later re-drop of the same obj id isn't permanently suppressed for the session.
        if (this.abandonedClueId !== null && id !== this.abandonedClueId) {
            this.abandonedClueId = null;
        }
        return id !== null && id !== this.abandonedClueId;
    }

    async execute(): Promise<void> {
        // Bank-first, ONCE per solve: dump loot and ensure a spade + food before
        // trekking the trail. Skipped on post-yield re-entry (already banked this
        // solve) and when only a reward casket is held (open-casket needs no prep).
        if (heldClueScrollId() !== null && !this.bankedThisSolve) {
            if (!(await this.bankFirst())) {
                return; // walk/open failed — retry next loop (flag stays unset)
            }
            this.bankedThisSolve = true;
        }

        this.status = 'solving';
        this.host.setStatus('solving clue trail');
        const outcome = await ClueExecutor.solveHeldClue(m => this.host.log(`[clue] ${m}`));

        if (outcome === 'yield') {
            // Random event pending — hand back to loop() so the Supervisor handles
            // it; validate() re-fires next loop and re-identify resumes the step.
            // Keep bankedThisSolve set so the resume doesn't re-trek to the bank.
            this.status = 'event — yielding';
            return;
        }
        if (outcome === 'abandon') {
            // Flag whatever is currently stuck so validate() stops firing on it;
            // leave it in the pack and carry on. This solve is over.
            this.abandonedClueId = heldClueLikeId();
            this.bankedThisSolve = false;
            this.status = 'abandoned';
            this.host.log(`[clue] abandoned ${this.abandonedClueId ?? '?'} — leaving it in the pack`);
            return;
        }

        this.bankedThisSolve = false;
        this.status = 'idle';
        this.host.setStatus('clue solved');
        this.host.log('[clue] trail complete');
    }

    /** Dump loot at the NEAREST known bank, keep the clue/casket + food + spade,
     *  top up food, withdraw a spade if needed. False if the walk or open failed. */
    private async bankFirst(): Promise<boolean> {
        const here = Game.tile();
        const bank = here ? nearestBank(here) : null;
        if (!bank) {
            this.host.log('[clue] no known bank to prep at — solving with the pack as-is');
            return true;
        }

        this.status = 'banking';
        this.host.setStatus('clue — banking loot before the trail');
        this.host.log(`[clue] banking loot at the ${bank.name} bank (${bank.tile}) before solving`);

        if (!(await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 6, timeoutMs: 300_000, log: m => this.host.log(`  ${m}`) }))) {
            this.host.log('[clue] walk to the bank failed — will retry');
            return false;
        }
        if (!(await Bank.openNearest(BANK_NAME, BANK_OP, m => this.host.log(`  ${m}`)))) {
            this.host.log('[clue] could not open the bank — will retry');
            return false;
        }

        // Deposit everything EXCEPT the keep-set. depositAllMatching matches by
        // NAME, so protect the held clue/casket by their real (id-resolved) names,
        // with a 'clue'/'casket' substring belt, plus every food form and the spade.
        const protectedNames = new Set<string>();
        for (const it of Inventory.items()) {
            if ((CLUE_DB[it.id] !== undefined || CASKET_IDS[it.id] !== undefined) && it.name) {
                protectedNames.add(it.name.toLowerCase());
            }
        }
        const spade = this.host.spadeName().toLowerCase();
        const weapon = (this.host.weaponName?.() ?? '').toLowerCase();
        const coordItems = new Set(['sextant', 'watch', 'chart']);
        // Per-clue extra items (ClueRow.items — e.g. the Rope for 2811's falls
        // ledge): part of the keep-set and withdrawn below like the spade.
        const scrollId = heldClueScrollId();
        const rowItems = scrollId !== null ? (CLUE_DB[scrollId]?.items ?? []) : [];
        const rowItemNames = new Set(rowItems.map(n => n.toLowerCase()));
        const isKeep = (name: string): boolean => {
            const n = name.toLowerCase();
            return protectedNames.has(n) || n.includes('clue') || n.includes('casket') || this.host.isFood(name)
                || n === spade || n === 'coins' || coordItems.has(n) || rowItemNames.has(n) || (weapon !== '' && n === weapon);
        };
        await Bank.depositAllMatching(name => !isKeep(name));

        // Withdraw a spade for dig clues if we don't already hold one.
        if (!Inventory.first(this.host.spadeName())) {
            await Bank.withdraw(this.host.spadeName(), 'Withdraw-1');
            if (!(await Execution.delayUntil(() => Inventory.first(this.host.spadeName()) !== null, 2500))) {
                this.host.log(`[clue] no '${this.host.spadeName()}' in the bank — dig clues will be abandoned`);
            }
        }

        // Best-effort weapon withdraw for kill-for-key riddles. The coordinate
        // items (sextant/watch/chart) are kept if present but NOT auto-withdrawn —
        // they're player-supplied and only some clues need them; a weapon helps
        // the combat riddles, so we pull one when the host names it and lacks it.
        const weaponName = this.host.weaponName?.() ?? '';
        if (weaponName !== '' && !Inventory.first(weaponName)) {
            await Bank.withdraw(weaponName, 'Withdraw-1');
            await Execution.delayUntil(() => Inventory.first(weaponName) !== null, 2500);
        }

        // Toll money rides along with the spade (best-effort: a coinless bank
        // just means toll gates stay detoured, not a failed solve).
        const coinsShort = CLUE_COINS - Inventory.count('Coins');
        if (coinsShort > 0 && !(await Bank.withdrawX('Coins', coinsShort))) {
            this.host.log('[clue] no Coins in the bank — toll-gate routes will detour');
        }

        // Per-clue extra items: withdraw any the pack is missing. Best-effort —
        // a bank without the item just means the step blocks and abandons
        // honestly at execution (blockReason), same as a missing spade.
        for (const item of rowItems) {
            if (!Inventory.first(item)) {
                await Bank.withdraw(item, 'Withdraw-1');
                if (!(await Execution.delayUntil(() => Inventory.first(item) !== null, 2000))) {
                    this.host.log(`[clue] no '${item}' in the bank — this clue will be abandoned at its ${CLUE_DB[scrollId!]?.type ?? 'step'}`);
                }
            }
        }

        // Coordinate clues: the dig hard-requires Sextant+Watch+Chart held
        // (spade.rs2). They persist once acquired, so withdraw any owned copies
        // now (they're already in the keep-set, never re-deposited). The NPC
        // chain that fills any still-missing pieces runs AFTER the bank closes
        // (below) — it walks NPCs and needs the coord clue, not the bank.
        const scrollIsCoord = scrollId !== null && CLUE_DB[scrollId]?.needsSextant === true;
        if (scrollIsCoord) {
            for (const tool of TRIO) {
                if (!Inventory.first(tool)) {
                    await Bank.withdraw(tool, 'Withdraw-1');
                    await Execution.delayUntil(() => Inventory.first(tool) !== null, 2000);
                }
            }
        }

        // Top up food (skipped when the bot runs foodless) so the trail is sustainable.
        const food = this.host.foodName();
        if (food !== '') {
            this.host.setStatus(`clue — withdrawing ${food}`);
            for (let guard = 0; guard < 12 && Inventory.count(food) < this.host.foodWithdraw() && !Inventory.isFull(); guard++) {
                const need = this.host.foodWithdraw() - Inventory.count(food);
                const op = need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1';
                const before = Inventory.count(food);
                await Bank.withdraw(food, op);
                if (!(await Execution.delayUntil(() => Inventory.count(food) > before, 2500))) {
                    break;
                }
            }
        }

        // Pre-provision the coord trio (user's bank-first choice). Runs the
        // 4-NPC chain once ever — the tools persist — and only when a coordinate
        // clue is held (has_sextant_clue). Runs AFTER the bank interaction so
        // the walk away doesn't fight the open bank; best-effort, so a failure
        // here never fails bankFirst — the dig-step safety net covers any gap.
        if (scrollIsCoord && !hasAllTrio() && hasCoordClueHeld()) {
            this.host.setStatus('clue — acquiring coordinate tools');
            await ensureCoordTools(m => this.host.log(`[clue] ${m}`));
        }

        return true;
    }
}
