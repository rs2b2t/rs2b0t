import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Skills } from '../api/hud/Skills.js';
import { Traversal } from '../api/Traversal.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import { reader } from '../adapter/ClientAdapter.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';

const MONKEYBARS_APPROACH = new Tile(3121, 9964, 0);

const RESTOCK_DUNGEON = 'Dungeon ladder (out of food)';
const RESTOCK_DEATH = 'After death only';

export const EDGEVILLE_MONKEYBARS_SETTINGS: SettingsSchema = {
    food: { type: 'string', default: 'Lobster', label: 'Food' },
    foodAmount: { type: 'number', default: 20, min: 5, max: 28, label: 'Food to withdraw' },
    eatAtHp: { type: 'number', default: 40, min: 1, max: 100, label: 'Eat below HP %' },
    eatToHp: {
        type: 'number',
        default: 90,
        min: 1,
        max: 100,
        label: 'Eat up to HP %',
        help: 'keep eating until HP reaches this value — avoids overheal waste. Damage from skeletons can stack during agility animations; set higher if you die frequently.'
    },
    smartEat: {
        type: 'boolean',
        default: false,
        label: 'Smart eat (avoid overheal)',
        help: 'calculate exactly how many foods to eat based on heal amount — avoids wasting food waiting to heal past the target.'
    },
    smartEatHealAmount: {
        type: 'number',
        default: 12,
        min: 1,
        max: 100,
        label: 'Food heal amount',
        help: 'how much HP each food restores (Lobster = 12). Only used when smart eat is enabled.'
    },
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
        default: RESTOCK_DUNGEON,
        options: [RESTOCK_DUNGEON, RESTOCK_DEATH],
        label: 'Restock mode',
        help: 'Dungeon ladder: climb out near 3096,9868 when food runs out. After death only: stay until death, then bank from surface.'
    } as SettingsSchema[string],
    monkeybarsApproach: {
        type: 'tile',
        // plain {x,z,level} is what the panel serializes; settings.tile() needs a real Tile fallback
        default: { x: MONKEYBARS_APPROACH.x, z: MONKEYBARS_APPROACH.z, level: MONKEYBARS_APPROACH.level },
        label: 'Monkey Bars Approach Tile'
    },
    barsName: {
        type: 'string',
        default: 'Monkeybars',
        label: 'Monkey bars loc name',
        help: 'exact display name if known; blank/wrong still falls back to swing-like ops nearby'
    },
    barsOp: {
        type: 'string',
        default: 'Swing across',
        label: 'Monkey bars op',
        help: 'preferred op; if missing the bot uses the first swing-like action on the loc'
    },
    searchRadius: { type: 'number', default: 15, min: 4, max: 30, label: 'Bars search radius' },
};

const UNDERGROUND_Z = 6400; // dungeon tiles sit above this; surface below it
// stand adjacent to the trapdoor (same as ChaosDruidKiller); closed offers "Open", open offers "Climb-down"
const TRAPDOOR = { name: 'Trapdoor', stand: new Tile(3096, 3468, 0) };
// dungeon exit ladder under Edgeville (ChaosDruidKiller uses 3096,9867)
const LADDER = { name: 'Ladder', op: 'Climb-up', stand: new Tile(3096, 9868, 0) };
const INTERMEDIATE_GATE = new Tile(3103, 9909, 0);
const WILDERNESS_GATE = new Tile(3130, 9914, 0);
const EDGEVILLE_BANK = new Tile(3094, 3493, 0);

// chatbox-docked paint
const PAINT = {
    x: 8, y: 345, w: 506, h: 150,
    pad: 8, line: 16, titleH: 20,
    bg: 'rgba(12, 12, 14, 0.88)',
    bgTitle: 'rgba(28, 28, 34, 0.95)',
    fg: '#cdd3da',
    fgDim: '#8a919a',
    border: 'rgba(90, 90, 100, 0.8)',
    accent: '#9be05b',
};

