import { Execution } from '../../../api/Execution.js';
import { gotoNpc, talkStrict } from '../../exec/primitives.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { KELI_PRINT, LEELA_STOP, OSMAN_FORGE, PA_ITEM, PA_SHOP, PA_TILE } from './areas.js';
import { PRINCE_STAGE } from './journal.js';
import { banked, buyItem, fromBank, grabItem, hasAnyPickaxe, held, heldItem, owned, withdrawFrom } from './supplies.js';

const BAR_GP = 40;
const WATER_GP = 20;

export function haveKey(snap: QuestSnapshot): boolean {
    return held(snap, PA_ITEM.PRINCE_KEY.id) > 0;
}

function keyDone(snap: QuestSnapshot): boolean {
    return owned(snap, PA_ITEM.PRINCE_KEY.id) > 0;
}

/**
 * Leela only promotes to stage 30 while the key is in the pack, so from 30 on the
 * key provably existed and prince_keystatus is no longer 0 — Osman will not forge
 * a second one, and every clay leg is dead weight.
 */
function keyIssued(snap: QuestSnapshot): boolean {
    return (snap.stage ?? 0) >= PRINCE_STAGE.PREP_FINISHED;
}

function printDone(snap: QuestSnapshot): boolean {
    return keyDone(snap) || keyIssued(snap) || owned(snap, PA_ITEM.KEY_PRINT.id) > 0;
}

function softClayDone(snap: QuestSnapshot): boolean {
    return printDone(snap) || owned(snap, PA_ITEM.SOFT_CLAY.id) > 0;
}

export function sourceBronzeBar(snap: QuestSnapshot): QuestStep | null {
    if (keyDone(snap) || keyIssued(snap)) {
        return null;
    }
    return buyItem(snap, PA_ITEM.BRONZE_BAR, 1, PA_SHOP.SHANTAY, BAR_GP);
}

export function sourceWater(snap: QuestSnapshot): QuestStep | null {
    const forClay = softClayDone(snap) ? 0 : 1;
    const forPaste = owned(snap, PA_ITEM.PASTE.id) > 0 ? 0 : 1;
    const want = forClay + forPaste;
    if (want === 0) {
        return null;
    }
    return buyItem(snap, PA_ITEM.JUG_OF_WATER, want, PA_SHOP.SHANTAY, WATER_GP);
}

export function sourcePickaxe(snap: QuestSnapshot): QuestStep | null {
    if (softClayDone(snap) || owned(snap, PA_ITEM.CLAY.id) > 0 || hasAnyPickaxe(snap)) {
        return null;
    }
    return grabItem(snap, PA_ITEM.PICKAXE, PA_TILE.PICKAXE_SPAWN);
}

export function sourceClay(snap: QuestSnapshot): QuestStep | null {
    if (softClayDone(snap) || held(snap, PA_ITEM.CLAY.id) > 0) {
        return null;
    }
    return fromBank(snap, PA_ITEM.CLAY, 1)
        ?? { kind: 'mineRock', rock: 'Clay', item: PA_ITEM.CLAY.name, qty: 1, anchor: PA_TILE.CLAY_ROCKS };
}

export function makeSoftClay(snap: QuestSnapshot): QuestStep | null {
    if (softClayDone(snap)) {
        return fromBank(snap, PA_ITEM.SOFT_CLAY, 1);
    }
    if (held(snap, PA_ITEM.CLAY.id) === 0 || held(snap, PA_ITEM.JUG_OF_WATER.id) === 0) {
        return null;
    }
    return {
        kind: 'useOn',
        item: PA_ITEM.JUG_OF_WATER.name,
        targetKind: 'item',
        target: PA_ITEM.CLAY.name,
        anchor: PA_TILE.CLAY_ROCKS,
        product: PA_ITEM.SOFT_CLAY.name
    };
}

export function takeKeyPrint(snap: QuestSnapshot): QuestStep | null {
    if (printDone(snap)) {
        return keyIssued(snap) ? null : fromBank(snap, PA_ITEM.KEY_PRINT, 1);
    }
    if (held(snap, PA_ITEM.SOFT_CLAY.id) === 0) {
        return null;
    }
    return { kind: 'talk', stop: KELI_PRINT };
}

export function collectKey(snap: QuestSnapshot): QuestStep | null {
    if (haveKey(snap)) {
        return null;
    }
    // Leela's re-issue check reads the bank as well as the pack, so a banked key
    // blocks its own replacement.
    if (banked(snap, PA_ITEM.PRINCE_KEY.id) > 0) {
        return withdrawFrom([{ name: PA_ITEM.PRINCE_KEY.name, id: PA_ITEM.PRINCE_KEY.id, qty: 1 }]);
    }
    if (keyIssued(snap)) {
        return { kind: 'custom', name: 'ask Leela to replace the lost key', run: collectFromLeela };
    }
    if (held(snap, PA_ITEM.KEY_PRINT.id) === 0 || held(snap, PA_ITEM.BRONZE_BAR.id) === 0) {
        return null;
    }
    return { kind: 'custom', name: 'have Osman forge the key, then collect it from Leela', run: forgeAndCollect };
}

async function collectFromLeela(log: (m: string) => void): Promise<boolean> {
    if (heldItem(PA_ITEM.PRINCE_KEY.id)) {
        return true;
    }
    if (!(await gotoNpc(LEELA_STOP, [], log))) {
        return false;
    }
    await talkStrict(LEELA_STOP.npc, LEELA_STOP.prefer, log);
    await Execution.delayUntil(() => heldItem(PA_ITEM.PRINCE_KEY.id) !== null, 4000);
    return heldItem(PA_ITEM.PRINCE_KEY.id) !== null;
}

/**
 * Osman forges only while prince_keystatus is 0, and that varp is not transmitted.
 * A print still in the pack after the conversation is the observable proof that the
 * key was already forged, so this goes to Leela either way.
 */
async function forgeAndCollect(log: (m: string) => void): Promise<boolean> {
    if (heldItem(PA_ITEM.PRINCE_KEY.id)) {
        return true;
    }
    if (await gotoNpc(OSMAN_FORGE, [], log)) {
        await talkStrict(OSMAN_FORGE.npc, OSMAN_FORGE.prefer, log);
    }
    if (heldItem(PA_ITEM.KEY_PRINT.id)) {
        log('Osman would not take the print — the key is already forged; collecting from Leela');
    }
    return collectFromLeela(log);
}
