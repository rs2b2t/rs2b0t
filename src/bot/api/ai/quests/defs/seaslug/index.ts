// docs/QUESTS.md
import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import {
    BAILEY,
    CAROLINE,
    HOLGART_LAND,
    KHAZARD_SHOP,
    SS_ITEM,
    SS_OBJ,
    SS_TILE,
    onIsland,
    onPlatform
} from './areas.js';
import { SS_STAGE, readSeaSlugProgress } from './journal.js';
import { callKennith, climbTo, findKent, openPanelAndCall, rotateCrane, rubSticks, sailTo } from './legs.js';

const PASTE_GP = 1000;

function held(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

function sailStep(): QuestStep {
    return { kind: 'custom', name: 'sail to the fishing platform', run: log => sailTo('platform', log) };
}

export function sourcePaste(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, SS_OBJ.SWAMP_PASTE) > 0) {
        return null;
    }
    if (snap.bankKnown !== true) {
        return { kind: 'scanBank' };
    }
    if ((snap.bank?.get(SS_ITEM.SWAMP_PASTE.toLowerCase()) ?? 0) > 0) {
        return { kind: 'withdraw', items: [{ name: SS_ITEM.SWAMP_PASTE, qty: 1 }] };
    }
    return { kind: 'buy', item: SS_ITEM.SWAMP_PASTE, qty: 1, shop: KHAZARD_SHOP, estGp: PASTE_GP };
}

export function torchStep(snap: QuestSnapshot): QuestStep {
    if (!onPlatform(snap.tile)) {
        return sailStep();
    }
    if (snap.tile && snap.tile.level !== 0) {
        return { kind: 'custom', name: 'climb down to the lower deck', run: log => climbTo(0, log) };
    }
    if (held(snap, SS_OBJ.TORCH_LIT) + held(snap, SS_OBJ.TORCH_UNLIT) === 0) {
        if (snap.stage === SS_STAGE.NEED_KENNITH_PATH) {
            return { kind: 'wait', reason: 'no torch, and Bailey has no stage-10 line to hand one over' };
        }
        return { kind: 'talk', stop: BAILEY };
    }
    if (held(snap, SS_OBJ.DRY_STICKS) > 0) {
        return { kind: 'custom', name: 'rub the dry sticks together', run: rubSticks };
    }
    if (held(snap, SS_OBJ.DAMP_STICKS) === 0) {
        return { kind: 'grabGround', item: SS_ITEM.DAMP_STICKS, anchor: SS_TILE.DAMP_STICKS_SPAWN, waitIfMissing: true };
    }
    if (held(snap, SS_OBJ.BROKEN_GLASS) === 0) {
        return { kind: 'grabGround', item: SS_ITEM.BROKEN_GLASS, anchor: SS_TILE.BROKEN_GLASS_SPAWN, waitIfMissing: true };
    }
    return {
        kind: 'useOn',
        item: SS_ITEM.BROKEN_GLASS,
        targetKind: 'item',
        target: SS_ITEM.DAMP_STICKS,
        anchor: SS_TILE.BROKEN_GLASS_SPAWN,
        product: SS_ITEM.DRY_STICKS
    };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: CAROLINE }; }

    const progress = snap.progress;
    if (progress === undefined) { return { kind: 'wait', reason: 'Sea Slug journal stage unavailable' }; }
    const stage = progress.stage;

    if (stage === SS_STAGE.NOT_STARTED) { return { kind: 'talk', stop: CAROLINE }; }
    if (stage === SS_STAGE.STARTED) { return { kind: 'talk', stop: HOLGART_LAND }; }
    if (stage === SS_STAGE.SPOKEN_HOLGART) { return sourcePaste(snap) ?? { kind: 'talk', stop: HOLGART_LAND }; }
    if (stage === SS_STAGE.BOAT_REPAIRED) {
        return { kind: 'custom', name: 'call to Kennith behind the crates', run: callKennith };
    }
    if (stage === SS_STAGE.SPOKEN_KENNITH || stage === SS_STAGE.SAILED_KENT) {
        return { kind: 'custom', name: 'find Kent on the island', run: findKent };
    }

    const litTorch = held(snap, SS_OBJ.TORCH_LIT) > 0;
    if (stage === SS_STAGE.SPOKEN_KENT || (stage <= SS_STAGE.NEED_KENNITH_PATH && stage >= SS_STAGE.LIT_TORCH && !litTorch)) {
        return torchStep(snap);
    }

    if (stage === SS_STAGE.LIT_TORCH) {
        return { kind: 'custom', name: 'show Kennith the lit torch', run: callKennith };
    }
    if (stage === SS_STAGE.KENNITH_NEED_ESCAPE || stage === SS_STAGE.PANEL_OPENED) {
        return { kind: 'custom', name: 'kick the panel open and call Kennith through', run: openPanelAndCall };
    }
    if (stage === SS_STAGE.NEED_KENNITH_PATH) {
        return { kind: 'custom', name: 'swing the crane over to Kennith', run: rotateCrane };
    }
    if (stage === SS_STAGE.SAVED_KENNITH) {
        if (onPlatform(snap.tile) || onIsland(snap.tile)) {
            return { kind: 'custom', name: 'sail back to the Ardougne shore', run: log => sailTo('mainland', log) };
        }
        return { kind: 'talk', stop: CAROLINE };
    }
    return { kind: 'wait', reason: `unhandled Sea Slug stage ${stage}` };
}

export const seaslug: QuestModule = {
    record: QUESTS.find(r => r.id === 'seaslug')!,
    bank: SS_TILE.BANK,
    food: 6,
    tools: ['torch', 'damp sticks', 'dry sticks', 'broken glass', 'swamp paste', 'coins'],
    readProgress: readSeaSlugProgress,
    decide
};
