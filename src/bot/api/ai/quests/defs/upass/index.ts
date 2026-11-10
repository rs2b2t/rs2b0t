import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import Tile from '../../../../../geometry/Tile.js';
import { UP_ITEM, UP_LOC, UP_NPC, UP_TILE, carried, held, insideIbanTemple, insideWitchHouse, pastGridTile, upassArea, worn, type UpassArea } from './areas.js';
import { UP_FLAG, UP_STAGE, readUpassProgress } from './journal.js';
import {
    armFireArrow,
    crossToWest,
    enterCave,
    getDampCloth,
    crossToEast,
    leavePass,
    leaveWithKoftik,
    locById,
    reportToLathas,
    makeFireArrow,
    meetKoftik,
    shootGuiderope,
    startQuest,
    walkTo
} from './bridge.js';
import { sweepOrbs, enterWell } from './area1.js';
import { crossGrid } from './grid.js';
import {
    badgesHeld,
    crossTheTemple,
    crushUnicorn,
    enterMainCavern,
    takeRailing,
    takeUnicornHorn
} from './area2.js';
import {
    ascendFromDwarves,
    askKlank,
    askNilhoof,
    buyKamenMeal,
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
    foodHeldNow,
    killDemon,
    killKalrag,
    noteRestock,
    openIbanDoor,
    openSealedChest,
    rubAshes,
    rubDove,
    rubShadow,
    searchCages,
    throwDoll
} from './doll.js';
import { crossChain, outstandingCrossing, takeNextCrossing, TO_RAILINGS } from './railings.js';
import { releaseJournal } from './stall.js';
import { bowWorn, drawGear, FOOD_RETREAT, foodInPack, kitShortfall, meleeCarried, RESTOCK_TARGET, sourceKit, sourceWeapon, wearGear } from './supplies.js';

let lastStep = '';
const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep => {
    lastStep = name;
    return { kind: 'custom', name, run };
};

function flag(snap: QuestSnapshot, name: string): boolean {
    return snap.progress?.flags.has(name) ?? false;
}

/** Everything the pass needs, drawn and worn while a bank is still reachable. */
function outfit(snap: QuestSnapshot, area: UpassArea): QuestStep | null {
    return area === 'mainland' ? sourceKit(snap) ?? wearGear(snap) : null;
}

/** Why: a death past the bridge drops the player back on the surface; re-enter the cave before the stage leg runs. */
async function reenterPass(area: UpassArea, log: (m: string) => void): Promise<boolean> {
    if (area === 'mainland' && !(await crossToWest(log))) {
        return false;
    }
    return enterCave(log);
}

/** Why: the rope bridge is a scripted one-way crossing, so a landing-side resume has to make and fire another arrow to get back west. */
async function shootBridgeAgain(log: (m: string) => void): Promise<boolean> {
    if (!(await getDampCloth(log))) {
        return false;
    }
    if (!(await makeFireArrow(log))) {
        return false;
    }
    if (!(await armFireArrow(log))) {
        return false;
    }
    return shootGuiderope(log);
}

/**
 * Take the unicorn tunnel through to the first cavern.
 * Why: the door's landing depends on its loc_angle, which the mud-dig `loc_change` flips and the journal cannot report; the only proof is the area after the click, so try both halves from both sides and read where the teleport landed.
 */
async function useUnicornTunnel(log: (m: string) => void): Promise<boolean> {
    if (upassArea(Game.tile()) === 'area1') {
        return true;
    }
    const stands = [new Tile(2375, 9613, 0), new Tile(2375, 9609, 0)];
    for (const stand of stands) {
        if (!(await walkTo(stand, 1, log))) {
            continue;
        }
        for (const id of [UP_LOC.UNICORN_DOOR_L, UP_LOC.UNICORN_DOOR_R]) {
            const door = locById(id, null, 8);
            const op = door?.actions()[0];
            if (!door || !op || !(await door.interact(op))) {
                continue;
            }
            await Execution.delayTicks(3);
            if (upassArea(Game.tile()) === 'area1') {
                log(`the unicorn tunnel dropped us at (${Game.tile()?.x},${Game.tile()?.z})`);
                return true;
            }
        }
    }
    log('the unicorn tunnel did not lead out of the crushed-cage room');
    return false;
}

