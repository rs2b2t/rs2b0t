import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { nearestAltar } from '#/bot/api/altar/Altars.js';
import { nearestBank } from '#/bot/api/bank/BankLocations.js';
import type { Task } from '#/bot/api/bot/Bot.js';
import { Prayer } from '#/bot/api/prayer/Prayer.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
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
import { COORD_TOOL_SLOTS, trailFoodTarget, weaponNeeded } from '#/bot/api/ai/clues/packPlan.js';
import { isTeleportItem, teleportKitFor, type TeleportKit } from '#/bot/api/ai/clues/teleportKit.js';
import {
    ENTRANA_RESTRICTED_GEAR_RE,
    namesHaveEntranaRestrictedGear
} from '#/bot/event/webwalk/exec/specialCrossing.js';
import { snapshotWorldState } from '#/bot/event/webwalk/worldStateLive.js';

const BANK_NAME = 'Bank booth';
const BANK_OP = 'Use-quickly';
const CLUE_COINS = 1_000;
const ALTAR_OP = 'Pray-at';
const ALTAR_RADIUS = 2;
const ALTAR_WALK_MS = 180_000;
const ALTAR_RESTORE_MS = 6000;
const EAT_CONFIRM_TICKS = 2;
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

/** Hard riddle drawers on Entrana (issue #368) — boat refuses weapons/armour. */
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
    /** Hard-clue dig guardians are fought under Protect from Magic. */
    restorePrayer?(): boolean;
    /** Route trail legs through the teleport catalog and stock the runes. */
    useTeleports?(): boolean;
}

export class SolveClue implements Task {
    private bankedThisSolve = false;

    /** One restock trip per dry spell — cleared as soon as food is held again. */
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

    /**
     * Why: a trail runs inside this one task call, so a host's own Eat task never gets a turn between legs.
     * Why: `Sustain.run()` is a no-op unless a hook is installed, so trail upkeep is owned here rather than by the host.
     * Why: hard-clue dig guardians are level-65 mages that keep hitting through Protect from Magic, so a trail without upkeep dies on a full pack.
     */
    private async eatIfHurt(): Promise<void> {
        const held = (): { name: string | null; interact(a: string): boolean | Promise<boolean> }[] =>
            Inventory.items().filter(i => this.host.isFood(i.name ?? ''));
        const food = held();
        const maxHp = Skills.level('hitpoints');
        const hp = Skills.effective('hitpoints');
        if (!shouldEatToUseFood({ hp, maxHp, heal: foodHealAmount(this.host.foodName()), foodCount: food.length })) {
            return;
        }
        this.host.log(`[clue] eating ${food[0].name} (${hp}/${maxHp} hp)`);
        await food[0].interact('Eat');
        // Why: a guardian's hit lands in the same tick as the heal, so hp can end below where it started and an hp-only check waits out its full budget.
        // Why: Sustain.running is set for the duration of that wait, blanking every other pump while damage is heaviest.
        // Why: measured 3s of no bites at 8/70 hp with seven lobsters in the pack; at three seconds the four-tick blackout took a guardian from 45 hp to 2.
        // Why: two ticks, not five — a bite that lands confirms on the next tick, and one the server dropped must be re-sent.
        const landed = await Execution.delayUntilTicks(
            () => held().length < food.length || Skills.effective('hitpoints') > hp,
            EAT_CONFIRM_TICKS
        );
        if (!landed) {
            this.host.log(`[clue] the bite never left the pack (${held().length} left) — re-sending`);
        }
    }

    async execute(): Promise<void> {
        const hostUpkeep = Sustain.hook;
        Sustain.set(() => this.eatIfHurt());
        try {
            await this.runTrail();
        } finally {
            Sustain.set(hostUpkeep);
        }
    }

