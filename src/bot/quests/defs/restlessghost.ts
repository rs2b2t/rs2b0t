import { Execution } from '../../api/Execution.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import Tile from '../../api/Tile.js';
import { talkThrough, walkWithHops, type NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { F2P } from '../data/f2p.js';
import { WIZARD_HOPS } from './runemysteries.js';

// Facts: father_aereck.rs2, father_urhney.rs2, restless_ghost.rs2,
// quest_priest.rs2 (see the plan's Task 10 research block for line cites).
const AMULET = 'Ghostspeak amulet';
const SKULL = 'Skull';

// Anchors map-derived (npc 456 spawn m50_50 -> (3244,3206); npc 458 spawn
// m50_49 -> (3235,3153) — the SE-swamp shack, NOT classic RS2's west shack,
// which cost a live 40-min wedge on 2026-07-16; pack-pathable cost 224 from
// Aereck incl. the shack door).
const AERECK: NpcStop = { npc: 'Father Aereck', anchor: new Tile(3244, 3206, 0), leash: 6, prefer: ["I'm looking for a quest!"] };
const URHNEY: NpcStop = {
    npc: 'Father Urhney', anchor: new Tile(3235, 3154, 0), leash: 6,
    prefer: ['Father Aereck sent me to talk to you.', "He's got a ghost haunting his graveyard.", "I've lost the amulet."]
};
const GHOST_PREFER = ['Yep, now tell me what the problem is.'];
const COFFIN_STAND = new Tile(3250, 3193, 0); // beside the coffin (shutghostcoffin 2145 @ (3249,3192), m50_49)
const SKULL_TILE = new Tile(3120, 9565, 0);   // basement altar room (quest_priest.rs2:74)

/** Open the coffin when its shut variant (op Open) is present; already-open
 *  (op Close) is left alone. Opening/searching also SPAWNS the ghost
 *  (check_restlessghost_spawn — there is no static ghost spawn). */
async function ensureCoffinOpen(log: (m: string) => void): Promise<void> {
    const shut = Locs.query().name('Coffin').action('Open').within(6).nearest();
    if (shut) {
        await shut.interact('Open');
        await Execution.delayTicks(2);
    }
}

/** Graveyard talk then basement grab, idempotent: re-talking a stage-3+ ghost
 *  is a harmless status line; a stage-gated skull grab ("looks scary") gains
 *  nothing and the next pass re-talks. Two passes worst case. */
async function ghostAndSkull(log: (m: string) => void): Promise<boolean> {
    if (!(await walkWithHops(COFFIN_STAND, 2, WIZARD_HOPS, log))) {
        return false;
    }
    await ensureCoffinOpen(log);
    if (!Npcs.query().name('Restless ghost').within(8).nearest()) {
        log('no ghost after opening the coffin — re-check next loop');
        return false;
    }
    if (!(await talkThrough('Restless ghost', GHOST_PREFER, log))) {
        return false;
    }
    if (!(await walkWithHops(SKULL_TILE, 2, WIZARD_HOPS, log))) {
        return false;
    }
    const skull = GroundItems.query().name(SKULL).within(10).nearest();
    if (!skull) {
        log('no Skull ground item in the altar room');
        return false;
    }
    if (!(await skull.interact('Take'))) {
        return false;
    }
    // skeleton spawns the same tick (quest_priest.rs2:74-77) — do NOT fight;
    // success = skull in pack, and the next decide() walks us straight out.
    return Execution.delayUntil(() => Inventory.contains(SKULL), 8000);
}

/** Skull onto the OPEN coffin (shut coffin refuses — quest_priest.rs2:46-51). */
async function returnSkull(log: (m: string) => void): Promise<boolean> {
    if (!(await walkWithHops(COFFIN_STAND, 2, WIZARD_HOPS, log))) {
        return false;
    }
    await ensureCoffinOpen(log);
    const coffin = Locs.query().name('Coffin').within(6).nearest();
    const skull = Inventory.first(SKULL);
    if (!coffin || !skull) {
        return false;
    }
    if (!(await skull.useOn(coffin))) {
        return false;
    }
    return Execution.delayUntil(() => !Inventory.contains(SKULL), 8000);
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: AERECK }; }
    if (snap.inv.has('skull')) { return { kind: 'custom', name: 'return skull', run: returnSkull }; }
    const amuletLower = AMULET.toLowerCase();
    if (!snap.inv.has(amuletLower) && !snap.worn.has(amuletLower)) {
        return { kind: 'talk', stop: URHNEY }; // first visit AND lost-amulet recovery
    }
    if (!snap.worn.has(amuletLower)) {
        return { kind: 'equip', item: AMULET }; // ghost gate checks WORN (restless_ghost.rs2:15)
    }
    return { kind: 'custom', name: 'ghost + skull', run: ghostAndSkull };
}

export const restlessghost: QuestModule = {
    record: F2P.find(r => r.id === 'priest')!,
    hops: WIZARD_HOPS,
    decide
};
