import { actions, reader } from '../../../adapter/ClientAdapter.js';
import Tile from '../../../geometry/Tile.js';
import { DirectNavigator } from '../../../event/webwalk/DirectNavigator.js';
import { Reachability } from '../../../event/webwalk/geometry/Reachability.js';
import { Equipment } from '../../equipment/Equipment.js';
import { EventSignal } from '../../execution/EventSignal.js';
import { Execution } from '../../execution/Execution.js';
import { Game } from '../../game/Game.js';
import { Inventory } from '../../inventory/Inventory.js';
import { Npcs, type Npc } from '../../npcs/Npcs.js';
import { bodyOrigin } from '../../combat/hunting/logic.js';
import { AUTO_TOGGLE_COM } from '../../combat/CombatStyleLogic.js';
import { Autocast } from '../../magic/Autocast.js';
import { Skills } from '../../skills/Skills.js';
import { Sustain } from '../../sustain/Sustain.js';
import { Traversal } from '../../walking/Traversal.js';
import { strikeSpell } from './strike.js';

export const ARENA_COVER = new Tile(2594, 3167, 0);
export const ARENA_LURE = [new Tile(2598, 3167, 0), new Tile(2598, 3169, 0), new Tile(2594, 3169, 0), ARENA_COVER];
export const DEMON_COVER = new Tile(2472, 9865, 0);
export const EXPERIMENT_COVER = new Tile(2936, 3465, 0);
export const EXPERIMENT_TRAP = new Tile(2937, 3466, 0);

export const atCover = (tile: Tile): boolean => {
    const here = reader.serverTile() ?? Game.tile();
    return here !== null && tile.equals(here);
};

export function castFromCover(spot: Tile, target: Npc): boolean {
    const centre = target.networkTile();
    const tile = { ...bodyOrigin(centre, target.size), level: centre.level };
    const distance = Math.max(tile.x - spot.x, spot.x - tile.x - target.size + 1,
        tile.z - spot.z, spot.z - tile.z - target.size + 1);
    if (tile.level !== spot.level || distance > 10 || distance < 1) return false;
    if (spot.equals(ARENA_COVER) && !((tile.x >= 2596 && tile.z >= 3166 && tile.z <= 3168) || (tile.x >= 2594 && tile.z === 3169))) return false;
    if (spot.equals(EXPERIMENT_COVER) && !EXPERIMENT_TRAP.equals(tile)) return false;
    return Reachability.lineOfSight(spot, tile, target.size);
}

export async function readyStrikes(log: (m: string) => void): Promise<boolean> {
    Game.setAutoRetaliate(false);
    if (!(await Execution.delayUntilTicks(() => !Game.autoRetaliateOn(), 5))) return false;
    if (Autocast.armed()) {
        if (!(await Game.openSideTab(0))) return false;
        actions.ifButton(AUTO_TOGGLE_COM);
        if (!(await Execution.delayUntilTicks(() => !Autocast.armed(), 5))) return false;
    }
    for (const item of Equipment.items()) {
        if (!item.name || /staff|amulet|cape|leather gloves|leather boots|robe|wizard/i.test(item.name)) continue;
        if (!(await Equipment.unequip(item.name))) { log(`need room to remove ${item.name} before casting`); return false; }
    }
    return strikeSpell(Skills.effective('magic'), rune => Inventory.count(rune)) !== null;
}

export async function takeStrikeCover(spot: Tile, log: (m: string) => void, lureTarget?: () => Npc | null): Promise<boolean> {
    if (atCover(spot) && !lureTarget) return true;
    const route = spot.equals(ARENA_COVER) ? ARENA_LURE : [spot];
    for (const tile of route) {
        if (EventSignal.pending()) return false;
        await Sustain.run();
        if (!(await Traversal.walkResilient(tile, { radius: 0, attempts: 2, timeoutMs: 30_000, log }))) return false;
        if (tile.equals(ARENA_LURE[0]!)) {
            const target = lureTarget?.();
            if (target && !target.targetsMe() && castFromCover(tile, target)) {
                if (!(await castStrike(tile, target, log))) return false;
            }
        }
    }
    return atCover(spot);
}

export async function castStrike(spot: Tile, target: Npc, log: (m: string) => void): Promise<boolean> {
    if (EventSignal.pending() || Game.autoRetaliateOn() || !atCover(spot) || !castFromCover(spot, target)) return false;
    const spell = strikeSpell(Skills.effective('magic'), rune => Inventory.count(rune));
    if (!spell) { log('out of Strike runes; holding cover'); return false; }
    const before = Inventory.count('Mind rune');
    let settled = false;
    let returning = false;
    try {
        if (!(await Game.castOnNpc(spell, target))) return false;
        for (let tick = 0; tick < 10; tick++) {
            if (EventSignal.pending()) return false;
            await Sustain.run();
            if (!atCover(spot)) {
                returning = await DirectNavigator.walk(spot);
                return false;
            }
            const current = Npcs.all().find(npc => npc.index === target.index && npc.id === target.id);
            if (Game.autoRetaliateOn() || Autocast.armed() || (current && !castFromCover(spot, current))) {
                Game.setAutoRetaliate(false);
                return false;
            }
            if (tick >= 5 && Inventory.count('Mind rune') < before) { settled = true; return true; }
            await Execution.delayTicks(1);
        }
        return false;
    } finally {
        if (!settled && !returning) {
            const here = reader.serverTile() ?? Game.tile();
            if (here) await DirectNavigator.walk(new Tile(here.x, here.z, here.level));
        }
    }
}
