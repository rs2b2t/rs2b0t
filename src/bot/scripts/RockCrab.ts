import { TaskBot, type Task } from '../api/Bot.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Skills } from '../api/hud/Skills.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import { DirectNavigator } from '../nav/DirectNavigator.js';
import { Traversal } from '../api/Traversal.js';
import type { SettingsSchema } from '../runtime/Settings.js';

// The rock crab field east of Rellekka, on the northern shoreline (verified
// live: dormant "Rocks" NPCs at x 2694-2719, z 3714-3729; walking adjacent
// wakes them into attacking "Rock Crab" lvl 13). Two clusters share one
// scene, so the whole spot is reachable with scene-local walking.
const DEFAULT_FIELD = new Tile(2710, 3720, 0);
// Inland reset tile, ~21 tiles south of the field — far enough that the crabs
// de-aggro and revert, so walking back in wakes them again (the "run out and
// back" reset).
const DEFAULT_RESET = new Tile(2712, 3699, 0);
// Seers' Village bank — the nearest bank to the Rellekka shoreline (the game
// says so: quest_viking/viking_peer.rs2). Coords are the verified Seers bank
// zone (firemaking bank_zones: mapsquare 42,54 -> x 2721-2730, z 3487-3497).
// The exact walkable stand tile next to a booth may need a nudge on the first
// live run.
const DEFAULT_BANK = new Tile(2725, 3491, 0);
const BANK_NAME = 'Bank booth';
const BANK_OP = 'Use-quickly';
const MAX_FAILED_WAKES = 3; // consecutive dud wakes => area is de-aggro'd
// How close to the field centre counts as "regrouped" for the run-back step.
const CENTRE_RADIUS = 2;

// Valuables to grab off the ground. Both crystal-key halves share the item
// name "Half of a key"; the rest are the notable rock-crab drops.
const DEFAULT_LOOT = 'half of a key, casket, clue scroll, small oyster pearls, oyster pearls, uncut sapphire, uncut emerald, uncut ruby, uncut diamond';

/** Tunable parameters (panel + `?RockCrab.<key>=...`). The field/reset tiles
 *  let you point it at a different rock-crab spot entirely. */
export const SETTINGS: SettingsSchema = {
    field: { type: 'tile', default: DEFAULT_FIELD, label: 'Field centre (x,z)' },
    resetTile: { type: 'tile', default: DEFAULT_RESET, label: 'Run-out reset tile (x,z)' },
    fieldRadius: { type: 'number', default: 15, min: 5, max: 30, label: 'Field radius (tiles)' },
    stack: { type: 'number', default: 3, min: 1, max: 8, label: 'Crabs to stack before clearing' },
    fightHpGate: { type: 'number', default: 40, min: 0, max: 100, label: 'Retreat below HP%' },
    restUntilHp: { type: 'number', default: 75, min: 0, max: 100, label: 'Rest until HP% (no-food fallback)' },
    food: { type: 'string', default: 'Lobster', label: 'Food item name', help: 'exact item name, e.g. Lobster, Swordfish, Trout' },
    eatAtHp: { type: 'number', default: 50, min: 1, max: 99, label: 'Eat below HP%' },
    foodWithdraw: { type: 'number', default: 20, min: 1, max: 27, label: 'Food to withdraw per bank run' },
    bankTile: { type: 'tile', default: DEFAULT_BANK, label: 'Bank stand tile (Seers)' },
    loot: { type: 'string[]', default: DEFAULT_LOOT.split(',').map(s => s.trim()), label: 'Loot item names' }
};

// Active run config — set from settings in onStart. Safe as module state
// because exactly one script runs at a time (ADR-0006).
let FIELD = DEFAULT_FIELD;
let RESET_TILE = DEFAULT_RESET;
let BANK_TILE = DEFAULT_BANK;
let FIELD_RADIUS = 15;
let DESIRED_STACK = 3;
let FIGHT_HP_GATE = 0.4;
let REST_HP = 0.75;
let EAT_HP = 0.5;
let FOOD_NAME = 'Lobster';
let FOOD_WITHDRAW = 20;
let LOOT_NAMES = DEFAULT_LOOT.split(',').map(s => s.trim());

