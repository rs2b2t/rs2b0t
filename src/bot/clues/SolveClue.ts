import { EventSignal } from '#/bot/api/EventSignal.js';
import { Execution } from '#/bot/api/Execution.js';
import { Game } from '#/bot/api/Game.js';
import { nearestAltar } from '#/bot/api/Altars.js';
import { nearestBank } from '#/bot/api/BankLocations.js';
import type { Task } from '#/bot/api/Bot.js';
import { Prayer } from '#/bot/api/Prayer.js';
import { Traversal } from '#/bot/api/Traversal.js';
import { Locs } from '#/bot/api/queries/Locs.js';
import { Bank } from '#/bot/api/hud/Bank.js';
import { Inventory } from '#/bot/api/hud/Inventory.js';
import { ClueExecutor } from '#/bot/clues/ClueExecutor.js';
import { CASKET_IDS, CLUE_DB } from '#/bot/clues/data/cluedb.js';
import { ensureCoordTools, hasAllTrio, hasCoordClueHeld } from '#/bot/clues/AcquireTools.js';
import { trailKit } from '#/bot/clues/data/toolAcquire.js';
import { isTeleportItem, teleportRunes } from '#/bot/clues/teleportKit.js';

const BANK_NAME = 'Bank booth';
const BANK_OP = 'Use-quickly';
const CLUE_COINS = 1_000;
const ALTAR_OP = 'Pray-at';
const ALTAR_RADIUS = 2;
const ALTAR_WALK_MS = 180_000;
const ALTAR_RESTORE_MS = 6000;
// Enough runes for a few hops per trail without crowding the pack.
const TELEPORT_CASTS = 4;

export function heldClueLikeId(): number | null {
    const it = Inventory.items().find(i => CLUE_DB[i.id] !== undefined || CASKET_IDS[i.id] !== undefined);
    return it ? it.id : null;
}

function heldClueScrollId(): number | null {
    const it = Inventory.items().find(i => CLUE_DB[i.id] !== undefined);
    return it ? it.id : null;
}

export interface SolveClueHost {
    log(m: string): void;
    setStatus(s: string): void;
    isFood(name: string): boolean;
    foodName(): string;
    foodWithdraw(): number;
    spadeName(): string;
    weaponName?(): string;
    enabled?(): boolean;
    /** Hard-clue dig guardians are fought under Protect from Magic. */
    restorePrayer?(): boolean;
    /** Route trail legs through the teleport catalog and stock the runes. */
    useTeleports?(): boolean;
}

export class SolveClue implements Task {
    private bankedThisSolve = false;

    private abandonedClueId: number | null = null;

    private status = 'idle';

    constructor(private readonly host: SolveClueHost) {}

    clueStatus(): string {
        return this.status;
    }

    noteDeath(): void {
        this.bankedThisSolve = false;
    }

    validate(): boolean {
        if (!(this.host.enabled?.() ?? true) || EventSignal.pending()) {
            return false;
        }
        const id = heldClueLikeId();
        if (this.abandonedClueId !== null && id !== this.abandonedClueId) {
            this.abandonedClueId = null;
        }
        return id !== null && id !== this.abandonedClueId;
    }

