import { QUESTS } from '../../data/quests.js';
import { flagValue, hasFlag, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { CRYSTALS, RELIC_PARTS, WT_ITEM, WT_TILE, watchtowerArea, type WatchtowerArea } from './areas.js';
import {
    CHASM_TOLL,
    answerRiddle,
    askRiddle,
    crossBattlement,
    jumpBack,
    leaveLowerCity,
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
            return { kind: 'custom', name: 'climb down from the wizard floor', run: leaveWizardFloor };
        case 'grewIsland':
            return { kind: 'custom', name: 'swing back off Grew island', run: leaveGrewIsland };
        case 'tobanCamp':
            return { kind: 'custom', name: "leave Toban's camp", run: leaveTobanCamp };
        case 'cityGuard':
            return { kind: 'custom', name: 'jump back out of the city-guard pocket', run: jumpBack };
        case 'skavidCaves':
            return { kind: 'custom', name: 'leave the skavid cave', run: leaveCave };
        case 'enclave':
            return { kind: 'custom', name: 'leave the shaman enclave', run: leaveEnclave };
        case 'lowerCity':
            // The battlement is a two-way climb once the market gift is paid.
            return { kind: 'custom', name: 'climb back over the battlement', run: leaveLowerCity };
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
            return at(area, 'yanille', { kind: 'custom', name: 'talk to Og', run: talkToOg });
        }
        if (held(snap, WT_ITEM.TOBAN_KEY.id) > 0) {
            return at(area, 'tobanCamp', { kind: 'custom', name: "take the stolen gold from Toban's chest", run: openTobanChest });
        }
        return at(area, 'yanille', { kind: 'custom', name: 'ask Og for another chest key', run: talkToOg });
    }

    if (!hasFlag(progress, 'helped-toban')) {
        if (held(snap, WT_ITEM.DRAGON_BONES.id) > 0 || !hasFlag(progress, 'spoken-toban')) {
            return at(area, 'tobanCamp', { kind: 'custom', name: 'talk to Toban', run: talkToToban });
        }
        const bones = bankOnly(snap, WT_ITEM.DRAGON_BONES);
        return bones
            ? at(area, 'yanille', bones)
            : at(area, 'tobanCamp', { kind: 'custom', name: 'talk to Toban', run: talkToToban });
    }

    if (!hasFlag(progress, 'helped-grew')) {
        if (held(snap, WT_ITEM.OGRE_TOOTH.id) > 0 || !hasFlag(progress, 'spoken-grew')) {
            const rope = needRope(snap, area);
            return rope
                ? at(area, 'yanille', rope)
                : at(area, 'grewIsland', { kind: 'custom', name: 'talk to Grew', run: talkToGrew });
        }
        return at(area, 'tobanCamp', { kind: 'custom', name: "knock out one of Gorad's teeth", run: killGorad });
    }

    const shortOfBerries = owned(snap, WT_ITEM.JANGERBERRIES.id) < JANGERBERRY_TARGET;
    const pickBerries: QuestStep = { kind: 'custom', name: 'pick jangerberries on Grew island', run: pickJangerberries };

    // Standing on the island already: take the berries now rather than swinging
    // out to the wizard and paying another rope to come back for them.
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
        ?? { kind: 'wait', reason: 'every tribe is helped but no relic part is in the pack' };
}

function stageRelicGate(snap: QuestSnapshot, area: WatchtowerArea): QuestStep {
    if (held(snap, WT_ITEM.OGRE_RELIC.id) > 0) {
        return escapePocket(area, 'yanille')
            ?? { kind: 'custom', name: 'show the relic to the north-west ogre guard', run: showRelicToGuard };
    }
    if (!snap.bankKnown) {
        return at(area, 'yanille', scanBank());
    }
    if (banked(snap, WT_ITEM.OGRE_RELIC.id) > 0) {
        return at(area, 'yanille', withdrawFrom([{ name: WT_ITEM.OGRE_RELIC.name, id: WT_ITEM.OGRE_RELIC.id, qty: 1 }]));
    }
    return at(area, 'towerFloor', { kind: 'custom', name: 'ask the wizard for another relic', run: askWizardForRelic });
}

function stageCityEntry(snap: QuestSnapshot, area: WatchtowerArea): QuestStep {
    if (area === 'cityGuard') {
        return { kind: 'custom', name: 'ask the city guard for passage', run: askRiddle };
    }
    if (!hasFlag(snap.progress, 'market-paid')) {
        if (held(snap, WT_ITEM.ROCK_CAKE.id) === 0) {
            return { kind: 'custom', name: 'steal a rock cake from the ogre stall', run: stealRockCake };
        }
        return { kind: 'custom', name: 'give the rock cake to the battlement guard', run: crossBattlement };
    }
    const purse = held(snap, WT_ITEM.COINS.id) < CHASM_TOLL * 2 ? sourceCoins(snap, CITY_PURSE) : null;
    return purse
        ? at(area, 'yanille', purse)
        : { kind: 'custom', name: 'pay the ogre guard, jump the chasm, ask the riddle', run: askRiddle };
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
        : { kind: 'custom', name: 'answer the riddle with a death rune', run: answerRiddle };
}

