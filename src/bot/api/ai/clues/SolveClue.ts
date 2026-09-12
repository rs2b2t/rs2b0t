import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { nearestAltar } from '#/bot/api/altar/Altars.js';
import { nearestBank } from '#/bot/api/bank/BankLocations.js';
import type { Task } from '#/bot/api/bot/Bot.js';
import { Prayer } from '#/bot/api/prayer/Prayer.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { crossesTirannwn, walkAcrossTirannwn } from '#/bot/api/ai/clues/tirannwnTravel.js';
import {
    KHARAZI_CLUES,
    MACHETE,
    RADIMUS_NOTES,
    crossesKharazi,
    hasJungleMap,
    heldAxe,
    jungleAxe,
    jungleKeepNames,
    walkAcrossKharazi
} from '#/bot/api/ai/clues/kharaziTravel.js';
import type { NavPoint } from '#/bot/event/webwalk/PathFinder.js';
import { foodHealAmount, shouldEatToUseFood } from '#/bot/api/combat/food.js';
import { Locs } from '#/bot/api/locs/Locs.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { CASKET_IDS, CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import { ensureCoordTools, hasAllTrio, hasCoordClueHeld } from '#/bot/api/ai/clues/AcquireTools.js';
import { SPADE_NAME, trailKit } from '#/bot/api/ai/clues/data/toolAcquire.js';
import { COORD_TOOL_SLOTS, teleportRuneTarget, trailFoodTarget, weaponNeeded } from '#/bot/api/ai/clues/packPlan.js';
import { isTeleportItem, teleportKitFor, type TeleportKit } from '#/bot/api/ai/clues/teleportKit.js';
import {
    ENTRANA_RESTRICTED_GEAR_RE,
    namesHaveEntranaRestrictedGear
} from '#/bot/event/webwalk/exec/specialCrossing.js';
import { snapshotWorldState } from '#/bot/event/webwalk/worldStateLive.js';
import { hardClueKit, DDS_IDS, SHARK_ID } from './hardClueKit.js';
import { hardKitSnapshot, hardKitFingerprint, stockHardWeapon, stockHardSupplies } from './hardCluePreparation.js';
import { sustainUntil } from './Guardian.js';
import { distance } from './rewardAccounting.js';

const BANK_NAME = 'Bank booth';
const BANK_OP = 'Use-quickly';
const CLUE_COINS = 1_000;
const ALTAR_OP = 'Pray-at';
const ALTAR_RADIUS = 2;
const ALTAR_WALK_MS = 180_000;
const ALTAR_RESTORE_MS = 6000;
const EAT_CONFIRM_TICKS = 2;

export function heldClueLikeId(): number | null {
    const it = Inventory.items().find(i => CLUE_DB[i.id] !== undefined || CASKET_IDS[i.id] !== undefined);
    return it ? it.id : null;
}

function heldClueScrollId(): number | null {
    const it = Inventory.items().find(i => CLUE_DB[i.id] !== undefined);
    return it ? it.id : null;
}

/** Hard riddle drawers on Entrana (issue #368), boat refuses weapons/armour. */
function isEntranaClueCoord(c: { x: number; z: number; level: number } | undefined): boolean {
    if (!c || c.level !== 0) {
        return false;
    }
    return c.x >= 2802 && c.x <= 2878 && c.z >= 3329 && c.z <= 3393;
}

function heldClueNeedsEntranaStrip(): boolean {
    const id = heldClueScrollId();
    if (id === null) {
        return false;
    }
    return isEntranaClueCoord(CLUE_DB[id]?.coord);
}

export interface SolveClueHost {
    log(m: string): void;
    setStatus(s: string): void;
    isFood(name: string): boolean;
    foodName(): string;
    foodWithdraw(): number;
    weaponName?(): string;
    enabled?(): boolean;
    /** Travel to the initial bank with host upkeep intact; false blocks the trail. */
    prepareInitialBank?(): Promise<boolean>;
    /** Hard-clue dig guardians are fought under Protect from Magic. */
    restorePrayer?(): boolean;
    /** Route trail legs through the teleport catalog and stock the runes. */
    useTeleports?(): boolean;
}