type PaintApi = {
    publishRegions(regions: { id: string; x: number; y: number; w: number; h: number; kind: 'panel' | 'widget' }[]): void;
    consumeClick(id: string): boolean;
    isHovered(rect: { x: number; y: number; w: number; h: number }): boolean;
    get(key: string, fallback: string): string;
    set(key: string, value: string): void;
};

type Rs2b0tDev = {
    actions?: { ifButton?: (comId: number) => boolean };
    paint?: PaintApi;
};

function paintApi(): PaintApi | null {
    return (globalThis as { rs2b0t?: Rs2b0tDev }).rs2b0t?.paint ?? null;
}

function ifButton(comId: number): boolean {
    const dev = (globalThis as { rs2b0t?: Rs2b0tDev }).rs2b0t;
    return dev?.actions?.ifButton?.(comId) ?? false;
}

function fmtDuration(mins: number): string {
    const t = Math.max(0, Math.floor(mins * 60));
    return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function foodCount(food: string): number {
    const want = food.toLowerCase();
    return Inventory.items().filter(i => i.name?.toLowerCase().includes(want)).length;
}

function restockMode(bot: EdgevilleMonkeyBars): string {
    return bot.settings.str('restockMode', RESTOCK_DUNGEON);
}

function needsFoodRestock(bot: EdgevilleMonkeyBars): boolean {
    if (restockMode(bot) === RESTOCK_DEATH) {
        return false;
    }
    const min = bot.settings.num('minFood', 1);
    if (min <= 0) {
        return false;
    }
    return foodCount(bot.settings.str('food', 'Lobster')) < min;
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

function findMonkeyBars(bot: EdgevilleMonkeyBars): Loc | null {
    const radius = bot.settings.num('searchRadius', 15);
    const preferredName = bot.settings.str('barsName', 'Monkeybars').trim();
    const preferredOp = bot.settings.str('barsOp', 'Swing across').trim();

    // 1) preferred name + preferred/swing op
    if (preferredName) {
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
    type IfEntry = { text?: string; children?: number[] };
    type IfTypeList = Record<number, IfEntry>;

    const client = reader as { client?: { IfType?: { list: IfTypeList } } };
    const IfType = client?.client?.IfType?.list;
    if (!IfType) {
        log('IfType not accessible — cannot toggle retaliate');
        return;
    }

    // Find the parent group that contains "Auto retaliate" text, then locate the Off button.
    // The RS3 options combat panel has a consistent structure:
    //   text "Run" / Off / On / text "Auto retaliate" / Off / On
    // Retaliate-Off is children[6], Retaliate-On is children[7].
    for (const rootIdx of Object.keys(IfType)) {
        const root = IfType[Number(rootIdx)];
        if (!root?.children || root.children.length < 8) continue;
        const hasRetaliate = root.children.some((c: number) => IfType[c]?.text === 'Auto retaliate');
        if (!hasRetaliate) continue;
        // Retaliate Off is children[6].
        const retaliateOff = root.children[6];
        ifButton(retaliateOff);
        log('Auto Retaliate turned off');
        break;
    }
}

async function openNearestGate(log: (m: string) => void): Promise<void> {
    const gate = Locs.query().name('Gate').within(6).nearest();
    if (!gate) {
        return;
    }
    const op = gate.actions().find(a => /open/i.test(a));
    if (!op) {
        return;
    }
    log(`Opening gate: ${op}`);
    await gate.interact(op);
    await Execution.delayTicks(2);
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

/**
 * Walk from the wildy monkey-bars side back through the dungeon gates to the ladder,
 * then climb out. Order is reverse of NavigateToMonkeyBars.
 */
async function exitDungeonToSurface(log: (m: string) => void): Promise<boolean> {
    if ((Game.tile()?.z ?? 0) < UNDERGROUND_Z) {
        return true;
    }

    // reverse path: approach → wildy gate → intermediate gate → ladder
    await Traversal.walkResilient(WILDERNESS_GATE, { radius: 4 });
    await openNearestGate(log);

    await Traversal.walkResilient(INTERMEDIATE_GATE, { radius: 4 });
    await openNearestGate(log);

    return climbDungeonLadder(log);
}

class EdgevilleMonkeyBars extends TaskBot {
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private paintCollapsed = false;
    deaths = 0;
    completions = 0;
    eats = 0;
    failedSwings = 0;
    died = false;

    override async onStart() {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('agility');
        const paint = paintApi();
        this.paintCollapsed = paint?.get('paint:collapsed', '0') === '1';

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
                this.deaths++;
                this.log('Death detected');
            }
        });

        // Check inventory on startup — if no food is present, BankAndRestock will run first
        // (validate returns true when no food on surface for any restock mode).
        const foodName = this.settings.str('food', 'Lobster').toLowerCase();
        const hasFood = Inventory.items().some(i => i.name?.toLowerCase().includes(foodName));
        if (!hasFood) {
            this.log(`No ${this.settings.str('food', 'Lobster')} in inventory — banking first`);
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
        const { x, y, w, h, pad, line, titleH, bg, bgTitle, fg, fgDim, border, accent } = PAINT;
        const paint = paintApi();
        const regions: { id: string; x: number; y: number; w: number; h: number; kind: 'panel' | 'widget' }[] = [];

        ctx.textBaseline = 'middle';
        ctx.font = 'bold 12px monospace';

        // title bar + collapse toggle (same hit-target as internal Paint)
        ctx.fillStyle = bgTitle;
        ctx.fillRect(x, y, w, titleH);
        ctx.strokeStyle = border;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, titleH - 1);
        ctx.fillStyle = accent;
        ctx.fillText(`EdgevilleMonkeyBars — ${this.status}`, x + pad, y + titleH / 2 + 1);

        const toggle = { x: x + w - titleH, y, w: titleH, h: titleH };
        const hovered = paint?.isHovered(toggle) ?? false;
        ctx.fillStyle = hovered ? fg : fgDim;
        ctx.fillText(this.paintCollapsed ? '+' : '–', toggle.x + 7, toggle.y + titleH / 2 + 1);
        regions.push({ id: 'paint:toggle', ...toggle, kind: 'widget' });
        if (paint?.consumeClick('paint:toggle')) {
            this.paintCollapsed = !this.paintCollapsed;
            paint.set('paint:collapsed', this.paintCollapsed ? '1' : '0');
        }

        if (this.paintCollapsed) {
            regions.push({ id: 'paint:panel', x, y, w, h: titleH, kind: 'panel' });
            paint?.publishRegions(regions);
            return;
        }

        regions.push({ id: 'paint:panel', x, y, w, h, kind: 'panel' });

        // body
        ctx.fillStyle = bg;
        ctx.fillRect(x, y + titleH, w, h - titleH);
        ctx.strokeStyle = border;
        ctx.strokeRect(x + 0.5, y + titleH + 0.5, w - 1, h - titleH - 1);

        ctx.font = '12px monospace';
        ctx.fillStyle = fg;
        let cy = y + titleH + 4;
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5
            ? `${(((Skills.xp('agility') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k`
            : '—';
        const food = this.settings.str('food', 'Lobster');
        const colW = (w - pad * 2) / 3;
        const mode = restockMode(this) === RESTOCK_DEATH ? 'death' : 'dungeon';

        const row = (...cols: string[]) => {
            cols.forEach((c, i) => ctx.fillText(c, x + pad + i * colW, cy + line / 2 + 1));
            cy += line;
        };

        row(`Runtime: ${fmtDuration(mins)}`, `Swings: ${this.completions}`, `XP/hr: ${xph}`);
        row(`Food: ${foodCount(food)}`, `Ate: ${this.eats}`, `Deaths: ${this.deaths}`);
        row(`Misses: ${this.failedSwings}`, `Restock: ${mode}`, `HP: ${Math.round(Skills.hpFraction() * 100)}%`);

        // HP bar
        const frac = Math.max(0, Math.min(1, Skills.hpFraction()));
        const labelW = 48;
        const barX = x + pad + labelW;
        const barW = w - pad * 2 - labelW - 42;
        const barY = cy + 3;
        ctx.fillStyle = fg;
        ctx.fillText('HP', x + pad, cy + line / 2 + 1);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(barX, barY, barW, line - 6);
        ctx.fillStyle = frac < 0.35 ? '#e05b5b' : frac < 0.65 ? '#e8c35b' : '#69c86b';
        ctx.fillRect(barX, barY, barW * frac, line - 6);
        ctx.fillStyle = fgDim;
        ctx.fillText(`${Math.round(frac * 100)}%`, barX + barW + 6, cy + line / 2 + 1);

        paint?.publishRegions(regions);
    }
}

class EatFood implements Task {
    private ateThisCycle = false;

    constructor(private bot: EdgevilleMonkeyBars) {}

    validate() {
        if (this.bot.died) {
            return false;
        }
        const hp = Skills.hpFraction();
        const eatAt = this.bot.settings.num('eatAtHp', 40) / 100;
        const eatTo = this.bot.settings.num('eatToHp', 90) / 100;

        // If HP climbs back above eatAt, reset the cycle so we can eat again on the next dip.
        if (hp >= eatAt) {
            this.ateThisCycle = false;
        }

        // Only eat once per dip below eatAt — eat up to eatTo, then stop.
        if (hp >= eatTo || this.ateThisCycle) {
            return false;
        }
        const foodName = this.bot.settings.str('food', 'Lobster').toLowerCase();
        return Inventory.items().some(i => i.name?.toLowerCase().includes(foodName));
    }
    async execute() {
        this.bot.setStatus('eating');
        const foodName = this.bot.settings.str('food', 'Lobster').toLowerCase();
        const eatTo = this.bot.settings.num('eatToHp', 90) / 100;

        // Determine how many foods to eat.
        const smartEat = this.bot.settings.bool('smartEat', false);
        let foodsToEat = Infinity;
        if (smartEat) {
            const healAmount = this.bot.settings.num('smartEatHealAmount', 12);
            const hpMax = Skills.level('hitpoints'); // max HP = HP level in OSRS
            const hpCurrent = Skills.effective('hitpoints');
            const hpTarget = eatTo * hpMax;
            const hpNeeded = Math.max(0, hpTarget - hpCurrent);
            foodsToEat = Math.ceil(hpNeeded / healAmount);
        }

        let eaten = 0;
        // Eat one food at a time until we reach eatTo, food count limit, or run out of food.
        while ((smartEat ? eaten < foodsToEat : true) && Skills.hpFraction() < eatTo) {
            const food = Inventory.items().find(i => i.name?.toLowerCase().includes(foodName));
            if (!food) {
                break;
            }

            const before = Skills.effective('hitpoints');
            await food.interact('Eat');
            if (await Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000)) {
                this.bot.countEat();
                eaten++;
            }
        }
        this.ateThisCycle = true;

        // OSRS enforces a 3-tick (1.8s) penalty between eating; wait so the next agility
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
        const foodName = this.bot.settings.str('food', 'Lobster').toLowerCase();
        const fc = foodCount(this.bot.settings.str('food', 'Lobster'));
        const min = this.bot.settings.num('minFood', 1);
        if (fc < min && (Game.tile()?.z ?? 0) < UNDERGROUND_Z) {
            // Below minimum food on the surface — bank before heading into the dungeon (works for both restock modes).
            return true;
        }
        return needsFoodRestock(this.bot);
    }
    async execute() {
        const log = (m: string) => this.bot.log(m);
        const foodName = this.bot.settings.str('food', 'Lobster').toLowerCase();
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
            await Bank.depositInventory();
            const foodName = this.bot.settings.str('food', 'Lobster');
            const amt = this.bot.settings.num('foodAmount', 20);
            for (let i = 0; i < amt; i++) {
                await Bank.withdraw(foodName, 'Withdraw-1');
                await Execution.delayTicks(1);
            }
            const afterCount = foodCount(foodName);
            const minFood = this.bot.settings.num('minFood', 1);
            if (afterCount < minFood) {
                log(`only ${afterCount} ${foodName} in bank (minimum ${minFood}) — stopping (sending bot to its own death is not useful)`);
                this.bot.setStatus(`out of ${foodName} in bank — stopped`);
                ScriptRunner.stop();
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
        const approach = this.bot.settings.tile('monkeybarsApproach', MONKEYBARS_APPROACH);
        return new Tile(here.x, here.z, here.level).distanceTo(approach) > 12;
    }

    async execute() {
        this.bot.setStatus('navigating to monkey bars');
        this.bot.log('Starting dungeon navigation sequence');
        const log = (m: string) => this.bot.log(m);
        const approach = this.bot.settings.tile('monkeybarsApproach', MONKEYBARS_APPROACH);

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
        await Traversal.walkResilient(approach, { radius: 3 });
        this.bot.log('Reached monkey bars area');
    }
}

class RepeatMonkeyBars implements Task {
    private lastScanLog = 0;

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
        const preferredOp = this.bot.settings.str('barsOp', 'Swing across').trim();
        const bars = findMonkeyBars(this.bot);

        if (!bars) {
            // periodic diagnostic so we can learn the real loc name/ops live
            const now = Date.now();
            if (now - this.lastScanLog > 8000) {
                this.lastScanLog = now;
                const nearby = Locs.query()
                    .within(this.bot.settings.num('searchRadius', 15))
                    .where(l => l.actions().length > 0)
                    .results()
                    .slice(0, 8)
                    .map(l => `${l.name ?? '?'}@${l.tile().x},${l.tile().z}[${l.actions().join('|')}]`);
                this.bot.log(`No monkey bars found nearby${nearby.length ? ` — nearby: ${nearby.join('; ')}` : ''}`);
            }
            this.bot.setStatus('waiting: no monkey bars in range');
            // nudge toward approach so we don't idle off-angle
            const approach = this.bot.settings.tile('monkeybarsApproach', MONKEYBARS_APPROACH);
            const here = Game.tile();
            if (here && new Tile(here.x, here.z, here.level).distanceTo(approach) > 4) {
                await Traversal.walkResilient(approach, { radius: 2 });
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

        const beforeXp = Skills.xp('agility');
        const beforeTile = Game.tile();
        this.bot.setStatus(`${op} ${bars.name ?? 'bars'} @ ${bars.tile().x},${bars.tile().z}`);
        this.bot.log(`Interacting bars: ${op} on '${bars.name}' @ ${bars.tile().x},${bars.tile().z} actions=[${bars.actions().join(', ')}]`);

        const clicked = await bars.interact(op);
        if (!clicked) {
            this.bot.log(`interact('${op}') returned false`);
            this.bot.countFailedSwing();
            await Execution.delayTicks(2);
            return;
        }

        // success = agility XP (not HP damage — skeletons hit constantly here)
        const progressed = await Execution.delayUntil(() => {
            if (this.bot.died) {
                return true; // bail early — no XP coming after death
            }
            if (Skills.xp('agility') > beforeXp) {
                return true;
            }
            const t = Game.tile();
            // also accept a clear tile change while animating (swing traversal)
            if (beforeTile && t && (t.x !== beforeTile.x || t.z !== beforeTile.z) && Game.animating()) {
                return false; // keep waiting for XP / settle
            }
            return false;
        }, 12_000);

        if (this.bot.died) {
            return; // let the task scheduler pick up BankAndRestock immediately
        }

        // settle animation
        let last = Game.tile();
        for (let i = 0; i < 20; i++) {
            if (this.bot.died) {
                return;
            }
            await Execution.delayTicks(1);
            const now = Game.tile();
            if (now && last && now.x === last.x && now.z === last.z && !Game.animating()) {
                break;
            }
            last = now;
        }

        if (Skills.xp('agility') > beforeXp || progressed) {
            this.bot.countCompletion();
            this.bot.log(`Swing complete (+${Skills.xp('agility') - beforeXp} xp)`);
        } else {
            this.bot.countFailedSwing();
            this.bot.log('Swing produced no agility XP — retrying');
        }
    }
}

export default EdgevilleMonkeyBars;
