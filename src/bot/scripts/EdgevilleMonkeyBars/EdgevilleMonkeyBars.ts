import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Bank } from '../../api/bank/Bank.js';
import { Skills } from '../../api/skills/Skills.js';
import { Paint } from '../../paint/Paint.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Locs, type Loc } from '../../api/locs/Locs.js';
import { actions, reader } from '../../adapter/ClientAdapter.js';
import { depositAllExcept } from '../../api/bank/Banking.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { foodHealAmount, shouldEatToUseFood } from '../../api/combat/food.js';
import { scriptFood } from '../../api/loadout/loadoutPlan.js';
import { LOADOUT_SETTING } from '../../api/loadout/loadoutSetting.js';

const MONKEYBARS_APPROACH = new Tile(3121, 9964, 0);
const MIN_AGILITY = 15; // required to swing across the monkey bars

const FALLBACK_FOOD = 'Lobster';

const RESTOCK_DUNGEON = 'Dungeon ladder (out of food)';
const RESTOCK_DEATH = 'After death only';

export const EDGEVILLE_MONKEYBARS_SETTINGS: SettingsSchema = {
    loadout: LOADOUT_SETTING,
    foodAmount: { type: 'number', default: 20, min: 5, max: 28, label: 'Food to withdraw' },
    minFood: {
        type: 'number',
        default: 1,
        min: 0,
        max: 28,
        label: 'Bank below food count',
        help: 'minimum food to have before heading into the dungeon; 0 = never bank for food (used at startup and during dungeon restocks)'
    },
    restockMode: {
        type: 'string',
        default: RESTOCK_DEATH,
        options: [RESTOCK_DUNGEON, RESTOCK_DEATH],
        label: 'Restock mode',
        help: 'Dungeon ladder: climb out near 3096,9868 when food runs out. After death only: stay until death, then bank from surface.'
    } as SettingsSchema[string],
    bankJunk: {
        type: 'boolean',
        default: true,
        label: 'Bank junk items',
        help: 'deposit anything that isn\'t the selected food (e.g. random event loot) when banking'
    },
};

const UNDERGROUND_Z = 6400; // dungeon tiles sit above this; surface below it
// stand adjacent to the trapdoor (same as ChaosDruidKiller); closed offers "Open", open offers "Climb-down"
const TRAPDOOR = { name: 'Trapdoor', stand: new Tile(3096, 3468, 0) };
// dungeon exit ladder under Edgeville (ChaosDruidKiller uses 3096,9867)
const LADDER = { name: 'Ladder', op: 'Climb-up', stand: new Tile(3096, 9868, 0) };
const INTERMEDIATE_GATE = new Tile(3103, 9909, 0);
const WILDERNESS_GATE = new Tile(3130, 9914, 0);
const EDGEVILLE_BANK = new Tile(3094, 3493, 0);