// Why: nearestBank from inside the elf camp answers the Grand Tree, and the walk there crosses
// Why: Isafdar, which the baked pack cannot route. The bank stop runs before every trail, so a clue
// Why: that leads into Tirannwn strands the bot on its own prep rather than on the clue.
export function walkToBank(tile: NavPoint, log: (m: string) => void): Promise<boolean> {
    if (crossesTirannwn(tile)) {
        return walkAcrossTirannwn(tile, 3, log);
    }
    // Why: a trail that dug in the Kharazi Jungle has to cut back out before any bank is on the graph at all.
    if (crossesKharazi(tile)) {
        return walkAcrossKharazi(tile, 3, log);
    }
    return Traversal.walkResilient(tile, { radius: 3, attempts: 6, timeoutMs: 300_000, log });
}

export class SolveClue implements Task {
    private hardTrail = false;
    private blockedKit: string | null = null;
    private blockedBankKit: string | null = null;
    private deathBlocked = false;
    private restoring = false;
    private retreatPending = false;
    private initialBankVisited = false;
    private preferredRewardBank: NavPoint | null = null;
    private rewardBank: NavPoint | null = null;
    private rewardBlocked: string | null = null;
    private completionPending = false;

    private async retreatFromGuardian(): Promise<boolean> {
        const here = Game.tile();
        const bank = here ? nearestBank(here) : null;
        if (!bank || !(await walkToBank(bank.tile, m => this.host.log(`[clue] ${m}`)))
            || !(await sustainUntil(() => !Game.inCombat(), 6000))) {
            this.status = 'guardian retreat blocked';
            this.host.log('[clue] no safe bank route completed; guardian retry and host handoff remain blocked');
            return false;
        }
        this.retreatPending = false;
        return true;
    }

    private kitBlocked(): boolean {
        return this.blockedKit !== null && this.blockedKit === hardKitFingerprint()
            && !(Bank.ready() && this.blockedBankKit !== null && this.blockedBankKit !== hardKitFingerprint(true));
    }

    private blockHardKit(): void {
        this.blockedKit = hardKitFingerprint();
        if (Bank.ready()) this.blockedBankKit = hardKitFingerprint(true);
    }

    retry(): void {
        this.rewardBlocked = null;
        ClueExecutor.retryGuardian();
        this.blockedKit = null;
        this.blockedBankKit = null;
        this.deathBlocked = false;
        this.abandonedClueId = null;
        this.bankedThisSolve = false;
        this.initialBankVisited = false;
    }
    private bankedThisSolve = false;

    /** One restock trip per dry spell, cleared as soon as food is held again. */
    private triedFoodRestock = false;

    private abandonedClueId: number | null = null;

    /** What the Entrana monk search made us bank, so the trail can give it back. */
    private strippedGear: string[] = [];

    private status = 'idle';

    constructor(private readonly host: SolveClueHost) {}

    clueStatus(): string {
        return this.status;
    }

    noteDeath(): void {
        this.bankedThisSolve = false;
        const id = heldClueScrollId();
        if (!this.hardTrail && !(id !== null && CLUE_DB[id]?.obj.includes('_hard_'))) return;
        ClueExecutor.noteDeath();
        this.deathBlocked = true;
        this.retreatPending = false;
        this.restoring = true;
    }

    validate(): boolean {
        if (ClueExecutor.reward || this.rewardBlocked || this.completionPending) return true;
        if (this.retreatPending) return true;
        if (this.strippedGear.length > 0 && (this.restoring || heldClueLikeId() === null)) return true;
        if (this.deathBlocked) return false;
        if (this.blockedKit !== null) {
            if (this.kitBlocked()) return false;
            this.blockedKit = null;
        }
        if (!(this.host.enabled?.() ?? true) || EventSignal.pending()) {
            return false;
        }
        const id = heldClueLikeId();
        if (this.abandonedClueId !== null && id !== this.abandonedClueId) {
            this.abandonedClueId = null;
        }
        return id !== null && id !== this.abandonedClueId;
    }

