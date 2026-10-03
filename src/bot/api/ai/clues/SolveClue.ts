import { openClueBank } from './bankAccess.js';
import { crossesClueDuel, walkAcrossClueDuel } from './duelTravel.js';
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
    jungleKitMissing,
    walkAcrossKharazi
} from '#/bot/api/ai/clues/kharaziTravel.js';
import type { NavPoint } from '#/bot/event/webwalk/PathFinder.js';
import { foodHealAmount, shouldEatToUseFood } from '#/bot/api/combat/food.js';
import { Locs } from '#/bot/api/locs/Locs.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { ClueExecutor, trailWalkOpts } from '#/bot/api/ai/clues/ClueExecutor.js';
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
import { hardClueKit, GUARDIAN_WEAPON_IDS, SHARK_ID } from './hardClueKit.js';
import { hardKitSnapshot, hardKitFingerprint, stockHardWeapon, stockHardSupplies } from './hardCluePreparation.js';
import { sustainUntil } from './Guardian.js';

const CLUE_COINS = 1_000;
const ALTAR_OP = 'Pray-at';
const ALTAR_RADIUS = 2;
const ALTAR_WALK_MS = 180_000;
const ALTAR_RESTORE_MS = 6000;
const EAT_CONFIRM_TICKS = 2;
const ROTTEN_FOOD_ID = 2959;

export function heldClueLikeId(): number | null {
    const it = Inventory.items().find(i => CLUE_DB[i.id] !== undefined || CASKET_IDS[i.id] !== undefined);
    return it ? it.id : null;
}

function heldClueScrollId(): number | null {
    const it = Inventory.items().find(i => CLUE_DB[i.id] !== undefined);
    return it ? it.id : null;
}

/** Hard-riddle drawers on Entrana; the boat refuses weapons and armour (#368). */
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
    hardFoodTarget?: number;
    weaponName?(): string;
    enabled?(): boolean;
    /** Travel to the initial bank with host upkeep intact; false blocks the trail. */
    prepareInitialBank?(): Promise<boolean>;
    /** Hard-clue dig guardians are fought under Protect from Magic. */
    restorePrayer?(): boolean;
    /** Route trail legs through the teleport catalog and stock the runes. */
    useTeleports?(): boolean;
}

// Why: The nearest bank from the elf camp routes across unsupported Isafdar terrain, so leave Tirannwn first.
export function walkToBank(tile: NavPoint, log: (m: string) => void): Promise<boolean> {
    if (crossesClueDuel(tile)) return walkAcrossClueDuel(tile, 3, log);
    if (crossesTirannwn(tile)) {
        return walkAcrossTirannwn(tile, 3, log, trailWalkOpts(log, 3));
    }
    // Why: a trail that dug in the Kharazi Jungle has to cut back out before any bank is on the graph.
    if (crossesKharazi(tile)) {
        return walkAcrossKharazi(tile, 3, log);
    }
    return Traversal.walkResilient(tile, { ...trailWalkOpts(log, 3), attempts: 6, timeoutMs: 300_000 });
}

export class SolveClue implements Task {
    private hardTrail = false;
    private blockedKit: string | null = null;
    private blockedBankKit: string | null = null;
    private deathBlocked = false;
    private restoring = false;
    private retreatPending = false;
    private initialBankVisited = false;
    private completionPending = false;
    private collectingRewards = false;
    private trailWeapon: string | null = null;

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

    private preparationFingerprint(includeBank = false): string {
        const kit = hardKitFingerprint(includeBank);
        if (!KHARAZI_CLUES.has(heldClueScrollId() ?? -1)) return kit;
        const items = [...Inventory.items(), ...Equipment.items(), ...(includeBank && Bank.ready() ? Bank.items() : [])];
        const tools = jungleKeepNames().map(name => items.filter(i => i.name === name).reduce((n, i) => n + i.count, 0));
        return `${kit}:${tools.join(',')}:${hasJungleMap()}`;
    }

    private kitBlocked(): boolean {
        return this.blockedKit !== null && this.blockedKit === this.preparationFingerprint()
            && !(Bank.ready() && this.blockedBankKit !== null && this.blockedBankKit !== this.preparationFingerprint(true));
    }