/**
 * Rock crab trainer for the Rellekka shoreline. Walks among the dormant
 * "Rocks" to aggro them; once the stack is built it runs back to the field
 * centre so the crabs pile up there, then kills the pile. Eats food to sustain,
 * and when it runs out it web-walks to the Seers' Village bank, withdraws more,
 * and returns. Loots key halves and other valuables, and runs out-and-back to
 * reset aggression when the rocks stop waking. Start it anywhere — it web-walks
 * to the field first. Handles every random event via the shared handler.
 */
export default class RockCrab extends TaskBot {
    override loopDelay = 600;

    private kills = 0;
    private looted = 0;
    private deaths = 0;
    private resets = 0;
    private bankTrips = 0;
    private failedWakes = 0;
    private bankKnownEmpty = false;
    private status = 'starting';
    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        FIELD = this.settings.tile('field', DEFAULT_FIELD);
        RESET_TILE = this.settings.tile('resetTile', DEFAULT_RESET);
        BANK_TILE = this.settings.tile('bankTile', DEFAULT_BANK);
        FIELD_RADIUS = this.settings.num('fieldRadius', 15);
        DESIRED_STACK = this.settings.num('stack', 3);
        FIGHT_HP_GATE = this.settings.num('fightHpGate', 40) / 100;
        REST_HP = this.settings.num('restUntilHp', 75) / 100;
        EAT_HP = this.settings.num('eatAtHp', 50) / 100;
        FOOD_NAME = this.settings.str('food', 'Lobster');
        FOOD_WITHDRAW = this.settings.num('foodWithdraw', 20);
        LOOT_NAMES = this.settings.list('loot', LOOT_NAMES).map(s => s.toLowerCase());

        this.log(`RockCrab starting — field ${FIELD} r${FIELD_RADIUS}, stack ${DESIRED_STACK}, food '${FOOD_NAME}' (eat<${Math.round(EAT_HP * 100)}%), bank ${BANK_TILE}, attack lvl ${Skills.level('attack')}`);

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
        });

        this.add(
            new DeathRecovery(this, {
                anchor: FIELD,
                radius: 4,
                onDeath: () => {
                    this.setStatus('died — recovering');
                    this.countDeath();
                    this.log('died! waiting for respawn, then web-walking back to the field');
                },
                onRecovered: () => {
                    this.died = false;
                }
            }),
            new Eat(this),
            new BankRun(this),
            new GoToField(this),
            new LootValuables(this),
            new RegroupAtField(this),
            new Fight(this),
            new Aggro(this),
            new ResetAggro(this)
        );
    }

    override grindTargets(): string[] {
        return ['rock crab', 'rocks'];
    }

    override recoveryAnchor(): Tile | null {
        return FIELD;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [`RockCrab — ${this.status}`, `kills ${this.kills}  loot ${this.looted}  banks ${this.bankTrips}  resets ${this.resets}${this.deaths ? `  deaths ${this.deaths}` : ''}`, `hp ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}  food ${foodCount()}  tick ${Game.tick()}`];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#7ad0ff';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void {
        this.status = s;
    }
    countKill(): void {
        this.kills++;
    }
    killsTotal(): number {
        return this.kills;
    }
    countLoot(): void {
        this.looted++;
    }
    countDeath(): void {
        this.deaths++;
    }
    countReset(): void {
        this.resets++;
    }
    countBankTrip(): void {
        this.bankTrips++;
    }
    noteBankEmpty(empty: boolean): void {
        this.bankKnownEmpty = empty;
    }
    bankIsKnownEmpty(): boolean {
        return this.bankKnownEmpty;
    }
    noteWake(success: boolean): void {
        this.failedWakes = success ? 0 : this.failedWakes + 1;
    }
    deAggroed(): boolean {
        return this.failedWakes >= MAX_FAILED_WAKES;
    }
    clearWakes(): void {
        this.failedWakes = 0;
    }
}

function hpFraction(): number {
    const base = Skills.level('hitpoints');
    return base > 0 ? Skills.effective('hitpoints') / base : 1;
}

