import Tile from '../../geometry/Tile.js';
import { Game } from '../../api/game/Game.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { DirectNavigator } from '../../event/webwalk/DirectNavigator.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import { ID, KEY_CHESTS, keyTier } from './data.js';

const T = (x: number, z: number) => new Tile(3456 + x, 9664 + z, 0);
const rows = [
    [4109, 5, 29, 0, 0, 1], [4109, 5, 38, 0, 0, 2], [4109, 5, 47, 0, 0, 3], [4109, 5, 56, 0, 0, 4],
    [4108, 9, 3, 0, 5, 6], [4108, 9, 10, 0, 5, 7], [4108, 9, 17, 0, 5, 8], [4108, 9, 23, 0, 5, 9],
    [4109, 11, 32, 0, 10, 0], [4107, 15, 46, 1, 10, 11],
    [4108, 16, 3, 2, 5, 12], [4108, 16, 10, 2, 5, 13], [4108, 16, 17, 2, 5, 14],
    [4106, 23, 59, 0, 15, 16], [4107, 30, 46, 1, 10, 17],
    [4108, 33, 3, 0, 5, 18], [4108, 33, 10, 0, 5, 19], [4108, 33, 17, 0, 5, 20],
    [4107, 37, 48, 3, 15, 10], [4107, 42, 46, 1, 10, 22], [4107, 48, 46, 1, 10, 23],
    [4106, 48, 59, 2, 15, 24], [4108, 55, 32, 2, 10, 5],
    [4107, 55, 46, 1, 10, 25], [4107, 61, 46, 1, 10, 26]
] as const;

export const CATACOMB_DOORS = rows.map(([id, x, z, angle, from, to]) => {
    const [dx, dz] = [[-1, 0], [0, 1], [1, 0], [0, -1]][angle];
    return { id, at: T(x, z), across: T(x + dx, z + dz), from, to, tier: id - 4106 };
});

type Door = typeof CATACOMB_DOORS[number];
export interface DoorStep { door: Door; stand: Tile; land: Tile; from: number; to: number }

export function catacombPath(from: number, to: number, counts: ReadonlyMap<number, number>): DoorStep[] | null {
    const tier = Math.max(-1, ...[...counts].filter(([, count]) => count > 0).map(([id]) => keyTier(id)));
    const seen = new Set([from]);
    const queue: { area: number; path: DoorStep[] }[] = [{ area: from, path: [] }];
    for (let i = 0; i < queue.length; i++) {
        const node = queue[i];
        if (node.area === to) return node.path;
        for (const door of CATACOMB_DOORS) {
            const entering = door.from === node.area;
            if (!entering && door.to !== node.area) continue;
            if (entering && tier < door.tier) continue;
            const next = entering ? door.to : door.from;
            if (seen.has(next)) continue;
            seen.add(next);
            queue.push({ area: next, path: [...node.path, {
                door, stand: entering ? door.at : door.across, land: entering ? door.across : door.at,
                from: node.area, to: next
            }] });
        }
    }
    return null;
}

export const CAMPS = [new Tile(3490, 3290), T(38, 58), T(32, 40), T(49, 21), T(7, 34)];
export const CAMP_AREAS = [-1, 15, 10, 5, 0];
export const PYRE_TILE = new Tile(3504, 3275);

const chestRows = [
    [16, 19, 62], [16, 18, 57], [16, 15, 62], [16, 14, 57], [16, 12, 59],
    [11, 15, 49], [11, 20, 50], [11, 15, 52], [11, 20, 53], [11, 17, 54],
    [6, 7, 1], [6, 5, 1], [6, 3, 4], [6, 2, 1], [6, 1, 2],
    [1, 2, 30], [1, 2, 28], [2, 2, 40], [3, 1, 49], [4, 3, 55]
] as const;
export const CHEST_ROOMS = new Map(chestRows.map(([area, x, z], i) => [3450 + i, { area, tile: T(x, z) }]));
export const inCatacombs = () => { const t = Game.tile(); return !!t && t.level === 0 && t.x >= 3456 && t.x < 3520 && t.z >= 9664 && t.z < 9728; };
export const inventoryCounts = () => new Map(KEY_CHESTS.map(key => [key.id, Inventory.countById(key.id)]));

export class MorttonRoute {
    constructor(private log: (message: string) => void, private upkeep: () => Promise<boolean>) {}

    private async ready(combat: boolean): Promise<boolean> {
        if (EventSignal.pending()) return false;
        const ready = await this.upkeep();
        if (ready || !combat) return true;
        await this.exit();
        return false;
    }

    async local(tile: Tile, radius = 0, combat = true): Promise<boolean> {
        for (let tick = 0; tick < 90; tick++) {
            if (!(await this.ready(combat))) return false;
            const me = Game.tile();
            if (!me || me.level !== tile.level) return false;
            if (Math.max(Math.abs(me.x - tile.x), Math.abs(me.z - tile.z)) <= radius) return true;
            if (tick % 3 === 0 && !(await DirectNavigator.walk(tile))) return false;
            await Execution.delayTicks(1);
        }
        return false;
    }

    async area(target: number, combat = true): Promise<boolean> {
        if (!inCatacombs()) {
            if (target < 0) return true;
            if (![...inventoryCounts()].some(([, count]) => count > 0)) return false;
            if (!(await Traversal.walkResilient(new Tile(3485, 3322), { radius: 1, attempts: 2, timeoutMs: 180_000, log: this.log }))) return false;
            const entrance = Locs.query().where(loc => loc.id === ID.ENTRANCE_LEFT || loc.id === ID.ENTRANCE_RIGHT).nearest();
            if (!entrance || !(await entrance.interact('Open'))) return false;
            if (!(await Execution.delayUntil(inCatacombs, 8000))) return false;
            await Execution.delayUntil(Game.sceneReady, 8000);
        }
        for (let crossings = 0; crossings < 12; crossings++) {
            if (!(await this.ready(combat))) return false;
            const me = Game.tile();
            if (!me) return false;
            const reachable = CATACOMB_DOORS.flatMap(door => [
                { area: door.from, tile: door.at }, { area: door.to, tile: door.across }
            ]).filter(node => Reachability.canReach(node.tile, { maxSteps: 4096 }))
                .sort((a, b) => a.tile.distanceTo(Tile.from(me)) - b.tile.distanceTo(Tile.from(me)));
            const current = reachable[0]?.area;
            if (current === undefined) return false;
            if (current === target) return true;
            const step = catacombPath(current, target, inventoryCounts())?.[0];
            if (!step || !(await this.local(step.stand, 0, combat))) return false;
            let door = Locs.query().where(loc => loc.id === step.door.id && loc.tile().equals(step.door.at)).nearest();
            if (!door) {
                await Execution.delayTicks(4);
                door = Locs.query().where(loc => loc.id === step.door.id && loc.tile().equals(step.door.at)).nearest();
            }
            if (!door || !(await door.interact('Open'))) return false;
            if (!(await Execution.delayUntil(() => {
                const tile = Game.tile();
                return !!tile && tile.x === step.land.x && tile.z === step.land.z;
            }, 7000))) return false;
            await Execution.delayTicks(4);
        }
        return false;
    }

    async exit(): Promise<boolean> {
        if (!inCatacombs()) return true;
        if (!(await this.area(15, false)) || !(await this.local(T(37, 61), 0, false))) return false;
        const door = Locs.query().where(loc => loc.id === 4106 && loc.tile().equals(T(37, 62))).nearest();
        return !!door && !!(await door.interact('Open')) && Execution.delayUntil(() => !inCatacombs(), 8000);
    }
}
