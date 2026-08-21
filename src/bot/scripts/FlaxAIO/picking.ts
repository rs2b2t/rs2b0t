import type { Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs, type Loc } from '../../api/locs/Locs.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { travelTo } from './walking.js';
import type FlaxAIO from './flaxaio.js';

const POCKET_CAP = 40;
const CARVE_DROP = 5;

export function atField(bot: FlaxAIO): boolean {
    const here = Game.tile();
    return here !== null && bot.fieldCentre().distanceTo(here) <= bot.fieldScope();
}

export function nearestFlax(bot: FlaxAIO): Loc | null {
    const me = Game.tile();
    const flax = Locs.query()
        .name(bot.flaxName())
        .action(bot.pickOpName())
        .where(l => l.tile().distanceTo(bot.fieldCentre()) <= bot.fieldScope())
        .results();
    if (flax.length === 0) {
        return null;
    }
    if (me) {
        flax.sort((a, b) => a.tile().distanceTo(me) - b.tile().distanceTo(me));
    }
    for (const f of flax) {
        if (Reachability.canReach(f.tile(), { adjacentOk: true, maxSteps: 400 })) {
            return f;
        }
    }
    return null;
}

function flaxLocAt(bot: FlaxAIO, x: number, z: number, level: number): Loc | null {
    return Locs.query()
        .name(bot.flaxName())
        .action(bot.pickOpName())
        .where(l => l.tile().x === x && l.tile().z === z && l.tile().level === level)
        .nearest();
}

function pocketTiles(bot: FlaxAIO): { x: number; z: number }[] {
    const me = Game.tile();
    if (!me) {
        return [];
    }
    const level = me.level;
    const key = (x: number, z: number): string => `${x},${z}`;
    const seen = new Set<string>([key(me.x, me.z)]);
    const out: { x: number; z: number }[] = [{ x: me.x, z: me.z }];
    const queue: { x: number; z: number }[] = [{ x: me.x, z: me.z }];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (queue.length > 0 && out.length < POCKET_CAP) {
        const cur = queue.shift()!;
        const from = { x: cur.x, z: cur.z, level };
        for (const [dx, dz] of dirs) {
            const nx = cur.x + dx, nz = cur.z + dz, k = key(nx, nz);
            if (seen.has(k) || !Reachability.canStep(from, { x: nx, z: nz, level })) {
                continue;
            }
            seen.add(k);
            out.push({ x: nx, z: nz });
            queue.push({ x: nx, z: nz });
        }
    }
    return out;
}

function boundaryFlax(bot: FlaxAIO, pocket: { x: number; z: number }[]): Loc[] {
    const level = Game.tile()?.level ?? 0;
    const inPocket = new Set(pocket.map(t => `${t.x},${t.z}`));
    const seen = new Set<string>();
    const walls: Loc[] = [];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const p of pocket) {
        for (const [dx, dz] of dirs) {
            const nx = p.x + dx, nz = p.z + dz, k = `${nx},${nz}`;
            if (inPocket.has(k) || seen.has(k)) {
                continue;
            }
            seen.add(k);
            const flax = flaxLocAt(bot, nx, nz, level);
            if (flax) {
                walls.push(flax);
            }
        }
    }
    return walls;
}

export function boxedByFlax(bot: FlaxAIO): boolean {
    if (!Inventory.isFull()) {
        return false;
    }
    const pocket = pocketTiles(bot);
    return pocket.length < POCKET_CAP && boundaryFlax(bot, pocket).length > 0;
}

async function dropFlax(bot: FlaxAIO, n: number): Promise<void> {
    const isFlax = (name: string | null | undefined): boolean => (name ?? '').toLowerCase().includes(bot.flaxName().toLowerCase());
    for (let i = 0; i < n; i++) {
        const flax = Inventory.items().find(it => isFlax(it.name));
        if (!flax) {
            return;
        }
        const before = bot.flaxCount();
        if (!(await flax.interact('Drop'))) {
            return;
        }
        await Execution.delayUntil(() => bot.flaxCount() < before, 2000);
    }
}

export async function carveOut(bot: FlaxAIO): Promise<void> {
    bot.setStatus('boxed in by flax — carving a way out');
    bot.log('boxed in by flax with a full pack — dropping flax to pick a way out');
    await dropFlax(bot, CARVE_DROP);
    for (let n = 0; n < 20; n++) {
        if (ChatDialog.canContinue() || EventSignal.pending()) {
            return;
        }
        const pocket = pocketTiles(bot);
        if (pocket.length >= POCKET_CAP) {
            bot.log('carved back out to open ground');
            return;
        }
        const walls = boundaryFlax(bot, pocket);
        if (walls.length === 0) {
            return;
        }
        if (Inventory.isFull()) {
            await dropFlax(bot, CARVE_DROP);
        }
        const target = walls.sort((a, b) => a.tile().distanceTo(bot.fieldGate()) - b.tile().distanceTo(bot.fieldGate()))[0];
        const t = target.tile();
        if (!(await target.interact(bot.pickOpName()))) {
            await Execution.delayTicks(2);
            continue;
        }
        await Execution.delayUntil(() => flaxLocAt(bot, t.x, t.z, t.level) === null, 4000);
    }
}

export class EscapeFlaxTrap implements Task {
    constructor(private bot: FlaxAIO) {}
    validate(): boolean {
        return this.bot.picking && boxedByFlax(this.bot);
    }
    async execute(): Promise<void> {
        await carveOut(this.bot);
    }
}

export class PickTask implements Task {
    constructor(private bot: FlaxAIO) {}
    validate(): boolean {
        return this.bot.picking && !Inventory.isFull() && atField(this.bot) && nearestFlax(this.bot) !== null;
    }
    async execute(): Promise<void> {
        for (let n = 0; n < 30 && !Inventory.isFull(); n++) {
            if (ChatDialog.canContinue()) {
                return;
            }
            const flax = nearestFlax(this.bot);
            if (!flax) {
                return;
            }
            const target = flax.tile();
            this.bot.setStatus(`picking ${this.bot.flaxName()} at ${target}`);
            const before = this.bot.flaxCount();
            if (!(await flax.interact(this.bot.pickOpName()))) {
                await Execution.delayTicks(2);
                continue;
            }
            await Execution.delayUntil(
                () => this.bot.flaxCount() > before || Inventory.isFull() || ChatDialog.canContinue() || flaxLocAt(this.bot, target.x, target.z, target.level) === null,
                6000
            );
        }
    }
}

export class GoToFieldTask implements Task {
    constructor(private bot: FlaxAIO) {}
    validate(): boolean {
        return this.bot.picking && !Inventory.isFull() && nearestFlax(this.bot) === null;
    }
    async execute(): Promise<void> {
        const here = Game.tile();
        if (here && this.bot.fieldCentre().distanceTo(here) <= this.bot.fieldArrive()) {
            await Execution.delayTicks(2);
            return;
        }
        this.bot.setStatus('travelling to the flax field');
        await travelTo(this.bot, this.bot.fieldCentre(), this.bot.fieldArrive());
    }
}
