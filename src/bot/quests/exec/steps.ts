import { actions } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import Tile from '../../api/Tile.js';
import { Bank } from '../../api/hud/Bank.js';
import { Equipment } from '../../api/hud/Equipment.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Shop } from '../../api/hud/Shop.js';
import { nearestBank } from '../../api/BankLocations.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import { ROCK_TYPES } from '../../scripts/MiningRocks.js';
import type { QuestStep } from '../engine/types.js';
import { gotoNpc, talkThrough, type LadderHop } from './primitives.js';

// The single live-I/O dispatcher for a QuestStep. Every executor is a thin
// wrapper over an already-proven leg pattern from an existing bot (cited per
// case). Decision logic lives in the pure decide()/gather() evaluators (Tasks
// 1–3) and is unit-tested there; this module only performs the I/O, so its
// verification is typecheck + the Task 12 live smoke, not unit tests.

const BANK_NAME = 'Bank booth';
const BANK_OP = 'Use-quickly';

/** Walk within `radius` of anchor unless already there (walkResilient — the
 *  clue-solver leg pattern, SolveClue.bankFirst). */
/** Shared bank-leg prologue (SolveClue.bankFirst pattern): resolve the target
 *  bank — explicit `override` where the geometric nearest is gated/unreachable,
 *  else nearest known — walk there resiliently, open the booth. False fails
 *  the caller's step, which re-enters next loop. Exported for quest legs that
 *  need a bank op the step kinds don't cover (a targeted single-item deposit). */
export async function openBankLeg(noBankMsg: string, override: Tile | undefined, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    const bankTile = override ?? (here ? nearestBank(here)?.tile : undefined);
    if (!bankTile) {
        log(noBankMsg);
        return false;
    }
    if (!(await Traversal.walkResilient(bankTile, { radius: 3, attempts: 6, timeoutMs: 300_000, log }))) {
        return false;
    }
    return Bank.openNearest(BANK_NAME, BANK_OP, log);
}

async function ensureAt(anchor: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && anchor.distanceTo(here) <= radius) {
        return true;
    }
    return Traversal.walkResilient(anchor, { radius, attempts: 3, timeoutMs: 90_000, log });
}

/**
 * Execute one QuestStep. True = the step ran to its success signal; false =
 * re-decide next loop (walk failed, target missing, timeout).
 */
export async function executeStep(step: QuestStep, hops: LadderHop[], log: (m: string) => void): Promise<boolean> {
    switch (step.kind) {
        case 'talk': {
            if (!(await gotoNpc(step.stop, hops, log))) {
                return false;
            }
            return talkThrough(step.stop.npc, step.stop.prefer, log);
        }
        case 'grabGround': {
            // CooksAssistant GetEgg pattern: take if visible, else walk the anchor
            const before = Inventory.count(step.item);
            const g = GroundItems.query().name(step.item).within(12).nearest();
            if (!g) {
                return ensureAt(step.anchor, 2, log);
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
            // Item-on-item (targetKind 'item'): both operands are in the pack, so
            // no walk is needed and `anchor` is ignored — resolve the target from
            // the backpack and dispatch InvItem.useOn(InvItem) (driver-supported).
            // Mirrors the npc/loc cases below for the held item + product wait.
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
                // COUNT increase, not contains(): repeat products (Ball of wool
                // x20) are already present from the previous pass.
                const product = step.product;
                return Execution.delayUntil(() => Inventory.count(product) > beforeProduct, 10_000);
            }
            await Execution.delayTicks(3);
            return true;
        }
        case 'equip':
            return Equipment.equip(step.item);
        case 'withdraw': {
            if (!(await openBankLeg('withdraw: no known bank', step.bank, log))) {
                return false;
            }
            let ok = true;
            for (const it of step.items) {
                if (!(await Bank.withdrawX(it.name, it.qty))) {
                    log(`withdraw: '${it.name}' x${it.qty} failed`);
                    ok = false;
                }
            }
            // No Bank.close() in this codebase — the proven close idiom is
            // actions.closeModal() (Shop.close, StrangeBox), which sends the real
            // CLOSE_MODAL packet so the server's [if_close] trigger runs, not just
            // a local reset.
            actions.closeModal();
            return ok;
        }
        case 'deposit': {
            // Deposit everything whose LOWERCASED name matches none of the keep
            // substrings (SolveClue.bankFirst's keep-set idiom). Worn equipment
            // is not in the backpack, so it is untouched.
            if (!(await openBankLeg('deposit: no known bank', step.bank, log))) {
                return false;
            }
            const kept = (name: string): boolean => {
                const n = name.toLowerCase();
                return step.keep.some(k => n.includes(k));
            };
            await Bank.depositAllMatching(name => !kept(name));
            actions.closeModal();
            return true;
        }
        case 'buy': {
            const before = Inventory.count(step.item);
            // Coins first: withdraw the estimate at the nearest bank when the
            // pack can't cover it (the withdraw-leg idiom, same as the withdraw
            // case; estGp deliberately overshoots so price climb mid-purchase
            // doesn't strand us — ShopRunner's est×1.25 lesson).
            if (Inventory.count('Coins') < step.estGp) {
                if (!(await openBankLeg('buy: no known bank for coins', undefined, log))) {
                    return false;
                }
                await Bank.withdrawX('Coins', step.estGp);
                actions.closeModal();
                if (Inventory.count('Coins') < step.estGp) {
                    log(`buy: bank could not cover ${step.estGp} gp for ${step.item}`);
                    return false; // gather fn's gpShort turns this into a parked wait next loop
                }
            }
            if (!(await ensureAt(step.shop.anchor, 3, log))) {
                return false;
            }
            // Open/close via the proven ShopBuyout idiom (ShopBuyout.ts:239,262):
            // Shop.open re-queries the Trade npc + retries the click 3× (a single
            // Trade click can silently drop, per Shop.ts:38-45), Shop.close sends
            // the real CLOSE_MODAL and awaits the window closing.
            if (!(await Shop.open(step.shop.npc))) {
                log(`buy: could not open ${step.shop.npc}'s shop near the anchor`);
                return false;
            }
            await Shop.buy(step.item, step.qty);
            await Shop.close();
            return Inventory.count(step.item) > before;
        }
        case 'mineRock': {
            // GatheringBot mining idiom: every mining rock shares the loc NAME
            // "Rocks"; only the loc ID distinguishes ore, so resolve the ore type
            // to its rock ids via MiningRocks.ROCK_TYPES (MiningRocks.ts:8-19) and
            // match by id. Item display names carry a trailing ' ore' the rock-type
            // keys lack (Copper ore -> Copper, Iron ore -> Iron); Clay passes
            // through (ores.obj:13,27,59). Then walk-to-anchor fallback + count-
            // increase success signal, same as before.
            //
            // `step.qty` is the REMAINING need (informational only): the
            // provisioning loop re-plans every iteration and decides when enough
            // is enough — the executor's job is exactly ONE mining action per
            // invocation, with success = the count increase awaited below. A
            // former `if (count >= qty) return true` short-circuit compared TOTAL
            // HELD against REMAINING NEED and froze the run at have=need (live:
            // Doric mined Clay 0->1->2->3 then span forever at Clay x3, the
            // watchdog seeing no change and parking); it is deliberately gone.
            const before = Inventory.count(step.item);
            const rockType = step.rock.replace(/ ore$/i, '');
            const rockIds = ROCK_TYPES[rockType];
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