    async execute(): Promise<void> {
        if (heldClueScrollId() !== null && !this.bankedThisSolve) {
            if (!(await this.bankFirst())) {
                return;
            }
            this.bankedThisSolve = true;
        }

        this.status = 'solving';
        this.host.setStatus('solving clue trail');
        const outcome = await ClueExecutor.solveHeldClue(m => this.host.log(`[clue] ${m}`));

        if (outcome === 'yield') {
            this.status = 'event — yielding';
            return;
        }
        if (outcome === 'abandon') {
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

        const protectedNames = new Set<string>();
        for (const it of Inventory.items()) {
            if ((CLUE_DB[it.id] !== undefined || CASKET_IDS[it.id] !== undefined) && it.name) {
                protectedNames.add(it.name.toLowerCase());
            }
        }
        const spade = this.host.spadeName().toLowerCase();
        const weapon = (this.host.weaponName?.() ?? '').toLowerCase();
        const coordItems = new Set(['sextant', 'watch', 'chart']);
        const scrollId = heldClueScrollId();
        const rowItems = scrollId !== null ? (CLUE_DB[scrollId]?.items ?? []) : [];
        const rowItemNames = new Set(rowItems.map(n => n.toLowerCase()));
        const keepTeleports = this.host.useTeleports?.() ?? true;
        const isKeep = (name: string): boolean => {
            const n = name.toLowerCase();
            return protectedNames.has(n) || n.includes('clue') || n.includes('casket') || this.host.isFood(name)
                || n === spade || n === 'coins' || coordItems.has(n) || rowItemNames.has(n) || (weapon !== '' && n === weapon)
                || (keepTeleports && isTeleportItem(name));
        };
        await Bank.depositAllMatching(name => !isKeep(name));

        for (const item of trailKit(scrollId, this.host.spadeName())) {
            if (!Inventory.first(item)) {
                await Bank.withdraw(item, 'Withdraw-1');
                if (!(await Execution.delayUntil(() => Inventory.first(item) !== null, 2500))) {
                    this.host.log(`[clue] no '${item}' in the bank`);
                }
            }
        }

        const weaponName = this.host.weaponName?.() ?? '';
        if (weaponName !== '' && !Inventory.first(weaponName)) {
            await Bank.withdraw(weaponName, 'Withdraw-1');
            await Execution.delayUntil(() => Inventory.first(weaponName) !== null, 2500);
        }

        const coinsShort = CLUE_COINS - Inventory.count('Coins');
        if (coinsShort > 0 && !(await Bank.withdrawX('Coins', coinsShort))) {
            this.host.log('[clue] no Coins in the bank — toll-gate routes will detour');
        }

        const scrollIsCoord = scrollId !== null && CLUE_DB[scrollId]?.needsSextant === true;

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

        if (scrollIsCoord && !hasAllTrio() && hasCoordClueHeld()) {
            this.host.setStatus('clue — acquiring coordinate tools');
            await ensureCoordTools(m => this.host.log(`[clue] ${m}`));
        }

        await this.stockTeleports();
        await this.topUpPrayer(scrollId);

        return true;
    }

    /**
     * Top the teleport runes up from the bank. Jewellery is kept if the account
     * already carries it but never fetched — charges make the names inexact.
     * A missing rune is not fatal: the router simply walks instead.
     */
    private async stockTeleports(): Promise<void> {
        if (!(this.host.useTeleports?.() ?? true)) {
            return;
        }
        for (const { name, perCast } of teleportRunes()) {
            const want = perCast * TELEPORT_CASTS;
            for (let guard = 0; guard < 6 && Inventory.count(name) < want && !Inventory.isFull(); guard++) {
                const short = want - Inventory.count(name);
                const before = Inventory.count(name);
                if (!(await Bank.withdrawX(name, short))) {
                    break;
                }
                if (!(await Execution.delayUntil(() => Inventory.count(name) > before, 2500))) {
                    break;
                }
            }
        }
    }

    /**
     * Top up prayer at an altar before a hard trail starts, since any of its legs
     * can be a guarded dig. Low prayer never blocks a trail — the fight simply
     * runs without a protection prayer.
     */
    private async topUpPrayer(scrollId: number | null): Promise<void> {
        const hardTrail = scrollId !== null && (CLUE_DB[scrollId]?.obj.includes('_hard_') ?? false);
        if (!hardTrail || !(this.host.restorePrayer?.() ?? true) || Prayer.max() === 0 || Prayer.full()) {
            return;
        }
        const here = Game.tile();
        const altar = here ? nearestAltar(here) : null;
        if (!altar) {
            this.host.log('[clue] prayer is low but no known altar to restore at');
            return;
        }

        this.status = 'restoring prayer';
        this.host.setStatus(`clue — restoring prayer at ${altar.name}`);
        this.host.log(`[clue] prayer ${Prayer.points()}/${Prayer.max()} — praying at the ${altar.name} altar (${altar.tile})`);

        const walked = await Traversal.walkResilient(altar.tile, {
            radius: ALTAR_RADIUS,
            attempts: 4,
            timeoutMs: ALTAR_WALK_MS,
            log: m => this.host.log(`  ${m}`)
        });
        if (!walked) {
            this.host.log('[clue] could not reach the altar — starting the trail with the prayer we have');
            return;
        }

        const loc = Locs.query().name(altar.loc).action(ALTAR_OP).nearest();
        if (!loc) {
            this.host.log(`[clue] no '${altar.loc}' to pray at here — starting the trail with the prayer we have`);
            return;
        }
        await loc.interact(ALTAR_OP);
        await Execution.delayUntil(() => Prayer.full(), ALTAR_RESTORE_MS);
        this.host.log(`[clue] prayer now ${Prayer.points()}/${Prayer.max()}`);
    }
}
