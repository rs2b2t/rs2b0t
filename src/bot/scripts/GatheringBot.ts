import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Equipment } from '../api/hud/Equipment.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Locs } from '../api/queries/Locs.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Traversal } from '../api/Traversal.js';
import { DirectNavigator } from '../nav/DirectNavigator.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { resolveLocation, type FishingLocation } from './FishingLocations.js';
import { BROKEN_PICKAXE, GAS_ROCK_IDS, GAS_ROCK_TICKS, ROCK_OPTIONS, bestPickaxe, resolveRockIds } from './MiningRocks.js';
import { FISHING_METHOD_OPTIONS, resolveFishMethod } from './FishingMethods.js';
import { Banking } from '../api/Banking.js';

/** Shared parameter schema for any gathering preset (mining, fishing, etc.). */
export const GATHERING_SETTINGS: SettingsSchema = {
    targetType: { type: 'string', default: 'loc', label: "Target type ('loc' or 'npc')", help: 'loc = scenery (rocks/trees), npc = fishing spots' },
    target: { type: 'string', default: 'Rocks', label: 'Target name', help: 'in-game name, e.g. Rocks / Tree / Fishing spot' },
    action: { type: 'string', default: 'Mine', label: 'Action', help: 'right-click op, e.g. Mine / Chop down / Net' },
    dropMatch: { type: 'string', default: 'ore', label: 'Drop items containing', help: 'when full, drop items whose name contains this (the gathered product)' },
    leashRadius: { type: 'number', default: 10, min: 2, max: 30, label: 'Leash radius (tiles)' }
};