// Why: a cave mouth refuses entry without the map and a lit light source, and bounces you to a fixed tile, which loops forever if the kit was banked or lost.

/** The cave kit shortfall, or null when both are held. */
function needCaveKit(snap: QuestSnapshot, area: WatchtowerArea): QuestStep | null {
    if (held(snap, WT_ITEM.SKAVID_MAP.id) === 0) {
        const inBank = bankOnly(snap, WT_ITEM.SKAVID_MAP);
        if (inBank && inBank.kind === 'withdraw') {
            return at(area, 'yanille', inBank);
        }
        return { kind: 'custom', name: 'ask the city guard for another skavid map', run: askRiddle };
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
        return { kind: 'custom', name: 'learn skavid words from the scared skavid', run: learnFromScaredSkavid };
    }
    if (cave <= 4) {
        return { kind: 'custom', name: `answer the skavid in cave ${cave}`, run: log => learnWord(cave, log) };
    }
    // Cave 6 is behind the gold-bar gate, so the bar has to be in the pack first.
    const bar = bankOnly(snap, WT_ITEM.GOLD_BAR);
    return bar
        ? at(area, 'yanille', bar)
        : { kind: 'custom', name: 'answer the mad skavid for a crystal', run: answerMadSkavid };
}

function stageEnclaveEntry(snap: QuestSnapshot, area: WatchtowerArea): QuestStep {
    if (area === 'enclave') {
        return { kind: 'custom', name: 'leave the shaman enclave', run: leaveEnclave };
    }
    if (held(snap, WT_ITEM.NIGHTSHADE.id) === 0) {
        return needCaveKit(snap, area)
            ?? { kind: 'custom', name: 'take Nightshade from the skavid cave', run: takeNightshade };
    }
    const food = sourceFood(snap, ENCLAVE_FOOD);
    return food
        ? at(area, 'yanille', food)
        : { kind: 'custom', name: 'feed the enclave guard Nightshade', run: enterEnclave };
}

function stagePotion(snap: QuestSnapshot, area: WatchtowerArea): QuestStep {
    if (held(snap, WT_ITEM.OGRE_POTION.id) > 0) {
        return at(area, 'towerFloor', { kind: 'custom', name: 'have the wizard infuse the ogre potion', run: infusePotion });
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
        return needRope(snap, area)
            ?? { kind: 'custom', name: 'pick jangerberries on Grew island', run: pickJangerberries };
    }
    if (held(snap, WT_ITEM.GROUND_BAT_BONES.id) === 0) {
        const bones = bankOnly(snap, WT_ITEM.BAT_BONES);
        if (bones) {
            return bones;
        }
        const pestle = sourcePestle(snap);
        if (pestle) {
            return pestle;
        }
        return { kind: 'custom', name: 'grind the bat bones', run: grindBatBones };
    }
    return { kind: 'custom', name: 'brew the ogre potion', run: brewOgrePotion };
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
                return { kind: 'custom', name: 'leave the enclave to brew another potion', run: leaveEnclave };
            }
            return stagePotion(snap, area);
        }
        if (area !== 'enclave' && held(snap, WT_ITEM.NIGHTSHADE.id) === 0) {
            return needCaveKit(snap, area)
                ?? provisioned({ kind: 'custom', name: 'take Nightshade for the enclave', run: takeNightshade });
        }
        // The mining follows in the same visit, so the pickaxe rides along rather
        // than costing a second trip through the guard.
        const pick = area === 'enclave' ? null : sourcePickaxe(snap);
        if (pick) {
            return provisioned(at(area, 'yanille', pick));
        }
        return provisioned({ kind: 'custom', name: 'dissolve the ogre shamans', run: dissolveShamans });
    }

    if (held(snap, WT_ITEM.CRYSTAL4.id) === 0 && banked(snap, WT_ITEM.CRYSTAL4.id) === 0) {
        // Why: there is no area guard, as standing in the enclave without a pickaxe is the case that has to walk back out for one, and at() does the leaving.
        const pick = sourcePickaxe(snap);
        if (pick) {
            return at(area, 'yanille', pick);
        }
        if (area !== 'enclave' && held(snap, WT_ITEM.NIGHTSHADE.id) === 0) {
            return needCaveKit(snap, area)
                ?? provisioned({ kind: 'custom', name: 'take Nightshade for the enclave', run: takeNightshade });
        }
        return provisioned({ kind: 'custom', name: 'mine the Rock of Dalgroth', run: mineDalgroth });
    }
    if (held(snap, WT_ITEM.CRYSTAL3.id) === 0 && banked(snap, WT_ITEM.CRYSTAL3.id) === 0) {
        if (area !== 'enclave' && held(snap, WT_ITEM.NIGHTSHADE.id) === 0) {
            return needCaveKit(snap, area)
                ?? provisioned({ kind: 'custom', name: 'take Nightshade for the enclave', run: takeNightshade });
        }
        return provisioned({ kind: 'custom', name: 'search a shaman robe for the third crystal', run: searchShamanRobe });
    }
    if (area === 'enclave') {
        return { kind: 'custom', name: 'leave the shaman enclave', run: leaveEnclave };
    }
    const recovery = recoverCrystals(snap);
    if (recovery) {
        return recovery;
    }
    return at(area, 'towerFloor', { kind: 'custom', name: 'take all four crystals to the wizard', run: showCrystalsToWizard });
}

