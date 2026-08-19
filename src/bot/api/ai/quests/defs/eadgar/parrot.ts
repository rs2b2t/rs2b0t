import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { talkStrict } from '../../exec/primitives.js';
import { driveUntil, useOnLoc } from '../../exec/prompts.js';
import { ER_ITEM, ER_LOC, ER_TILE, PETE_FEED, PETE_WHEN, banked, held } from './areas.js';
import { HECKEL, heldLiquor, scanBank, sourceKnife, sourceLiquor, withdraw } from './supplies.js';

const PINEAPPLE_PRICE = 5;

const invById = (id: number): ReturnType<typeof Inventory.items>[number] | undefined =>
    Inventory.items().find(item => item.id === id);

// Why: the knife opens a two-object chat rather than completing the action — "Slice the pineapple."
// yields four rings, and only "Dice the pineapple." makes the chunks the parrot wants.

/** Cut an uncut pineapple into chunks. */
async function dicePineapple(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(ER_ITEM.PINEAPPLE_CHUNKS.id) > 0) {
        return true;
    }
    // Why: this runs the tick after Heckel Funch's counter shuts, and a use-on issued into the
    // closing shop interface is swallowed — the first pass cost thirty seconds to nothing.
    await Modals.closeIfOpen();
    await Execution.delayTicks(1);
    const knife = invById(ER_ITEM.KNIFE.id);
    const fruit = invById(ER_ITEM.PINEAPPLE.id);
    if (!knife || !fruit) {
        log('dice: no Knife or no Pineapple in the pack');
        return false;
    }
    if (!(await knife.useOn(fruit))) {
        return false;
    }
    return driveUntil(() => Inventory.countById(ER_ITEM.PINEAPPLE_CHUNKS.id) > 0, ['Dice the'], log);
}

/** Bank, then the knife, then Heckel Funch's counter. Null once chunks are in the pack. */
function sourcePineappleChunks(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, ER_ITEM.PINEAPPLE_CHUNKS) > 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(snap);
    }
    if (banked(snap, ER_ITEM.PINEAPPLE_CHUNKS) > 0) {
        return withdraw(snap, [{ name: ER_ITEM.PINEAPPLE_CHUNKS.name, id: ER_ITEM.PINEAPPLE_CHUNKS.id, qty: 1 }]);
    }
    if (held(snap, ER_ITEM.PINEAPPLE) > 0) {
        return sourceKnife(snap) ?? { kind: 'custom', name: 'dice the pineapple', run: dicePineapple };
    }
    if (banked(snap, ER_ITEM.PINEAPPLE) > 0) {
        return withdraw(snap, [{ name: ER_ITEM.PINEAPPLE.name, id: ER_ITEM.PINEAPPLE.id, qty: 1 }]);
    }
    // One trip: Heckel Funch stocks the knife as well as the fruit and the vodka.
    return sourceKnife(snap) ?? { kind: 'buy', item: ER_ITEM.PINEAPPLE.name, qty: 1, shop: HECKEL, estGp: PINEAPPLE_PRICE };
}

// Why: `make_alco_chunks` is gated on both of Parroty Pete's varbits, and neither is visible to the
// client — so both lines are re-asked every pass, which costs two dialogues and never guesses wrong.

/** Dip the chunks, bait the hatch, pocket the parrot. */
async function catchParrot(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(ER_ITEM.DRUNK_PARROT.id) > 0) {
        return true;
    }
    if (Inventory.countById(ER_ITEM.ALCO_CHUNKS.id) === 0) {
        if (!(await Traversal.walkResilient(ER_TILE.PETE, { radius: 4, attempts: 3, timeoutMs: 180_000, log }))) {
            return false;
        }
        for (const stop of [PETE_WHEN, PETE_FEED]) {
            if (!(await talkStrict(stop.npc, stop.prefer, log))) {
                log(`Parroty Pete would not answer "${stop.prefer[0]}"`);
                return false;
            }
            await Execution.delayTicks(2);
        }
        const chunks = invById(ER_ITEM.PINEAPPLE_CHUNKS.id);
        const liquor = Inventory.items().find(item => /^(vodka|gin|brandy|whisky)$/i.test(item.name ?? ''));
        if (!chunks || !liquor) {
            log('no Pineapple chunks or no liquor in the pack');
            return false;
        }
        if (!(await chunks.useOn(liquor))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => Inventory.countById(ER_ITEM.ALCO_CHUNKS.id) > 0, 8000))) {
            log('the chunks did not soak — Pete has not said both of his lines yet');
            return false;
        }
    }
    return useOnLoc(
        ER_ITEM.ALCO_CHUNKS.id,
        { name: 'Aviary Hatch', near: ER_TILE.AVIARY_HATCH, id: ER_LOC.AVIARY_HATCH },
        [],
        () => Inventory.countById(ER_ITEM.DRUNK_PARROT.id) > 0,
        log
    );
}

/** Everything between an empty pack and a Drunk parrot. Null once one is carried. */
export function sourceParrot(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, ER_ITEM.DRUNK_PARROT) > 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(snap);
    }
    // Why: the aviary refuses a second parrot while one is banked, so a banked one has to come out.
    if (banked(snap, ER_ITEM.DRUNK_PARROT) > 0) {
        return withdraw(snap, [{ name: ER_ITEM.DRUNK_PARROT.name, id: ER_ITEM.DRUNK_PARROT.id, qty: 1 }]);
    }
    return sourcePineappleChunks(snap)
        ?? sourceLiquor(snap)
        ?? { kind: 'custom', name: `catch a parrot with ${(heldLiquor(snap) ?? ER_ITEM.VODKA).name.toLowerCase()} chunks`, run: catchParrot };
}