    /**
     * Why: a trail runs inside this one task call, so a host's own Eat task never gets a turn between legs.
     * Why: `Sustain.run()` is a no-op unless a hook is installed, so trail upkeep is owned here rather than by the host.
     * Why: hard-clue dig guardians are level-65 mages that keep hitting through Protect from Magic, so a trail without upkeep dies on a full pack.
     */
    private async eatIfHurt(): Promise<void> {
        if (ClueExecutor.reward) return;
        const held = (): { name: string | null; interact(a: string): boolean | Promise<boolean> }[] =>
            Inventory.items().filter(i => this.hardTrail ? i.id === SHARK_ID : this.host.isFood(i.name ?? ''));
        const food = held();
        const maxHp = Skills.level('hitpoints');
        const hp = Skills.effective('hitpoints');
        if (!shouldEatToUseFood({ hp, maxHp, heal: foodHealAmount(this.hardTrail ? 'Shark' : this.host.foodName()), foodCount: food.length })) {
            return;
        }
        this.host.log(`[clue] eating ${food[0].name} (${hp}/${maxHp} hp)`);
        await food[0].interact('Eat');
        // Why: a guardian's hit lands in the same tick as the heal, so hp can end below where it started and an hp-only check waits out its full budget.
        // Why: Sustain.running is set for the duration of that wait, blanking every other pump while damage is heaviest.
        // Why: measured 3s of no bites at 8/70 hp with seven lobsters in the pack; at three seconds the four-tick blackout took a guardian from 45 hp to 2.
        // Why: two ticks, not five, a bite that lands confirms on the next tick, and one the server dropped must be re-sent.
        const landed = await Execution.delayUntilTicks(
            () => held().length < food.length || Skills.effective('hitpoints') > hp,
            EAT_CONFIRM_TICKS
        );
        if (!landed) {
            this.host.log(`[clue] the bite never left the pack (${held().length} left) — re-sending`);
        }
    }

    async execute(): Promise<void> {
        if (this.rewardBlocked) return;
        if (!ClueExecutor.reward && (this.completionPending || this.retreatPending || (this.strippedGear.length > 0 && (this.restoring || heldClueLikeId() === null)))) {
            const upkeep = Sustain.hook;
            Sustain.set(() => this.eatIfHurt());
            try {
                if (this.retreatPending && !(await this.retreatFromGuardian())) return;
                await this.restoreStrippedGear();
                if (this.completionPending && !this.restoring) this.finishTrail();
            } finally {
                Sustain.set(upkeep);
            }
            return;
        }
        if (this.deathBlocked || this.kitBlocked()) return;
        const scroll = heldClueScrollId();
        const startingHard = !this.hardTrail && scroll !== null && CLUE_DB[scroll]?.obj.includes('_hard_') === true;
        if (startingHard) {
            const original = Equipment.items().find(i => i.slot === 3);
            const name = original?.name ?? this.host.weaponName?.() ?? '';
            if (name !== '' && !this.strippedGear.includes(name)) this.strippedGear.push(name);
        }
        if (scroll !== null) this.hardTrail = CLUE_DB[scroll]?.obj.includes('_hard_') === true;
        const prepare = !this.bankedThisSolve && !this.initialBankVisited && heldClueScrollId() !== null ? this.host.prepareInitialBank : undefined;
        if (prepare && !(await prepare.call(this.host))) {
            this.status = 'bank preparation blocked';
            this.host.setStatus('clue: could not reach the initial bank');
            return;
        }
        if (prepare) this.initialBankVisited = true;
        const hostUpkeep = Sustain.hook;
        Sustain.set(() => this.eatIfHurt());
        try {
            await this.runTrail(prepare !== undefined);
        } finally {
            Sustain.set(hostUpkeep);
        }
    }

    /**
     * Why: a trail banks once at the start, so a long one runs dry and walks the rest of the way, often through the Wilderness, with nothing to eat.
     * Why: `Sustain` is pumped on every walk pass but an empty pack has no bite to take, so upkeep alone cannot cover a long trail.
     * Why: bounded to one restock trip per dry spell, so an empty bank cannot put the bot in a bank-walk loop.
     */
    private needsFood(): boolean {
        if ((this.host.foodName() ?? '') === '') {
            return false;
        }
        const held = Inventory.items().some(i => this.host.isFood(i.name ?? ''));
        if (held) {
            this.triedFoodRestock = false;
            return false;
        }
        return !this.triedFoodRestock;
    }