/** minutes → h:mm:ss for the paint's runtime line. */
function fmtDuration(mins: number): string {
    const t = Math.max(0, Math.floor(mins * 60));
    return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * One bot for all gathering: find a target (scenery LOC or NPC) by name +
 * right-click action within a leash of the start tile, interact, wait for the
 * inventory to grow, and drop the product when full. Depletion is handled for
 * free — a mined-out rock / chopped stump no longer matches name+action, so
 * the next search picks another. Registered as Mining/Fishing/etc. presets in
 * scripts/index.ts; fully driven by settings so new spots need no code.
 */
export default class GatheringBot extends TaskBot {
    override loopDelay = 600;

    private anchor: Tile | null = null;
    private gathered = 0;
    private gems = 0;
    private status = 'starting';
    private location: FishingLocation | null = null;
    private banked = 0;
    private trips = 0;
    private startedAt = Date.now();

    private targetType = 'loc';
    private target = 'Rocks';
    private action = 'Mine';
    // Fishing (Fisher preset): a fishing spot exposes a PAIR of ops; pairOp is the
    // OTHER op that identifies the right spot when the clicked op is shared by two
    // spot types (Net on small/big, Bait on sardine/pike). '' = match any spot.
    private pairOp = '';
    private dropMatch = 'ore';
    private leash = 10;

    // Mining mode (Miner preset): every rock loc is named "Rocks", so we target
    // the SELECTED ore types by loc id, and the product filter matches every
    // selected ore's item. Empty when not mining a specific set.
    private rockIds = new Set<number>();
    private productKeywords: string[] = [];

    // A target that gave a blocking dialog (too-high level / no tool) is dead
    // for this run; one that just yielded nothing (freshly depleted rock,
    // exhausted fishing spot) gets a short cooldown so we rotate to others and
    // come back after it respawns. Keyed by "x,z".
    private rejected = new Set<string>();
    private cooldownUntil = new Map<string, number>();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.startedAt = Date.now();
        this.targetType = this.settings.str('targetType', 'loc').toLowerCase();
        this.target = this.settings.str('target', 'Rocks');
        this.action = this.settings.str('action', 'Mine');
        this.dropMatch = this.settings.str('dropMatch', 'ore').toLowerCase();
        this.leash = this.settings.num('leashRadius', 10);

        // Mining mode: the Miner preset carries a 'rocks' multi-select. When
        // present, we target rocks by loc id (every rock shares the name
        // "Rocks") and match every selected ore's item as the product. Empty
        // selection falls back to mining all rock types.
        if ('rocks' in this.settings.raw()) {
            const chosen = this.settings.list('rocks');
            const rocks = chosen.length > 0 ? chosen : ROCK_OPTIONS;
            this.targetType = 'loc';
            this.target = 'Rocks';
            this.action = 'Mine';
            this.rockIds = resolveRockIds(rocks);
            this.productKeywords = rocks.map(r => r.trim().toLowerCase());
        } else if ('fishMethod' in this.settings.raw()) {
            // Fishing mode: the Fisher preset carries a 'fishMethod'. Map it to the
            // Fishing-spot op to click and the pair op that picks the right spot
            // (Net small/big, Bait sardine/pike). Every catch is a 'Raw ...' fish.
            const method = resolveFishMethod(this.settings.str('fishMethod', FISHING_METHOD_OPTIONS[0]));
            this.targetType = 'npc';
            this.target = 'Fishing spot';
            this.action = method.op;
            this.pairOp = method.pair ?? '';
            this.productKeywords = ['raw'];
        } else {
            this.productKeywords = [this.dropMatch];
        }

        const here = Game.tile()!;
        const locSetting = this.settings.str('location', 'None');
        this.location = resolveLocation(locSetting, here);

        // a known location anchors the bot on its spot cluster (ReturnToAnchor
        // walks it there if started elsewhere) and banks the product; with no
        // location, anchor where we stand and drop when full (original behavior)
        this.anchor = this.location ? this.location.spot : new Tile(here.x, here.z, here.level);

        // 'None' = power-gathering (always drop). Anything else banks: at the
        // configured location's verified stand if resolved, else at the nearest
        // bank booth in the scene (auto-detected). Miner has no location setting
        // -> defaults to 'None' -> drops, unchanged.
        const powerMode = locSetting.toLowerCase() === 'none';
        if (this.location) {
            this.log(`location: ${this.location.name}${locSetting.toLowerCase() === 'auto' ? ' (auto-detected)' : ''} — banking the catch at ${this.location.bankStand}`);
            if (!this.location.verified) {
                this.log(`warning: ${this.location.name} coordinates are UNVERIFIED — watch the first bank run`);
            }
        } else if (!powerMode) {
            this.log('no preset location — will bank at the nearest bank booth in the scene (drops if none)');
        }
        this.log(`gathering '${this.target}' (${this.action}) within ${this.leash} of ${this.anchor}, ${powerMode ? 'dropping' : 'banking'} *${this.productLabel()}* when full`);

        this.on('inventory.changed', e => {
            if (e.id === -1) {
                return;
            }
            if (this.isProduct(e.name)) {
                this.gathered++;
            } else if (this.mining() && (e.name ?? '').toLowerCase().startsWith('uncut ')) {
                // rocks roll a gem instead of the ore now and then — count them
                this.gems++;
                this.log(`gem! ${e.name} (${this.gems} this run)`);
            }
        });

        this.add(new ContinueDialog(), ...(this.mining() ? [new ReplacePickaxe(this)] : []), powerMode ? new DropProduct(this) : new BankCatch(this), new Gather(this), new ReturnToAnchor(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#9be05b' });
        p.title(`Gathering — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const label = this.mining() ? 'Ore' : this.target;
        const perHr = mins > 0.5 ? ` (${Math.round((this.gathered / mins) * 60)}/hr)` : '';
        p.row(`Runtime: ${fmtDuration(mins)}`, `${label}: ${this.gathered}${perHr}`, `Inv: ${Inventory.used()}/28`);
        const extras: string[] = [];
        if (this.mining()) {
            extras.push(`Gems: ${this.gems}`);
        }
        if (this.location) {
            extras.push(`Loc: ${this.location.name}`, `Banked: ${this.banked} (${this.trips} trips)`);
        }
        if (extras.length > 0) {
            p.row(...extras);
        }

        p.gap();
        const clicked = p.buttons([
            { id: 'pause', label: ScriptRunner.state === 'paused' ? 'Resume' : 'Pause' },
            { id: 'stop', label: 'Stop' }
        ]);
        if (clicked === 'pause') {
            if (ScriptRunner.state === 'paused') {
                ScriptRunner.resume();
            } else {
                ScriptRunner.pause();
            }
        } else if (clicked === 'stop') {
            ScriptRunner.stop();
        }
        p.end();
    }

    setStatus(s: string): void {
        this.status = s;
    }
    getAnchor(): Tile {
        return this.anchor!;
    }
    leashRadius(): number {
        return this.leash;
    }
    targetName(): string {
        return this.target;
    }
    actionName(): string {
        return this.action;
    }
    isNpc(): boolean {
        return this.targetType === 'npc';
    }
    /** The op that must ALSO be on a fishing spot to disambiguate it ('' = any). */
    pairAction(): string {
        return this.pairOp;
    }

    /** True if an item name is one of our gathered products — any selected ore
     *  (Miner), or the single dropMatch keyword for other presets. */
    isProduct(name: string | null | undefined): boolean {
        const n = (name ?? '').toLowerCase();
        return this.productKeywords.some(k => n.includes(k));
    }
    /** Only mine the SELECTED rock ids; an empty set matches any rock. */
    matchesRock(id: number): boolean {
        return this.rockIds.size === 0 || this.rockIds.has(id);
    }
    /** Running as the Miner preset (rock ids resolved from the multi-select). */
    mining(): boolean {
        return this.rockIds.size > 0;
    }
    /** Short product label (e.g. "iron/coal") for status and log lines. */
    productLabel(): string {
        return this.productKeywords.join('/');
    }

    /** Inventory items matching the product filter (dropped or banked when full). */
    products() {
        return Inventory.items().filter(i => this.isProduct(i.name));
    }
    getLocation(): FishingLocation | null {
        return this.location;
    }
    countTrip(n: number): void {
        this.trips++;
        this.banked += n;
    }

    /** A target we can never use this run (level/tool gate). */
    reject(key: string): void {
        if (!this.rejected.has(key)) {
            this.rejected.add(key);
            this.log(`skipping ${this.target} at ${key} (can't ${this.action.toLowerCase()} it)`);
        }
    }
    /** Briefly skip a target that yielded nothing (depleted/exhausted). */
    cooldown(key: string, ticks = 8): void {
        this.cooldownUntil.set(key, Game.tick() + ticks);
    }
    usable(key: string): boolean {
        if (this.rejected.has(key)) {
            return false;
        }
        const until = this.cooldownUntil.get(key);
        return until === undefined || Game.tick() >= until;
    }
}

/** Stable per-tile key for the reject/cooldown maps. */
function keyOf(t: { x: number; z: number }): string {
    return `${t.x},${t.z}`;
}

class DropProduct implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        return Inventory.isFull() && this.bot.products().length > 0;
    }

    async execute(): Promise<void> {
        await dropAll(this.bot);
    }
}

/** Drop every product slot (power-gathering, or the no-bank-nearby fallback). */
async function dropAll(bot: GatheringBot): Promise<void> {
    bot.setStatus('dropping');
    for (let guard = 0; guard < 30; guard++) {
        const item = bot.products()[0];
        if (!item) {
            break;
        }
        const before = Inventory.used();
        await item.interact('Drop');
        await Execution.delayUntil(() => Inventory.used() < before, 3000);
    }
    bot.log('dropped the haul');
}

/** Full pack -> bank the catch at the nearest bank, then come back. Uses the
 *  configured location's verified stand when there is one, else auto-detects the
 *  nearest booth in the scene; drops only if there's no bank nearby. */
class BankCatch implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        return Inventory.isFull() && this.bot.products().length > 0;
    }

    async execute(): Promise<void> {
        const had = this.bot.products().length;
        const loc = this.bot.getLocation();
        const log = (m: string) => this.bot.log(`  ${m}`);
        // gems don't stack — bank them along with the ore or they eat the pack
        const deposit = (name: string) => this.bot.isProduct(name) || (this.bot.mining() && name.toLowerCase().startsWith('uncut '));

        if (loc) {
            // known location: walk to its verified stand and open the adjacent booth
            this.bot.setStatus('banking: heading to the bank');
            await Traversal.walkResilient(loc.bankStand, { radius: 2, log });
            if (!(await Bank.openBooth(loc.bankStand, loc.boothName ?? 'Bank booth', loc.boothOp ?? 'Use-quickly', log))) {
                this.bot.log('could not open the bank — will retry');
                return;
            }
            await Bank.depositAllMatching(deposit);
            await Execution.delayTicks(1);
            await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
        } else {
            this.bot.setStatus('banking: heading to the nearest bank');
            const banked = await Banking.bankNearest({ deposit, returnTo: this.bot.getAnchor(), log });
            if (!banked) {
                this.bot.setStatus('no bank reachable — dropping the haul');
                this.bot.log('no bank reachable — dropping instead');
                await dropAll(this.bot);
                return;
            }
        }

        this.bot.countTrip(had);
        this.bot.log(`banked ${had} *${this.bot.productLabel()}*`);
    }
}