    /**
     * Why: a trail banks once at the start, so a long one runs dry and walks the rest of the way — often through the Wilderness — with nothing to eat.
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

    private async runTrail(): Promise<void> {
        const restock = this.bankedThisSolve && this.needsFood();
        if (heldClueScrollId() !== null && (!this.bankedThisSolve || restock)) {
            if (restock) {
                this.triedFoodRestock = true;
                this.host.log(`[clue] out of ${this.host.foodName()} mid-trail — banking to restock`);
            }
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
            await this.restoreStrippedGear();
            this.status = 'abandoned';
            this.host.log(`[clue] abandoned ${this.abandonedClueId ?? '?'} — leaving it in the pack`);
            return;
        }

        this.bankedThisSolve = false;
        await this.restoreStrippedGear();
        this.status = 'idle';
        this.host.setStatus('clue solved');
        this.host.log('[clue] trail complete');
    }

    /**
     * Put back what the Entrana strip banked.
     * Why: the grind bots only re-equip their configured weapon and shield, so nothing else reclaims stripped armour.
     */
    private async restoreStrippedGear(): Promise<void> {
        const want = this.strippedGear.filter(n => !Equipment.contains(n));
        if (want.length === 0) {
            this.strippedGear = [];
            return;
        }

        const here = Game.tile();
        const bank = here ? nearestBank(here) : null;
        if (!bank) {
            this.host.log(`[clue] no bank nearby to reclaim ${want.join(', ')} — will retry after the next trail`);
            return;
        }

        this.status = 'restoring gear';
        this.host.setStatus('clue — reclaiming stripped gear');
        this.host.log(`[clue] reclaiming gear banked for Entrana: ${want.join(', ')}`);

        if (!(await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 6, timeoutMs: 300_000, log: m => this.host.log(`  ${m}`) }))) {
            this.host.log('[clue] walk to the bank failed — gear stays banked, will retry');
            return;
        }
        if (!(await Bank.openNearest(BANK_NAME, BANK_OP, m => this.host.log(`  ${m}`)))) {
            this.host.log('[clue] could not open the bank — gear stays banked, will retry');
            return;
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
        if (this.strippedGear.length > 0) {
            this.host.log(`[clue] could not re-equip ${this.strippedGear.join(', ')} — will retry`);
        }
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

        const scrollId = heldClueScrollId();
        const entranaStrip = heldClueNeedsEntranaStrip();
        if (entranaStrip) {
            this.host.log('[clue] Entrana destination — banking weapons/armour (monk search)');
            // Unequip before bank open — side-view swaps inventory ops to Deposit-*.
            for (const worn of Equipment.items()) {
                const n = worn.name ?? '';
                if (n !== '' && ENTRANA_RESTRICTED_GEAR_RE.test(n)) {
                    await Equipment.unequip(n);
                    if (!this.strippedGear.some(g => g.toLowerCase() === n.toLowerCase())) {
                        this.strippedGear.push(n);
                    }
                }
            }
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
        const weapon = (this.host.weaponName?.() ?? '').toLowerCase();
        const coordItems = new Set(['sextant', 'watch', 'chart']);
        const rowItems = scrollId !== null ? (CLUE_DB[scrollId]?.items ?? []) : [];
        const rowItemNames = new Set(rowItems.map(n => n.toLowerCase()));
        // Why: one snapshot per bank stop — a spell this account cannot cast must not reserve a pack slot.
        const kit = teleportKitFor(snapshotWorldState());
        const keepTeleports = this.host.useTeleports?.() ?? true;
        // Southbound Shantay Pass is baked but consumes a pass (#371). Keep/withdraw
        // one so desert digs (3552/3554) can plan the requires-gated edge.
        const SHANTAY_PASS = 'Shantay pass';
        const isKeep = (name: string): boolean => {
            const n = name.toLowerCase();
            if (entranaStrip && ENTRANA_RESTRICTED_GEAR_RE.test(name)) {
                return false;
            }
            // Why: a bot arriving from a grind holds a grind-sized food load that fills the pack, so food is banked here and comes back capped below.
            return protectedNames.has(n) || n.includes('clue') || n.includes('casket')
                || n === SPADE_NAME.toLowerCase() || n === 'coins' || n === SHANTAY_PASS.toLowerCase()
                || coordItems.has(n) || rowItemNames.has(n)
                || (!entranaStrip && weapon !== '' && n === weapon)
                || (keepTeleports && isTeleportItem(name, kit));
        };
        await Bank.depositAllMatching(name => !isKeep(name), m => this.host.log(`[clue] deposit: ${m}`));

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
            !entranaStrip
            && weaponNeeded(weaponName, Inventory.first(weaponName) !== null, Equipment.contains(weaponName))
        ) {
            await Bank.withdraw(weaponName, 'Withdraw-1');
            await Execution.delayUntil(() => Inventory.first(weaponName) !== null, 2500);
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

        const scrollIsCoord = scrollId !== null && CLUE_DB[scrollId]?.needsSextant === true;
        const fetchingCoordTools = scrollIsCoord && !hasAllTrio() && hasCoordClueHeld();

        // Runes before food: both loops stop on a full pack, and food is the
        // bulky item, so it must be last or the trail leaves with no teleports.
        await this.stockTeleports(kit);

        const food = this.host.foodName();
        if (food !== '') {
            const target = trailFoodTarget({
                hostWant: this.host.foodWithdraw(),
                heldFood: Inventory.count(food),
                freeSlots: Inventory.free(),
                reserveSlots: fetchingCoordTools ? COORD_TOOL_SLOTS : 0
            });
            this.host.setStatus(`clue — withdrawing ${food}`);
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
            this.host.setStatus('clue — acquiring coordinate tools');
            await ensureCoordTools(m => this.host.log(`[clue] ${m}`));
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
     * Why: only spells this account can cast are stocked — a hard casket needs six free slots, so runes for an unlearned spell are dead weight.
     * Why: jewellery is kept when already carried but never fetched, since charges make the names inexact.
     * Why: a missing rune is not fatal — the router walks instead.
     */
    private async stockTeleports(kit: TeleportKit): Promise<void> {
        if (!(this.host.useTeleports?.() ?? true)) {
            return;
        }
        for (const { name, perCast } of kit.runes) {
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
     * Top up prayer at an altar before a hard trail starts, since any of its legs can be a guarded dig.
     * Why: low prayer never blocks a trail — the fight runs without a protection prayer.
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