    private async runTrail(initialBankPrepared = false): Promise<void> {
        const restock = this.bankedThisSolve && !this.hardTrail && this.needsFood();
        if (heldClueScrollId() !== null && (!this.bankedThisSolve || restock)) {
            if (restock) {
                this.triedFoodRestock = true;
                this.host.log(`[clue] out of ${this.host.foodName()} mid-trail — banking to restock`);
            }
            if (!(await this.bankFirst(initialBankPrepared))) {
                if (this.hardTrail && this.blockedKit !== null) {
                    await Bank.close();
                    this.restoring = true;
                    await this.restoreStrippedGear();
                    this.blockHardKit();
                }
                return;
            }
            this.bankedThisSolve = true;
        }

        this.status = 'solving';
        this.host.setStatus('solving clue trail');
        const rewards = {
            prepare: (id: number) => this.prepareReward(id),
            food: (item: { name: string | null }) => this.host.isFood(item.name ?? '')
        };
        let outcome = await ClueExecutor.solveHeldClue(m => this.host.log(`[clue] ${m}`), rewards);
        if (outcome === 'supplies-needed') {
            this.bankedThisSolve = false;
            this.retreatPending = Game.inCombat();
            const restockedClue = heldClueScrollId();
            if (await this.bankFirst()) {
                this.retreatPending = false;
                this.bankedThisSolve = true;
                outcome = await ClueExecutor.solveHeldClue(m => this.host.log(`[clue] ${m}`), rewards);
            } else if (this.blockedKit === null) {
                this.status = 'waiting for hard kit bank';
                return;
            }
            if (outcome === 'supplies-needed') {
                this.retreatPending ||= Game.inCombat();
                if (this.retreatPending && !(await this.retreatFromGuardian())) return;
                if (heldClueScrollId() !== restockedClue) {
                    this.status = 'next guardian needs supplies';
                    return;
                }
                this.blockHardKit();
                this.restoring = true;
                await this.restoreStrippedGear();
                this.blockHardKit();
                this.status = 'hard kit blocked';
                return;
            }
        }
        if (outcome === 'dead' || outcome === 'guardian-lost') {
            if (outcome === 'dead') this.noteDeath();
            else this.deathBlocked = true;
            this.bankedThisSolve = false;
            this.restoring = true;
            if (outcome === 'guardian-lost') {
                this.retreatPending = true;
                if (!(await this.retreatFromGuardian())) return;
            }
            await this.restoreStrippedGear();
            this.status = outcome;
            return;
        }

        if (outcome === 'reward-pending') {
            await this.continueReward();
            return;
        }
        if (outcome === 'yield') {
            this.status = 'event: yielding';
            return;
        }
        if (outcome === 'abandon') {
            this.abandonedClueId = heldClueLikeId();
            this.bankedThisSolve = false;
            this.initialBankVisited = false;
            await this.restoreStrippedGear();
            this.status = 'abandoned';
            this.host.log(`[clue] abandoned ${this.abandonedClueId ?? '?'} — leaving it in the pack`);
            return;
        }

        this.bankedThisSolve = false;
        this.initialBankVisited = false;
        this.restoring = true;
        this.completionPending = true;
        await this.restoreStrippedGear();
        if (this.restoring) return;
        this.finishTrail();
    }

    private finishTrail(): void {
        this.completionPending = false;
        this.rewardBank = null;
        this.preferredRewardBank = null;
        this.hardTrail = false;
        this.status = 'idle';
        this.host.setStatus('clue solved');
        this.host.log('[clue] trail complete');
    }

    private blockReward(reason: string): false {
        this.rewardBlocked = reason;
        this.status = `reward blocked: ${reason}`;
        this.host.setStatus(`clue: ${this.status}`);
        this.host.log(`[clue] ${this.status}; rewards remain pending`);
        return false;
    }

    private async prepareReward(casketId: number): Promise<boolean> {
        if (!CASKET_IDS[casketId]?.includes('_hard_')) return true;
        const here = Game.tile();
        const bank = this.preferredRewardBank ?? (here ? nearestBank(here)?.tile : null);
        if (!bank || !(await walkToBank(bank, m => this.host.log(`[clue] ${m}`)))) {
            return this.blockReward('no bank reached before opening');
        }
        if (!(await Bank.openNearest(BANK_NAME, BANK_OP)) || !(await Bank.waitReady())) {
            return this.blockReward('bank not ready before opening');
        }
        const deposit = (_name: string, id: number): boolean => id !== SHARK_ID && CLUE_DB[id] === undefined && CASKET_IDS[id] === undefined;
        await Bank.depositAllMatching(deposit);
        if (!Bank.isOpen() || Inventory.items().some(i => deposit(i.name ?? '', i.id))) {
            return this.blockReward('pre-open deposit incomplete');
        }
        this.rewardBank = Game.tile();
        if (!this.rewardBank || !(await Bank.close()) || !(await Execution.delayUntil(() => !Bank.isOpen(), 3000))) {
            return this.blockReward('bank did not close before opening');
        }
        return true;
    }

