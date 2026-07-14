import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { drawStatusBox } from '../api/hud/Overlay.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import { Traversal } from '../api/Traversal.js';
import { Reachability } from '../api/Reachability.js';
import { EventSignal } from '../api/EventSignal.js';
import { actions, reader } from '../adapter/ClientAdapter.js';
import type { SettingsSchema } from '../runtime/Settings.js';

// Waypoints for the Seers loop (user-supplied, live). The bank run is a chain of
// short, reliable hops — field centre → gate (the opening in the field boundary)
// → bank entrance → a booth stand — so no single long web-walk from inside the
// flax cluster can wedge.
const DEFAULT_FIELD = new Tile(2741, 3444, 0);      // centre of the flax field
const DEFAULT_FIELD_GATE = new Tile(2736, 3443, 0); // the opening on the west side
const DEFAULT_BANK_ENTRANCE = new Tile(2726, 3487, 0); // doorway into the Seers bank
const DEFAULT_BANK_STAND = new Tile(2725, 3493, 0); // middle of the booth-stand row (2721..2729, z3493)
const BANK_STAND_SPAN = 4; // booth stands run bankStand.x ± this along the same z
const BOOTH = { op: 'Use-quickly' };
// How close (Chebyshev) to the field centre still counts as "at the field" — the
// whole Seers flax cluster sits within this of the centre tile. Replaces the old
// user-facing "leash" setting: the bot web-walks to the field from anywhere, and
// this just scopes which flax belongs to this field.
const FIELD_SCOPE = 12;
const FIELD_ARRIVE = 3; // arrival radius when walking to the field centre
// Flax locs block movement, so a full pack (which can't pick — "You can't carry
// any more flax") can get walled in. If the tiles reachable from the player flood
// to fewer than this, we're boxed into a flax pocket and must carve out.
const POCKET_CAP = 40;
const CARVE_DROP = 5; // flax to drop to free slots for carving a way out

