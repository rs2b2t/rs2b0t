import { QUESTS } from '../../data/quests.js';
import { heldId, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { FALADOR_WEST_BANK, BOY, EXPERIMENT_NAMES, SHOP_GP, THESSALIA, WH_NAME, WH_OBJ, WYDIN, inGarden, inShed } from './areas.js';
import { fountainKey, killExperiment, takeBall } from './garden.js';
import { diaryWanted, dropStaleMagnet, fetchDiary, fetchMagnet, readDiary, takeDoorKey, unlockBackDoor } from './house.js';
import { WH_STAGE, readWitchsHouseProgress } from './journal.js';

export { WH_STAGE, parseWitchsHouseJournal, readWitchsHouseProgress } from './journal.js';
export { WH_OBJ, WH_TILE, inGarden, inShed } from './areas.js';
export { DiaryState, resetDiaryState } from './house.js';

/** The 4 forms carry 144 hitpoints between them, more than the 8-piece default covers. */
const WH_FOOD = 12;

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep => ({
    kind: 'custom',
    name,
    run
});

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    const stage = snap.progress?.stage ?? snap.stage;
    if (snap.journal === 'complete' || (stage ?? 0) >= WH_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (stage === undefined) {
        return { kind: 'wait', reason: "Witch's House journal stage unavailable" };
    }

    if (stage === WH_STAGE.NOT_STARTED) {
        return { kind: 'talk', stop: BOY };
    }
    if (stage >= WH_STAGE.DEFEATED && heldId(snap, WH_OBJ.BALL) > 0) {
        return { kind: 'talk', stop: BOY };
    }
    // Why: every remaining step is behind the front door, whose `oploc1` reads the key out of the pack.
    if (heldId(snap, WH_OBJ.DOOR_KEY) === 0) {
        return custom("look under the witch's flower pot for the door key", takeDoorKey);
    }
    if (stage >= WH_STAGE.DEFEATED) {
        return custom('take the ball from the shed', takeBall);
    }

    if (stage === WH_STAGE.STARTED || stage === WH_STAGE.FOUND_MAGNET) {
        const gloves = wearingGloves(snap);
        if (!gloves && heldId(snap, WH_OBJ.GLOVES) === 0) {
            return { kind: 'withdraw', items: [{ name: WH_NAME.GLOVES, qty: 1, id: WH_OBJ.GLOVES }] };
        }
        if (!gloves) {
            return { kind: 'equip', item: WH_NAME.GLOVES };
        }
        if (heldId(snap, WH_OBJ.MAGNET) === 0) {
            return custom('search the cellar cupboard for the magnet', fetchMagnet);
        }
        if (stage === WH_STAGE.STARTED) {
            return custom('drop the magnet the cupboard will not replace', dropStaleMagnet);
        }
        // Why: the cheese is spent luring the mouse, so a bot caught before the magnet lands comes back holding the magnet and nothing to lure with.
        if (heldId(snap, WH_OBJ.CHEESE) === 0) {
            return { kind: 'buy', item: WH_NAME.CHEESE, qty: 1, shop: WYDIN, estGp: SHOP_GP };
        }
        return custom('lure the mouse and fit the magnet', unlockBackDoor);
    }

    if (heldId(snap, WH_OBJ.SHED_KEY) > 0) {
        return custom('unlock the shed and kill the experiment', killExperiment);
    }
    // Why: the diary is read before the first garden trip and never while carrying a shed key, since the walk back through the garden is where that key is lost.
    if (diaryWanted()) {
        return heldId(snap, WH_OBJ.DIARY) > 0
            ? custom("read the witch's diary so a catch cannot relock the back door", readDiary)
            : custom("take the witch's diary from the bedroom", fetchDiary);
    }
    return custom('check the garden fountain for the shed key', fountainKey);
}

function wearingGloves(snap: QuestSnapshot): boolean {
    return snap.wornIds?.has(WH_OBJ.GLOVES) ?? snap.worn.has(WH_NAME.GLOVES.toLowerCase());
}

function where(snap: QuestSnapshot): string {
    if (inShed(snap.tile)) return 'shed';
    if (inGarden(snap.tile)) return 'garden';
    return snap.tile ? `${snap.tile.x},${snap.tile.z},L${snap.tile.level}` : 'off-scene';
}

export const witchshouse: QuestModule = {
    record: QUESTS.find(r => r.id === 'ball')!,
    bank: FALADOR_WEST_BANK,
    pray: { protect: 'melee', potions: 2 },
    food: WH_FOOD,
    grind: [...EXPERIMENT_NAMES],
    tools: ['door key', 'key', 'magnet', 'cheese', 'ball', 'diary', 'leather gloves'],
    readProgress: readWitchsHouseProgress,
    sustain: { foods: ['Lobster', 'Swordfish', 'Trout'], eatBelowHp: 0.6 },
    // Why: neither spawns anywhere and the record calls both acquirable, so with an empty bank the engine had no route to either and blocked the quest.
    gather: {
        'cheese': (_snap, need) => ({ kind: 'buy', item: WH_NAME.CHEESE, qty: need, shop: WYDIN, estGp: SHOP_GP }),
        'leather gloves': (_snap, need) => ({ kind: 'buy', item: WH_NAME.GLOVES, qty: need, shop: THESSALIA, estGp: SHOP_GP })
    },
    observe: (snap, step) => [
        `stage=${snap.progress?.stage ?? snap.stage ?? '?'} at=${where(snap)}`
        + ` key=${heldId(snap, WH_OBJ.DOOR_KEY)} magnet=${heldId(snap, WH_OBJ.MAGNET)}`
        + ` cheese=${heldId(snap, WH_OBJ.CHEESE)} diary=${heldId(snap, WH_OBJ.DIARY)}`
        + ` shedkey=${heldId(snap, WH_OBJ.SHED_KEY)} ball=${heldId(snap, WH_OBJ.BALL)}`
        + ` gloves=${wearingGloves(snap) ? 'worn' : heldId(snap, WH_OBJ.GLOVES)} step=${step.kind}`
    ],
    decide
};
