import type Tile from '../../geometry/Tile.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import { EventSignal } from '../execution/EventSignal.js';
import { Execution } from '../execution/Execution.js';
import { Game } from '../game/Game.js';
import { Inventory } from '../inventory/Inventory.js';
import { Locs, type Loc } from '../locs/Locs.js';
import { ChatDialog } from '../ui/dialogue/ChatDialog.js';

export const POCKET_CAP = 40;
export const CARVE_DROP = 5;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export function flaxAt(name: string, op: string, x: number, z: number, level: number): Loc | null {
    return Locs.query().name(name).action(op).where(loc => {
        const tile = loc.tile();
        return tile.x === x && tile.z === z && tile.level === level;
    }).nearest();
}

export function findFlaxBoundary(flaxAtTile: (x: number, z: number, level: number) => Loc | null): Loc[] | null {
    const start = Game.tile();
    if (!start) return [];
    const pocket = [start];
    const visited = new Set([`${start.x},${start.z}`]);
    for (let i = 0; i < pocket.length; i++) {
        const tile = pocket[i];
        for (const [dx, dz] of DIRECTIONS) {
            const next = { x: tile.x + dx, z: tile.z + dz, level: tile.level };
            const key = `${next.x},${next.z}`;
            if (visited.has(key) || !Reachability.canStep(tile, next)) continue;
            visited.add(key);
            pocket.push(next);
        }
        if (pocket.length >= POCKET_CAP) return null;
    }

    const level = Game.tile()?.level ?? 0;
    const walls: Loc[] = [];
    for (const tile of pocket) {
        for (const [dx, dz] of DIRECTIONS) {
            const x = tile.x + dx;
            const z = tile.z + dz;
            const key = `${x},${z}`;
            if (visited.has(key)) continue;
            visited.add(key);
            const flax = flaxAtTile(x, z, level);
            if (flax) walls.push(flax);
        }
    }
    return walls;
}

export function flaxBlocksExit(name: string, op: string): boolean {
    const walls = findFlaxBoundary((x, z, level) => flaxAt(name, op, x, z, level));
    return walls !== null && walls.length > 0;
}

export async function carveFlaxPocket(options: {
    name: string;
    op: string;
    gate: Tile;
    timing: 'ticks' | 'time';
    log: (message: string) => void;
}): Promise<void> {
    const { name, op, gate, timing, log } = options;
    const lookup = (x: number, z: number, level: number) => flaxAt(name, op, x, z, level);
    const wait = (ready: () => boolean, ticks: number, ms: number) =>
        timing === 'ticks' ? Execution.delayUntilTicks(ready, ticks) : Execution.delayUntil(ready, ms);

    async function dropFlax(): Promise<void> {
        for (let i = 0; i < CARVE_DROP; i++) {
            const flax = Inventory.items().find(item => (item.name ?? '').toLowerCase().includes(name.toLowerCase()));
            if (!flax) return;
            const before = Inventory.count(name);
            if (!(await flax.interact('Drop'))) return;
            await wait(() => Inventory.count(name) < before, 4, 2000);
        }
    }

    await dropFlax();
    for (let i = 0; i < 20; i++) {
        if (ChatDialog.canContinue() || EventSignal.pending()) return;
        const walls = findFlaxBoundary(lookup);
        if (walls === null) {
            log('carved back out to open ground');
            return;
        }
        if (!walls.length) return;
        if (Inventory.isFull()) await dropFlax();
        const target = walls.sort((a, b) => a.tile().distanceTo(gate) - b.tile().distanceTo(gate))[0];
        const tile = target.tile();
        if (!(await target.interact(op))) {
            await Execution.delayTicks(2);
            continue;
        }
        await wait(() => lookup(tile.x, tile.z, tile.level) === null, 7, 4000);
    }
}