    private blockHardKit(): void {
        this.blockedKit = this.preparationFingerprint();
        if (Bank.ready()) this.blockedBankKit = this.preparationFingerprint(true);
    }

    retry(): void {
        ClueExecutor.retryGuardian();
        this.blockedKit = null;
        this.blockedBankKit = null;
        this.deathBlocked = false;
        this.abandonedClueId = null;
        this.bankedThisSolve = false;
        this.initialBankVisited = false;
    }
    private bankedThisSolve = false;
    private recoveryPending = false;

    /** One restock trip per dry spell, cleared as soon as food is held again. */
    private triedFoodRestock = false;

    private abandonedClueId: number | null = null;

    private strippedGear: string[] = [];
    private strippedCounts = new Map<string, number>();
    private entranaStripped = false;

    private status = 'idle';

    constructor(private readonly host: SolveClueHost) {
        ClueExecutor.resetSession();
    }

    ownsEquipment(): boolean {
        return (this.recoveryPending && !this.kitBlocked()) || this.retreatPending || this.collectingRewards || this.strippedGear.length > 0 || (this.hardTrail && this.bankedThisSolve);
    }

    clueStatus(): string {
        return this.status;
    }

    noteDeath(): void {
        this.recoveryPending = false;
        this.collectingRewards = false;
        this.bankedThisSolve = false;
        const id = heldClueScrollId();
        if (!this.hardTrail && !(id !== null && CLUE_DB[id]?.obj.includes('_hard_'))) return;
        ClueExecutor.noteDeath();
        this.deathBlocked = true;
        this.retreatPending = false;
        this.restoring = true;
    }

    validate(): boolean {
        if (this.collectingRewards) return true;
        if (this.completionPending) return true;
        if (this.retreatPending) return true;
        if (this.strippedGear.length > 0 && (this.restoring || heldClueLikeId() === null)) return true;
        if (this.deathBlocked) return false;
        if (this.blockedKit !== null) {
            if (this.kitBlocked()) return false;
            this.blockedKit = null;
        }
        if (this.recoveryPending) return true;
        if (!(this.host.enabled?.() ?? true) || EventSignal.pending()) {
            return false;
        }
        const id = heldClueLikeId();
        if (this.abandonedClueId !== null && id !== this.abandonedClueId) {
            this.abandonedClueId = null;
        }
        return id !== null && id !== this.abandonedClueId;
    }

    /** Why: A trail owns one task call, so install upkeep here to eat between legs and during guardian fights. */
    private async eatIfHurt(): Promise<void> {
        const held = (): { name: string | null; interact(a: string): boolean | Promise<boolean> }[] =>
            Inventory.items().filter(i => this.hardTrail ? i.id === SHARK_ID : !i.noted && this.host.isFood(i.name ?? ''));
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
        // Why: measured: a 3s confirm at 8/70 hp with 7 lobsters held gave a 4-tick blackout that dropped 45 hp to 2.
        // Why: 2 ticks: a bite that lands confirms on the next tick, and one the server dropped needs re-sending.
        const landed = await Execution.delayUntilTicks(
            () => held().length < food.length || Skills.effective('hitpoints') > hp,
            EAT_CONFIRM_TICKS
        );
        if (!landed) {
            this.host.log(`[clue] the bite never left the pack (${held().length} left) — re-sending`);
        }
    }

    private async upkeep(): Promise<void> {
        await this.eatIfHurt();
        const rotten = Inventory.items().find(item => item.id === ROTTEN_FOOD_ID);
        if (rotten) await rotten.interact('Drop');
    }