function inField(tile: Tile): boolean {
    return FIELD.distanceTo(tile) <= FIELD_RADIUS;
}

/** True once we've stacked enough crabs (or there are no more rocks to gather). */
function stackReady(): boolean {
    const crabs = activeCrabs().length;
    return crabs >= DESIRED_STACK || (crabs >= 1 && dormantRocks().length === 0);
}

/** True when we're standing at (within CENTRE_RADIUS of) the field centre. */
function atCentre(): boolean {
    const here = Game.tile();
    return here !== null && FIELD.distanceTo(Tile.from(here)) <= CENTRE_RADIUS;
}

// Multi-bite foods eat DOWN through intermediate items (a cake is 3 items:
// Cake -> 2/3 cake -> Slice of cake), so an exact name match would stop seeing
// it as food after the first bite. List every edible form, keyed by the full
// item you'd bank/withdraw. Anything not listed is treated as a single-item food.
const FOOD_FORMS: Record<string, string[]> = {
    'cake': ['cake', '2/3 cake', 'slice of cake'],
    'chocolate cake': ['chocolate cake', '2/3 chocolate cake', 'chocolate slice'],
    'plain pizza': ['plain pizza', '1/2 plain pizza'],
    'meat pizza': ['meat pizza', '1/2 meat pizza'],
    'anchovy pizza': ['anchovy pizza', '1/2 anchovy pizza'],
    'pineapple pizza': ['pineapple pizza', '1/2 pineapple pizza'],
    'redberry pie': ['redberry pie', 'half a redberry pie'],
    'meat pie': ['meat pie', 'half a meat pie'],
    'apple pie': ['apple pie', 'half an apple pie']
};

/** Every edible form of the configured food (all 3 slices of a cake, etc.). */
function foodForms(): string[] {
    const key = FOOD_NAME.toLowerCase();
    return FOOD_FORMS[key] ?? [key];
}

/** True if an item is one of the edible forms of the configured food. */
function isFoodItem(name: string | null | undefined): boolean {
    return foodForms().includes((name ?? '').toLowerCase());
}

/** Edible food items in the pack, counting part-eaten cakes/pizzas/pies too. */
function foodCount(): number {
    return Inventory.items().filter(i => isFoodItem(i.name)).length;
}

function hasFood(): boolean {
    return foodCount() > 0;
}

/** Eat one piece of food if we have any (any form); resolves true if HP went up. */
async function eatOnce(bot: RockCrab): Promise<boolean> {
    const food = Inventory.items().find(i => isFoodItem(i.name));
    if (!food) {
        return false;
    }
    bot.setStatus(`eating ${food.name} (${Math.round(hpFraction() * 100)}% hp)`);
    const before = Skills.effective('hitpoints');
    await food.interact('Eat');
    return Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
}

/** Active, attackable crabs inside the field. */
function activeCrabs(): Npc[] {
    return Npcs.query()
        .name('Rock Crab')
        .where(n => inField(n.tile()))
        .results();
}

/** Dormant "Rocks" NPCs (not the mining loc of the same name) inside the field. */
function dormantRocks(): Npc[] {
    return Npcs.query()
        .name('Rocks')
        .where(n => inField(n.tile()))
        .results();
}

/** Eat food when HP dips below the eat gate (primary HP management). */
class Eat implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        return hpFraction() < EAT_HP && hasFood();
    }

    async execute(): Promise<void> {
        await eatOnce(this.bot);
    }
}

