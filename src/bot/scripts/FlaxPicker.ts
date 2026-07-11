import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import { Traversal } from '../api/Traversal.js';
import { Reachability } from '../api/Reachability.js';
import { EventSignal } from '../api/EventSignal.js';
import { actions, reader } from '../adapter/ClientAdapter.js';
import type { SettingsSchema } from '../runtime/Settings.js';

const DEFAULT_FIELD = new Tile(2744, 3446, 0);
// Open road just WEST of the field, out through the opening in the tree line and
// on the Seers-bank side (the bank is due north at 2722,3493). Web-walking
// straight from inside the flax cluster wedges on the flax "walls" — hopping to
// this tile first, then web-walking, avoids it (user-reported).
const DEFAULT_FIELD_EXIT = new Tile(2722, 3446, 0);
// South-adjacent to the Seers bank booths (they run along z=3494; stand on z=3493).
const DEFAULT_BANK_STAND = new Tile(2722, 3493, 0);
const BOOTH = { op: 'Use-quickly' };
// How close (Chebyshev) to the field centre still counts as "at the field" — the
// whole Seers flax cluster sits within this of the centre tile. Replaces the old
// user-facing "leash" setting: the bot web-walks to the field from anywhere, and
// this just scopes which flax belongs to this field.
const FIELD_SCOPE = 12;
const FIELD_ARRIVE = 6; // arrival radius when web-walking to the field
// Flax locs block movement, so a full pack (which can't pick — "You can't carry
// any more flax") can get walled in. If the tiles reachable from the player flood
// to fewer than this, we're boxed into a flax pocket and must carve out.
const POCKET_CAP = 40;
const CARVE_DROP = 5; // flax to drop to free slots for carving a way out

export const SETTINGS: SettingsSchema = {
    flaxName: { type: 'string', default: 'Flax', label: 'Flax loc name' },
    pickOp: { type: 'string', default: 'Pick', label: 'Interact op' },
    fieldTile: { type: 'tile', default: DEFAULT_FIELD, label: 'Field centre tile (x,z)', help: 'verify/adjust live — Seers flax field' },
    fieldExit: { type: 'tile', default: DEFAULT_FIELD_EXIT, label: 'Field exit tile (x,z)', help: 'open ground just west of the field (through the opening) — run here before banking' },
    bankStand: { type: 'tile', default: DEFAULT_BANK_STAND, label: 'Bank stand tile (x,z)', help: 'Seers bank booth-adjacent tile' },
    bankBooth: { type: 'string', default: 'Bank booth', label: 'Bank booth loc name' }
};

/**
 * Seers Village flax picker. Web-walks to the flax field from any start location,
 * picks raw flax from the field until the pack is full, runs out through the west
 * opening, web-walks to the Seers bank, deposits the WHOLE pack (flax + any
 * random-event junk), returns to the field, and repeats. On startup it first
 * empties whatever it's carrying at the bank so it always begins from a clean
 * pack. Start it anywhere.
 */
export default class FlaxPicker extends TaskBot {
    override loopDelay = 600;

    private picked = 0;
    private trips = 0;
    private status = 'starting';

    private flaxName = 'Flax';
    private pickOp = 'Pick';
    private fieldTile = DEFAULT_FIELD;
    private fieldExit = DEFAULT_FIELD_EXIT;
    private bankStand = DEFAULT_BANK_STAND;
    private boothName = 'Bank booth';

    /** Set once at start: force one bank trip to empty whatever we spawned with
     *  (a partial pack, random junk) before settling into the pick loop. */
    startupPending = true;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.flaxName = this.settings.str('flaxName', 'Flax');
        this.pickOp = this.settings.str('pickOp', 'Pick');
        this.fieldTile = this.settings.tile('fieldTile', DEFAULT_FIELD);
        this.fieldExit = this.settings.tile('fieldExit', DEFAULT_FIELD_EXIT);
        this.bankStand = this.settings.tile('bankStand', DEFAULT_BANK_STAND);
        this.boothName = this.settings.str('bankBooth', 'Bank booth');

        this.log(`FlaxPicker picking '${this.flaxName}' (${this.pickOp}) at ${this.fieldTile} — exit ${this.fieldExit}, bank ${this.bankStand}`);

        this.on('inventory.changed', e => {
            if (e.id !== -1 && this.isFlax(e.name)) {
                this.picked++;
            }
        });