    private async continueReward(): Promise<void> {
        const result = ClueExecutor.rewardResult;
        if (!result || this.rewardBlocked) return;
        this.status = 'collecting reward';
        switch (result.kind) {
            case 'complete': return;
            case 'blocked':
                this.blockReward(result.reason);
                return;
            case 'yield':
                if (result.reason === 'return-to-tile' && result.tile) {
                    if (!(await Traversal.walkResilient(result.tile, { radius: 0, attempts: 2, timeoutMs: 6000 }))) {
                        this.blockReward('return to reward tile failed');
                    }
                }
                return;
            case 'needs-space': {
                const tile = result.tile;
                const bank = this.rewardBank ?? (tile ? nearestBank(tile)?.tile : null);
                if (!tile || !bank || distance(tile, bank) > 8) {
                    this.blockReward('no nearby bank for remaining rewards');
                    return;
                }
                if (!(await walkToBank(bank, m => this.host.log(`[clue] ${m}`)))
                    || !(await Bank.openNearest(BANK_NAME, BANK_OP)) || !(await Bank.waitReady())) {
                    this.blockReward('reward bank unavailable');
                    return;
                }
                const before = Inventory.free();
                await Bank.depositAllMatching((_name, id) => CLUE_DB[id] === undefined && CASKET_IDS[id] === undefined);
                if (!(await Execution.delayUntil(() => Bank.isOpen() && Inventory.free() > before, 3000))) {
                    this.blockReward('reward deposit made no space');
                    return;
                }
                if (!(await Bank.close()) || !(await Execution.delayUntil(() => !Bank.isOpen() && Inventory.free() > before, 3000))) {
                    this.blockReward('reward bank close or space confirmation failed');
                    return;
                }
                ClueExecutor.reward?.resumeAfterBank();
                if (!(await Traversal.walkResilient(tile, { radius: 0, attempts: 2, timeoutMs: 6000 }))) {
                    this.blockReward('return to reward tile failed');
                }
                return;
            }
            default: {
                const exhaustive: never = result;
                return exhaustive;
            }
        }
    }

    /**
     * Put back what the Entrana strip banked.
     * Why: the grind bots only re-equip their configured weapon and shield, so nothing else reclaims stripped armour.
     */
    private async restoreStrippedGear(): Promise<void> {
        this.restoring = true;
        for (const name of this.strippedGear) {
            if (!Equipment.contains(name) && Inventory.first(name) !== null) await Equipment.equip(name);
        }
        const want = this.strippedGear.filter(n => !Equipment.contains(n));
        if (want.length === 0) {
            this.strippedGear = [];
            this.restoring = false;
            return;
        }

        const here = Game.tile();
        const bank = here ? nearestBank(here) : null;
        if (!bank) {
            this.host.log(`[clue] no bank nearby to reclaim ${want.join(', ')} — will retry after the next trail`);
            return;
        }

        this.status = 'restoring gear';
        this.host.setStatus('clue: reclaiming stripped gear');
        this.host.log(`[clue] reclaiming gear banked for Entrana: ${want.join(', ')}`);

        if (!(await walkToBank(bank.tile, m => this.host.log(`  ${m}`)))) {
            this.host.log('[clue] walk to the bank failed — gear stays banked, will retry');
            return;
        }
        if (!(await Bank.openNearest(BANK_NAME, BANK_OP, m => this.host.log(`  ${m}`)))) {
            this.host.log('[clue] could not open the bank — gear stays banked, will retry');
            return;
        }
        if (!(await Bank.waitReady())) return;
        if (Inventory.free() < want.filter(n => Inventory.first(n) === null).length) {
            await Bank.depositAllMatching((name, id) => !want.includes(name) && CLUE_DB[id] === undefined && CASKET_IDS[id] === undefined);
        }
        for (const name of want) {
            if (Inventory.first(name) === null) {
                await Bank.withdraw(name, 'Withdraw-1');
                await Execution.delayUntil(() => Inventory.first(name) !== null, 2500);
            }
        }
        await Bank.close();
        await Execution.delayUntil(() => !Bank.isOpen(), 3000);

        for (const name of want) {
            if (!Equipment.contains(name) && Inventory.first(name) !== null) {
                await Equipment.equip(name);
                await Execution.delayUntil(() => Equipment.contains(name), 2500);
            }
        }

        // Why: names that would not go back on stay listed so the next trail retries them.
        this.strippedGear = want.filter(n => !Equipment.contains(n));
        this.restoring = this.strippedGear.length > 0;
        if (this.strippedGear.length > 0) {
            this.host.log(`[clue] could not re-equip ${this.strippedGear.join(', ')} — will retry`);
        }
    }