/** Out of food -> web-walk to the Seers bank, withdraw more, and return to the field. */
class BankRun implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        // restock when we've run out — unless we've already learned the bank is
        // empty of this food (then fall back to no-food combat + resting)
        return !hasFood() && !this.bot.bankIsKnownEmpty();
    }

    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return; // runtime event guard takes over next loop
        }
        this.bot.setStatus('out of food — walking to the bank');
        this.bot.log(`out of ${FOOD_NAME} — banking at ${BANK_TILE} for more`);

        // long web-walk south; the crabs de-aggro as we leave the field
        if (!(await Traversal.walkResilient(BANK_TILE, { radius: 3, attempts: 6, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) }))) {
            this.bot.log('walk to the bank failed — will retry');
            return;
        }

        // interact the nearest booth directly; the engine walks us to its
        // accessible side and opens it (BANK_TILE just needs to land us near it)
        if (!(await Bank.openNearest(BANK_NAME, BANK_OP, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }

        this.bot.setStatus(`withdrawing ${FOOD_NAME}`);
        for (let guard = 0; guard < 12 && Inventory.count(FOOD_NAME) < FOOD_WITHDRAW && !Inventory.isFull(); guard++) {
            const need = FOOD_WITHDRAW - Inventory.count(FOOD_NAME);
            const op = need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1';
            const before = Inventory.count(FOOD_NAME);
            await Bank.withdraw(FOOD_NAME, op);
            if (!(await Execution.delayUntil(() => Inventory.count(FOOD_NAME) > before, 2500))) {
                break; // bank out of this food, or the button didn't fire
            }
        }

        const got = Inventory.count(FOOD_NAME);
        if (got === 0) {
            this.bot.noteBankEmpty(true);
            this.bot.log(`WARNING: no '${FOOD_NAME}' in the bank — falling back to no-food combat. Deposit food (or fix the food name) and it'll resume eating.`);
        } else {
            this.bot.countBankTrip();
            this.bot.log(`withdrew ${got} ${FOOD_NAME} — walking back to the field`);
        }

        this.bot.setStatus('food restocked — walking back to the field');
        await Traversal.walkResilient(FIELD, { radius: 4, attempts: 6, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) });
        this.bot.clearWakes();
    }
}

/** Web-walk to the field when we're not in it (start, post-death, post-bank). */
class GoToField implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        const here = Game.tile();
        return here !== null && !inField(Tile.from(here));
    }

    async execute(): Promise<void> {
        this.bot.setStatus('walking to the field');
        const ok = await Traversal.walkResilient(FIELD, { radius: 4, attempts: 6, timeoutMs: 240_000, log: m => this.bot.log(`  ${m}`) });
        if (ok) {
            this.bot.clearWakes();
        }
    }
}

/** Nearest valuable drop in the field (a configured loot name), or null. */
function findLoot() {
    return GroundItems.query()
        .where(g => LOOT_NAMES.includes((g.name ?? '').toLowerCase()))
        .within(FIELD_RADIUS)
        .nearest();
}

/** Grab the nearest valuable drop; resolves true if the pack grew. */
async function lootOnce(bot: RockCrab): Promise<boolean> {
    const drop = findLoot();
    if (!drop) {
        return false;
    }
    bot.setStatus(`looting ${drop.name} at ${drop.tile()}`);
    const before = Inventory.used();
    await drop.interact('Take');
    if (await Execution.delayUntil(() => Inventory.used() > before, 5000)) {
        bot.countLoot();
        bot.log(`looted ${drop.name}`);
        return true;
    }
    return false;
}

class LootValuables implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        return !Inventory.isFull() && findLoot() !== null;
    }

    async execute(): Promise<void> {
        await lootOnce(this.bot);
    }
}

/** After the stack is built, run back to the field centre so the crabs pile up there. */
class RegroupAtField implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        // only once we've stacked enough and we're healthy; Eat/ResetAggro own low HP
        return hpFraction() >= FIGHT_HP_GATE && stackReady() && !atCentre();
    }

    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return; // runtime event guard takes over next loop
        }
        this.bot.setStatus('regrouping — running back to the field centre');
        // scene-local walk; the aggroed crabs chase us to the centre
        await DirectNavigator.walkTo(FIELD, CENTRE_RADIUS, 30000);
    }
}

