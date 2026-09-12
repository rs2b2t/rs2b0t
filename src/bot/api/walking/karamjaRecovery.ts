import { reader, type WorldTile } from '../../adapter/ClientAdapter.js';
import type { MissingItem } from '../../event/webwalk/bankPlan.js';
import { EventSignal } from '../execution/EventSignal.js';
import { Inventory } from '../inventory/Inventory.js';
import { LUTHAS, PT_ID } from '../ai/quests/defs/piratestreasure/areas.js';
import { fillCrate } from '../ai/quests/defs/piratestreasure/karamja.js';
import { talkStrict } from '../ai/quests/exec/primitives.js';
import { Traversal } from './Traversal.js';

const BOAT_FARE = 30;

function onIsland(tile: WorldTile): boolean {
    return tile.level === 0 && tile.x >= 2700 && tile.x < 3000 && tile.z >= 2880 && tile.z <= 3255;
}

export function missingBoatFare(from: WorldTile | null, dest: WorldTile, coins: number, missing: readonly MissingItem[]): boolean {
    return from !== null && onIsland(from) && !onIsland(dest) && coins < BOAT_FARE
        && missing.length === 1 && missing[0]!.name.toLowerCase() === 'coins'
        && coins + missing[0]!.count === BOAT_FARE;
}

let recovering = false;

export async function recoverBoatFare(dest: WorldTile, missing: readonly MissingItem[], log: (message: string) => void): Promise<boolean> {
    const coins = (): number => Inventory.countById(PT_ID.COINS);
    if (recovering || EventSignal.pending() || !missingBoatFare(reader.worldTile(), dest, coins(), missing)) {
        return false;
    }
    if (Inventory.isFull() && Inventory.countById(PT_ID.BANANA) === 0) {
        log('boat fare recovery needs one free inventory slot');
        return false;
    }
    recovering = true;
    try {
        log("no boat fare: earning 30 coins at Luthas's plantation");
        const talk = async (): Promise<boolean> => {
            if (EventSignal.pending() || !(await Traversal.walkTo(LUTHAS.anchor, { radius: 2, timeoutMs: 120_000, log }))) {
                return false;
            }
            return talkStrict(LUTHAS.npc, LUTHAS.prefer, log);
        };
        if (!(await talk())) {
            return false;
        }
        if (coins() >= BOAT_FARE) {
            return true;
        }
        if (EventSignal.pending() || !(await fillCrate(log)) || !(await talk())) {
            return false;
        }
        return coins() >= BOAT_FARE;
    } finally {
        recovering = false;
    }
}
