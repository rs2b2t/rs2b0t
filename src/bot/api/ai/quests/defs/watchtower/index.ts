import { customStep, waitForJournal, waitStep } from '../../engine/questSteps.js';
import { Game } from '../../../../game/Game.js';
import { clearSpace, fitSupplies, foodCount, WATCHTOWER_FOODS } from './loadout.js';
import { QuestFood } from '../../food.js';
import { dragonBankPending, huntDragonBones, inDragonLair, leaveDragonLair, refreshDragonBank } from './bones.js';
import { QUESTS } from '../../data/quests.js';
import { flagValue, hasFlag, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { CRYSTALS, RELIC_PARTS, WT_ITEM, WT_TILE, watchtowerArea, type WatchtowerArea } from './areas.js';
import {
    CHASM_TOLL,
    goldGateNeedsPayment,
    answerRiddle,
    askRiddle,
    crossBattlement,
    jumpBack,
    leaveCity,
    showRelicToGuard,
    stealRockCake
} from './gutanoth.js';
import { WATCHTOWER_STAGE, readWatchtowerProgress } from './journal.js';
import { answerMadSkavid, leaveCave, learnFromScaredSkavid, learnWord, nextSkavidCave, takeNightshade } from './caves.js';
import { dissolveShamans, enterEnclave, leaveEnclave, mineDalgroth, searchShamanRobe } from './enclave.js';
import { brewOgrePotion, grindBatBones, infusePotion } from './potion.js';
import {
    askWizardAboutShamans,
    askWizardForRelic,
    giveRelicPart,
    handInFingernails,
    leaveWizardFloor,
    pullLever,
    readSpellScroll,
    searchEvidenceBush,
    showCrystalsToWizard,
    startQuest
} from './tower.js';
import {
    JANGERBERRY_TARGET,
    killGorad,
    leaveGrewIsland,
    leaveTobanCamp,
    openTobanChest,
    pickJangerberries,
    talkToGrew,
    talkToOg,
    talkToToban
} from './tribes.js';
import {
    banked,
    bankOnly,
    held,
    owned,
    scanBank,
    sourceCoins,
    sourceDeathRune,
    sourceLightSource,
    sourcePestle,
    sourcePickaxe,
    sourceFood,
    sourceRope,
    sourceVial,
    questKit,
    withdrawFrom
} from './supplies.js';

// Enough for both chasm tolls, a death rune and the odd shop trip.
const CITY_PURSE = 2000;

// Enough to survive a respawned shaman on the way to the rock.
const ENCLAVE_FOOD = 8;

function escapePocket(area: WatchtowerArea, wanted: WatchtowerArea): QuestStep | null {
    if (area === wanted) {
        return null;
    }
    switch (area) {
        case 'towerFloor':
        case 'mirrorTower':
            return customStep('climb down from the wizard floor', leaveWizardFloor);
        case 'grewIsland':
            return customStep('swing back off Grew island', leaveGrewIsland);
        case 'tobanCamp':
            return customStep("leave Toban's camp", leaveTobanCamp);
        case 'cityGuard':
            return customStep('jump back out of the city-guard pocket', jumpBack);
        case 'skavidCaves':
            return { kind: 'custom', name: 'leave the skavid cave', run: async log => {
                if (!(await leaveCave(log))) return false;
                return watchtowerArea(Game.tile()) !== 'lowerCity' || leaveCity(log);
            } };
        case 'enclave':
            return customStep('leave the shaman enclave', leaveEnclave);
        case 'lowerCity':
            return customStep('leave the ogre city', leaveCity);
        default:
            return null;
    }
}

// Why: `wanted` is where the step's own leg expects to begin, and the open mainland always qualifies, as every leg can walk from there.

/** Take `step` only once somewhere it can start from, escaping any other sealed pocket first. */
function at(area: WatchtowerArea, wanted: WatchtowerArea, step: QuestStep): QuestStep {
    return escapePocket(area, wanted) ?? step;
}

/** Each trip onto Grew's island consumes one rope; the swing back out is free. */
function needRope(snap: QuestSnapshot, area: WatchtowerArea): QuestStep | null {
    return area === 'grewIsland' ? null : sourceRope(snap);
}

function stageTribes(snap: QuestSnapshot, area: WatchtowerArea): QuestStep {
    const progress = snap.progress;

    if (!hasFlag(progress, 'helped-og')) {
        if (held(snap, WT_ITEM.STOLEN_GOLD.id) > 0 || !hasFlag(progress, 'spoken-og')) {
            return at(area, 'yanille', customStep('talk to Og', talkToOg));
        }
        if (held(snap, WT_ITEM.TOBAN_KEY.id) > 0) {
            return at(area, 'tobanCamp', customStep("take the stolen gold from Toban's chest", openTobanChest));
        }
        return at(area, 'yanille', customStep('ask Og for another chest key', talkToOg));
    }

    if (!hasFlag(progress, 'helped-toban')) {
        if (held(snap, WT_ITEM.DRAGON_BONES.id) > 0 || !hasFlag(progress, 'spoken-toban')) {
            return at(area, 'tobanCamp', customStep('talk to Toban', talkToToban));
        }
        let bones = bankOnly(snap, WT_ITEM.DRAGON_BONES);
        if (bones?.kind === 'wait') {
            const food = [QuestFood.name || 'Lobster', 'Lobster', 'Swordfish', 'Tuna']
                .find(name => (snap.inv.get(name.toLowerCase()) ?? 0) + (snap.bank?.get(name.toLowerCase()) ?? 0) >= 12)
                ?? (QuestFood.name || 'Lobster');
            bones = { kind: 'custom', name: 'kill a blue dragon for Dragon bones', run: log => huntDragonBones(food, log) };
        }
        return bones
            ? at(area, 'yanille', bones)
            : at(area, 'tobanCamp', customStep('talk to Toban', talkToToban));
    }

    if (!hasFlag(progress, 'helped-grew')) {
        if (held(snap, WT_ITEM.OGRE_TOOTH.id) > 0 || !hasFlag(progress, 'spoken-grew')) {
            const rope = needRope(snap, area);
            return rope
                ? at(area, 'yanille', rope)
                : at(area, 'grewIsland', customStep('talk to Grew', talkToGrew));
        }
        return at(area, 'tobanCamp', customStep("knock out one of Gorad's teeth", killGorad));
    }

    const shortOfBerries = owned(snap, WT_ITEM.JANGERBERRIES.id) < JANGERBERRY_TARGET;
    const pickBerries: QuestStep = customStep('pick jangerberries on Grew island', pickJangerberries);

    // Already on the island: take the berries now, as coming back costs another rope.
    if (shortOfBerries && area === 'grewIsland') {
        return pickBerries;
    }

    for (const part of RELIC_PARTS) {
        if (held(snap, part.id) > 0) {
            return at(area, 'towerFloor', {
                kind: 'custom',
                name: `give ${part.name} to the wizard`,
                run: log => giveRelicPart(part.id, log)
            });
        }
    }

    if (shortOfBerries) {
        const rope = needRope(snap, area);
        return rope ? at(area, 'yanille', rope) : at(area, 'grewIsland', pickBerries);
    }

    return escapePocket(area, 'yanille')
        ?? waitStep('every tribe is helped but no relic part is in the pack');
}

function stageRelicGate(snap: QuestSnapshot, area: WatchtowerArea): QuestStep {
    if (held(snap, WT_ITEM.OGRE_RELIC.id) > 0) {
        return escapePocket(area, 'yanille')
            ?? customStep('show the relic to the north-west ogre guard', showRelicToGuard);
    }
    if (!snap.bankKnown) {
        return at(area, 'yanille', scanBank());
    }
    if (banked(snap, WT_ITEM.OGRE_RELIC.id) > 0) {
        return at(area, 'yanille', withdrawFrom([{ name: WT_ITEM.OGRE_RELIC.name, id: WT_ITEM.OGRE_RELIC.id, qty: 1 }]));
    }
    return at(area, 'towerFloor', customStep('ask the wizard for another relic', askWizardForRelic));
}

function stageCityEntry(snap: QuestSnapshot, area: WatchtowerArea): QuestStep {
    if (area === 'cityGuard') {
        return customStep('ask the city guard for passage', askRiddle);
    }
    if (!hasFlag(snap.progress, 'market-paid')) {
        if (held(snap, WT_ITEM.ROCK_CAKE.id) === 0) {
            return customStep('steal a rock cake from the ogre stall', stealRockCake);
        }
        return customStep('give the rock cake to the battlement guard', crossBattlement);
    }
    const purse = held(snap, WT_ITEM.COINS.id) < CHASM_TOLL * 2 ? sourceCoins(snap, CITY_PURSE) : null;
    return purse
        ? at(area, 'yanille', purse)
        : customStep('pay the ogre guard, jump the chasm, ask the riddle', askRiddle);
}

function stageRiddle(snap: QuestSnapshot, area: WatchtowerArea): QuestStep {
    // Banking and shopping happen on the mainland, so leave the pocket first.
    const rune = sourceDeathRune(snap);
    if (rune) {
        return at(area, 'yanille', rune);
    }
    const purse = held(snap, WT_ITEM.COINS.id) < CHASM_TOLL * 2 ? sourceCoins(snap, CITY_PURSE) : null;
    return purse
        ? at(area, 'yanille', purse)
        : customStep('answer the riddle with a death rune', answerRiddle);
}

// Why: a cave mouth refuses entry without the map and a lit light source, and bounces you to a fixed tile, which loops forever if the kit was banked or lost.

/** The cave kit shortfall, or null when both are held. */
function needCaveKit(snap: QuestSnapshot, area: WatchtowerArea): QuestStep | null {
    if (held(snap, WT_ITEM.SKAVID_MAP.id) === 0) {
        const inBank = bankOnly(snap, WT_ITEM.SKAVID_MAP);
        if (inBank && inBank.kind !== 'wait') {
            return at(area, 'yanille', inBank);
        }
        const purse = held(snap, WT_ITEM.COINS.id) < CHASM_TOLL * 2 ? sourceCoins(snap, CITY_PURSE) : null;
        return purse ? at(area, 'yanille', purse) : at(area, 'cityGuard', customStep('ask the city guard for another skavid map', askRiddle));
    }
    const light = sourceLightSource(snap);
    return light ? at(area, 'yanille', light) : null;
}

function stageCaves(snap: QuestSnapshot, area: WatchtowerArea): QuestStep {
    const kit = needCaveKit(snap, area);
    if (kit) {
        return kit;
    }
    const cave = nextSkavidCave(snap.progress);
    if (cave === 5) {
        return customStep('learn skavid words from the scared skavid', learnFromScaredSkavid);
    }
    if (cave <= 4) {
        return { kind: 'custom', name: `answer the skavid in cave ${cave}`, run: log => learnWord(cave, log) };
    }
    const payment = goldGateNeedsPayment();
    if (area !== 'skavidCaves' && payment !== false && (area !== 'lowerCity' || payment === true)) {
        const bar = bankOnly(snap, WT_ITEM.GOLD_BAR);
        if (bar && (bar.kind !== 'wait' || payment === true)) return at(area, 'yanille', bar);
    }
    return at(area, 'skavidCaves', customStep('answer the mad skavid for a crystal', answerMadSkavid));
}

function stageEnclaveEntry(snap: QuestSnapshot, area: WatchtowerArea): QuestStep {
    if (area === 'enclave') {
        return customStep('leave the shaman enclave', leaveEnclave);
    }
    if (held(snap, WT_ITEM.NIGHTSHADE.id) === 0) {
        return needCaveKit(snap, area)
            ?? customStep('take Nightshade from the skavid cave', takeNightshade);
    }
    const food = sourceFood(snap, ENCLAVE_FOOD);
    return food
        ? at(area, 'yanille', food)
        : customStep('feed the enclave guard Nightshade', enterEnclave);
}

function stagePotion(snap: QuestSnapshot, area: WatchtowerArea): QuestStep {
    for (const potion of [WT_ITEM.MAGIC_OGRE_POTION, WT_ITEM.OGRE_POTION, WT_ITEM.GUAM_JANGER_VIAL, WT_ITEM.GUAM_VIAL]) {
        if (held(snap, potion.id) > 0) break;
        if (banked(snap, potion.id) > 0) return at(area, 'yanille', withdrawFrom([{ ...potion, qty: 1 }]));
    }
    if (held(snap, WT_ITEM.OGRE_POTION.id) > 0) {
        return at(area, 'towerFloor', customStep('have the wizard infuse the ogre potion', infusePotion));
    }
    const escape = escapePocket(area, 'yanille');
    if (escape) {
        return escape;
    }
    const midBrew = held(snap, WT_ITEM.GUAM_VIAL.id) > 0 || held(snap, WT_ITEM.GUAM_JANGER_VIAL.id) > 0;
    if (!midBrew) {
        const guam = bankOnly(snap, WT_ITEM.GUAM_LEAF);
        if (guam) {
            return guam;
        }
        const vial = sourceVial(snap);
        if (vial) {
            return vial;
        }
    }
    if (held(snap, WT_ITEM.GUAM_JANGER_VIAL.id) === 0 && held(snap, WT_ITEM.JANGERBERRIES.id) === 0) {
        if (banked(snap, WT_ITEM.JANGERBERRIES.id) > 0) return withdrawFrom([{ ...WT_ITEM.JANGERBERRIES, qty: 1 }]);
        return needRope(snap, area)
            ?? customStep('pick jangerberries on Grew island', pickJangerberries);
    }
    if (held(snap, WT_ITEM.GROUND_BAT_BONES.id) === 0) {
        if (banked(snap, WT_ITEM.GROUND_BAT_BONES.id) > 0) return withdrawFrom([{ ...WT_ITEM.GROUND_BAT_BONES, qty: 1 }]);
        const bones = bankOnly(snap, WT_ITEM.BAT_BONES);
        if (bones) {
            return bones;
        }
        const pestle = sourcePestle(snap);
        if (pestle) {
            return pestle;
        }
        return customStep('grind the bat bones', grindBatBones);
    }
    return customStep('brew the ogre potion', brewOgrePotion);
}

function stageShamans(snap: QuestSnapshot, area: WatchtowerArea): QuestStep {
    const left = flagValue(snap.progress, 'shamans-left') ?? 6;

    // Why: dissolved shamans respawn, so any trip back in needs food, but only the steps that go back in.
    // Why: demanding it while carrying the crystals to the wizard parks the quest for no reason.
    const enclaveFood = area === 'enclave' ? null : sourceFood(snap, ENCLAVE_FOOD);
    const provisioned = (step: QuestStep): QuestStep => (enclaveFood ? at(area, 'yanille', enclaveFood) : step);

    if (left > 0) {
        if (held(snap, WT_ITEM.MAGIC_OGRE_POTION.id) === 0) {
            if (area === 'enclave') {
                return customStep('leave the enclave to brew another potion', leaveEnclave);
            }
            return stagePotion(snap, area);
        }
        if (area !== 'enclave' && held(snap, WT_ITEM.NIGHTSHADE.id) === 0) {
            return needCaveKit(snap, area)
                ?? provisioned(customStep('take Nightshade for the enclave', takeNightshade));
        }
        // The mining follows in the same visit, so the pickaxe rides along and saves a second trip through the guard.
        const pick = area === 'enclave' ? null : sourcePickaxe(snap);
        if (pick) {
            return provisioned(at(area, 'yanille', pick));
        }
        return provisioned(customStep('dissolve the ogre shamans', dissolveShamans));
    }

    if (held(snap, WT_ITEM.CRYSTAL4.id) === 0 && banked(snap, WT_ITEM.CRYSTAL4.id) === 0) {
        // Why: no area guard here; standing in the enclave without a pickaxe is the case that has to walk back out for one, and at() does the leaving.
        const pick = sourcePickaxe(snap);
        if (pick) {
            return at(area, 'yanille', pick);
        }
        if (area !== 'enclave' && held(snap, WT_ITEM.NIGHTSHADE.id) === 0) {
            return needCaveKit(snap, area)
                ?? provisioned(customStep('take Nightshade for the enclave', takeNightshade));
        }
        return provisioned(customStep('mine the Rock of Dalgroth', mineDalgroth));
    }
    if (held(snap, WT_ITEM.CRYSTAL3.id) === 0 && banked(snap, WT_ITEM.CRYSTAL3.id) === 0) {
        if (area !== 'enclave' && held(snap, WT_ITEM.NIGHTSHADE.id) === 0) {
            return needCaveKit(snap, area)
                ?? provisioned(customStep('take Nightshade for the enclave', takeNightshade));
        }
        return provisioned(customStep('search a shaman robe for the third crystal', searchShamanRobe));
    }
    if (area === 'enclave') {
        return customStep('leave the shaman enclave', leaveEnclave);
    }
    const recovery = recoverCrystals(snap, area);
    if (recovery) {
        return recovery;
    }
    return at(area, 'towerFloor', customStep('take all four crystals to the wizard', showCrystalsToWizard));
}

const CRYSTAL_RECOVERY: Readonly<Record<number, { name: string; run: (log: (m: string) => void) => Promise<boolean> }>> = {
    [WT_ITEM.CRYSTAL1.id]: { name: 'ask Grew for another crystal', run: talkToGrew },
    [WT_ITEM.CRYSTAL2.id]: { name: 'ask the mad skavid for another crystal', run: log => answerMadSkavid(log, true) },
    [WT_ITEM.CRYSTAL3.id]: { name: 'search a shaman robe for the third crystal', run: searchShamanRobe },
    [WT_ITEM.CRYSTAL4.id]: { name: 'mine the Rock of Dalgroth again', run: mineDalgroth }
};

function recoverCrystals(snap: QuestSnapshot, area: WatchtowerArea): QuestStep | null {
    // Nothing to recover once all four are carried; don't walk to the bank only to learn what's in it.
    const lost = CRYSTALS.find(crystal => held(snap, crystal.id) === 0);
    if (!lost) {
        return null;
    }
    // Every re-issue check reads the bank as well as the pack, so a banked crystal blocks its own replacement. Withdraw before asking for another.
    const inBank = CRYSTALS.filter(crystal => held(snap, crystal.id) === 0 && banked(snap, crystal.id) > 0);
    if (inBank.length > 0) {
        return at(area, 'yanille', withdrawFrom(inBank.map(crystal => ({ name: crystal.name, id: crystal.id, qty: 1 }))));
    }
    if (!snap.bankKnown) {
        return at(area, 'yanille', scanBank());
    }
    const recovery = CRYSTAL_RECOVERY[lost.id];
    const step: QuestStep = customStep(recovery.name, recovery.run);
    if (lost.id === WT_ITEM.CRYSTAL1.id) {
        const rope = needRope(snap, area);
        return rope ? at(area, 'yanille', rope) : at(area, 'grewIsland', step);
    }
    if (lost.id === WT_ITEM.CRYSTAL2.id) {
        const kit = needCaveKit(snap, area);
        if (kit) return kit;
        return at(area, 'skavidCaves', step);
    }
    return step;
}

function decideNext(snap: QuestSnapshot): QuestStep {
    if (inDragonLair(snap.tile)) return customStep('leave the dragon lair', leaveDragonLair);
    if (dragonBankPending()) return customStep('refresh the bank after the dragon hunt', refreshDragonBank);
    if (snap.journal === 'complete' || (snap.stage ?? -1) >= WATCHTOWER_STAGE.COMPLETE) {
        if (held(snap, WT_ITEM.WATCHTOWER_SPELL.id) > 0) {
            return customStep('read the Watchtower spell scroll', readSpellScroll);
        }
        // Completing teleports into the mirror tower in region 45_73.
        const stranded = escapePocket(watchtowerArea(snap.tile), 'yanille');
        return stranded ?? { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return waitForJournal();
    }
    if (snap.stage === undefined) {
        return waitStep('Watch Tower journal stage unavailable');
    }
    const area = watchtowerArea(snap.tile);
    if (area === 'unknown') {
        return waitStep('player location unavailable');
    }
    // Why: pulling the lever teleports into the shielded copy of the tower in region 45_73, and nothing else goes there.
    // Why: standing in it means the quest is done, whatever the journal colour has caught up to.
    if (area === 'mirrorTower') {
        if (held(snap, WT_ITEM.WATCHTOWER_SPELL.id) > 0) {
            return customStep('read the Watchtower spell scroll', readSpellScroll);
        }
        return customStep('climb down from the activated Watchtower', leaveWizardFloor);
    }

    if ((snap.freeSlots ?? 28) < 2 || foodCount(snap) > 8) {
        return at(area, 'yanille', clearSpace(snap));
    }

    if (snap.stage > WATCHTOWER_STAGE.NOT_STARTED && snap.stage <= WATCHTOWER_STAGE.MADE_POTION) {
        const kit = questKit(snap, ENCLAVE_FOOD);
        if (kit) {
            return at(area, 'yanille', kit);
        }
    }

    switch (snap.stage) {
        case WATCHTOWER_STAGE.NOT_STARTED:
            return customStep('climb the Watchtower and ask the wizard for work', startQuest);

        case WATCHTOWER_STAGE.STARTED: {
            if (held(snap, WT_ITEM.FINGERNAILS.id) > 0) {
                return at(area, 'towerFloor', customStep('give the fingernails to the wizard', handInFingernails));
            }
            return escapePocket(area, 'yanille')
                ?? customStep('search the bush by the Watchtower for evidence', searchEvidenceBush);
        }

        // The journal renders one block for stages 2 through 5, so stage 3 reads back as stage 2; owning the assembled relic is the only visible difference.
        case WATCHTOWER_STAGE.GIVEN_FINGERNAILS:
            return owned(snap, WT_ITEM.OGRE_RELIC.id) > 0
                ? stageRelicGate(snap, area)
                : stageTribes(snap, area);

        case WATCHTOWER_STAGE.MADE_RELIC:
            return stageRelicGate(snap, area);

        case WATCHTOWER_STAGE.GIVEN_RELIC:
            return stageCityEntry(snap, area);

        case WATCHTOWER_STAGE.GIVEN_RIDDLE:
            return stageRiddle(snap, area);

        case WATCHTOWER_STAGE.SOLVED_RIDDLE:
            return stageCaves(snap, area);

        case WATCHTOWER_STAGE.SKAVID_CRYSTAL:
            return stageEnclaveEntry(snap, area);

        case WATCHTOWER_STAGE.FED_NIGHTSHADE:
            return at(area, 'towerFloor', customStep('ask the wizard how to beat the shamans', askWizardAboutShamans));

        case WATCHTOWER_STAGE.LEARNED_POTION:
            return stagePotion(snap, area);

        case WATCHTOWER_STAGE.MADE_POTION:
            return stageShamans(snap, area);

        case WATCHTOWER_STAGE.FOUND_ALL_CRYSTALS:
            return at(area, 'towerFloor', customStep('pull the lever to activate the shield', pullLever));

        default:
            return waitStep('Watch Tower stage ' + snap.stage + ' is not implemented yet');
    }
}

export function decide(snap: QuestSnapshot): QuestStep {
    return fitSupplies(snap, decideNext(snap));
}

export const watchtower: QuestModule = {
    autoRetaliate: snap => !inDragonLair(snap.tile) && watchtowerArea(snap.tile) !== 'enclave',
    record: QUESTS.find(record => record.id === 'itwatchtower')!,
    bank: WT_TILE.YANILLE_BANK,
    ownsInventory: true,
    resumeAt: tile => inDragonLair(tile) || escapePocket(watchtowerArea(tile), 'yanille') !== null,
    recover: tile => inDragonLair(tile) ? customStep('leave the dragon lair', leaveDragonLair) : escapePocket(watchtowerArea(tile), 'yanille'),
    readProgress: readWatchtowerProgress,
    sustain: { foods: WATCHTOWER_FOODS, eatBelowHp: 0.6 },
    decide
};