/**
 * A smoking rock blew up on us and the pickaxe (worn or pack) is now a
 * "Broken pickaxe": bank it and withdraw the best replacement the mining
 * level can use from what's actually banked (rune 41 → adamant 31 → mithril
 * 21 → steel 6 → iron/bronze — the engine's own pickaxe_checker ladder).
 * Without any usable pick the run is dead, so warn and stop.
 */
class ReplacePickaxe implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        return Equipment.contains(BROKEN_PICKAXE) || Inventory.first(BROKEN_PICKAXE) !== null;
    }

    async execute(): Promise<void> {
        this.bot.setStatus('pickaxe broke — fetching a replacement');
        this.bot.log('pickaxe is broken — banking for the best replacement');
        const loc = this.bot.getLocation();
        const log = (m: string) => this.bot.log(`  ${m}`);

        // a broken pick can sit in the WORN weapon slot (the explosion swaps it
        // in place) — pull it into the pack so the deposit below reaches it
        if (Equipment.contains(BROKEN_PICKAXE) && !Inventory.isFull()) {
            await Equipment.unequip(BROKEN_PICKAXE);
        }

        let open: boolean;
        if (loc) {
            await Traversal.walkResilient(loc.bankStand, { radius: 2, log });
            open = await Bank.openBooth(loc.bankStand, loc.boothName ?? 'Bank booth', loc.boothOp ?? 'Use-quickly', log);
        } else {
            open = await Bank.openNearest('Bank booth', 'Use-quickly', log);
        }
        if (!open) {
            this.bot.log('could not open a bank — will retry');
            return;
        }

        // stash the broken pick (repairable later) and take the best usable tier
        await Bank.depositAllMatching(n => n.toLowerCase() === BROKEN_PICKAXE.toLowerCase());
        const pick = bestPickaxe(Skills.level('mining'), name => Bank.count(name) > 0);
        if (!pick) {
            this.bot.log('WARNING: no usable pickaxe in the bank — stopping. Deposit one and restart.');
            ScriptRunner.stop();
            return;
        }
        await Bank.withdraw(pick, 'Withdraw-1');
        if (!(await Execution.delayUntil(() => Inventory.first(pick) !== null, 3000))) {
            this.bot.log('withdraw did not land — will retry');
            return;
        }
        this.bot.log(`replaced the broken pickaxe with a ${pick}`);
        await Equipment.equip(pick); // frees a pack slot when wieldable; a pack pick mines fine too
        await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
    }
}

