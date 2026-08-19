// docs/QUESTS.md
import { Skills } from '../../../../skills/Skills.js';
import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import {
    OBSERVATORY_TOOLS, OBS_ID, OBS_ITEM, OBS_STAGE, OBS_TILE, PLANKS_NEEDED, PROFESSOR
} from './areas.js';
import { fetchLensMould, useTelescope } from './dungeon.js';
import { readObservatoryStage } from './journal.js';
import {
    fromBank, heldId, ore, oreShort, planks, sand, smeltBronze, smeltGlass, sodaAsh
} from './supplies.js';

export { parseObservatoryJournal, readObservatoryStage } from './journal.js';

const talkProfessor: QuestStep = { kind: 'talk', stop: PROFESSOR };

const fetchMould: QuestStep = { kind: 'custom', name: 'fetch the lens mould', run: fetchLensMould };

/** `professor_mould` hands the molten glass back and refuses outright on a full pack. */
const HANDBACK_SLOT = 1;

/** What the professor still has to be handed, worked out from the stage he is on. */
interface Wanted {
    planks: boolean;
    bar: boolean;
    glass: boolean;
    mould: boolean;
}

// Why: the professor only ever accepts the item his current stage names, so the hand-overs cannot be batched — but the errands can, and each one is opened as soon as its stage is in reach rather than when it is due.
// Why: the order below is the map rather than the quest — sand by the reception, the pickaxe and the seam south-east, the planks and the seaweed north, then one furnace visit that smelts both bars on the way home.
// Why: ordering it by the quest instead walks the length of the map three times, as the planks and the seaweed are two hundred tiles apart and everything else is south of both.

/** The next errand this loop owes, or null when the pack is ready for the professor. */
function supply(snap: QuestSnapshot, want: Wanted): QuestStep | null {
    const glassShort = want.glass && heldId(snap, OBS_ID.MOLTEN_GLASS) === 0;
    const barShort = want.bar && heldId(snap, OBS_ID.BRONZE_BAR) === 0;
    const planksShort = want.planks && heldId(snap, OBS_ID.PLANK) < PLANKS_NEEDED;
    const mouldShort = want.mould && heldId(snap, OBS_ID.LENS_MOULD) === 0;

    // A finished item in the bank is worth more than every rung that would rebuild it.
    if (glassShort) {
        const banked = fromBank(snap, OBS_ID.MOLTEN_GLASS, OBS_ITEM.MOLTEN_GLASS, 1);
        if (banked) { return banked; }
    }
    if (barShort) {
        const banked = fromBank(snap, OBS_ID.BRONZE_BAR, OBS_ITEM.BRONZE_BAR, 1);
        if (banked) { return banked; }
    }
    if (mouldShort) {
        const banked = fromBank(snap, OBS_ID.LENS_MOULD, OBS_ITEM.LENS_MOULD, 1);
        if (banked) { return banked; }
    }

    if (glassShort && heldId(snap, OBS_ID.BUCKET_OF_SAND) === 0 && heldId(snap, OBS_ID.SODA_ASH) === 0) {
        return sand(snap);
    }
    if (barShort && oreShort(snap)) {
        return ore(snap);
    }
    if (planksShort) {
        return planks(snap);
    }
    if (glassShort && heldId(snap, OBS_ID.SODA_ASH) === 0) {
        return sodaAsh(snap);
    }
    if (glassShort) {
        return heldId(snap, OBS_ID.BUCKET_OF_SAND) === 0 ? sand(snap) : smeltGlass;
    }
    if (barShort) {
        return smeltBronze;
    }
    if (mouldShort) {
        return fetchMould;
    }
    return null;
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return talkProfessor; }

    const stage = snap.stage;
    if (stage === undefined) { return { kind: 'wait', reason: 'Observatory Quest journal stage unavailable' }; }
    if (stage >= OBS_STAGE.COMPLETE) { return { kind: 'done' }; }

    if (stage === OBS_STAGE.SENT_TELESCOPE) {
        return { kind: 'custom', name: 'look through the telescope', run: useTelescope };
    }

    if (stage === OBS_STAGE.GIVEN_MOULD) {
        if (heldId(snap, OBS_ID.LENS) > 0) { return talkProfessor; }
        // Why: `professor_glass` deletes the glass at the previous hand-over and `professor_mould` hands it straight back, so a stage-5 pack without one has lost it rather than never had it.
        const rebuild = supply(snap, { planks: false, bar: false, glass: true, mould: true });
        if (rebuild) { return rebuild; }
        return {
            kind: 'useOn',
            item: OBS_ITEM.LENS_MOULD,
            targetKind: 'item',
            target: OBS_ITEM.MOLTEN_GLASS,
            anchor: OBS_TILE.PROFESSOR,
            product: OBS_ITEM.LENS
        };
    }

    const errand = supply(snap, {
        planks: stage <= OBS_STAGE.STARTED,
        bar: stage <= OBS_STAGE.GIVEN_PLANKS,
        glass: stage <= OBS_STAGE.GIVEN_BRONZE,
        mould: stage <= OBS_STAGE.GIVEN_GLASS
    });
    if (errand) { return errand; }

    if (stage === OBS_STAGE.GIVEN_GLASS && snap.freeSlots !== undefined && snap.freeSlots < HANDBACK_SLOT) {
        return { kind: 'deposit', keep: [...OBSERVATORY_TOOLS] };
    }
    return talkProfessor;
}

// Why: the server gates nothing here — `craft_telescope_disc` has no level check — but the quest is listed at Crafting 10 and an account short of it is short of the rest of the trip too.
const OBS_PROVEN_SKILLS = { crafting: 10, mining: 1, smithing: 1, cooking: 1 } as const;

export function warnObservatoryReadiness(): string | null {
    const short = (Object.keys(OBS_PROVEN_SKILLS) as (keyof typeof OBS_PROVEN_SKILLS)[])
        .filter(s => Skills.level(s) < OBS_PROVEN_SKILLS[s])
        .map(s => `${s} ${Skills.level(s)}/${OBS_PROVEN_SKILLS[s]}`);
    if (short.length === 0) {
        return null;
    }
    return `below the proven profile (${short.join(', ')}); headed PASS at 70s across the board. `
        + 'The goblin guard on the keep gate is level 42 and turns on the bot the moment the gate moves.';
}

export const observatory: QuestModule = {
    record: QUESTS.find(r => r.id === 'itgronigen')!,
    bank: OBS_TILE.BANK,
    food: 8,
    tools: [...OBSERVATORY_TOOLS],
    readStage: readObservatoryStage,
    warnReadiness: warnObservatoryReadiness,
    decide
};