    /**
     * Why: `start_chop_jungle` wants a machete, an axe and Radimus's notes, and the bank is the only source.
     * Why: `~woodcutting_axe_checker` reads the pack and the right hand, never the bank, so the axe has to come out.
     * Why: without them the trail spends its budget swinging at a band that will not open.
     */
    private async stockJungleKit(): Promise<void> {
        const want: string[] = [];
        if (Inventory.first(MACHETE) === null && !Equipment.contains(MACHETE)) {
            want.push(MACHETE);
        }
        if (heldAxe() === null) {
            const axe = jungleAxe();
            if (axe === null) {
                this.host.log('[clue] no axe in the pack or the bank — the Kharazi band cannot be cut');
            } else {
                want.push(axe);
            }
        }
        if (!hasJungleMap()) {
            want.push(RADIMUS_NOTES);
        }
        for (const name of want) {
            await Bank.withdraw(name, 'Withdraw-1');
            if (await Execution.delayUntil(() => Inventory.first(name) !== null, 2500)) {
                this.host.log(`[clue] took ${name} for the Kharazi Jungle`);
            } else {
                this.host.log(`[clue] no '${name}' in the bank — the Kharazi dig will abandon`);
            }
        }
    }

    private async bankFirst(initialBankPrepared = false): Promise<boolean> {
        this.status = 'banking';
        this.host.setStatus('clue: banking loot before the trail');
        if (!initialBankPrepared) {
            const here = Game.tile();
            const bank = here ? nearestBank(here) : null;
            if (!bank) {
                this.host.log(this.hardTrail ? '[clue] no known bank; hard kit preparation blocked' : '[clue] no known bank to prep at — solving with the pack as-is');
                return !this.hardTrail;
            }
            this.host.log(`[clue] banking loot at the ${bank.name} bank (${bank.tile}) before solving`);
            if (!(await walkToBank(bank.tile, m => this.host.log(`  ${m}`)))) {
                this.host.log('[clue] walk to the bank failed — will retry');
                return false;
            }
        }

        const scrollId = heldClueScrollId();
        const entranaStrip = heldClueNeedsEntranaStrip();
        if (entranaStrip) {
            this.host.log('[clue] Entrana destination — banking weapons/armour (monk search)');
            // Unequip before bank open, side-view swaps inventory ops to Deposit-*.
            for (const worn of Equipment.items()) {
                const n = worn.name ?? '';
                if (n !== '' && ENTRANA_RESTRICTED_GEAR_RE.test(n)) {
                    await Equipment.unequip(n);
                    if ((!this.hardTrail || !DDS_IDS.includes(worn.id)) && !this.strippedGear.some(g => g.toLowerCase() === n.toLowerCase())) {
                        this.strippedGear.push(n);
                    }
                }
            }
        }

        if (!(await Bank.openNearest(BANK_NAME, BANK_OP, m => this.host.log(`  ${m}`)))) {
            this.host.log('[clue] could not open the bank — will retry');
            return false;
        }
        if ((initialBankPrepared || this.hardTrail) && !Bank.ready()) {
            this.status = 'bank preparation blocked';
            this.host.setStatus('clue: initial bank is not ready');
            return false;
        }
        if (initialBankPrepared) this.preferredRewardBank = Game.tile();
        if (this.hardTrail && hardClueKit(hardKitSnapshot(true)) !== 'ready') {
            this.status = `hard kit: ${hardClueKit(hardKitSnapshot(true))}`;
            this.blockHardKit();
            await Bank.close();
            return false;
        }

        const protectedNames = new Set<string>();
        for (const it of Inventory.items()) {
            if ((CLUE_DB[it.id] !== undefined || CASKET_IDS[it.id] !== undefined) && it.name) {
                protectedNames.add(it.name.toLowerCase());
            }
        }
        const weapon = (this.host.weaponName?.() ?? '').toLowerCase();
        const coordItems = new Set(['sextant', 'watch', 'chart']);
        const rowItems = scrollId !== null ? (CLUE_DB[scrollId]?.items ?? []) : [];
        const rowItemNames = new Set(rowItems.map(n => n.toLowerCase()));
        // Why: one snapshot per bank stop, a spell this account cannot cast must not reserve a pack slot.
        const kit = teleportKitFor(snapshotWorldState());
        const keepTeleports = this.host.useTeleports?.() ?? true;
        // Southbound Shantay Pass is baked but consumes a pass (#371). Keep/withdraw
        // one so desert digs (3552/3554) can plan the requires-gated edge.
        const SHANTAY_PASS = 'Shantay pass';
        // Why: the machete, an axe and Radimus's notes are what `start_chop_jungle` checks, and a bot arriving
        // Why: from a grind is holding none of them, so they are kept through the deposit and withdrawn below.
        const jungleClue = scrollId !== null && KHARAZI_CLUES.has(scrollId);
        const jungleKeep = new Set(jungleClue ? jungleKeepNames().map(n => n.toLowerCase()) : []);
        const isKeep = (name: string): boolean => {
            const n = name.toLowerCase();
            if (entranaStrip && ENTRANA_RESTRICTED_GEAR_RE.test(name)) {
                return false;
            }
            // Why: a bot arriving from a grind holds a grind-sized food load that fills the pack, so food is banked here and comes back capped below.
            return protectedNames.has(n) || n.includes('clue') || n.includes('casket')
                || n === SPADE_NAME.toLowerCase() || n === 'coins' || n === SHANTAY_PASS.toLowerCase()
                || coordItems.has(n) || rowItemNames.has(n) || jungleKeep.has(n)
                || (!entranaStrip && weapon !== '' && n === weapon)
                || (keepTeleports && isTeleportItem(name, kit));
        };
        await Bank.depositAllMatching(name => !isKeep(name), m => this.host.log(`[clue] deposit: ${m}`));
        if (initialBankPrepared && (!Bank.isOpen() || Inventory.items().some(item => !isKeep(item.name ?? '')))) {
            this.status = 'bank preparation blocked';
            this.host.setStatus('clue: loot deposit incomplete');
            return false;
        }

        for (const item of trailKit(scrollId)) {
            if (entranaStrip && ENTRANA_RESTRICTED_GEAR_RE.test(item)) {
                continue;
            }
            if (!Inventory.first(item)) {
                await Bank.withdraw(item, 'Withdraw-1');
                if (!(await Execution.delayUntil(() => Inventory.first(item) !== null, 2500))) {
                    this.host.log(`[clue] no '${item}' in the bank`);
                }
            }
        }

        const weaponName = this.host.weaponName?.() ?? '';
        if (
            !this.hardTrail && !entranaStrip
            && weaponNeeded(weaponName, Inventory.first(weaponName) !== null, Equipment.contains(weaponName))
        ) {
            await Bank.withdraw(weaponName, 'Withdraw-1');
            await Execution.delayUntil(() => Inventory.first(weaponName) !== null, 2500);
        }

        if (this.hardTrail && !(await stockHardWeapon(entranaStrip, name => {
            if (!this.strippedGear.includes(name)) this.strippedGear.push(name);
        }))) {
            this.blockHardKit();
            return false;
        }

        if (entranaStrip && namesHaveEntranaRestrictedGear([
            ...Inventory.items().map(i => i.name ?? ''),
            ...Equipment.items().map(i => i.name ?? '')
        ])) {
            this.host.log('[clue] still holding Entrana-banned gear after bank prep — will retry');
            await Bank.close();
            return false;
        }

        const coinsShort = CLUE_COINS - Inventory.count('Coins');
        if (coinsShort > 0 && !(await Bank.withdrawX('Coins', coinsShort))) {
            this.host.log('[clue] no Coins in the bank — toll-gate routes will detour');
        }

        if (Inventory.count(SHANTAY_PASS) < 1) {
            if (!(await Bank.withdraw(SHANTAY_PASS, 'Withdraw-1'))) {
                this.host.log('[clue] no Shantay pass in the bank — Kharidian desert digs will stay closed (#371)');
            } else if (!(await Execution.delayUntil(() => Inventory.count(SHANTAY_PASS) >= 1, 2500))) {
                this.host.log('[clue] Shantay pass withdraw did not land');
            }
        }

        if (jungleClue) {
            await this.stockJungleKit();
        }

        const scrollIsCoord = scrollId !== null && CLUE_DB[scrollId]?.needsSextant === true;
        const fetchingCoordTools = scrollIsCoord && !hasAllTrio() && hasCoordClueHeld();

        // Runes before food: both loops stop on a full pack, and food is the
        // bulky item, so it must be last or the trail leaves with no teleports.
        await this.stockTeleports(kit);

        const food = this.host.foodName();
        if (this.hardTrail) {
            if (!(await stockHardSupplies(fetchingCoordTools ? COORD_TOOL_SLOTS : 0, this.strippedGear))) {
                this.blockHardKit();
                return false;
            }
        } else if (food !== '') {
            const target = trailFoodTarget({
                hostWant: this.host.foodWithdraw(),
                heldFood: Inventory.count(food),
                freeSlots: Inventory.free(),
                reserveSlots: fetchingCoordTools ? COORD_TOOL_SLOTS : 0
            });
            this.host.setStatus(`clue: withdrawing ${food}`);
            this.host.log(`[clue] taking ${target} ${food} for the trail (a grind load is ${this.host.foodWithdraw()})`);
            for (let guard = 0; guard < 12 && Inventory.count(food) < target && !Inventory.isFull(); guard++) {
                const need = target - Inventory.count(food);
                const op = need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1';
                const before = Inventory.count(food);
                await Bank.withdraw(food, op);
                if (!(await Execution.delayUntil(() => Inventory.count(food) > before, 2500))) {
                    break;
                }
            }
            if (Inventory.count(food) === 0 && target > 0) {
                this.host.log(`[clue] WARNING: no '${food}' came back out of the bank — running the trail without food`);
            }
        }
        this.host.log(`[clue] trail pack: ${Inventory.count(food)} ${food}, ${this.describeTeleports(kit)}, ${Inventory.free()} slots free`);

        if (fetchingCoordTools) {
            this.host.setStatus('clue: acquiring coordinate tools');
            await ensureCoordTools(m => this.host.log(`[clue] ${m}`));
        }

        if (this.hardTrail) {
            await Bank.close();
            if (!entranaStrip && hardClueKit(hardKitSnapshot()) !== 'ready') return false;
        }

        await this.topUpPrayer(scrollId);

        return true;
    }

