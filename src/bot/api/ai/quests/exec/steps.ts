import type { WorldTile } from '../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import Tile from '../../../../geometry/Tile.js';
import { Bank } from '../../../bank/Bank.js';
import { Equipment } from '../../../equipment/Equipment.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Modals } from '../../../ui/widgets/Modals.js';
import { Shop } from '../../../shop/Shop.js';
import { bankDistance, nearestBanks } from '../../../bank/BankLocations.js';
import { Banking } from '../../../bank/Banking.js';
import { Navigator } from '../../../../event/webwalk/Navigator.js';
import { GroundItems } from '../../../grounditems/GroundItems.js';
import { Locs } from '../../../locs/Locs.js';
import { Npcs } from '../../../npcs/Npcs.js';
import { Traversal } from '../../../walking/Traversal.js';
import { QUEST_ROCK_TYPES, ROCK_TYPES } from '../../../../data/miningRocks.js';
import type { QuestStep } from '../engine/types.js';
import { gotoNpc, talkThrough, type LadderHop } from './primitives.js';

/** How deep into the straight-line shortlist to look before giving up. */
const BANK_CANDIDATES = 6;

// Why: from the Lumbridge respawn the three closest banks by air — Al Kharid, Shantay Pass and the Duel Arena — sit behind the same 10gp toll gate, and the navigator prunes a fare it cannot pay.
// Why: to a bot that has died every bank it can see is one it cannot reach, and the first it can walk to is only third on the list, so the navigator is asked for path costs.

/** The nearest bank measured by walking cost. */
async function reachableBank(from: WorldTile, log: (m: string) => void): Promise<Tile | undefined> {
    const candidates = nearestBanks(from).slice(0, BANK_CANDIDATES);
    let best: { tile: Tile; cost: number } | null = null;
    for (const bank of candidates) {
        // Why: stopping once a known route beats the next candidate's crow-flight is exact on open ground, as a walk is never shorter than the line it covers.
        // Why: a ladder or a ship can beat that line, so this can settle for a bank short of the cheapest.
        // Why: it can never settle for an unreachable bank, as nothing breaks the loop until a path has already been found.
        // Why: the common case stays at one or two pathfinds instead of six.
        if (best !== null && bankDistance(from, bank.tile) >= best.cost) {
            break;
        }
        const path = await Navigator.findPath(from, bank.tile);
        if (path.ok && (best === null || path.cost < best.cost)) {
            best = { tile: bank.tile, cost: path.cost };
        }
    }
    if (best) {
        return best.tile;
    }
    log(`no bank answered a path from (${from.x},${from.z}) — trying the closest anyway`);
    return candidates[0]?.tile;
}

export async function openBankLeg(noBankMsg: string, override: Tile | undefined, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    const bankTile = override ?? (here ? await reachableBank(here, log) : undefined);
    if (!bankTile) {
        log(noBankMsg);
        return false;
    }
    // Why: Banking.open honours Shantay's Bank chest (plus its continue) and other non-booth access.
    // Why: hardcoding "Bank booth" / Use-quickly looped forever at Shantay during Tourist Trap buys.
    return Banking.open({ stand: bankTile, log });
}

async function ensureAt(anchor: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && anchor.distanceTo(here) <= radius) {
        return true;
    }
    return Traversal.walkResilient(anchor, { radius, attempts: 3, timeoutMs: 90_000, log });
}