class Gather implements Task {
    constructor(private bot: GatheringBot) {}

    private find() {
        const anchor = this.bot.getAnchor();
        const within = this.bot.leashRadius();
        if (this.bot.isNpc()) {
            // fishing spots share the name "Fishing spot": require BOTH the op we
            // click and the pair op, so "Net" picks the small (Net/Bait) vs big
            // (Net/Harpoon) net spot, not whichever is nearest.
            const pair = this.bot.pairAction().toLowerCase();
            return Npcs.query()
                .name(this.bot.targetName())
                .action(this.bot.actionName())
                .where(n => n.tile().distanceTo(anchor) <= within && this.bot.usable(keyOf(n.tile())) && (pair === '' || n.actions().some(a => a.toLowerCase() === pair)))
                .nearest();
        }
        return Locs.query()
            .name(this.bot.targetName())
            .action(this.bot.actionName())
            // skip a target on our own tile — you can't mine/chop the tile you
            // stand on; the client must approach an adjacent square — restrict to
            // the selected rock ids (mining), never a smoking gas variant (same
            // "Rocks"/Mine name+op, explodes and breaks the pick), and skip
            // blacklisted/cooled-down tiles
            .where(l => l.distance() >= 1 && l.tile().distanceTo(anchor) <= within && this.bot.matchesRock(l.id) && !GAS_ROCK_IDS.has(l.id) && this.bot.usable(keyOf(l.tile())))
            .nearest();
    }

    validate(): boolean {
        return !Inventory.isFull() && this.find() !== null;
    }