        this.add(new ContinueDialog(), new EscapeFlaxTrap(this), new StartupReset(this), new BankTrip(this), new Pick(this), new GoToField(this));
    }

    override recoveryAnchor(): Tile | null {
        return this.fieldTile;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const size = Inventory.isFull() ? 0 : Math.max(0, 28 - Inventory.used());
        const lines = [
            `FlaxPicker — ${this.status}`,
            `${this.flaxName}: picked ${this.picked}  bank trips ${this.trips}`,
            `free slots ${size}  tick ${Game.tick()}`
        ];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#9be05b';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void { this.status = s; }
    countTrip(): void { this.trips++; }
    flaxLocName(): string { return this.flaxName; }
    pickOpName(): string { return this.pickOp; }
    fieldCentre(): Tile { return this.fieldTile; }
    flaxCount(): number { return Inventory.count(this.flaxName); }

    /** True if an item name is the picked flax product. */
    isFlax(name: string | null | undefined): boolean {
        return (name ?? '').toLowerCase().includes(this.flaxName.toLowerCase());
    }

    /** Within the field cluster (Chebyshev) — i.e. close enough to pick its flax. */
    atField(): boolean {
        const here = Game.tile();
        return here !== null && this.fieldTile.distanceTo(here) <= FIELD_SCOPE;
    }

    /** The nearest pickable "Flax" loc belonging to this field, or null. */
    nearestFlax() {
        return Locs.query()
            .name(this.flaxName)
            .action(this.pickOp)
            .where(l => l.tile().distanceTo(this.fieldTile) <= FIELD_SCOPE)
            .nearest();
    }

    /** The pickable flax loc at exactly (x,z,level), or null. */
    flaxLocAt(x: number, z: number, level: number): Loc | null {
        return Locs.query()
            .name(this.flaxName)
            .action(this.pickOp)
            .where(l => l.tile().x === x && l.tile().z === z && l.tile().level === level)
            .nearest();
    }

    /** True while a pickable flax loc still stands at `tile`. Picking flax (by us
     *  OR any other player) runs loc_del(25) — the loc vanishes for 25 ticks — so
     *  this flips false the instant someone else takes our target, letting Pick
     *  retarget immediately instead of waiting out the yield window. */
    flaxStillAt(tile: Tile): boolean {
        return this.flaxLocAt(tile.x, tile.z, tile.level) !== null;
    }

    /** Flood-fill the walkable tiles reachable from the player (4-connected, live
     *  collision), bounded to `cap`. A small result means we're penned into a
     *  pocket; open ground floods past the cap immediately. */
    private pocketTiles(cap: number): { x: number; z: number }[] {
        const me = Game.tile();
        if (!me) { return []; }
        const level = me.level;
        const key = (x: number, z: number): string => `${x},${z}`;
        const seen = new Set<string>([key(me.x, me.z)]);
        const out: { x: number; z: number }[] = [{ x: me.x, z: me.z }];
        const queue: { x: number; z: number }[] = [{ x: me.x, z: me.z }];
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        while (queue.length > 0 && out.length < cap) {
            const cur = queue.shift()!;
            const from = { x: cur.x, z: cur.z, level };
            for (const [dx, dz] of dirs) {
                const nx = cur.x + dx, nz = cur.z + dz, k = key(nx, nz);
                if (seen.has(k) || !Reachability.canStep(from, { x: nx, z: nz, level })) { continue; }
                seen.add(k);
                out.push({ x: nx, z: nz });
                queue.push({ x: nx, z: nz });
            }
        }
        return out;
    }

    /** Pickable flax locs walling in `pocket` — the boundary tiles we can carve. */
    private boundaryFlax(pocket: { x: number; z: number }[]): Loc[] {
        const level = Game.tile()?.level ?? 0;
        const inPocket = new Set(pocket.map(t => `${t.x},${t.z}`));
        const seen = new Set<string>();
        const walls: Loc[] = [];
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const p of pocket) {
            for (const [dx, dz] of dirs) {
                const nx = p.x + dx, nz = p.z + dz, k = `${nx},${nz}`;
                if (inPocket.has(k) || seen.has(k)) { continue; }
                seen.add(k);
                const flax = this.flaxLocAt(nx, nz, level);
                if (flax) { walls.push(flax); }
            }
        }
        return walls;
    }

    /** Full pack AND penned into a small flax pocket — a full pack can't pick, so
     *  it can't open the flax walls the normal way and is stuck. */
    boxedByFlax(): boolean {
        if (!Inventory.isFull()) { return false; }
        const pocket = this.pocketTiles(POCKET_CAP);
        return pocket.length < POCKET_CAP && this.boundaryFlax(pocket).length > 0;
    }

    /** Drop up to `n` flax to free slots (a full pack refuses to pick). */
    private async dropFlax(n: number): Promise<void> {
        for (let i = 0; i < n; i++) {
            const flax = Inventory.items().find(it => this.isFlax(it.name));
            if (!flax) { return; }
            const before = this.flaxCount();
            if (!(await flax.interact('Drop'))) { return; }
            await Execution.delayUntil(() => this.flaxCount() < before, 2000);
        }
    }

    /**
     * Carve out of a flax pen: drop a few flax to free slots, then pick the
     * boundary flax nearest the exit (toward the west opening) to open a path,
     * repeating until the pocket floods back open. Flax we pick lands in the freed
     * slots; top the drop up if we fill again mid-carve.
     */
    async carveOut(): Promise<void> {
        this.setStatus('boxed in by flax — carving a way out');
        this.log(`boxed in by flax with a full pack — dropping ${CARVE_DROP} flax to pick a way out`);
        await this.dropFlax(CARVE_DROP);
        for (let n = 0; n < 20; n++) {
            if (ChatDialog.canContinue() || EventSignal.pending()) { return; }
            const pocket = this.pocketTiles(POCKET_CAP);
            if (pocket.length >= POCKET_CAP) { this.log('carved back out to open ground'); return; }
            const walls = this.boundaryFlax(pocket);
            if (walls.length === 0) { return; } // walled by map, not flax — nothing to carve
            if (Inventory.isFull()) { await this.dropFlax(CARVE_DROP); }
            const target = walls.sort((a, b) => a.tile().distanceTo(this.fieldExit) - b.tile().distanceTo(this.fieldExit))[0];
            const t = target.tile();
            if (!(await target.interact(this.pickOp))) { await Execution.delayTicks(2); continue; }
            await Execution.delayUntil(() => !this.flaxStillAt(t), 4000);
        }
    }

    /**
     * Empty the whole pack at the Seers bank, then return to the field. Shared by
     * the startup reset and the pack-full bank trip. If we're currently in the
     * field, step out through the west opening onto open ground FIRST — web-walking
     * straight from inside the flax cluster wedges on the flax walls. Deposits the
     * ENTIRE inventory (flax + any random-event junk). Returns true once banked.
     */
    async bankRun(): Promise<boolean> {
        const log = (m: string): void => this.log(`  ${m}`);
        const had = this.flaxCount();
        if (this.atField()) {
            this.setStatus('leaving the field via the west opening');
            await Traversal.walkResilient(this.fieldExit, { radius: 1, attempts: 3, timeoutMs: 60_000, log });
        }
        this.setStatus('web-walking to the bank');
        if (!(await Traversal.walkResilient(this.bankStand, { radius: 4, attempts: 4, timeoutMs: 180_000, log }))) {
            this.log('could not reach the bank — will retry');
            return false;
        }
        // The web-walker parks a tile or two short of the counter, and its 1-tile
        // final step stalls ("stuck … repathing (0 clicks)") — the recurring "banks
        // slowly / recalculates while already at the bank" symptom. Close the last
        // step with a LIVE local walk onto the exact stand tile (adjacent to an
        // operable booth), the same trick SmelterBot/maze use, then just open.
        for (let w = 0; w < 6; w++) {
            const now = Game.tile();
            if (now && now.x === this.bankStand.x && now.z === this.bankStand.z) { break; }
            const local = reader.toLocal(this.bankStand.x, this.bankStand.z);
            if (!local) { await Execution.delayTicks(1); continue; }
            const before = Game.tile();
            actions.walkTo(local.lx, local.lz);
            await Execution.delayUntil(() => {
                const t = Game.tile();
                return (t !== null && t.x === this.bankStand.x && t.z === this.bankStand.z) || (before !== null && t !== null && (before.x !== t.x || before.z !== t.z));
            }, 3000);
        }
        // configured stand first, then the dynamic openNearest fallback (a bad/
        // unreachable stand can't hang us — it steps onto a live-reachable tile
        // beside the nearest OPERABLE booth, skipping the decorative ones)
        const opened = (await Bank.openBooth(this.bankStand, this.boothName, BOOTH.op, log))
            || (await Bank.openNearest(this.boothName, BOOTH.op, log));
        if (!opened) {
            this.log('could not open the bank — will retry');
            return false;
        }
        await Bank.depositInventory();
        await Execution.delayTicks(1);
        this.countTrip();
        this.log(`banked ${had} ${this.flaxName} (+ any junk)`);
        this.setStatus('returning to the field');
        await Traversal.walkResilient(this.fieldExit, { radius: 1, attempts: 3, timeoutMs: 180_000, log });
        await Traversal.walkResilient(this.fieldTile, { radius: FIELD_ARRIVE, attempts: 4, timeoutMs: 180_000, log });
        return true;
    }
}

