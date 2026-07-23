import { Execution } from '../../api/Execution.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import Tile from '../../api/Tile.js';
import { talkThrough, walkWithHops, type NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';
import { WIZARD_HOPS } from './runemysteries.js';

const AMULET = 'Ghostspeak amulet';
const SKULL = 'Skull';

const AERECK: NpcStop = { npc: 'Father Aereck', anchor: new Tile(3244, 3206, 0), leash: 6, prefer: ["I'm looking for a quest!"] };
const URHNEY: NpcStop = {
    npc: 'Father Urhney', anchor: new Tile(3235, 3154, 0), leash: 6,
    prefer: ['Father Aereck sent me to talk to you.', "He's got a ghost haunting his graveyard.", "I've lost the amulet."]
};
const GHOST_PREFER = ['Yep, now tell me what the problem is.'];
const COFFIN_STAND = new Tile(3250, 3193, 0);
const SKULL_TILE = new Tile(3120, 9565, 0);

async function ensureCoffinOpen(_log: (m: string) => void): Promise<void> {
    const shut = Locs.query().name('Coffin').action('Open').within(6).nearest();
    if (shut) {
        await shut.interact('Open');
        await Execution.delayTicks(2);
    }
}

async function grabSkull(log: (m: string) => void): Promise<boolean> {
    for (let cycle = 0; cycle < 10; cycle++) {
        const skull = GroundItems.query().name(SKULL).within(10).nearest();
        if (skull) {
            await skull.interact('Take');
            if (await Execution.delayUntil(() => Inventory.contains(SKULL), 8000)) {
                return true;
            }
            log('lost the skull to another quester — waiting for it to respawn');
        } else {
            log('altar skull already taken — waiting for the shared spawn to respawn');
        }
        await Execution.delayUntil(() => !!GroundItems.query().name(SKULL).within(10).nearest(), 70000);
    }
    log('altar skull never returned — re-entering to re-check the ghost trip');
    return false;
}

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
    return grabSkull(log);
}

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
        return { kind: 'talk', stop: URHNEY };
    }
    if (!snap.worn.has(amuletLower)) {
        return { kind: 'equip', item: AMULET };
    }
    return { kind: 'custom', name: 'ghost + skull', run: ghostAndSkull };
}

export const restlessghost: QuestModule = {
    record: QUESTS.find(r => r.id === 'priest')!,
    bank: new Tile(3093, 3243, 0),
    tools: ['ghostspeak amulet', 'skull'],
    hops: WIZARD_HOPS,
    decide
};