function fmtDuration(mins: number): string {
    const t = Math.max(0, Math.floor(mins * 60));
    return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function foodCount(food: string): number {
    const want = food.toLowerCase();
    return Inventory.items().filter(i => i.name?.toLowerCase().includes(want)).length;
}

function restockMode(bot: EdgevilleMonkeyBars): string {
    return bot.settings.str('restockMode', RESTOCK_DEATH);
}

function needsFoodRestock(bot: EdgevilleMonkeyBars): boolean {
    if (restockMode(bot) === RESTOCK_DEATH) {
        return false;
    }
    const min = bot.settings.num('minFood', 1);
    if (min <= 0) {
        return false;
    }
    return foodCount(scriptFood(bot.settings, FALLBACK_FOOD)) < min;
}

function swingOp(actions: string[], preferred?: string): string | undefined {
    if (preferred) {
        const exact = actions.find(a => a.toLowerCase() === preferred.toLowerCase());
        if (exact) {
            return exact;
        }
    }
    return actions.find(a => /swing|cross|climb-across|balance/i.test(a));
}

function looksLikeBars(loc: Loc, preferredName?: string): boolean {
    const name = (loc.name ?? '').toLowerCase();
    if (preferredName && name === preferredName.toLowerCase()) {
        return true;
    }
    if (/monkey|bars?/.test(name)) {
        return true;
    }
    return swingOp(loc.actions()) !== undefined;
}

function findMonkeyBars(_bot: EdgevilleMonkeyBars): Loc | null {
    const radius = 15;
    const preferredName = 'Monkeybars';
    const preferredOp = 'Swing across';

    // 1) preferred name + preferred/swing op
    const byName = Locs.query()
        .name(preferredName)
        .within(radius)
        .where(l => swingOp(l.actions(), preferredOp) !== undefined)
        .nearest();
    if (byName) {
        return byName;
    }
    const named = Locs.query().name(preferredName).within(radius).where(l => l.actions().length > 0).nearest();
    if (named) {
        return named;
    }

    // 2) any loc offering a swing-like op
    const byOp = Locs.query()
        .within(radius)
        .where(l => swingOp(l.actions(), preferredOp) !== undefined)
        .nearest();
    if (byOp) {
        return byOp;
    }

    // 3) name contains monkey/bars
    return Locs.query()
        .within(radius)
        .where(l => looksLikeBars(l, preferredName) && l.actions().length > 0)
        .nearest();
}

/** Ensure Auto Retaliate is turned off (prevents fighting back while doing agility). */
async function ensureRetaliateOff(log: (m: string) => void): Promise<void> {
    const controls = reader.retaliateControls();
    if (!controls) {
        log('retaliateControls not available — cannot toggle auto retaliate');
        return;
    }

    const result = actions.ifButton(controls.offComId);
    log(`Auto Retaliate turned off (comId: ${controls.offComId}, result: ${result})`);
}

async function openNearestGate(log: (m: string) => void): Promise<void> {
    const gate = Locs.query().name('Gate').within(6).nearest();
    if (!gate) {
        log('No gate found nearby — may already be open or out of range');
        return;
    }
    const op = gate.actions().find(a => /open/i.test(a));
    if (!op) {
        log(`Gate found but no "Open" action (actions: [${gate.actions().join(', ')}]) — likely already open`);
        return;
    }
    log(`Opening gate: ${op} @ ${gate.tile().x},${gate.tile().z}`);
    await gate.interact(op);
    // Wait for gate animation to finish before pathing through.
    await Execution.delayTicks(4);
}

/** Climb the Edgeville dungeon ladder back to the surface. */
async function climbDungeonLadder(log: (m: string) => void): Promise<boolean> {
    if ((Game.tile()?.z ?? 0) < UNDERGROUND_Z) {
        return true;
    }

    await Traversal.walkResilient(LADDER.stand, { radius: 2 });
    for (let attempt = 0; attempt < 5; attempt++) {
        if ((Game.tile()?.z ?? 0) < UNDERGROUND_Z) {
            return true;
        }
        const ladder = Locs.query()
            .name(LADDER.name)
            .within(8)
            .where(l => l.actions().some(a => /climb-up/i.test(a)))
            .nearest()
            ?? Locs.query().name(LADDER.name).within(8).nearest();
        if (!ladder) {
            log('Ladder not found near exit — retrying walk');
            await Traversal.walkResilient(LADDER.stand, { radius: 1 });
            continue;
        }
        const op = ladder.actions().find(a => /climb-up/i.test(a)) ?? LADDER.op;
        log(`Climbing ladder: ${op} on '${ladder.name}' @ ${ladder.tile().x},${ladder.tile().z}`);
        await ladder.interact(op);
        if (await Execution.delayUntil(() => (Game.tile()?.z ?? 0) < UNDERGROUND_Z, 8000)) {
            log('Climbed to surface');
            return true;
        }
    }
    return (Game.tile()?.z ?? 0) < UNDERGROUND_Z;
}

// Why: the order is the reverse of NavigateToMonkeyBars.
// Why: the gates may already be open from entry, so walking through is tried first.

/** Walks from the wildy monkey-bars side back through the dungeon gates to the ladder, then climbs out. */
async function exitDungeonToSurface(log: (m: string) => void): Promise<boolean> {
    if ((Game.tile()?.z ?? 0) < UNDERGROUND_Z) {
        return true;
    }

    // Why: after a swing the bot may land on the far, wilder side of the bars (~3121,9969).
    // Why: the exit path runs through the gates toward lower Z, so it must start on the approach side (~3121,9964) and swing back when past the bars at z > 9967.
    const here = Game.tile();
    if (here && here.z > 9967) {
        log('On far side of monkey bars — swinging back toward exit before leaving dungeon');
        const bars = Locs.query()
            .within(10)
            .where(l => swingOp(l.actions()) !== undefined)
            .nearest();
        if (bars) {
            const op = swingOp(bars.actions()) ?? bars.actions()[0];
            if (op) {
                log(`Swinging back: ${op} on '${bars.name}' @ ${bars.tile().x},${bars.tile().z}`);
                await bars.interact(op);
                // wait for swing animation to settle
                await Execution.delayUntil(() => false, 12_000);
            }
        }
    }

    // reverse path: wildy gate → intermediate gate → ladder
    // Gates may already be open; try to open them (harmless if already open), then walk through.
    log('Exiting dungeon — approaching wilderness gate');
    await Traversal.walkResilient(WILDERNESS_GATE, { radius: 3 });
    await openNearestGate(log);

    log('Exiting dungeon — approaching intermediate gate');
    await Traversal.walkResilient(INTERMEDIATE_GATE, { radius: 3 });
    await openNearestGate(log);

    log('Exiting dungeon — approaching ladder');
    return climbDungeonLadder(log);
}

class EdgevilleMonkeyBars extends TaskBot {
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    deaths = 0;
    completions = 0;
    eats = 0;
    failedSwings = 0;
    died = false;

    override async onStart() {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const agility = Skills.level('agility');
        if (agility < MIN_AGILITY) {
            this.log(`EdgevilleMonkeyBars needs Agility ${MIN_AGILITY} (have ${agility}) — stopping.`);
            throw new Error(`EdgevilleMonkeyBars: Agility ${MIN_AGILITY} required`);
        }

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('agility');

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
                this.deaths++;
                this.log('Death detected');
            }
        });

        // Check inventory on startup — if no food is present, BankAndRestock will run first
        // (validate returns true when no food on surface for any restock mode).
        const foodName = scriptFood(this.settings, FALLBACK_FOOD).toLowerCase();
        const hasFood = Inventory.items().some(i => i.name?.toLowerCase().includes(foodName));
        if (!hasFood) {
            this.log(`No ${scriptFood(this.settings, FALLBACK_FOOD)} in inventory — banking first`);
        }

        // Ensure Auto Retaliate is off so we don't fight back while doing agility.
        await ensureRetaliateOff(m => this.log(m));

        this.log(`EdgevilleMonkeyBars started (restock: ${restockMode(this)}, hasFood: ${hasFood})`);
        this.add(
            new EatFood(this),
            new BankAndRestock(this),
            new NavigateToMonkeyBars(this),
            new RepeatMonkeyBars(this)
        );
    }

    setStatus(s: string) { this.status = s; }
    countEat() { this.eats++; }
    countCompletion() { this.completions++; }
    countFailedSwing() { this.failedSwings++; }

    override onPaint(ctx: CanvasRenderingContext2D) {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#9be05b' });
        p.title(`EdgevilleMonkeyBars — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5
            ? `${(((Skills.xp('agility') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k`
            : '—';
        const food = scriptFood(this.settings, FALLBACK_FOOD);
        const mode = restockMode(this) === RESTOCK_DEATH ? 'death' : 'dungeon';

        p.row(`Runtime: ${fmtDuration(mins)}`, `Swings: ${this.completions}`, `XP/hr: ${xph}`);
        p.row(`Food: ${foodCount(food)}`, `Ate: ${this.eats}`, `Deaths: ${this.deaths}`);
        p.row(`Misses: ${this.failedSwings}`, `Restock: ${mode}`);
        p.bar('HP', Skills.hpFraction());

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}

class EatFood implements Task {
    constructor(private bot: EdgevilleMonkeyBars) {}

    private foodName(): string {
        return scriptFood(this.bot.settings, FALLBACK_FOOD);
    }

    private heldFood(): number {
        const key = this.foodName().toLowerCase();
        return Inventory.items().filter(i => i.name?.toLowerCase().includes(key)).length;
    }

    private needEat(): boolean {
        return shouldEatToUseFood({
            hp: Skills.effective('hitpoints'),
            maxHp: Skills.level('hitpoints'),
            heal: foodHealAmount(this.foodName()),
            foodCount: this.heldFood()
        });
    }

    validate() {
        if (this.bot.died || Bank.isOpen()) {
            return false;
        }
        return this.needEat();
    }

    async execute() {
        this.bot.setStatus('eating');
        const key = this.foodName().toLowerCase();
        while (this.needEat()) {
            const food = Inventory.items().find(i => i.name?.toLowerCase().includes(key));
            if (!food) {
                break;
            }
            const before = Skills.effective('hitpoints');
            await food.interact('Eat');
            if (await Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000)) {
                this.bot.countEat();
            }
        }
        // OSRS enforces a 3-tick penalty between eating; wait so the next agility
        // action doesn't fire while the client is still processing the eat animation.
        await Execution.delayTicks(3);
    }
}

class BankAndRestock implements Task {
    constructor(private bot: EdgevilleMonkeyBars) {}
    validate() {
        // Bank when dead, or when food is low (dungeon mode), or when food is below minFood on the surface (startup check).
        if (this.bot.died) {
            return true;
        }
        const fc = foodCount(scriptFood(this.bot.settings, FALLBACK_FOOD));
        const min = this.bot.settings.num('minFood', 1);
        if (fc < min && (Game.tile()?.z ?? 0) < UNDERGROUND_Z) {
            // Below minimum food on the surface — bank before heading into the dungeon (works for both restock modes).
            return true;
        }
        return needsFoodRestock(this.bot);
    }
    async execute() {
        const log = (m: string) => this.bot.log(m);
        const foodName = scriptFood(this.bot.settings, FALLBACK_FOOD).toLowerCase();
        const hasAnyFood = Inventory.items().some(i => i.name?.toLowerCase().includes(foodName));

        // Out of food underground → reverse dungeon path + ladder climb (only in dungeon mode)
        if (!this.bot.died && !hasAnyFood && restockMode(this.bot) !== RESTOCK_DEATH && (Game.tile()?.z ?? 0) >= UNDERGROUND_Z) {
            this.bot.setStatus('exiting dungeon to bank');
            log('Out of food — exiting dungeon via ladder');
            if (!(await exitDungeonToSurface(log))) {
                log('Failed to climb dungeon ladder — will retry');
                return;
            }
        }

        const wasDead = this.bot.died;
        this.bot.setStatus(this.bot.died ? 'banking after death' : 'banking');
        await Traversal.walkResilient(EDGEVILLE_BANK, { radius: 5 });
        // openBooth/openNearest exist at runtime; package d.ts is a slim subset
        const bankApi = Bank as typeof Bank & {
            openBooth(stand: Tile, name: string, op: string, log?: (m: string) => void): Promise<boolean>;
            openNearest(name: string, op: string, log?: (m: string) => void): Promise<boolean>;
        };
        const opened = (await bankApi.openBooth(EDGEVILLE_BANK, 'Bank booth', 'Use-quickly', m => this.bot.log(`  ${m}`)))
            || (await bankApi.openNearest('Bank booth', 'Use-quickly', m => this.bot.log(`  ${m}`)));
        if (opened) {
            const foodName = scriptFood(this.bot.settings, FALLBACK_FOOD);
            if (this.bot.settings.bool('bankJunk', true)) {
                await Bank.depositAllMatching(depositAllExcept([foodName]));
            } else {
                await Bank.depositInventory();
            }
            const amt = this.bot.settings.num('foodAmount', 20);
            await Bank.withdrawX(foodName, amt);
            const afterCount = foodCount(foodName);
            const minFood = this.bot.settings.num('minFood', 1);
            if (afterCount < minFood) {
                this.bot.setStatus(`out of ${foodName} in bank — stopped`);
                ScriptRunner.stop(`only ${afterCount} ${foodName} in bank (minimum ${minFood}) — sending the bot to its own death is not useful`);
                return;
            }
            log(`Withdrew food (have ${afterCount})`);
        } else {
            log('Could not open bank — will retry');
            return;
        }
        // After death, ensure Auto Retaliate is off again.
        if (wasDead) {
            await ensureRetaliateOff(log);
        }
        this.bot.died = false;
    }
}

class NavigateToMonkeyBars implements Task {
    constructor(private bot: EdgevilleMonkeyBars) {}

    /** Only while away from the bars (surface, or underground but not near approach). */
    validate() {
        if (this.bot.died || needsFoodRestock(this.bot)) {
            return false;
        }
        const here = Game.tile();
        if (!here) {
            return false;
        }
        if ((here.z ?? 0) < UNDERGROUND_Z) {
            return true; // still on the surface
        }
        // already next to interactable bars — stay put
        if (findMonkeyBars(this.bot)) {
            return false;
        }
        return new Tile(here.x, here.z, here.level).distanceTo(MONKEYBARS_APPROACH) > 12;
    }

    async execute() {
        this.bot.setStatus('navigating to monkey bars');
        this.bot.log('Starting dungeon navigation sequence');
        const log = (m: string) => this.bot.log(m);

        // 1. Surface trapdoor → dungeon (Open, then Climb-down)
        if ((Game.tile()?.z ?? 0) < UNDERGROUND_Z) {
            await Traversal.walkResilient(TRAPDOOR.stand, { radius: 1 });
            this.bot.log('At trapdoor location');
            let descended = false;
            for (let attempt = 0; attempt < 6 && !descended; attempt++) {
                const trap = Locs.query().name(TRAPDOOR.name).where(l => l.distance() <= 3).nearest();
                if (!trap) {
                    await Traversal.walkResilient(TRAPDOOR.stand, { radius: 1 });
                    continue;
                }
                // closed trapdoor offers "Open"; opened one offers "Climb-down"
                const op = trap.actions().find(a => /climb-down/i.test(a))
                    ?? trap.actions().find(a => /open/i.test(a));
                if (!op) {
                    this.bot.log(`Trapdoor actions: [${trap.actions().join(', ')}]`);
                    await Execution.delayTicks(2);
                    continue;
                }
                this.bot.log(`Interacting trapdoor: ${op}`);
                await trap.interact(op);
                descended = await Execution.delayUntil(
                    () => (Game.tile()?.z ?? 0) >= UNDERGROUND_Z,
                    /open/i.test(op) ? 2500 : 6000
                );
            }
            if (!descended) {
                this.bot.log('Failed to climb down trapdoor — will retry');
                return;
            }
            this.bot.log('Descended into dungeon');
        }

        // 2. Intermediate gate, then wilderness gate
        await Traversal.walkResilient(INTERMEDIATE_GATE, { radius: 4 });
        await openNearestGate(log);

        await Traversal.walkResilient(WILDERNESS_GATE, { radius: 4 });
        await openNearestGate(log);

        // Final approach
        await Traversal.walkResilient(MONKEYBARS_APPROACH, { radius: 3 });
        this.bot.log('Reached monkey bars area');
    }
}

class RepeatMonkeyBars implements Task {
    private lastScanLog = 0;
    private lastXp = -1;

    constructor(private bot: EdgevilleMonkeyBars) {}

    validate() {
        if (this.bot.died || needsFoodRestock(this.bot)) {
            return false;
        }
        const here = Game.tile();
        return here !== null && (here.z ?? 0) >= UNDERGROUND_Z;
    }

    async execute() {
        this.bot.setStatus('swinging on monkey bars');

        // Why: spam mode does not wait for a swing to finish, so XP for a prior click lands on a later tick.
        // Why: a swing is counted whenever XP rose since the last loop iteration, not synchronously after the click.
        const xpNow = Skills.xp('agility');
        if (this.lastXp >= 0 && xpNow > this.lastXp) {
            this.bot.countCompletion();
            this.bot.log(`Swing complete (+${xpNow - this.lastXp} xp)`);
        }
        this.lastXp = xpNow;

        const preferredOp = 'Swing across';
        const bars = findMonkeyBars(this.bot);

        if (!bars) {
            // periodic diagnostic so we can learn the live loc name/ops live
            const now = Date.now();
            if (now - this.lastScanLog > 8000) {
                this.lastScanLog = now;
                const nearby = Locs.query()
                    .within(15)
                    .where(l => l.actions().length > 0)
                    .results()
                    .slice(0, 8)
                    .map(l => `${l.name ?? '?'}@${l.tile().x},${l.tile().z}[${l.actions().join('|')}]`);
                this.bot.log(`No monkey bars found nearby${nearby.length ? ` — nearby: ${nearby.join('; ')}` : ''}`);
            }
            this.bot.setStatus('waiting: no monkey bars in range');
            // nudge toward approach so we don't idle off-angle
            const here = Game.tile();
            if (here && new Tile(here.x, here.z, here.level).distanceTo(MONKEYBARS_APPROACH) > 4) {
                await Traversal.walkResilient(MONKEYBARS_APPROACH, { radius: 2 });
            } else {
                await Execution.delayTicks(2);
            }
            return;
        }

        const op = swingOp(bars.actions(), preferredOp) ?? bars.actions()[0];
        if (!op) {
            this.bot.log(`Bars '${bars.name}' has no actions`);
            await Execution.delayTicks(2);
            return;
        }

        this.bot.setStatus(`${op} ${bars.name ?? 'bars'} @ ${bars.tile().x},${bars.tile().z}`);
        this.bot.log(`Interacting bars: ${op} on '${bars.name}' @ ${bars.tile().x},${bars.tile().z} actions=[${bars.actions().join(', ')}]`);

        const clicked = await bars.interact(op);
        if (!clicked) {
            this.bot.log(`interact('${op}') returned false`);
            this.bot.countFailedSwing();
            return;
        }

        // Spam mode: no wait for completion — loop back and click again immediately.
        // Swing is counted on the next loop when the XP for this click lands.
    }
}

export default EdgevilleMonkeyBars;