const CRYSTAL_RECOVERY: Readonly<Record<number, { name: string; run: (log: (m: string) => void) => Promise<boolean> }>> = {
    [WT_ITEM.CRYSTAL1.id]: { name: 'ask Grew for another crystal', run: talkToGrew },
    [WT_ITEM.CRYSTAL2.id]: { name: 'ask the mad skavid for another crystal', run: answerMadSkavid },
    [WT_ITEM.CRYSTAL3.id]: { name: 'search a shaman robe for the third crystal', run: searchShamanRobe },
    [WT_ITEM.CRYSTAL4.id]: { name: 'mine the Rock of Dalgroth again', run: mineDalgroth }
};

function recoverCrystals(snap: QuestSnapshot): QuestStep | null {
    // Nothing to recover once all four are carried — do not walk to the bank
    // merely to learn what is in it.
    const lost = CRYSTALS.find(crystal => held(snap, crystal.id) === 0);
    if (!lost) {
        return null;
    }
    // Every re-issue check reads the bank as well as the pack, so a banked crystal
    // blocks its own replacement. Withdraw before asking anyone for another.
    const inBank = CRYSTALS.filter(crystal => held(snap, crystal.id) === 0 && banked(snap, crystal.id) > 0);
    if (inBank.length > 0) {
        return withdrawFrom(inBank.map(crystal => ({ name: crystal.name, id: crystal.id, qty: 1 })));
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const recovery = CRYSTAL_RECOVERY[lost.id];
    return { kind: 'custom', name: recovery.name, run: recovery.run };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete' || (snap.stage ?? -1) >= WATCHTOWER_STAGE.COMPLETE) {
        if (held(snap, WT_ITEM.WATCHTOWER_SPELL.id) > 0) {
            return { kind: 'custom', name: 'read the Watchtower spell scroll', run: readSpellScroll };
        }
        // Completing teleports into the mirror tower in region 45_73.
        const stranded = escapePocket(watchtowerArea(snap.tile), 'yanille');
        return stranded ?? { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.stage === undefined) {
        return { kind: 'wait', reason: 'Watch Tower journal stage unavailable' };
    }
    const area = watchtowerArea(snap.tile);
    if (area === 'unknown') {
        return { kind: 'wait', reason: 'player location unavailable' };
    }
    // Why: pulling the lever teleports into the shielded copy of the tower in region 45_73, and nothing else goes there.
    // Why: standing in it means the quest is done, whatever the journal colour has caught up to.
    if (area === 'mirrorTower') {
        if (held(snap, WT_ITEM.WATCHTOWER_SPELL.id) > 0) {
            return { kind: 'custom', name: 'read the Watchtower spell scroll', run: readSpellScroll };
        }
        return { kind: 'custom', name: 'climb down from the activated Watchtower', run: leaveWizardFloor };
    }

    switch (snap.stage) {
        case WATCHTOWER_STAGE.NOT_STARTED:
            return { kind: 'custom', name: 'climb the Watchtower and ask the wizard for work', run: startQuest };

        case WATCHTOWER_STAGE.STARTED: {
            if (held(snap, WT_ITEM.FINGERNAILS.id) > 0) {
                return at(area, 'towerFloor', { kind: 'custom', name: 'give the fingernails to the wizard', run: handInFingernails });
            }
            return escapePocket(area, 'yanille')
                ?? { kind: 'custom', name: 'search the bush by the Watchtower for evidence', run: searchEvidenceBush };
        }

        // The journal renders one block for stages 2 through 5, so stage 3 reads back
        // as stage 2. Owning the assembled relic is the only visible difference.
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
            return at(area, 'towerFloor', { kind: 'custom', name: 'ask the wizard how to beat the shamans', run: askWizardAboutShamans });

        case WATCHTOWER_STAGE.LEARNED_POTION:
            return stagePotion(snap, area);

        case WATCHTOWER_STAGE.MADE_POTION:
            return stageShamans(snap, area);

        case WATCHTOWER_STAGE.FOUND_ALL_CRYSTALS:
            return at(area, 'towerFloor', { kind: 'custom', name: 'pull the lever to activate the shield', run: pullLever });

        default:
            return { kind: 'wait', reason: 'Watch Tower stage ' + snap.stage + ' is not implemented yet' };
    }
}

export const watchtower: QuestModule = {
    record: QUESTS.find(record => record.id === 'itwatchtower')!,
    bank: WT_TILE.YANILLE_BANK,
    ownsInventory: true,
    readProgress: readWatchtowerProgress,
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.6 },
    decide
};