    async execute(): Promise<void> {
        if (!this.collectingRewards && (!this.recoveryPending || this.restoring) && (this.completionPending || this.retreatPending || (this.strippedGear.length > 0 && (this.restoring || heldClueLikeId() === null)))) {
            const upkeep = Sustain.hook;
            Sustain.set(() => this.upkeep());
            try {
                if (this.retreatPending && !(await this.retreatFromGuardian())) return;
                await this.restoreStrippedGear();
                if (this.blockedKit !== null) this.blockHardKit();
                if (this.completionPending && !this.restoring) this.finishTrail();
            } finally {
                Sustain.set(upkeep);
            }
            return;
        }
        if (this.deathBlocked || this.kitBlocked()) return;
        const held = heldClueLikeId();
        const hard = held !== null && (CLUE_DB[held]?.obj ?? CASKET_IDS[held])?.includes('_hard_') === true;
        if (held !== null && this.trailWeapon === null) {
            const original = Equipment.items().find(i => i.slot === 3);
            this.trailWeapon = original?.name ?? this.host.weaponName?.() ?? '';
            if (this.trailWeapon !== '' && (original || hard) && !this.strippedGear.includes(this.trailWeapon)) this.strippedGear.push(this.trailWeapon);
        }
        if (held !== null) this.hardTrail = hard;
        const prepare = !this.bankedThisSolve && !this.initialBankVisited && heldClueScrollId() !== null ? this.host.prepareInitialBank : undefined;
        if (prepare && !(await prepare.call(this.host))) {
            this.status = 'bank preparation blocked';
            this.host.setStatus('clue: could not reach the initial bank');
            return;
        }
        if (prepare) this.initialBankVisited = true;
        const hostUpkeep = Sustain.hook;
        Sustain.set(() => this.upkeep());
        try {
            await this.runTrail(prepare !== undefined);
        } finally {
            Sustain.set(hostUpkeep);
        }
    }

    /**
     * Why: a trail banks once at the start, so a long one runs dry and walks the rest (often Wilderness) with nothing to eat.
     * Why: `Sustain` runs on every walk pass but can't bite from an empty pack.
     * Why: one restock trip per dry spell, so an empty bank can't cause a bank-walk loop.
     */
    private needsFood(): boolean {
        if ((this.host.foodName() ?? '') === '') {
            return false;
        }
        const held = Inventory.items().some(i => !i.noted && this.host.isFood(i.name ?? ''));
        if (held) {
            this.triedFoodRestock = false;
            return false;
        }
        return !this.triedFoodRestock;
    }

