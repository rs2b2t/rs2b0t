import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import { actions, reader } from '../../adapter/ClientAdapter.js';
import Tile from '../../geometry/Tile.js';
import type FlaxAIO from './flaxaio.js';

export function nearestStand(bot: FlaxAIO): Tile {
    const me = Game.tile();
    const z = bot.bankStand().z;
    const level = bot.bankStand().level;
    const row: Tile[] = [];
    for (let x = bot.bankStand().x - bot.bankStandSpan(); x <= bot.bankStand().x + bot.bankStandSpan(); x++) {
        row.push(new Tile(x, z, level));
    }
    // Why: prefer a stand we can already reach, falling back to the full row if the nav graph sees none of them.
    const pool = row.filter(t => Reachability.canReach(t));
    const pick = pool.length > 0 ? pool : row;
    if (!me) {
        return pick[Math.floor(pick.length / 2)];
    }
    return pick.sort((a, b) => a.distanceTo(me) - b.distanceTo(me))[0];
}

async function walkLocal(dest: Tile, radius: number): Promise<boolean> {
    let last: { x: number; z: number } | null = null;
    for (let w = 0; w < 30; w++) {
        const now = Game.tile();
        if (now && dest.distanceTo(now) <= radius) {
            return true;
        }
        const local = reader.toLocal(dest.x, dest.z);
        if (!local) {
            return false;
        }
        actions.walkTo(local.lx, local.lz);
        await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && dest.distanceTo(t) <= radius;
        }, 1800);
        const moved = Game.tile();
        if (moved && last && moved.x === last.x && moved.z === last.z) {
            return false;
        }
        last = moved ? { x: moved.x, z: moved.z } : null;
    }
    const fin = Game.tile();
    return fin !== null && dest.distanceTo(fin) <= radius;
}

export async function travelTo(bot: FlaxAIO, dest: Tile, radius: number): Promise<boolean> {
    if (reader.toLocal(dest.x, dest.z) !== null && await walkLocal(dest, radius)) {
        return true;
    }
    return Traversal.walkResilient(dest, { radius: Math.max(radius, 2), attempts: 4, timeoutMs: 180_000, log: m => bot.log(`  ${m}`) });
}