    /** What the trail can teleport with, for the pack log. */
    private describeTeleports(kit: TeleportKit): string {
        if (!(this.host.useTeleports?.() ?? true)) {
            return 'teleports off';
        }
        if (kit.usable.length === 0) {
            return `no castable teleport (magic ${Skills.level('magic')})`;
        }
        const stocked = kit.runes.filter(r => Inventory.count(r.name) > 0).length;
        return `${stocked}/${kit.runes.length} runes for ${kit.usable.join('/')}`;
    }

    /**
     * Why: only spells this account can cast are stocked, a hard casket needs six free slots, so runes for an unlearned spell are dead weight.
     * Why: jewellery is kept when already carried but never fetched, since charges make the names inexact.
     * Why: a missing rune is not fatal. The router walks instead.
     */
    private async stockTeleports(kit: TeleportKit): Promise<void> {
        if (!(this.host.useTeleports?.() ?? true)) {
            return;
        }
        for (const { name, perCast } of kit.runes) {
            const want = teleportRuneTarget(perCast);
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
     * Top up prayer at an altar before a hard trail starts, since any of its legs can be a guarded dig.
     * Why: low prayer never blocks a trail. The fight runs without a protection prayer.
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
        this.host.setStatus(`clue: restoring prayer at ${altar.name}`);
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
