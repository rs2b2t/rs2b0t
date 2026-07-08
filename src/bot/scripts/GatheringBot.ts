import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Locs } from '../api/queries/Locs.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Traversal } from '../api/Traversal.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { resolveLocation, type FishingLocation } from './FishingLocations.js';

/** Shared parameter schema for any gathering preset (mining, fishing, etc.). */
export const GATHERING_SETTINGS: SettingsSchema = {
    targetType: { type: 'string', default: 'loc', label: "Target type ('loc' or 'npc')", help: 'loc = scenery (rocks/trees), npc = fishing spots' },
    target: { type: 'string', default: 'Rocks', label: 'Target name', help: 'in-game name, e.g. Rocks / Tree / Fishing spot' },
    action: { type: 'string', default: 'Mine', label: 'Action', help: 'right-click op, e.g. Mine / Chop down / Net' },
    dropMatch: { type: 'string', default: 'ore', label: 'Drop items containing', help: 'when full, drop items whose name contains this (the gathered product)' },
    leashRadius: { type: 'number', default: 10, min: 2, max: 30, label: 'Leash radius (tiles)' }
};

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
    private status = 'starting';
    private location: FishingLocation | null = null;
    private banked = 0;
    private trips = 0;

    private targetType = 'loc';
    private target = 'Rocks';
    private action = 'Mine';
    private dropMatch = 'ore';
    private leash = 10;

    // A target that gave a blocking dialog (too-high level / no tool) is dead
    // for this run; one that just yielded nothing (freshly depleted rock,
    // exhausted fishing spot) gets a short cooldown so we rotate to others and
    // come back after it respawns. Keyed by "x,z".
    private rejected = new Set<string>();
    private cooldownUntil = new Map<string, number>();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.targetType = this.settings.str('targetType', 'loc').toLowerCase();
        this.target = this.settings.str('target', 'Rocks');
        this.action = this.settings.str('action', 'Mine');
        this.dropMatch = this.settings.str('dropMatch', 'ore').toLowerCase();
        this.leash = this.settings.num('leashRadius', 10);

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
        this.log(`gathering '${this.target}' (${this.action}) within ${this.leash} of ${this.anchor}, ${powerMode ? 'dropping' : 'banking'} *${this.dropMatch}* when full`);

        this.on('inventory.changed', e => {
            if (e.id !== -1 && e.name?.toLowerCase().includes(this.dropMatch)) {
                this.gathered++;
            }
        });

        this.add(new ContinueDialog(this), powerMode ? new DropProduct(this) : new BankCatch(this), new Gather(this), new ReturnToAnchor(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [`Gathering — ${this.status}`, `${this.target}: ${this.gathered} gathered`, `inv ${Inventory.used()} used  tick ${Game.tick()}`];
        if (this.location) {
            lines.splice(1, 0, `loc ${this.location.name}  banked ${this.banked} (${this.trips} trips)`);
        }
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#9be05b';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
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
    dropKeyword(): string {
        return this.dropMatch;
    }
    isNpc(): boolean {
        return this.targetType === 'npc';
    }

    /** Inventory items matching the product filter (dropped or banked when full). */
    products() {
        return Inventory.items().filter(i => i.name?.toLowerCase().includes(this.dropMatch));
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

class ContinueDialog implements Task {
    constructor(private bot: GatheringBot) {}
    validate(): boolean {
        return ChatDialog.canContinue();
    }
    async execute(): Promise<void> {
        await ChatDialog.continue();
    }
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
        const boothName = loc?.boothName ?? 'Bank booth';
        const boothOp = loc?.boothOp ?? 'Use-quickly';
        const log = (m: string) => this.bot.log(`  ${m}`);

        this.bot.setStatus('banking: heading to the bank');
        let opened: boolean;
        if (loc) {
            // known location: walk to its verified stand and open the adjacent booth
            await Traversal.walkResilient(loc.bankStand, { radius: 2, log });
            opened = await Bank.openBooth(loc.bankStand, boothName, boothOp, log);
        } else {
            // auto-detect: nearest REAL booth in the scene (usable op — skips
            // decorative "Bank booth" locs that share the name but have no op).
            // Its own tile is solid, so openNearest walks us to a reachable tile
            // beside it and opens it from there.
            const booth = Locs.query().name(boothName).where(l => l.actions().length > 0).nearest();
            if (!booth) {
                this.bot.setStatus('no bank in scene — dropping the haul');
                this.bot.log(`no '${boothName}' in the scene — dropping instead. Fish near a bank to bank the catch.`);
                await dropAll(this.bot);
                return;
            }
            await Traversal.walkResilient(booth.tile(), { radius: 3, log });
            opened = await Bank.openNearest(boothName, boothOp, log);
        }

        if (!opened) {
            this.bot.log('could not open the bank — will retry');
            return;
        }

        this.bot.setStatus('banking: depositing the catch');
        await Bank.depositAllMatching(name => name.toLowerCase().includes(this.bot.dropKeyword()));
        await Execution.delayTicks(1);
        this.bot.countTrip(had);
        this.bot.log(`banked ${had} *${this.bot.dropKeyword()}*`);

        this.bot.setStatus('banking: back to the spots');
        await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
    }
}

class Gather implements Task {
    constructor(private bot: GatheringBot) {}

    private find() {
        const anchor = this.bot.getAnchor();
        const within = this.bot.leashRadius();
        if (this.bot.isNpc()) {
            return Npcs.query()
                .name(this.bot.targetName())
                .action(this.bot.actionName())
                .where(n => n.tile().distanceTo(anchor) <= within && this.bot.usable(keyOf(n.tile())))
                .nearest();
        }
        return Locs.query()
            .name(this.bot.targetName())
            .action(this.bot.actionName())
            // skip a target on our own tile — you can't mine/chop the tile you
            // stand on; the client must approach an adjacent square — and skip
            // anything we've blacklisted or cooled down
            .where(l => l.distance() >= 1 && l.tile().distanceTo(anchor) <= within && this.bot.usable(keyOf(l.tile())))
            .nearest();
    }

    validate(): boolean {
        return !Inventory.isFull() && this.find() !== null;
    }

    async execute(): Promise<void> {
        const target = this.find();
        if (!target) {
            return;
        }
        const key = keyOf(target.tile());

        this.bot.setStatus(`${this.bot.actionName()} ${this.bot.targetName()} at ${target.tile()}`);
        const before = Inventory.used();
        if (!(await target.interact(this.bot.actionName()))) {
            this.bot.log(`no '${this.bot.actionName()}' op on ${this.bot.targetName()}? ops=[${target.actions().join(', ')}]`);
            await Execution.delayTicks(2);
            return;
        }

        // wait for the action to take hold: an item drops, the gather anim
        // starts (slow rocks swing well before the first ore), the target
        // depletes, the bag fills, or a dialog interrupts us
        await Execution.delayUntil(() => Inventory.used() > before || Game.animating() || this.find() === null || Inventory.isFull() || ChatDialog.canContinue(), 12000);

        if (Inventory.used() === before && !Game.animating()) {
            // gained nothing and never started animating — the engine refused
            if (ChatDialog.canContinue()) {
                this.bot.reject(key); // level/tool gate (~mesbox); never retry
            } else if (this.find() !== null) {
                this.bot.cooldown(key); // depleted/exhausted; come back later
            }
            return;
        }

        // we're gathering: stay on this spot while it yields and we have room
        // (fishing spots and slow trees/rocks drop repeatedly over many swings)
        for (let guard = 0; guard < 120; guard++) {
            if (Inventory.isFull() || ChatDialog.canContinue() || this.find() === null) {
                return;
            }
            const mark = Inventory.used();
            // wait for the next item, or for the action to stop / be interrupted
            await Execution.delayUntil(() => Inventory.used() > mark || !Game.animating() || Inventory.isFull() || ChatDialog.canContinue() || this.find() === null, 8000);
            if (Inventory.used() > mark) {
                continue; // got one, keep swinging
            }
            if (!Game.animating()) {
                // stopped without a new item — depleted/interrupted; rotate away
                if (this.find() !== null && !Inventory.isFull() && !ChatDialog.canContinue()) {
                    this.bot.cooldown(key);
                }
                return;
            }
            // still animating after 8s with no drop: a very slow rock — keep waiting
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