    private async runTrail(initialBankPrepared = false): Promise<void> {
        if (this.recoveryPending) {
            this.retreatPending ||= Game.inCombat();
            if (this.retreatPending && !(await this.retreatFromGuardian())) return;
            if (!(await this.bankFirst(false, true))) {
                if (this.hardTrail && this.blockedKit !== null) {
                    await Bank.close();
                    this.restoring = true;
                    await this.restoreStrippedGear();
                    this.blockHardKit();
                }
                return;
            }
            this.recoveryPending = false;
            this.bankedThisSolve = true;
        }
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
        let outcome = await ClueExecutor.solveHeldClue(m => this.host.log(`[clue] ${m}`),
            () => this.entranaStripped && heldClueScrollId() !== null && !heldClueNeedsEntranaStrip());
        if (outcome === 'supplies-needed') {
            this.bankedThisSolve = false;
            this.retreatPending = Game.inCombat();
            const restockedClue = heldClueScrollId();
            if (await this.bankFirst()) {
                this.retreatPending = false;
                this.bankedThisSolve = true;
                outcome = await ClueExecutor.solveHeldClue(m => this.host.log(`[clue] ${m}`),
                    () => this.entranaStripped && heldClueScrollId() !== null && !heldClueNeedsEntranaStrip());
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
        if (outcome === 'reset-needed') {
            this.recoveryPending = true;
            this.bankedThisSolve = false;
            this.initialBankVisited = true;
            this.triedFoodRestock = false;
            this.status = 'resetting at nearest bank';
            this.host.setStatus('clue: resetting at nearest bank');
            return;
        }
        this.collectingRewards = outcome === 'yield' && heldClueLikeId() === null && ClueExecutor.current !== null;
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

        if (outcome === 'yield') {
            this.status = 'event: yielding';
            return;
        }
        if (this.trailWeapon && this.strippedGear.includes(this.trailWeapon) && !Equipment.contains(this.trailWeapon)) {
            const current = Equipment.items().find(i => i.slot === 3)?.name ?? 'none';
            this.host.log(`[clue] ${outcome}: restoring starting weapon '${this.trailWeapon}' (equipped: '${current}')`);
        }
        if (outcome === 'abandon') {
            this.abandonedClueId = heldClueLikeId();
            this.bankedThisSolve = false;
            this.initialBankVisited = false;
            this.restoring = true;
            this.retreatPending = Game.inCombat();
            if (this.retreatPending && !(await this.retreatFromGuardian())) return;
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
        this.hardTrail = false;
        this.status = 'idle';
        this.host.setStatus('clue solved');
        this.host.log('[clue] trail complete');
    }

    private async restoreStrippedGear(preserveTrail = false): Promise<boolean> {
        this.restoring = !preserveTrail;
        const count = (name: string): number => this.strippedCounts.get(name) ?? 1;
        const equipped = (name: string): number => Equipment.items().find(i => i.name?.toLowerCase() === name.toLowerCase())?.count ?? 0;
        const restored = (name: string): boolean => equipped(name) >= count(name);
        for (const name of this.strippedGear) {
            if (!restored(name) && equipped(name) + Inventory.count(name) >= count(name)) await Equipment.equip(name);
        }
        const want = this.strippedGear.filter(n => !restored(n));
        if (want.length === 0) {
            if (!preserveTrail) {
                this.strippedGear = [];
                this.trailWeapon = null;
            }
            this.restoring = false;
            this.entranaStripped = false;
            this.strippedCounts.clear();
            return true;
        }

        const here = Game.tile();
        const bank = here ? nearestBank(here) : null;
        if (!bank) {
            this.host.log(`[clue] no bank nearby to reclaim ${want.join(', ')} — will retry after the next trail`);
            return false;
        }

        this.status = 'restoring gear';
        this.host.setStatus('clue: reclaiming stripped gear');
        this.host.log(`[clue] reclaiming trail gear: ${want.join(', ')}`);

        if (!(await walkToBank(bank.tile, m => this.host.log(`  ${m}`)))) {
            this.host.log('[clue] walk to the bank failed — gear stays banked, will retry');
            return false;
        }
        if (!(await openClueBank(m => this.host.log(`  ${m}`)))) {
            this.host.log('[clue] could not open the bank — gear stays banked, will retry');
            return false;
        }
        if (!(await Bank.waitReady())) return false;
        if (Inventory.free() < want.filter(n => Inventory.first(n) === null).length) {
            await Bank.depositAllMatching((name, id) => !want.includes(name) && CLUE_DB[id] === undefined && CASKET_IDS[id] === undefined);
        }
        for (const name of want) {
            const needed = count(name) - equipped(name) - Inventory.count(name);
            if (needed > 0) {
                if (needed > 1) await Bank.withdrawX(name, needed);
                else await Bank.withdraw(name, 'Withdraw-1');
                if (!(await Execution.delayUntil(() => equipped(name) + Inventory.count(name) >= count(name), 2500))) return false;
            }
        }
        if (!(await Bank.close()) || !(await Execution.delayUntil(() => !Bank.isOpen(), 3000))) return false;

        for (const name of want) {
            if (!restored(name) && Inventory.first(name) !== null) {
                await Equipment.equip(name);
                await Execution.delayUntil(() => restored(name), 2500);
            }
        }

        const missing = this.strippedGear.filter(n => !restored(n));
        if (!preserveTrail) this.strippedGear = missing;
        this.restoring = !preserveTrail && missing.length > 0;
        if (missing.length > 0) {
            this.host.log(`[clue] could not re-equip ${missing.join(', ')} — will retry`);
            return false;
        }
        this.entranaStripped = false;
        this.strippedCounts.clear();
        if (!preserveTrail) {
            this.trailWeapon = null;
        }
        return true;
    }

    /**
     * Why: `start_chop_jungle` wants a machete, an axe and Radimus's notes, and the bank is the only source.
     * Why: `~woodcutting_axe_checker` reads the pack and the right hand, so the axe has to come out of the bank.
     * Why: without them the trail burns its budget swinging at a band that won't open.
     */
    private async stockJungleKit(): Promise<'ready' | 'retry' | 'missing'> {
        if (!Bank.isOpen() || !Bank.ready() || EventSignal.pending()) return 'retry';
        const want: string[] = [];
        if (Inventory.first(MACHETE) === null && !Equipment.contains(MACHETE)) {
            want.push(MACHETE);
        }
        if (heldAxe() === null) {
            const axe = jungleAxe();
            if (axe === null) {
                this.host.log('[clue] no axe in the pack or the bank — the Kharazi band cannot be cut');
                return 'missing';
            } else {
                want.push(axe);
            }
        }
        if (!hasJungleMap()) {
            want.push(RADIMUS_NOTES);
        }
        for (const name of want) {
            if (!Bank.isOpen() || !Bank.ready() || EventSignal.pending()) return 'retry';
            if (Bank.count(name) < 1) {
                this.host.log(`[clue] no '${name}' in the bank — keeping the Kharazi clue`);
                return 'missing';
            }
            await Bank.withdraw(name, 'Withdraw-1');
            if (!(await Execution.delayUntil(() => Inventory.first(name) !== null, 2500))) {
                this.host.log(`[clue] '${name}' withdrawal did not land — will retry`);
                return 'retry';
            }
            this.host.log(`[clue] took ${name} for the Kharazi Jungle`);
        }
        return jungleKitMissing().length === 0 ? 'ready' : 'retry';
    }

    private async bankEntranaEquipment(protectedNames: ReadonlySet<string>): Promise<boolean> {
        this.host.log('[clue] Entrana destination: clearing the pack and banking all equipment');
        const deposit = (): Promise<void> => Bank.depositAllMatching(name => !protectedNames.has(name.toLowerCase()));
        await deposit();
        const worn = Equipment.items();
        if (worn.length > 0) this.entranaStripped = true;
        if (!Bank.isOpen() || Inventory.free() < worn.length) return false;
        if (worn.length > 0) {
            if (!(await Bank.close()) || !(await Execution.delayUntil(() => !Bank.isOpen(), 3000))) return false;
            for (const item of worn) {
                const name = item.name;
                if (!name || EventSignal.pending()) return false;
                if ((!this.hardTrail || !GUARDIAN_WEAPON_IDS.includes(item.id))
                    && !this.strippedGear.some(n => n.toLowerCase() === name.toLowerCase())) {
                    this.strippedGear.push(name);
                }
                if (this.strippedGear.includes(name)) this.strippedCounts.set(name, item.count);
                if (!(await Equipment.unequip(name))) return false;
            }
            if (!(await openClueBank()) || !(await Bank.waitReady())) return false;
            await deposit();
        }
        return Bank.isOpen() && Equipment.items().length === 0
            && Inventory.items().every(i => protectedNames.has((i.name ?? '').toLowerCase()));
    }

    private async bankFirst(initialBankPrepared = false, rebuild = false): Promise<boolean> {
        this.status = 'banking';
        this.host.setStatus('clue: banking loot before the trail');
        if (!initialBankPrepared) {
            const here = Game.tile();
            const bank = here ? nearestBank(here) : null;
            if (!bank) {
                this.host.log(this.hardTrail ? '[clue] no known bank; hard kit preparation blocked' : '[clue] no known bank to prep at — solving with the pack as-is');
                return !this.hardTrail && !rebuild;
            }
            this.host.log(`[clue] banking loot at the ${bank.name} bank (${bank.tile}) before solving`);
            if (!(await walkToBank(bank.tile, m => this.host.log(`  ${m}`)))) {
                this.host.log('[clue] walk to the bank failed — will retry');
                return false;
            }
        }

        const scrollId = heldClueScrollId();
        const entranaStrip = heldClueNeedsEntranaStrip();

        if (!(await openClueBank(m => this.host.log(`  ${m}`)))) {
            this.host.log('[clue] could not open the bank — will retry');
            return false;
        }
        if ((initialBankPrepared || rebuild || this.hardTrail) && !Bank.ready()) {
            this.status = 'bank preparation blocked';
            this.host.setStatus('clue: initial bank is not ready');
            return false;
        }
        if (this.hardTrail && hardClueKit(hardKitSnapshot(true), this.host.hardFoodTarget) !== 'ready') {
            this.status = `hard kit: ${hardClueKit(hardKitSnapshot(true), this.host.hardFoodTarget)}`;
            this.blockHardKit();
            await Bank.close();
            return false;
        }

        const protectedNames = new Set<string>();
        const puzzleId = scrollId === null ? undefined : CLUE_DB[scrollId]?.puzzle?.id;
        const keyId = scrollId === null ? undefined : CLUE_DB[scrollId]?.keyFrom?.keyId;
        for (const it of Inventory.items()) {
            if ((CLUE_DB[it.id] !== undefined || CASKET_IDS[it.id] !== undefined || it.id === puzzleId || it.id === keyId) && it.name) {
                protectedNames.add(it.name.toLowerCase());
            }
        }
        if (entranaStrip && !(await this.bankEntranaEquipment(protectedNames))) return false;
        if (!entranaStrip && this.entranaStripped) {
            if (!(await this.restoreStrippedGear(true))) return false;
            if (!(await openClueBank()) || !(await Bank.waitReady())) return false;
        }
        const weapon = (this.trailWeapon ?? this.host.weaponName?.() ?? '').toLowerCase();
        const coordItems = new Set(['sextant', 'watch', 'chart']);
        const rowItems = scrollId !== null ? (CLUE_DB[scrollId]?.items ?? []) : [];
        const rowItemNames = new Set(rowItems.map(n => n.toLowerCase()));
        // Why: one snapshot per bank stop; a spell this account can't cast shouldn't reserve a pack slot.
        const kit = teleportKitFor(snapshotWorldState());
        const keepTeleports = this.host.useTeleports?.() ?? true;
        const SHANTAY_PASS = 'Shantay pass';
        const needsShantayPass = scrollId === 3552;
        // Why: `start_chop_jungle` checks for the machete, an axe and Radimus's notes, so they survive the deposit and get withdrawn below.
        const jungleClue = scrollId !== null && KHARAZI_CLUES.has(scrollId);
        const jungleKeep = new Set(jungleClue ? jungleKeepNames().map(n => n.toLowerCase()) : []);
        const isKeep = (name: string): boolean => {
            const n = name.toLowerCase();
            if (rebuild) return protectedNames.has(n);
            if (entranaStrip && ENTRANA_RESTRICTED_GEAR_RE.test(name)) {
                return false;
            }
            // Why: a grind-sized food load fills the pack, so food is banked here and comes back capped below.
            return protectedNames.has(n) || n.includes('clue') || n.includes('casket')
                || n === SPADE_NAME.toLowerCase() || n === 'coins' || (needsShantayPass && n === SHANTAY_PASS.toLowerCase())
                || coordItems.has(n) || rowItemNames.has(n) || jungleKeep.has(n)
                || (!entranaStrip && weapon !== '' && n === weapon)
                || (keepTeleports && isTeleportItem(name, kit));
        };
        await Bank.depositAllMatching(name => !isKeep(name), m => this.host.log(`[clue] deposit: ${m}`));
        if ((initialBankPrepared || rebuild) && (!Bank.isOpen() || Inventory.items().some(item => !isKeep(item.name ?? '')))) {
            this.status = 'bank preparation blocked';
            this.host.setStatus('clue: loot deposit incomplete');
            return false;
        }

        if (puzzleId !== undefined && Inventory.countById(puzzleId) === 0 && Bank.countById(puzzleId) > 0) {
            await Bank.withdrawById(puzzleId, 'Withdraw-1');
            if (!(await Execution.delayUntil(() => Inventory.countById(puzzleId) > 0, 2500))) return false;
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

        const weaponName = this.trailWeapon ?? this.host.weaponName?.() ?? '';
        if (
            !this.hardTrail && !entranaStrip
            && weaponNeeded(weaponName, Inventory.first(weaponName) !== null, Equipment.contains(weaponName))
        ) {
            await Bank.withdraw(weaponName, 'Withdraw-1');
            await Execution.delayUntil(() => Inventory.first(weaponName) !== null, 2500);
        }

        if (this.hardTrail && !(await stockHardWeapon(entranaStrip, name => {
            if (!this.strippedGear.includes(name)) this.strippedGear.push(name);
        }, this.host.weaponName?.(), this.host.hardFoodTarget))) {
            this.blockHardKit();
            return false;
        }

        if (entranaStrip && (Equipment.items().length > 0 || namesHaveEntranaRestrictedGear([
            ...Inventory.items().map(i => i.name ?? ''),
            ...Equipment.items().map(i => i.name ?? '')
        ]))) {
            this.host.log('[clue] still holding Entrana-banned gear after bank prep — will retry');
            await Bank.close();
            return false;
        }

        const coinsShort = CLUE_COINS - Inventory.count('Coins');
        if (coinsShort > 0 && !(await Bank.withdrawX('Coins', coinsShort))) {
            this.host.log('[clue] no Coins in the bank — toll-gate routes will detour');
        }

        if (needsShantayPass && Inventory.count(SHANTAY_PASS) < 1) {
            if (!(await Bank.withdraw(SHANTAY_PASS, 'Withdraw-1'))) {
                this.host.log('[clue] no Shantay pass in the bank; desert routes will buy one from Shantay');
            } else if (!(await Execution.delayUntil(() => Inventory.count(SHANTAY_PASS) >= 1, 2500))) {
                this.host.log('[clue] Shantay pass withdraw did not land');
            }
        }

        if (jungleClue) {
            const result = await this.stockJungleKit();
            if (result !== 'ready') {
                this.host.setStatus(`[clue] needs ${jungleKitMissing().join(', ')}`);
                if (result === 'missing') this.blockHardKit();
                return false;
            }
        }

        const scrollIsCoord = scrollId !== null && CLUE_DB[scrollId]?.needsSextant === true;
        const fetchingCoordTools = scrollIsCoord && !hasAllTrio() && hasCoordClueHeld();

        // Runes before food: both loops stop on a full pack and food is the bulky one.
        await this.stockTeleports(kit);

        const food = this.host.foodName();
        const puzzleSlots = puzzleId !== undefined && Inventory.countById(puzzleId) === 0 ? 1 : 0;
        if (this.hardTrail) {
            const bankable = [...this.strippedGear, ...(puzzleId !== undefined ? ['Sextant', 'Watch', 'Chart'] : [])];
            if (!(await stockHardSupplies((fetchingCoordTools ? COORD_TOOL_SLOTS : 0) + puzzleSlots, bankable, this.host.hardFoodTarget))) {
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
            if (!entranaStrip && hardClueKit(hardKitSnapshot(), this.host.hardFoodTarget) !== 'ready') return false;
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
     * Why: only castable spells are stocked; a hard casket needs 6 free slots, so runes for an unlearned spell are dead weight.
     * Why: jewellery is kept when already carried but never fetched, since charges make the names inexact.
     * Why: a missing rune isn't fatal, the router walks instead.
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
     * Why: low prayer never blocks a trail; the fight runs without a protection prayer.
     */
    private async topUpPrayer(scrollId: number | null): Promise<void> {
        const hardTrail = scrollId !== null && (CLUE_DB[scrollId]?.obj.includes('_hard_') ?? false);
        if (!hardTrail || !(this.host.restorePrayer?.() ?? true) || Prayer.max() === 0 || Prayer.full()) {
            return;
        }
        const here = Game.tile();
        const altar = here ? await nearestAltar(here) : null;
        if (!altar) {
            this.host.log('[clue] prayer is low but no known altar to restore at');
            return;
        }

        this.status = 'restoring prayer';
        this.host.setStatus(`clue: restoring prayer at ${altar.name}`);
        this.host.log(`[clue] prayer ${Prayer.points()}/${Prayer.max()} — praying at the ${altar.name} altar (${altar.tile})`);

        const walked = await Traversal.walkResilient(altar.tile, {
            ...trailWalkOpts(m => this.host.log(`  ${m}`), ALTAR_RADIUS),
            attempts: 4,
            timeoutMs: ALTAR_WALK_MS
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