/** Why: the proven cage/dig/ledge/railing chain gets out of the well corridor; the pipe and unicorn tunnel then drop into the temple shelf. The pipe's landing changes with the stage, so the generic seam handles it rather than the fixed landing table. */
async function reachTempleShelf(log: (m: string) => void): Promise<boolean> {
    // Why: after the post-kill pipe the landing is already past the one-way chain, in the unicorn room; restarting at the cage is the loop where its stand is unreachable. If the cage walks from here, the chain is behind us.
    if (!(await walkTo(UP_TILE.UNICORN_CAGE, 3, log))) {
        if (!(await crossChain(TO_RAILINGS, log))) {
            return false;
        }
        if (!(await walkTo(UP_TILE.UNICORN_CAGE, 3, log))) {
            return false;
        }
    }
    if (!(await useUnicornTunnel(log))) {
        return false;
    }
    return walkTo(UP_TILE.TEMPLE_DOOR, 3, log);
}

async function transitToStage(stage: number, area: UpassArea, tile: QuestSnapshot['tile'], log: (m: string) => void): Promise<boolean> {
    if (stage > UP_STAGE.PASSED_BRIDGE && area === 'area1' && !pastGridTile(tile)) {
        // Why: the cave lands east of the fired rope bridge and the pass pocket graph has no edge back across it, so a resumed run shoots the rope again. From the west side the shot is impossible and pointless.
        if (tile != null && tile.x > UP_TILE.BRIDGE_WEST.x + 3 && !(await shootBridgeAgain(log))) {
            log('re-entry: could not fire the guide rope to cross back west');
            return false;
        }
        if (!(await crossGrid(log))) {
            return false;
        }
        // Why: the well only opens once all four orbs are dark, and a resumed run can find the seeded stage with them still lit, so fall back to the sweep.
        if (!(await enterWell(log)) && !(await sweepOrbs(log))) {
            return false;
        }
    }
    if (stage > UP_STAGE.KILLED_UNICORN && area === 'area2' && !(await reachTempleShelf(log))) {
        return false;
    }
    const atTempleShelf = area === 'area1' && pastGridTile(tile);
    if (stage > UP_STAGE.KILLED_UNICORN && (area === 'area2' || atTempleShelf)) {
        // Why: the grid crossing leaves the quest journal up to keep the traps shut, and an open modal blocks every later op-click, so the temple door would never answer.
        await releaseJournal();
        if (!(await enterMainCavern(log)) && !(await crossTheTemple(log))) {
            return false;
        }
    }
    return true;
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

// Why: a death on the landing side of the rope bridge respawns on the surface and re-enters the cave with the bridge gone, so the grid walk cannot find a route west. Retry once with a freshly fired bridge before giving the step up.
async function crossGridOrRebridge(log: (m: string) => void): Promise<boolean> {
    if (await crossGrid(log)) {
        return true;
    }
    log('no route to the grid — firing the guide rope again');
    if (!(await shootBridgeAgain(log))) {
        return false;
    }
    return crossGrid(log);
}

// Why: all 4 orbs are gathered before any is burned, because the furnace sits between the grid and the well and a per-orb round trip crosses the spear-trap corridor 4 times.
function orbLeg(snap: QuestSnapshot): QuestStep {
    if (!pastGridTile(snap.tile)) {
        // Why: the crossing walks itself to the grid lip first, and the rope swing onto that shelf is in travelTo's vocabulary, so the caller doesn't pick seams.
        return custom('cross the spiked grid with the journal held open', crossGridOrRebridge);
    }
    // Why: one step for the sweep. A burned orb has left the pack and reads as never collected, and no site hands over a second, so a per-site decide cycle picks the same site forever. The step keeps its own tally.
    return custom('take and burn the four orbs, then climb the well', sweepOrbs);
}

// Why: a respawn after the crush has lost the railing and the journal reads stage 3 again (stages 3 and 4 share the page), so only the live boulder and cage say the lever is already spent.
async function reachRuinedCage(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.UNICORN_CAGE, 3, log))) {
        const next = outstandingCrossing();
        if (next !== null) {
            return takeNextCrossing(log);
        }
    }
    return takeUnicornHorn(log);
}

