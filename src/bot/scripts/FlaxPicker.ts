import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Paint } from '../api/hud/Paint.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import { Traversal } from '../api/Traversal.js';
import { Reachability } from '../api/Reachability.js';
import { EventSignal } from '../api/EventSignal.js';
import { actions, reader } from '../adapter/ClientAdapter.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

const DEFAULT_FIELD = new Tile(2741, 3444, 0);      // centre of the flax field
const DEFAULT_FIELD_GATE = new Tile(2736, 3443, 0); // the opening on the west side
const DEFAULT_BANK_ENTRANCE = new Tile(2726, 3487, 0); // doorway into the Seers bank
const DEFAULT_BANK_STAND = new Tile(2725, 3493, 0); // middle of the booth-stand row (2721..2729, z3493)
const BANK_STAND_SPAN = 4; // booth stands run bankStand.x ± this along the same z
const BOOTH = { op: 'Use-quickly' };
const FIELD_SCOPE = 12;
const FIELD_ARRIVE = 3; // arrival radius when walking to the field centre
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

export default class FlaxPicker extends TaskBot {
    override loopDelay = 600;

    private picked = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();

    private flaxName = 'Flax';
    private pickOp = 'Pick';
    private fieldTile = DEFAULT_FIELD;
    private fieldGate = DEFAULT_FIELD_GATE;
    private bankEntrance = DEFAULT_BANK_ENTRANCE;
    private bankStand = DEFAULT_BANK_STAND;
    private boothName = 'Bank booth';

    startupPending = true;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.startedAt = Date.now();
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
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#9be05b' });
        p.title(`FlaxPicker — ${this.status}`);

        const size = Inventory.isFull() ? 0 : Math.max(0, 28 - Inventory.used());
        const mins = (Date.now() - this.startedAt) / 60_000;
        p.row(`Runtime: ${fmtDuration(mins)}`, `${this.flaxName} picked: ${this.picked}`, `Trips: ${this.trips}`);
        p.row(`Free slots: ${size}`, `Held: ${this.flaxCount()}`);

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(s: string): void { this.status = s; }
    countTrip(): void { this.trips++; }
    flaxLocName(): string { return this.flaxName; }
    pickOpName(): string { return this.pickOp; }
    fieldCentre(): Tile { return this.fieldTile; }
    flaxCount(): number { return Inventory.count(this.flaxName); }

    isFlax(name: string | null | undefined): boolean {
        return (name ?? '').toLowerCase().includes(this.flaxName.toLowerCase());
    }

    atField(): boolean {
        const here = Game.tile();
        return here !== null && this.fieldTile.distanceTo(here) <= FIELD_SCOPE;
    }

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

    flaxLocAt(x: number, z: number, level: number): Loc | null {
        return Locs.query()
            .name(this.flaxName)
            .action(this.pickOp)
            .where(l => l.tile().x === x && l.tile().z === z && l.tile().level === level)
            .nearest();
    }

    flaxStillAt(tile: Tile): boolean {
        return this.flaxLocAt(tile.x, tile.z, tile.level) !== null;
    }

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

    boxedByFlax(): boolean {
        if (!Inventory.isFull()) { return false; }
        const pocket = this.pocketTiles(POCKET_CAP);
        return pocket.length < POCKET_CAP && this.boundaryFlax(pocket).length > 0;
    }

    private async dropFlax(n: number): Promise<void> {
        for (let i = 0; i < n; i++) {
            const flax = Inventory.items().find(it => this.isFlax(it.name));
            if (!flax) { return; }
            const before = this.flaxCount();
            if (!(await flax.interact('Drop'))) { return; }
            await Execution.delayUntil(() => this.flaxCount() < before, 2000);
        }
    }

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

    private async walkLocal(dest: Tile, radius: number): Promise<boolean> {
        let last: { x: number; z: number } | null = null;
        for (let w = 0; w < 30; w++) {
            const now = Game.tile();
            if (now && dest.distanceTo(now) <= radius) { return true; }
            const local = reader.toLocal(dest.x, dest.z);
            if (!local) { return false; }
            actions.walkTo(local.lx, local.lz);
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

    async travelTo(dest: Tile, radius: number): Promise<boolean> {
        if (reader.toLocal(dest.x, dest.z) !== null && await this.walkLocal(dest, radius)) {
            return true;
        }
        return Traversal.walkResilient(dest, { radius: Math.max(radius, 2), attempts: 4, timeoutMs: 180_000, log: m => this.log(`  ${m}`) });
    }

    async bankRun(): Promise<boolean> {
        const log = (m: string): void => this.log(`  ${m}`);
        const had = this.flaxCount();
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
        this.setStatus('returning to the field');
        await this.travelTo(this.bankEntrance, 1);
        await this.travelTo(this.fieldGate, 0);
        await this.travelTo(this.fieldTile, FIELD_ARRIVE);
        return true;
    }
}

class EscapeFlaxTrap implements Task {
    constructor(private bot: FlaxPicker) {}
    validate(): boolean { return this.bot.boxedByFlax(); }
    async execute(): Promise<void> { await this.bot.carveOut(); }
}

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

class BankTrip implements Task {
    constructor(private bot: FlaxPicker) {}
    validate(): boolean { return Inventory.isFull(); }
    async execute(): Promise<void> { await this.bot.bankRun(); }
}

class Pick implements Task {
    constructor(private bot: FlaxPicker) {}
    validate(): boolean {
        return !Inventory.isFull() && this.bot.atField() && this.bot.nearestFlax() !== null;
    }
    async execute(): Promise<void> {
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