class ContinueDialog implements Task {
    validate(): boolean { return ChatDialog.canContinue(); }
    async execute(): Promise<void> { await ChatDialog.continue(); }
}

/** Full pack AND walled into a flax pocket → carve out (a full pack can't pick
 *  the flax walls the normal way). Highest working priority so it pre-empts the
 *  bank trip, which would otherwise try to web-walk out of a pen it can't leave. */
class EscapeFlaxTrap implements Task {
    constructor(private bot: FlaxPicker) {}
    validate(): boolean { return this.bot.boxedByFlax(); }
    async execute(): Promise<void> { await this.bot.carveOut(); }
}

/** One-shot at start: bank whatever we spawned holding so the loop begins from a
 *  clean pack, no matter where or with what we were started. */
class StartupReset implements Task {
    constructor(private bot: FlaxPicker) {}
    validate(): boolean { return this.bot.startupPending; }
    async execute(): Promise<void> {
        this.bot.startupPending = false;
        if (Inventory.used() === 0) { return; } // already clean — go straight to the field
        this.bot.log('startup: emptying the pack at the bank before picking');
        await this.bot.bankRun();
    }
}

/** Pack full → run out the west opening, deposit the WHOLE pack at the bank, and
 *  come back to the field. */
class BankTrip implements Task {
    constructor(private bot: FlaxPicker) {}
    validate(): boolean { return Inventory.isFull(); }
    async execute(): Promise<void> { await this.bot.bankRun(); }
}