/** Past the crush take the horn; before it, cross the corridor and fetch the railing the boulder still needs. */
async function unicornRoomOrRailing(log: (m: string) => void): Promise<boolean> {
    // Why: from the room, walkTo(cage) can pick the pass-through tunnel as a seam and leave toward the first cavern without the horn. The room is a tiny tile box; take the horn from there directly.
    const at = Game.tile();
    if (at !== null && at.x <= 2400 && at.z >= 9600 && at.z <= 9625) {
        return takeUnicornHorn(log);
    }
    const boulder = Npcs.query().where(npc => npc.id === UP_NPC.BOULDER).within(32).nearest();
    const cage = locById(UP_LOC.UNICORN_CAGE, null, 32);
    if (!boulder && cage !== null) {
        return reachRuinedCage(log);
    }
    if (!(await walkTo(UP_TILE.UNICORN_CAGE, 3, log))) {
        const next = outstandingCrossing();
        if (next !== null) {
            return takeNextCrossing(log);
        }
    }
    return takeRailing(log);
}

// Why: stages 3 and 4 are one leg because the journal can't tell them apart, both print "I must work my way deeper into these caverns" and differ only in which line is struck through. The horn is what the snapshot can see, so it ends the step.
function unicornLeg(snap: QuestSnapshot, area: UpassArea): QuestStep {
    if (held(snap, UP_ITEM.UNICORN_HORN) > 0 || badgesHeld(snap) > 0 || area !== 'area2') {
        // Why: at stage 4 the horn is in hand inside the crushed-cage room; the way to the paladins is the unicorn tunnel, and the journal cannot report where its angle-dependent landing goes.
        if (area === 'area2' && (held(snap, UP_ITEM.UNICORN_HORN) > 0 || badgesHeld(snap) > 0)) {
            return custom('take the unicorn tunnel down', useUnicornTunnel);
        }
        return paladinLeg();
    }
    if (held(snap, UP_ITEM.RAILING) === 0) {
        // Why: the journal cannot tell a pre-crush stage 3 from a post-crush death, so the live boulder/cage state decides: a ruined cage needs no lever, and re-fetching one behind the one-way pipe is the loop.
        return custom('reach the ruined unicorn cage', unicornRoomOrRailing);
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
    // Why: a run that climbed down to Klank and then walked to Kalrag's side is still in the level-0 pocket; the cat is on the platforms above.
    if (area === 'dwarves' || area === 'kalrag') {
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

// Why: Kamen hands out a meal in the dwarves camp, and that camp is reachable from the level-1 platforms through the wall tunnel, so a fight that burns the food down to five items can walk back fed instead of dying below the well. One trip buys several meals, because one meal per attempt loses more time walking than it buys in swings.
function restockStep(area: UpassArea): QuestStep {
    return custom('get a meal from Kamen', async log => {
        if (area !== 'dwarves' && area !== 'kalrag' && !(await descendToDwarves(log))) {
            log('no route down to Kamen from here');
            return false;
        }
        while (foodHeldNow() < RESTOCK_TARGET) {
            if (!(await buyKamenMeal(log))) {
                // Why: a full pack or an empty purse cannot be fixed here, so resume with what is left instead of retrying the same dialogue forever.
                return foodHeldNow() > 0;
            }
            noteRestock();
        }
        return foodHeldNow() > FOOD_RETREAT;
    });
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
        // Why: the collapsed bridges over the demon platforms can drop you into the dwarves cave, and the amulet route only exists from level 1.
        if (area === 'dwarves' || area === 'kalrag') {
            return custom('climb back up out of the dwarves cave', ascendFromDwarves);
        }
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
    // Why: a death past the bridge leaves the player on the surface; provision at the bank, then re-enter the cave.
    if ((area === 'mainland' || area === 'westardougne') && stage > UP_STAGE.SPOKEN_KOFTIK && stage < UP_STAGE.DEFEATED_IBAN) {
        // Why: an unarmed re-entry just dies again; the cave mouth is the last bank, so the queue waits here until the weapon and kit are in hand.
        return sourceWeapon(snap) ?? outfit(snap, area) ?? readyToDescend(snap)
            ?? custom('return to the underground pass', log => reenterPass(area, log));
    }
    // Why: Keep the bow equipped through the rope shot and reserve inventory space for the orb sweep; equip melee gear only after the robe-only door.
    const bare = flag(snap, UP_FLAG.DOLL_COMPLETE) && stage < UP_STAGE.DEFEATED_IBAN;
    const gear = stage >= UP_STAGE.PASSED_BRIDGE && !bare ? drawGear(snap) : null;
    if (gear) {
        return gear;
    }
    // Why: once inside, a resumed run can still be in area1/area2 while its stage needs the well or main cavern.
    // Why: the second cavern's temple shelf shares area1's z band, so "past the grid" is the real test; a player already west of it is at the stage's own obstacle, not on the landing side.
    const wrongArea = (stage > UP_STAGE.PASSED_BRIDGE && area === 'area1' && !pastGridTile(snap.tile))
        || (stage > UP_STAGE.KILLED_UNICORN && (area === 'area2' || (area === 'area1' && pastGridTile(snap.tile))));
    if (wrongArea && stage < UP_STAGE.DEFEATED_IBAN) {
        return custom(
            stage > UP_STAGE.KILLED_UNICORN ? 'continue to the main cavern' : 'continue to the second cavern',
            log => transitToStage(stage, area, snap.tile, log)
        );
    }
    // Why: death keeps the three rune pieces and drops the 10gp doll, and Nilhoof hands a replacement at the doll and Iban stages.
    if (stage >= UP_STAGE.FOUND_DOLL && stage < UP_STAGE.DEFEATED_IBAN && held(snap, UP_ITEM.DOLL) === 0) {
        // Why: Nilhoof is in the level-0 dwarf camp; on the platforms the direct walk cannot find the wall tunnel, so use the proven descent first.
        return area === 'dwarves' || area === 'kalrag'
            ? custom('ask Nilhoof for the lost doll', askNilhoof)
            : custom('climb down the wall tunnel to the dwarves', descendToDwarves);
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
                if (insideIbanTemple(snap.tile)) {
                    return custom('throw the doll into the pit of the damned', throwDoll);
                }
                // Why: the collapsing platform bridges can drop a finished doll into the dwarves cave, and the temple doors are only reachable from the level-1 platforms; walking at them from level 0 reports an unreachable goal on every attempt.
                if (area === 'dwarves' || area === 'kalrag') {
                    return custom('climb back up out of the dwarves cave', ascendFromDwarves);
                }
                return custom("open Iban's temple doors", openIbanDoor);
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
    // Why: at two failed attempts an expensive route walk is not going to change, so returning a cheap wait lets the engine park in seconds instead of spending another ten minutes on the same walk. Quick bank/shop/combat steps recover on the next pass, so they are exempt; parking there just stranded a pack that was two withdrawals from ready.
    if (snap.noProgress >= 2 && /main cavern|wall tunnel|dwarves cave|temple shelf|temple doors/i.test(lastStep)) {
        return {
            kind: 'wait',
            reason: `"${lastStep || 'the last step'}" has failed ${snap.noProgress} times with no progress; stopping instead of retrying the same route`
        };
    }
    // Why: the last few lobsters are not enough for Kalrag plus a demon, and there is no bank below the well; the dwarves camp has Kamen, so top up there before the next swing rather than starting a fight that ends in a death. A finished doll and Kardia's locked house are one-room jobs that must finish where they stand.
    const nearKamen = area === 'dwarves' || area === 'kalrag' || area === 'main' || area === 'witch' || area === 'temple';
    const dollReady = (snap.stage === UP_STAGE.FOUND_DOLL || snap.stage === UP_STAGE.CONFRONTED_IBAN)
        && flag(snap, UP_FLAG.DOLL_COMPLETE);
    if (snap.stage >= UP_STAGE.FOUND_DOLL && snap.stage < UP_STAGE.DEFEATED_IBAN
        && nearKamen && !dollReady
        && !insideWitchHouse(snap.tile) && !insideIbanTemple(snap.tile)
        && foodInPack(snap) <= FOOD_RETREAT) {
        return restockStep(area);
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
    // Why: Nilhoof hands out meat pie, meat pizza and bread, and eating those before the last lobster is what carries a 1-Prayer run through the third demon; 0.8 ate the lobsters too early.
    sustain: { foods: [UP_ITEM.LOBSTER.name, 'Meat pie', 'Meat pizza', 'Bread', 'Stew'], eatBelowHp: 0.7 },
    decide
};
