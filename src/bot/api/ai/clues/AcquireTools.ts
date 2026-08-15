// docs/reference/clues-mechanics.md#tool-acquisition
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { GroundItems } from '#/bot/api/grounditems/GroundItems.js';
import { gotoNpc, talkThrough, type NpcStop } from '#/bot/api/ai/quests/exec/primitives.js';
import { CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import { Shop } from '#/bot/api/shop/Shop.js';
import { COINS } from '#/bot/api/acquisition/ToolAcquire.js';
import {
    KOJO, KOJO_EXIT, MURPHY, PROFESSOR, SPADE_NAME, SPADE_SPAWNS, TRIO,
    extraItemShop, gateItemShop, nextCoordTool, type HeldTrio
} from '#/bot/api/ai/clues/data/toolAcquire.js';

const SPADE_OBJ_ID = 952;
const WALK_ATTEMPTS = 4;
const WALK_TIMEOUT_MS = 120_000;
const TAKE_WAIT_MS = 3000;
const TOOL_WAIT_MS = 3000;
const CHAIN_GUARD = 8;
const HOP_ATTEMPTS = 4;
const HOP_TIMEOUT_MS = 90_000;
const HOP_ARRIVE_RADIUS = 4;
const CHAIN_DEADLINE_MS = 480_000;

function heldTrio(): HeldTrio {
    return {
        sextant: Inventory.first('Sextant') !== null,
        watch: Inventory.first('Watch') !== null,
        chart: Inventory.first('Chart') !== null
    };
}

export function hasAllTrio(): boolean {
    return TRIO.every(n => Inventory.first(n) !== null);
}

export function hasCoordClueHeld(): boolean {
    return Inventory.items().some(i => CLUE_DB[i.id]?.needsSextant === true);
}

async function travelToStop(stop: NpcStop, log: (m: string) => void): Promise<boolean> {
    await Traversal.walkResilient(stop.anchor, { radius: HOP_ARRIVE_RADIUS, attempts: HOP_ATTEMPTS, timeoutMs: HOP_TIMEOUT_MS, log: m => log(`  ${m}`) });
    return gotoNpc(stop, [], log);
}

export async function ensureSpade(log: (m: string) => void): Promise<boolean> {
    if (Inventory.first(SPADE_NAME) !== null) {
        return true;
    }
    const here = Game.tile();
    const spawns = here
        ? [...SPADE_SPAWNS].sort((a, b) => a.distanceTo(here) - b.distanceTo(here))
        : SPADE_SPAWNS;
    for (const spawn of spawns) {
        if (EventSignal.pending()) {
            return false;
        }
        log(`acquiring a spade — walking to (${spawn.x},${spawn.z})`);
        await Traversal.walkResilient(spawn, { radius: 1, attempts: WALK_ATTEMPTS, timeoutMs: WALK_TIMEOUT_MS, log: m => log(`  ${m}`) });
        const spade = GroundItems.query().where(g => g.id === SPADE_OBJ_ID || (g.name ?? '').toLowerCase() === 'spade').nearest();
        if (spade) {
            if (spade.distance() > 1) {
                await Traversal.walkResilient(spade.tile(), { radius: 1, attempts: 2, timeoutMs: WALK_TIMEOUT_MS, log: m => log(`  ${m}`) });
            }
            await spade.interact('Take');
            if (await Execution.delayUntil(() => Inventory.first(SPADE_NAME) !== null, TAKE_WAIT_MS)) {
                log('got a spade');
                return true;
            }
        }
        log(`no spade at (${spawn.x},${spawn.z}) — trying the next spawn`);
    }
    return false;
}

/**
 * Buy the extra items a clue row lists in `items` (today: the Baxtorian Rope).
 * Why: bank prep withdraws them when the bank has one, and without this path the trail abandons over 18gp.
 */
export async function ensureExtraItems(names: readonly string[], log: (m: string) => void): Promise<boolean> {
    let bought = false;
    for (const name of names) {
        if (Inventory.first(name) !== null) {
            continue;
        }
        if (EventSignal.pending()) {
            return bought;
        }
        const shop = extraItemShop(name);
        if (!shop) {
            log(`no shop known for '${name}' — cannot acquire it`);
            continue;
        }
        if (Inventory.count(COINS) < shop.cost) {
            log(`need ~${shop.cost} coins for '${name}' and hold ${Inventory.count(COINS)} — skipping the shop trip`);
            continue;
        }
        log(`acquiring ${name} — walking to ${shop.npc} at (${shop.stand.x},${shop.stand.z})`);
        await Traversal.walkResilient(shop.stand, {
            radius: HOP_ARRIVE_RADIUS,
            attempts: WALK_ATTEMPTS,
            timeoutMs: WALK_TIMEOUT_MS,
            log: m => log(`  ${m}`)
        });
        if (!(await Shop.open(shop.npc))) {
            log(`${shop.npc}'s shop did not open — leaving '${name}' unacquired`);
            continue;
        }
        const got = await Shop.buy(name, 1);
        await Shop.close();
        if (got > 0 && (await Execution.delayUntil(() => Inventory.first(name) !== null, TOOL_WAIT_MS))) {
            log(`bought ${name}`);
            bought = true;
        } else {
            log(`${shop.npc} had no '${name}' in stock`);
        }
    }
    return bought;
}

// Why: `missing` comes from the walker's own diagnosis, so this fires only for a crossing the bot planned to use — no speculative shopping trips.
// Why: coins are skipped because no counter sells them.

/** Buy the crossing tolls the navigator says a route is short of. */
export async function ensureGateItems(
    missing: readonly { name: string; count: number }[],
    log: (m: string) => void
): Promise<boolean> {
    let bought = false;
    for (const want of missing) {
        if (EventSignal.pending()) {
            return bought;
        }
        if (want.name.toLowerCase() === COINS.toLowerCase()) {
            log(`route needs ${want.count} more ${COINS} — no shop sells those`);
            continue;
        }
        const shop = gateItemShop(want.name);
        if (!shop) {
            log(`route is short ${want.count}x '${want.name}' and no counter is known for it`);
            continue;
        }
        const price = shop.cost * want.count;
        if (Inventory.count(COINS) < price) {
            log(`need ~${price} coins for ${want.count}x '${want.name}' and hold ${Inventory.count(COINS)}`);
            continue;
        }
        log(`route is short ${want.count}x '${want.name}' — buying from ${shop.npc} at (${shop.stand.x},${shop.stand.z})`);
        await Traversal.walkResilient(shop.stand, {
            radius: HOP_ARRIVE_RADIUS,
            attempts: WALK_ATTEMPTS,
            timeoutMs: WALK_TIMEOUT_MS,
            log: m => log(`  ${m}`)
        });
        if (!(await Shop.open(shop.npc))) {
            log(`${shop.npc}'s shop did not open — leaving '${want.name}' unacquired`);
            continue;
        }
        const before = Inventory.count(want.name);
        const got = await Shop.buy(want.name, want.count);
        await Shop.close();
        if (got > 0 && (await Execution.delayUntil(() => Inventory.count(want.name) > before, TOOL_WAIT_MS))) {
            log(`bought ${Inventory.count(want.name) - before}x ${want.name}`);
            bought = true;
        } else {
            log(`${shop.npc} had no '${want.name}' in stock`);
        }
    }
    return bought;
}

export async function ensureCoordTools(log: (m: string) => void): Promise<boolean> {
    if (hasAllTrio()) {
        return true;
    }
    if (!hasCoordClueHeld()) {
        log('coord-tool chain needs a coordinate clue held — skipping');
        return false;
    }
    const deadline = performance.now() + CHAIN_DEADLINE_MS;
    for (let guard = 0; guard < CHAIN_GUARD && !hasAllTrio(); guard++) {
        if (EventSignal.pending()) {
            return false;
        }
        if (performance.now() > deadline) {
            log('coord-tools: chain exceeded its time budget — abandoning (likely a stuck door en route)');
            return false;
        }
        const need = nextCoordTool(heldTrio());
        if (need === null) {
            break;
        }
        if (need === 'sextant') {
            log('coord-tools: learning from the professor, then Murphy for the sextant');
            if (await travelToStop(PROFESSOR, log)) {
                await talkThrough(PROFESSOR.npc, PROFESSOR.prefer, log);
            }
            if (EventSignal.pending()) {
                return false;
            }
            if (await travelToStop(MURPHY, log)) {
                await talkThrough(MURPHY.npc, MURPHY.prefer, log);
            }
            await Execution.delayUntil(() => Inventory.first('Sextant') !== null, TOOL_WAIT_MS);
            if (Inventory.first('Sextant') === null) {
                log('coord-tools: Murphy did not yield a sextant — abandoning the chain');
                return false;
            }
        } else if (need === 'watch') {
            log('coord-tools: Brother Kojo for the watch');
            if (await travelToStop(KOJO, log)) {
                await talkThrough(KOJO.npc, KOJO.prefer, log);
            }
            await Execution.delayUntil(() => Inventory.first('Watch') !== null, TOOL_WAIT_MS);
            if (Inventory.first('Watch') === null) {
                log('coord-tools: Kojo did not yield a watch — abandoning the chain');
                return false;
            }
        } else {
            log('coord-tools: back to the professor for the chart');
            const here = Game.tile();
            if (here && KOJO.anchor.distanceTo(here) <= 15) {
                log(`coord-tools: exiting the Clock Tower via (${KOJO_EXIT.x},${KOJO_EXIT.z}) to dodge the locked door`);
                await Traversal.walkResilient(KOJO_EXIT, { radius: 1, attempts: 3, timeoutMs: 60_000, log: m => log(`  ${m}`) });
            }
            if (await travelToStop(PROFESSOR, log)) {
                await talkThrough(PROFESSOR.npc, PROFESSOR.prefer, log);
            }
            await Execution.delayUntil(() => Inventory.first('Chart') !== null, TOOL_WAIT_MS);
            if (Inventory.first('Chart') === null) {
                log('coord-tools: the professor did not yield a chart — abandoning the chain');
                return false;
            }
        }
    }
    return hasAllTrio();
}
