import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { UP_ITEM, UP_TILE, carried, held, insideIbanTemple, insideWitchHouse, pastGridTile, upassArea, worn, type UpassArea } from './areas.js';
import { UP_FLAG, UP_STAGE, readUpassProgress } from './journal.js';
import {
    armFireArrow,
    crossToWest,
    enterCave,
    getDampCloth,
    crossToEast,
    leavePass,
    leaveWithKoftik,
    reportToLathas,
    makeFireArrow,
    meetKoftik,
    shootGuiderope,
    startQuest
} from './bridge.js';
import { sweepOrbs } from './area1.js';
import { crossGrid } from './grid.js';
import {
    badgesHeld,
    crossTheTemple,
    crushUnicorn,
    takeRailing
} from './area2.js';
import {
    ascendFromDwarves,
    askKlank,
    askNilhoof,
    catchCat,
    descendToDwarves,
    distractWitch,
    leaveWitchHouse,
    lootWitchChest,
    wearGauntlets
} from './cavern.js';
import {
    amuletsHeld,
    burnTomb,
    fillBrew,
    killDemon,
    killKalrag,
    openIbanDoor,
    openSealedChest,
    rubAshes,
    rubDove,
    rubShadow,
    searchCages,
    throwDoll
} from './doll.js';
import { outstandingCrossing, takeNextCrossing } from './railings.js';
import { bowWorn, drawGear, kitShortfall, meleeCarried, sourceKit, wearGear } from './supplies.js';

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

function flag(snap: QuestSnapshot, name: string): boolean {
    return snap.progress?.flags.has(name) ?? false;
}

/** Everything the pass needs, drawn and worn while a bank is still reachable. */
function outfit(snap: QuestSnapshot, area: UpassArea): QuestStep | null {
    return area === 'mainland' ? sourceKit(snap) ?? wearGear(snap) : null;
}

// Why: Koftik and the cave mouth are inside West Ardougne, which the navigator has no edge into; the wall is only crossed through the Plague City sewer with the kit already packed.
function inWest(snap: QuestSnapshot, area: UpassArea, step: QuestStep): QuestStep {
    if (area === 'westardougne') {
        return step;
    }
    return readyToDescend(snap) ?? custom('cross the wall into West Ardougne', crossToWest);
}

// Why: the cave mouth is the last point with a bank behind it, so a pack short of the kit stops here and says what's missing.
function readyToDescend(snap: QuestSnapshot): QuestStep | null {
    const missing = kitShortfall(snap);
    // Why: 3 paladins at level 62, 3 demons and Kalrag stand between the bridge and the end, with no bank past the cave mouth, so the fire arrow's bow alone can't win it.
    if (!meleeCarried(snap)) {
        missing.push('a melee weapon (the paladins, the demons and Kalrag), have none');
    }
    return missing.length === 0 ? null : { kind: 'wait', reason: `not equipped for the pass: ${missing.join('; ')}` };
}

function bridgeLeg(snap: QuestSnapshot, area: UpassArea): QuestStep {
    if (area === 'mainland' || area === 'westardougne') {
        // Why: the kit is checked here too, since a pack that lost something inside West Ardougne would walk into a one-way dungeon without it.
        return readyToDescend(snap) ?? inWest(snap, area, custom('enter the underground pass', enterCave));
    }
    if (area !== 'area1') {
        return { kind: 'wait', reason: `bridge leg reached from ${area}` };
    }
    if (carried(snap, UP_ITEM.LIT_ARROW) === 0) {
        if (held(snap, UP_ITEM.DAMP_CLOTH) === 0 && held(snap, UP_ITEM.UNLIT_ARROW) === 0) {
            return custom('take the damp cloth from Koftik', getDampCloth);
        }
        return custom('wrap and light a fire arrow', makeFireArrow);
    }
    if (!worn(snap, UP_ITEM.LIT_ARROW) || !bowWorn(snap)) {
        return custom('wield the bow and the lit arrow', armFireArrow);
    }
    return custom('fire the lit arrow at the bridge stay rope', shootGuiderope);
}

// Why: all 4 orbs are gathered before any is burned, because the furnace sits between the grid and the well and a per-orb round trip crosses the spear-trap corridor 4 times.
function orbLeg(snap: QuestSnapshot): QuestStep {
    if (!pastGridTile(snap.tile)) {
        // Why: the crossing walks itself to the grid lip first, and the rope swing onto that shelf is in travelTo's vocabulary, so the caller doesn't pick seams.
        return custom('cross the spiked grid with the journal held open', crossGrid);
    }
    // Why: one step for the sweep. A burned orb has left the pack and reads as never collected, and no site hands over a second, so a per-site decide cycle picks the same site forever. The step keeps its own tally.
    return custom('take and burn the four orbs, then climb the well', sweepOrbs);
}