    /** The worked rock has turned into a smoking gas variant under us. The
     *  engine re-interacts the miner automatically (p_oploc in the event
     *  script), so waiting out the animation mines it to the explosion —
     *  detect the loc swap and bail instead. */
    private gasAt(t: Tile): boolean {
        return Locs.query()
            .where(l => {
                const lt = l.tile();
                return lt.x === t.x && lt.z === t.z && GAS_ROCK_IDS.has(l.id);
            })
            .nearest() !== null;
    }

    /** Step off the smoking rock: one raw walk click toward the anchor cancels
     *  the engine's auto-continued mining, and the tile cools down past the
     *  gas duration so find() won't come back until it reverts. */
    private async fleeGas(key: string, tile: Tile): Promise<void> {
        this.bot.log(`rock at ${tile} is smoking — backing off before it blows`);
        this.bot.setStatus('smoking rock — backing off');
        this.bot.cooldown(key, GAS_ROCK_TICKS + 10);
        DirectNavigator.walk(this.bot.getAnchor());
        await Execution.delayTicks(2);
    }

    async execute(): Promise<void> {
        const target = this.find();
        if (!target) {
            return;
        }
        const key = keyOf(target.tile());

        const npc = this.bot.isNpc();

        // "Am I still fishing?" gate: if we're already animating we're working the
        // spot (or rock), so DON'T click again — re-clicking mid-action only
        // interrupts it. Only (re)start the action when the animation is stopped.
        if (!Game.animating()) {
            this.bot.setStatus(`${this.bot.actionName()} ${this.bot.targetName()} at ${target.tile()}`);
            const before = Inventory.used();
            if (!(await target.interact(this.bot.actionName()))) {
                this.bot.log(`no '${this.bot.actionName()}' op on ${this.bot.targetName()}? ops=[${target.actions().join(', ')}]`);
                await Execution.delayTicks(2);
                return;
            }

            // wait for the action to take hold: an item drops, the anim starts
            // (slow rocks swing before the first ore), the target moves/depletes,
            // the bag fills, a dialog interrupts us, or the rock starts smoking
            await Execution.delayUntil(
                () => Inventory.used() > before || Game.animating() || this.find() === null || Inventory.isFull() || ChatDialog.canContinue() || this.gasAt(target.tile()),
                12000
            );
            if (this.gasAt(target.tile())) {
                await this.fleeGas(key, target.tile());
                return;
            }

            if (Inventory.used() === before && !Game.animating()) {
                // gained nothing and never started animating — the engine refused
                if (ChatDialog.canContinue()) {
                    this.bot.reject(key); // level/tool gate (~mesbox); never retry
                } else if (!npc && this.find() !== null) {
                    this.bot.cooldown(key); // a depleted rock; a fishing spot we just re-find
                }
                return;
            }
        }

        // We're gathering/fishing now — stay put while the animation runs (still
        // working the spot) and we have room; NEVER re-click while animating. When
        // it STOPS: a rock/tree has depleted (cool it down and rotate away); a
        // fishing spot has moved or we were interrupted (do NOT cool it down —
        // re-find resumes the same spot, or picks the one it moved to).
        for (let guard = 0; guard < 200; guard++) {
            if (Inventory.isFull() || ChatDialog.canContinue() || this.find() === null) {
                return;
            }
            const mark = Inventory.used();
            await Execution.delayUntil(
                () => Inventory.used() > mark || !Game.animating() || Inventory.isFull() || ChatDialog.canContinue() || this.find() === null || this.gasAt(target.tile()),
                8000
            );
            if (this.gasAt(target.tile())) {
                await this.fleeGas(key, target.tile());
                return;
            }
            if (Inventory.used() > mark) {
                continue; // caught/gathered one — keep going, no re-click
            }
            if (!Game.animating()) {
                if (!npc && this.find() !== null && !Inventory.isFull() && !ChatDialog.canContinue()) {
                    this.bot.cooldown(key);
                }
                return;
            }
            // still animating — keep waiting
        }
    }
}

class ReturnToAnchor implements Task {
    constructor(private bot: GatheringBot) {}
    validate(): boolean {
        const here = Game.tile();
        return here !== null && this.bot.getAnchor().distanceTo(here) > this.bot.leashRadius() + 4;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('returning to anchor');
        await Traversal.walkTo(this.bot.getAnchor(), { radius: 3, timeoutMs: 90000 });
    }
}