export async function executeStep(step: QuestStep, hops: LadderHop[], log: (m: string) => void): Promise<boolean> {
    switch (step.kind) {
        case 'talk': {
            if (!(await gotoNpc(step.stop, hops, log))) {
                return false;
            }
            return talkThrough(step.stop.npc, step.stop.prefer, log);
        }
        case 'grabGround': {
            const before = Inventory.count(step.item);
            const g = GroundItems.query().name(step.item).within(12).nearest();
            if (!g) {
                const arrived = await ensureAt(step.anchor, 2, log);
                if (arrived && step.waitIfMissing) {
                    await Execution.delayTicks(2);
                    return false;
                }
                return arrived;
            }
            if (!(await g.interact('Take'))) {
                return false;
            }
            return Execution.delayUntil(() => Inventory.count(step.item) > before, 8000);
        }
        case 'pickLoc': {
            const before = Inventory.count(step.item);
            const loc = Locs.query().name(step.loc).action(step.op).within(10).nearest();
            if (!loc) {
                return ensureAt(step.anchor, 2, log);
            }
            if (!(await loc.interact(step.op))) {
                return false;
            }
            return Execution.delayUntil(() => Inventory.count(step.item) > before, 8000);
        }
        case 'interactLoc': {
            const loc = Locs.query().name(step.loc).action(step.op).within(10).nearest();
            if (!loc) {
                return ensureAt(step.anchor, 2, log);
            }
            if (!(await loc.interact(step.op))) {
                return false;
            }
            if (step.expectItem !== undefined) {
                const item = step.expectItem;
                return Execution.delayUntil(() => Inventory.contains(item), 8000);
            }
            await Execution.delayTicks(3);
            return true;
        }
        case 'useOn': {
            if (step.targetKind === 'item') {
                const held = Inventory.first(step.item);
                if (!held) {
                    log(`useOn: no '${step.item}' in the pack`);
                    return false;
                }
                const targetItem = Inventory.first(step.target);
                if (!targetItem) {
                    log(`useOn: no '${step.target}' in the pack`);
                    return false;
                }
                const beforeProduct = step.product !== undefined ? Inventory.count(step.product) : 0;
                if (!(await held.useOn(targetItem))) {
                    return false;
                }
                if (step.product !== undefined) {
                    const product = step.product;
                    return Execution.delayUntil(() => Inventory.count(product) > beforeProduct, 10_000);
                }
                await Execution.delayTicks(3);
                return true;
            }
            if (!(await ensureAt(step.anchor, 4, log))) {
                return false;
            }
            const held = Inventory.first(step.item);
            if (!held) {
                log(`useOn: no '${step.item}' in the pack`);
                return false;
            }
            const target = step.targetKind === 'npc'
                ? Npcs.query().name(step.target).within(10).nearest()
                : Locs.query().name(step.target).within(10).nearest();
            if (!target) {
                log(`useOn: no '${step.target}' near the anchor`);
                return false;
            }
            const beforeProduct = step.product !== undefined ? Inventory.count(step.product) : 0;
            if (!(await held.useOn(target))) {
                return false;
            }
            if (step.product !== undefined) {
                const product = step.product;
                return Execution.delayUntil(() => Inventory.count(product) > beforeProduct, 10_000);
            }
            await Execution.delayTicks(3);
            return true;
        }
        case 'equip':
            return Equipment.equip(step.item);
        case 'scanBank':
            return openBankLeg('scanBank: no known bank', step.bank, log);
        case 'withdraw': {
            if (!(await openBankLeg('withdraw: no known bank', step.bank, log))) {
                return false;
            }
            let ok = true;
            for (const it of step.items) {
                const withdrawn = it.id === undefined
                    ? await Bank.withdrawX(it.name, it.qty)
                    : await Bank.withdrawXById(it.id, it.qty);
                if (!withdrawn) {
                    const exact = it.id === undefined ? '' : ` (id ${it.id})`;
                    log(`withdraw: '${it.name}'${exact} x${it.qty} failed`);
                    ok = false;
                }
            }
            if (!step.leaveOpen) {
                await Modals.close();
            }
            return ok;
        }
        case 'deposit': {
            if (!(await openBankLeg('deposit: no known bank', step.bank, log))) {
                return false;
            }
            const keepIds = new Set(step.keepIds ?? []);
            const kept = (name: string, id: number): boolean => {
                if (keepIds.has(id)) {
                    return true;
                }
                const n = name.toLowerCase();
                return step.keep.some(k => step.exactKeep ? n === k.toLowerCase() : n.includes(k.toLowerCase()));
            };
            await Bank.depositAllMatching((name, id) => !kept(name, id));
            if (!step.leaveOpen) {
                await Modals.close();
            }
            return true;
        }
        case 'buy': {
            const before = Inventory.count(step.item);
            if (Inventory.count('Coins') < step.estGp) {
                if (!(await openBankLeg('buy: no known bank for coins', undefined, log))) {
                    return false;
                }
                await Bank.withdrawX('Coins', step.estGp);
                await Modals.close();
                if (Inventory.count('Coins') < step.estGp) {
                    log(`buy: bank could not cover ${step.estGp} gp for ${step.item}`);
                    return false;
                }
            }
            if (!(await ensureAt(step.shop.anchor, 3, log))) {
                return false;
            }
            if (!(await Shop.open(step.shop.npc))) {
                log(`buy: could not open ${step.shop.npc}'s shop near the anchor`);
                return false;
            }
            await Shop.buy(step.item, step.qty);
            await Shop.close();
            return Inventory.count(step.item) > before;
        }
        case 'mineRock': {
            const before = Inventory.count(step.item);
            const rockType = step.rock.replace(/ ore$/i, '');
            const rockIds = ROCK_TYPES[rockType] ?? QUEST_ROCK_TYPES[rockType];
            if (!rockIds) {
                log(`mineRock: no rock-id mapping for '${rockType}'`);
                return false;
            }
            const idSet = new Set(rockIds);
            const rock = Locs.query().where(l => idSet.has(l.id)).action('Mine').within(10).nearest();
            if (!rock) {
                return ensureAt(step.anchor, 3, log);
            }
            if (!(await rock.interact('Mine'))) {
                return false;
            }
            return Execution.delayUntil(() => Inventory.count(step.item) > before, 20_000);
        }
        case 'custom':
            return step.run(log);
        case 'wait':
            await Execution.delayTicks(2);
            return true;
        case 'done':
            return true;
    }
}