// Why: stages 3 and 4 are one leg because the journal can't tell them apart, both print "I must work my way deeper into these caverns" and differ only in which line is struck through. The horn is what the snapshot can see, so it ends the step.
function unicornLeg(snap: QuestSnapshot, area: UpassArea): QuestStep {
    if (held(snap, UP_ITEM.UNICORN_HORN) > 0 || badgesHeld(snap) > 0 || area !== 'area2') {
        return paladinLeg();
    }
    if (held(snap, UP_ITEM.RAILING) === 0) {
        // Why: 6 crossings stand between the well's corridor and that cage, and the engine recognises "the same step" by description alone, so one step for all of them never resets the attempt counter and the watchdog parks it. Each crossing is its own step.
        const next = outstandingCrossing();
        if (next !== null) {
            return custom(`cross ${next.what}`, takeNextCrossing);
        }
        return custom('search the cage bars for a loose railing', takeRailing);
    }
    return custom('crush the unicorn and take its horn', crushUnicorn);
}

// Why: the way back up to the paladins' shelf is the unicorn tunnel at the south end of the second cavern; the mud pile climbs into the orb corridor behind every trap already crossed. The tunnel is one of travelTo's seams, so walking is enough.
// Why: the crests, the well and the doors are one step, because the well eats the crests and the journal never says so, so a snapshot can't tell "not killed yet" from "already fed".
function paladinLeg(): QuestStep {
    return custom('take the crests, feed the well and pass the temple doors', crossTheTemple);
}

function dwarfLeg(area: UpassArea): QuestStep {
    if (area !== 'dwarves') {
        return custom('climb down the wall tunnel to the dwarves', descendToDwarves);
    }
    return custom('ask Nilhoof about the way through', askNilhoof);
}

function witchLeg(snap: QuestSnapshot, area: UpassArea): QuestStep {
    if (area === 'dwarves') {
        return held(snap, UP_ITEM.TINDERBOX) === 0
            ? custom('take a tinderbox from Klank', askKlank)
            : custom('climb back up out of the dwarves cave', ascendFromDwarves);
    }
    // Why: the knock takes the cat and the journal never records it, so "no cat, no doll" reads the same before and after the knock. Only the knock leaves you at her door, so the tile tells them apart.
    // Why: 3 steps because the engine recognises "the same step" by description alone, and the walk to the cat is 56 tiles across 4 bridges. Each part names itself so finishing one resets the count.
    const at = snap.tile;
    const atHerDoor = at !== undefined && at !== null && at.level === UP_TILE.WITCH_DOOR.level
        && Math.max(Math.abs(at.x - UP_TILE.WITCH_DOOR.x), Math.abs(at.z - UP_TILE.WITCH_DOOR.z)) <= 6;
    if (!atHerDoor && held(snap, UP_ITEM.WITCH_CAT) === 0) {
        return custom('catch the witches cat', catchCat);
    }
    if (held(snap, UP_ITEM.WITCH_CAT) > 0) {
        return custom("knock on Kardia's door with the cat", distractWitch);
    }
    return custom("open Kardia's chest and take the doll", lootWitchChest);
}

// Why: the 4 elements are ordered by where they are: ashes and blood hang off the 2 wall tunnels, shadow and conscience off the level-1 platforms, so each tunnel is used once.
function dollLeg(snap: QuestSnapshot, area: UpassArea): QuestStep {
    if (held(snap, UP_ITEM.ASHES) > 0) {
        return custom("rub Iban's ashes into the doll", rubAshes);
    }
    if (held(snap, UP_ITEM.SHADOW) > 0) {
        return custom("pour Iban's shadow over the doll", rubShadow);
    }
    if (held(snap, UP_ITEM.DOVE) > 0) {
        return custom("crumble Iban's dove into the doll", rubDove);
    }
    // Why: the 4 elements sit in 4 pockets joined by one-way tunnels, so each names the pocket it needs and the step that gets there.
    if (!flag(snap, UP_FLAG.ASHES_ON_DOLL)) {
        // Why: the camp and Kalrag's cave are one pocket, so a resume on her side is already down here; naming only the camp sends it back down a tunnel it's standing below.
        if (area !== 'dwarves' && area !== 'kalrag') {
            return custom('climb down the wall tunnel to the dwarves', descendToDwarves);
        }
        if (held(snap, UP_ITEM.GAUNTLETS) === 0) {
            return custom("take Klank's gauntlets", askKlank);
        }
        return held(snap, UP_ITEM.DWARF_BREW) === 0
            ? custom('fill the bucket with dwarf brew', fillBrew)
            : custom("soak and burn Iban's tomb", burnTomb);
    }
    // Why: the collision pack floods the dwarf camp, Iban's tomb, Kalrag and both wall-tunnel exits into one pocket, so take the blood while already down here. Kalrag only gives it with the doll in the pack and the stage still `found`.
    if (!flag(snap, UP_FLAG.BLOOD_ON_DOLL) && (area === 'dwarves' || area === 'kalrag')) {
        return custom('kill Kalrag with the doll in hand', killKalrag);
    }
    if (!flag(snap, UP_FLAG.DOVE_ON_DOLL)) {
        // Why: taking the blood leaves you on Kalrag's tile, which classifies as `kalrag`, and a guard naming only `dwarves` walks off to a level-1 cage from level 0. Both names are one pocket and both climb out.
        if (area === 'dwarves' || area === 'kalrag') {
            return custom('climb back up out of the dwarves cave', ascendFromDwarves);
        }
        return held(snap, UP_ITEM.GAUNTLETS) > 0 && !worn(snap, UP_ITEM.GAUNTLETS)
            ? custom("wear Klank's gauntlets", wearGauntlets)
            : custom('search the soulless cages for the dove', searchCages);
    }
    if (!flag(snap, UP_FLAG.SHADOW_ON_DOLL)) {
        return amuletsHeld(snap) < 3
            ? custom('kill a demon for its amulet', killDemon)
            : custom('open the sealed chest for the shadow', openSealedChest);
    }
    if (!flag(snap, UP_FLAG.BLOOD_ON_DOLL)) {
        return area === 'kalrag' || area === 'dwarves'
            ? custom('kill Kalrag with the doll in hand', killKalrag)
            // Why: the pack floods Klank, Nilhoof and Kalrag into one level-0 pocket, and the tunnel beside Kalrag is on no bridge the platform graph knows, so routing at it strands you.
            : custom('climb down the wall tunnel to the dwarves', descendToDwarves);
    }
    return custom("open Iban's temple doors", openIbanDoor);
}