/** Clear the stacked crabs at the centre; eats mid-fight when HP dips. */
class Fight implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        if (hpFraction() < FIGHT_HP_GATE) {
            return false; // too low to keep fighting — Eat or ResetAggro takes over
        }
        // Clear the pile only once it's stacked to size (or there are no more
        // rocks to gather). RegroupAtField runs first to drag the stack to the
        // centre; while still gathering, Aggro keeps priority.
        return stackReady();
    }

    async execute(): Promise<void> {
        this.bot.setStatus('fighting the stack');

        const deadline = performance.now() + 120000;
        while (performance.now() < deadline) {
            if (EventSignal.pending()) {
                return; // runtime event guard takes over next loop
            }
            if (this.bot.died || ChatDialog.canContinue()) {
                return;
            }
            // eat mid-fight so we sustain without leaving the pile
            if (hpFraction() < EAT_HP && hasFood()) {
                await eatOnce(this.bot);
                continue;
            }
            if (hpFraction() < FIGHT_HP_GATE) {
                return; // out of food and low — Eat/ResetAggro handles it next loop
            }

            // grab valuable drops as they fall, without waiting for the whole
            // stack to clear (the crabs keep auto-retaliating while we step over)
            if (!Inventory.isFull() && findLoot() !== null) {
                await lootOnce(this.bot);
                continue;
            }

            const crab = activeCrabs().sort((a, b) => a.distance() - b.distance())[0];
            if (!crab) {
                return; // stack cleared
            }

            if (!Game.inCombat()) {
                await crab.interact('Attack');
                await Execution.delayUntil(() => Game.inCombat() || activeCrabs().length === 0, 4000);
            } else {
                await Execution.delayTicks(2);
            }

            // count kills by watching the active-crab population fall
            const remaining = activeCrabs().length;
            if (remaining < this.lastCount) {
                for (let i = 0; i < this.lastCount - remaining; i++) {
                    this.bot.countKill();
                }
                this.bot.log(`rock crab down — ${this.bot.killsTotal()} kills total`);
            }
            this.lastCount = remaining;
        }
    }

    private lastCount = 0;
}

/** Walk adjacent to a dormant Rocks to wake it into an attacking Rock Crab. */
class Aggro implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        if (hpFraction() < FIGHT_HP_GATE || this.bot.deAggroed()) {
            return false;
        }
        return activeCrabs().length < DESIRED_STACK && dormantRocks().length > 0;
    }

    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return; // runtime event guard takes over next loop
        }
        const rocks = dormantRocks().sort((a, b) => a.distance() - b.distance())[0];
        if (!rocks) {
            return;
        }

        this.bot.setStatus(`waking rocks at ${rocks.tile()}`);
        const before = activeCrabs().length;
        const rockTile = rocks.tile();

        // walk adjacent (radius 1) — proximity fires the crab's approach AI
        await DirectNavigator.walkTo(rockTile, 1, 15000);
        // give the engine a couple ticks to flip it active
        const woke = await Execution.delayUntil(() => activeCrabs().length > before || !dormantRocks().some(r => r.tile().equals(rockTile)), 4000);

        this.bot.noteWake(woke);
        if (woke) {
            this.bot.log(`woke a rock crab — stack now ${activeCrabs().length}`);
        } else {
            this.bot.log(`rocks at ${rockTile} did not wake (${this.failsLabel()})`);
        }
    }

    private failsLabel(): string {
        return this.bot.deAggroed() ? 'area de-aggroed — will reset' : 'retrying';
    }
}

/** Run out of the field and back to reset aggression, or (with no food) to regen HP. */
class ResetAggro implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        // reset when the rocks stopped waking, or when we're low with no food to
        // eat (the no-food fallback: drop aggro at the reset tile and regen)
        return this.bot.deAggroed() || (hpFraction() < FIGHT_HP_GATE && !hasFood() && !Game.inCombat());
    }

    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return; // runtime event guard takes over next loop
        }
        const low = hpFraction() < FIGHT_HP_GATE;
        this.bot.setStatus(low ? 'low HP, no food — retreating to regen' : 'running out to reset aggression');
        this.bot.countReset();

        await DirectNavigator.walkTo(RESET_TILE, 1, 60000);

        if (low) {
            this.bot.log(`resting at the reset tile (${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp)`);
            await Execution.delayUntil(() => hpFraction() >= REST_HP, 120000);
        } else {
            // brief pause so the crabs fully revert before we walk back in
            await Execution.delayTicks(3);
        }

        await DirectNavigator.walkTo(FIELD, 3, 60000);
        this.bot.clearWakes();
        this.bot.log('back in the field');
    }
}