export const SETTINGS: SettingsSchema = {
    flaxName: { type: 'string', default: 'Flax', label: 'Flax loc name' },
    pickOp: { type: 'string', default: 'Pick', label: 'Interact op' },
    fieldTile: { type: 'tile', default: DEFAULT_FIELD, label: 'Field centre tile (x,z)', help: 'centre of the flax field' },
    fieldGate: { type: 'tile', default: DEFAULT_FIELD_GATE, label: 'Field gate/opening (x,z)', help: 'the opening on the west side — run out here before banking' },
    bankEntrance: { type: 'tile', default: DEFAULT_BANK_ENTRANCE, label: 'Bank entrance tile (x,z)', help: 'doorway into the bank, walked to on the way in and out' },
    bankStand: { type: 'tile', default: DEFAULT_BANK_STAND, label: 'Bank stand tile (x,z)', help: 'a booth-adjacent tile; the bot uses the nearest reachable one along this row' },
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
    private fieldGate = DEFAULT_FIELD_GATE;
    private bankEntrance = DEFAULT_BANK_ENTRANCE;
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
        this.fieldGate = this.settings.tile('fieldGate', DEFAULT_FIELD_GATE);
        this.bankEntrance = this.settings.tile('bankEntrance', DEFAULT_BANK_ENTRANCE);
        this.bankStand = this.settings.tile('bankStand', DEFAULT_BANK_STAND);
        this.boothName = this.settings.str('bankBooth', 'Bank booth');

        this.log(`FlaxPicker picking '${this.flaxName}' (${this.pickOp}) at ${this.fieldTile} — gate ${this.fieldGate}, bank entrance ${this.bankEntrance}, stand ${this.bankStand}`);

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
        drawStatusBox(ctx, lines, '#9be05b');
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

    /** The nearest REACHABLE pickable "Flax" loc of this field, or null. Reachable
     *  matters because flax blocks movement: the plain nearest can sit behind a
     *  wall of other flax, and interacting with it leaves the bot stranded (the
     *  server can't path to it) — it then camps, picking only the one adjacent
     *  stalk as it respawns. Checking nearest-first and stopping at the first
     *  reachable keeps the bot flowing to flax it can actually walk to. */
    nearestFlax(): Loc | null {
        const me = Game.tile();
        const flax = Locs.query()
            .name(this.flaxName)
            .action(this.pickOp)
            .where(l => l.tile().distanceTo(this.fieldTile) <= FIELD_SCOPE)
            .results();
        if (flax.length === 0) { return null; }
        if (me) { flax.sort((a, b) => a.tile().distanceTo(me) - b.tile().distanceTo(me)); }
        for (const f of flax) {
            if (Reachability.canReach(f.tile(), { adjacentOk: true, maxSteps: 400 })) { return f; }
        }
        return null;
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
            const target = walls.sort((a, b) => a.tile().distanceTo(this.fieldGate) - b.tile().distanceTo(this.fieldGate))[0];
            const t = target.tile();
            if (!(await target.interact(this.pickOp))) { await Execution.delayTicks(2); continue; }
            await Execution.delayUntil(() => !this.flaxStillAt(t), 4000);
        }
    }

    /** The nearest reachable booth-stand tile in the row (bankStand.x ± span, same
     *  z), or the row-nearest to us if none reads reachable right now. Using the
     *  whole row means one occupied/blocked stand never wedges the bank run. */
    private nearestStand(): Tile {
        const me = Game.tile();
        const z = this.bankStand.z, level = this.bankStand.level;
        const row: Tile[] = [];
        for (let x = this.bankStand.x - BANK_STAND_SPAN; x <= this.bankStand.x + BANK_STAND_SPAN; x++) {
            row.push(new Tile(x, z, level));
        }
        const pool = row.filter(t => Reachability.canReach(t));
        const pick = pool.length > 0 ? pool : row;
        if (!me) { return pick[Math.floor(pick.length / 2)]; }
        return pick.sort((a, b) => a.distanceTo(me) - b.distanceTo(me))[0];
    }

    /** Walk to `dest` using the LIVE client tryMove (local-scene pathing), which
     *  handles the short/medium in-scene hops the baked web-walker stalls on
     *  ("stuck … repathing (0 clicks)"). Re-issues each time we move; bails if the
     *  target isn't in the loaded scene or we stop making progress, so the caller
     *  can fall back to the web-walker. Returns true once within `radius`. */
    private async walkLocal(dest: Tile, radius: number): Promise<boolean> {
        let last: { x: number; z: number } | null = null;
        for (let w = 0; w < 30; w++) {
            const now = Game.tile();
            if (now && dest.distanceTo(now) <= radius) { return true; }
            const local = reader.toLocal(dest.x, dest.z);
            if (!local) { return false; } // off-scene — hand off to the web-walker
            actions.walkTo(local.lx, local.lz);
            // walk for a beat, then re-check. If we didn't move at all since the
            // last beat, bail IMMEDIATELY to the web-walker rather than re-clicking
            // a blocked tile — fast stuck-resolution, no slow flailing.
            await Execution.delayUntil(() => {
                const t = Game.tile();
                return t !== null && dest.distanceTo(t) <= radius;
            }, 1800);
            const moved = Game.tile();
            if (moved && last && moved.x === last.x && moved.z === last.z) { return false; }
            last = moved ? { x: moved.x, z: moved.z } : null;
        }
        const fin = Game.tile();
        return fin !== null && dest.distanceTo(fin) <= radius;
    }

    /** Robust travel to `dest`: the local client walk first (no short-move stall,
     *  handles the whole in-scene Seers loop), and the web-walker as a fallback for
     *  off-scene / long cross-region legs or when the local walk is blocked (it
     *  also opens any door/gate en route). */
    async travelTo(dest: Tile, radius: number): Promise<boolean> {
        if (reader.toLocal(dest.x, dest.z) !== null && await this.walkLocal(dest, radius)) {
            return true;
        }
        return Traversal.walkResilient(dest, { radius: Math.max(radius, 2), attempts: 4, timeoutMs: 180_000, log: m => this.log(`  ${m}`) });
    }

    /**
     * Empty the whole pack at the Seers bank, then return to the field. Shared by
     * the startup reset and the pack-full bank trip. The route is a chain of short
     * hops between known-good tiles — field ⇄ gate ⇄ bank entrance ⇄ booth stand —
     * so no single long web-walk (least of all one starting inside the flax
     * cluster) can wedge. Deposits the ENTIRE inventory (flax + any random-event
     * junk). Returns true once banked.
     */
    async bankRun(): Promise<boolean> {
        const log = (m: string): void => this.log(`  ${m}`);
        const had = this.flaxCount();
        // OUT: field → gate → bank entrance → nearest booth stand. Each is its own
        // travelTo (local-first, web-walk fallback) so a short hop never wedges.
        if (this.atField()) {
            this.setStatus('leaving the field via the gate');
            await this.travelTo(this.fieldGate, 0);
        }
        this.setStatus('walking to the bank entrance');
        if (!(await this.travelTo(this.bankEntrance, 1))) {
            this.log('could not reach the bank entrance — will retry');
            return false;
        }
        const stand = this.nearestStand();
        this.setStatus('stepping to the bank counter');
        await this.travelTo(stand, 0);
        // configured stand first, then the dynamic openNearest fallback (a bad/
        // unreachable stand can't hang us — it steps onto a live-reachable tile
        // beside the nearest OPERABLE booth, skipping the decorative ones)
        const opened = (await Bank.openBooth(stand, this.boothName, BOOTH.op, log))
            || (await Bank.openNearest(this.boothName, BOOTH.op, log));
        if (!opened) {
            this.log('could not open the bank — will retry');
            return false;
        }
        await Bank.depositInventory();
        await Execution.delayTicks(1);
        this.countTrip();
        this.log(`banked ${had} ${this.flaxName} (+ any junk)`);
        // BACK: bank entrance → gate → field centre.
        this.setStatus('returning to the field');
        await this.travelTo(this.bankEntrance, 1);
        await this.travelTo(this.fieldGate, 0);
        await this.travelTo(this.fieldTile, FIELD_ARRIVE);
        return true;
    }
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

/** Not full and no reachable flax to pick right now → get to / reposition toward
 *  the field centre (handles both "still travelling here from anywhere" and "stuck
 *  in a spot with nothing reachable"). At the centre with nothing reachable, just
 *  wait a beat for flax to respawn. */
class GoToField implements Task {
    constructor(private bot: FlaxPicker) {}
    validate(): boolean { return !Inventory.isFull() && this.bot.nearestFlax() === null; }
    async execute(): Promise<void> {
        const here = Game.tile();
        if (here && this.bot.fieldCentre().distanceTo(here) <= FIELD_ARRIVE) {
            await Execution.delayTicks(2); // at the centre — flax just respawning, wait it out
            return;
        }
        this.bot.setStatus('travelling to the flax field');
        await this.bot.travelTo(this.bot.fieldCentre(), FIELD_ARRIVE);
    }
}