// Why: the temple throws you into the second cavern, which has no walkable way up; Koftik's dialogue is the transport, so the walk out is 4 steps keyed on where the last one landed.
function finishLeg(area: UpassArea): QuestStep {
    switch (area) {
        case 'area2':
            return custom('find Koftik and let him lead the way out', leaveWithKoftik);
        case 'area1':
            return custom('leave the underground pass', leavePass);
        case 'westardougne':
            return custom('cross the wall back into East Ardougne', crossToEast);
        case 'mainland':
            return custom('report to King Lathas', reportToLathas);
        default:
            return { kind: 'wait', reason: `thrown out of Iban's temple into ${area}` };
    }
}

function stageStep(snap: QuestSnapshot, area: UpassArea, stage: number): QuestStep {
// Why: The doll chest pocket's only exit is absent from the nav pack, so leave it explicitly.
    if (insideWitchHouse(snap.tile)) {
        return custom("let yourself out of Kardia's house", leaveWitchHouse);
    }
    // Why: Keep the bow equipped through the rope shot and reserve inventory space for the orb sweep; equip melee gear only after the robe-only door.
    const bare = flag(snap, UP_FLAG.DOLL_COMPLETE) && stage < UP_STAGE.DEFEATED_IBAN;
    const gear = stage >= UP_STAGE.PASSED_BRIDGE && !bare ? drawGear(snap) : null;
    if (gear) {
        return gear;
    }
    switch (stage) {
        case UP_STAGE.NOT_STARTED:
            return outfit(snap, area)
                ?? (flag(snap, UP_FLAG.STARTED)
                    ? inWest(snap, area, custom('meet Koftik at the cave mouth', meetKoftik))
                    : custom('ask King Lathas about the mountains', startQuest));
        case UP_STAGE.SPOKEN_KOFTIK:
            return outfit(snap, area) ?? bridgeLeg(snap, area);
        case UP_STAGE.PASSED_BRIDGE:
            return orbLeg(snap);
        case UP_STAGE.ENTERED_SECOND_AREA:
        case UP_STAGE.KILLED_UNICORN:
            return unicornLeg(snap, area);
        case UP_STAGE.ENTERED_MAIN_AREA:
            return dwarfLeg(area);
        case UP_STAGE.SPOKEN_NILHOOF:
            return witchLeg(snap, area);
        case UP_STAGE.FOUND_DOLL:
        case UP_STAGE.CONFRONTED_IBAN:
            if (flag(snap, UP_FLAG.DOLL_COMPLETE)) {
                return insideIbanTemple(snap.tile)
                    ? custom('throw the doll into the pit of the damned', throwDoll)
                    : custom("open Iban's temple doors", openIbanDoor);
            }
            return dollLeg(snap, area);
        case UP_STAGE.DEFEATED_IBAN:
            return finishLeg(area);
        default:
            return { kind: 'wait', reason: `Underground Pass stage ${stage} is not implemented` };
    }
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    const area = upassArea(snap.tile);
    if (area === 'unknown') {
        return { kind: 'wait', reason: 'player location unavailable' };
    }
    if (snap.journal === 'complete' || (snap.stage ?? -1) >= UP_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.stage === undefined) {
        return { kind: 'wait', reason: 'Underground Pass journal stage unavailable' };
    }
    return stageStep(snap, area, snap.stage);
}

export const upass: QuestModule = {
    record: QUESTS.find(record => record.id === 'upass')!,
    pray: { protect: 'melee', potions: 2 },
    bank: UP_TILE.ARDOUGNE_BANK,
    ownsInventory: true,
    readProgress: readUpassProgress,
    // Why: the corridor traps are timer damage on chokepoint tiles, and avoiding those tiles deletes 4 of the 6 routes through the orb corridor because the traps sit in the only walkable squares, so the eat threshold is high.
    sustain: { foods: [UP_ITEM.LOBSTER.name], eatBelowHp: 0.8 },
    decide
};
