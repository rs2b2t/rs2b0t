import { actions } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import Tile from '../../api/Tile.js';
import { Bank } from '../../api/hud/Bank.js';
import { Equipment } from '../../api/hud/Equipment.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { nearestBank } from '../../api/BankLocations.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
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
            // SolveClue.bankFirst pattern: nearest known bank -> openNearest -> withdrawX
            const here = Game.tile();
            const bank = here ? nearestBank(here) : null;
            if (!bank) {
                log('withdraw: no known bank');
                return false;
            }
            if (!(await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 6, timeoutMs: 300_000, log }))) {
                return false;
            }
            if (!(await Bank.openNearest(BANK_NAME, BANK_OP, log))) {
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
        case 'mineRock': {
            // GatheringBot mining idiom, minimal: interact the named rock, wait for ore.
            // Deliberately NAIVE — matches by loc NAME, but every rock is literally
            // named "Rocks" in-game. Task 8 (Doric) refines this to resolve the ore
            // type via MiningRocks.ts's rock-id mapping so rock: 'Clay' mines clay.
            const before = Inventory.count(step.item);
            if (before >= step.qty) {
                return true;
            }
            const rock = Locs.query().name(step.rock).action('Mine').within(10).nearest();
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