/** At the field and not full → pick the nearest flax, retargeting instantly if
 *  someone else takes our stalk (loc_del). */
class Pick implements Task {
    constructor(private bot: FlaxPicker) {}
    validate(): boolean {
        return !Inventory.isFull() && this.bot.atField() && this.bot.nearestFlax() !== null;
    }
    async execute(): Promise<void> {
        // Picking flax loc_del's it for 25t (ours or anyone's), so re-select the
        // nearest each time. Bounded loop: pick, wait for a flax to land, repeat
        // until full or a dialog interrupts us. Bail the yield-wait the moment the
        // targeted stalk disappears — someone else picked it first — so we retarget
        // the next-nearest flax instead of burning the whole window on a dead loc.
        for (let n = 0; n < 30 && !Inventory.isFull(); n++) {
            if (ChatDialog.canContinue()) { return; }
            const flax = this.bot.nearestFlax();
            if (!flax) { return; }
            const target = flax.tile();
            this.bot.setStatus(`picking ${this.bot.flaxLocName()} at ${target}`);
            const before = this.bot.flaxCount();
            if (!(await flax.interact(this.bot.pickOpName()))) { await Execution.delayTicks(2); continue; }
            await Execution.delayUntil(
                () => this.bot.flaxCount() > before || Inventory.isFull() || ChatDialog.canContinue() || !this.bot.flaxStillAt(target),
                6000
            );
        }
    }
}

/** Not at the field and not full → web-walk to the field from wherever we are. */
class GoToField implements Task {
    constructor(private bot: FlaxPicker) {}
    validate(): boolean { return !Inventory.isFull() && !this.bot.atField(); }
    async execute(): Promise<void> {
        this.bot.setStatus('web-walking to the flax field');
        await Traversal.walkResilient(this.bot.fieldCentre(), { radius: FIELD_ARRIVE, attempts: 4, timeoutMs: 180_000, log: m => this.bot.log(`  ${m}`) });
    }
}
