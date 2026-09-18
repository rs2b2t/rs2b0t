import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Loc } from '../../../../model/Loc.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type Tile from '../../../../../geometry/Tile.js';
import { EVIL_TOTEMS, FERTILE_SOILS, LQ_ID, LQ_LOC, LQ_LOC_ID, LQ_NPC } from './areas.js';
import { fight } from './fight.js';
import { enterJungle, talkGujuo } from './jungle.js';
import { clearBoxes, driveUntil, heldId, modalText, settleScene, useOnLoc } from './scene.js';

const PLANT_ATTEMPTS = 3;
const GROW_MS = 90_000;

function nearestOf(tiles: readonly Tile[]): Tile {
    const here = Game.tile();
    if (!here) {
        return tiles[0]!;
    }
    return [...tiles].sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0]!;
}

function treeAt(id: number, near: Tile): Loc | null {
    return Locs.query().where(l => l.id === id && l.tile().distanceTo(near) <= 6).nearest();
}

async function axeOn(id: number, name: string, near: Tile, next: number, log: (m: string) => void): Promise<boolean> {
    if (treeAt(next, near)) {
        return true;
    }
    return useOnLoc(
        LQ_ID.RUNE_AXE,
        { name, near, within: 8, id },
        [],
        () => treeAt(next, near) !== null,
        log
    );
}

// Why: every stage of the tree reverts to a rotten one 51 ticks after it grows, so planting, watering, felling, trimming and carving can't be 5 decide ticks.
// Why: the chain is one step whose oracle is the totem pole in the pack.

/** Grow a Yommi tree from a germinated seed and carve it into a totem pole. */
export async function growTotemPole(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.TOTEM_POLE) > 0) {
        return true;
    }
    if (!(await enterJungle(log))) {
        return false;
    }
    if (heldId(LQ_ID.RUNE_AXE) === 0) {
        log('no rune axe in the pack — nothing weaker will touch a Yommi tree');
        return false;
    }
    const soil = nearestOf(FERTILE_SOILS);
    if (!(await Traversal.walkResilient(soil, { radius: 3, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();

    for (let attempt = 0; attempt < PLANT_ATTEMPTS; attempt++) {
        if (treeAt(LQ_LOC_ID.YOMMI_SAPLING, soil) || treeAt(LQ_LOC_ID.YOMMI_ADULT, soil)) {
            break;
        }
        if (heldId(LQ_ID.YOMMI_SEEDS_GERM) === 0) {
            log('no germinated Yommi seeds left to plant');
            return false;
        }
        if (heldId(LQ_ID.GOLD_BOWL_BLESSED_PURE) === 0) {
            log('the planting is refused without sacred water in hand to feed the tree');
            return false;
        }
        await useOnLoc(
            LQ_ID.YOMMI_SEEDS_GERM,
            { name: LQ_LOC.FERTILE_SOIL, near: soil, within: 8, id: LQ_LOC_ID.FERTILE_SOIL },
            [],
            () => treeAt(LQ_LOC_ID.YOMMI_SAPLING, soil) !== null || /withers and dies/.test(modalText()),
            log
        );
        await clearBoxes();
    }

    if (treeAt(LQ_LOC_ID.YOMMI_SAPLING, soil)) {
        const watered = await useOnLoc(
            LQ_ID.GOLD_BOWL_BLESSED_PURE,
            { name: LQ_LOC.YOMMI_SAPLING, near: soil, within: 8, id: LQ_LOC_ID.YOMMI_SAPLING },
            [],
            () => treeAt(LQ_LOC_ID.YOMMI_ADULT, soil) !== null,
            log
        );
        if (!watered) {
            log('the sapling would not take the sacred water');
            return false;
        }
    }

    if (!(await Execution.delayUntil(() => treeAt(LQ_LOC_ID.YOMMI_ADULT, soil) !== null, GROW_MS))) {
        log('no adult Yommi tree grew on the soil');
        return false;
    }
    if (!(await axeOn(LQ_LOC_ID.YOMMI_ADULT, LQ_LOC.YOMMI_ADULT, soil, LQ_LOC_ID.YOMMI_FELLED, log))) {
        return false;
    }
    if (!(await axeOn(LQ_LOC_ID.YOMMI_FELLED, LQ_LOC.YOMMI_FELLED, soil, LQ_LOC_ID.YOMMI_TRIMMED, log))) {
        return false;
    }
    if (!(await axeOn(LQ_LOC_ID.YOMMI_TRIMMED, LQ_LOC.YOMMI_TRIMMED, soil, LQ_LOC_ID.YOMMI_TOTEM, log))) {
        return false;
    }
    const carved = treeAt(LQ_LOC_ID.YOMMI_TOTEM, soil);
    if (!carved || !(await carved.interact('Lift'))) {
        log('the carved totem would not lift');
        return false;
    }
    return Execution.delayUntil(() => heldId(LQ_ID.TOTEM_POLE) > 0, 12_000);
}

const TOTEM_FIGHT_MS = 420_000;

// Why: the first time the new pole touches an evil one the demon comes out, and the second time, after he's dead, swaps them.

/** Put the new pole on an evil totem, fighting whatever comes out of it. */
export async function replaceEvilTotem(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.TOTEM_POLE) === 0) {
        return true;
    }
    if (!(await enterJungle(log))) {
        return false;
    }
    const totem = nearestOf(EVIL_TOTEMS);
    if (!(await Traversal.walkResilient(totem, { radius: 3, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    const enemyNear = (name: string): boolean => Npcs.query().name(name).action('Attack').within(14).exists();
    for (let attempt = 0; attempt < 6; attempt++) {
        if (heldId(LQ_ID.TOTEM_POLE) === 0) {
            return true;
        }
        if (!enemyNear(LQ_NPC.NEZIKCHENED)) {
            await useOnLoc(
                LQ_ID.TOTEM_POLE,
                { name: LQ_LOC.TOTEM_POLE, near: totem, within: 8, id: LQ_LOC_ID.EVIL_TOTEM },
                [],
                () => heldId(LQ_ID.TOTEM_POLE) === 0 || enemyNear(LQ_NPC.NEZIKCHENED),
                log
            );
            await clearBoxes();
        }
        if (heldId(LQ_ID.TOTEM_POLE) === 0) {
            return true;
        }
        // Why: with Viyeldi alive the demon comes alone; kill whatever is swinging.
        for (const name of [LQ_NPC.SAN_TOJALON, LQ_NPC.IRVIG_SENAY, LQ_NPC.RANALPH_DEVERE, LQ_NPC.NEZIKCHENED]) {
            if (enemyNear(name)) {
                await fight({ npc: name, done: () => !enemyNear(name), ms: TOTEM_FIGHT_MS }, log);
            }
        }
        await Execution.delayTicks(4);
    }
    log('the evil totem would not take the new pole');
    return false;
}

const GIFT_PREFER = ['Ok thanks for your help.', 'Do you have any news?'];

/** Gujuo's thanks for the swapped totem: the gilded pole the Guild wants. */
export const takeGildedTotem = talkGujuo(
    GIFT_PREFER,
    () => heldId(LQ_ID.GILDED_TOTEM) > 0,
    120_000
);

const SEEDS_AGAIN_PREFER = ['I need more Yommi tree seeds.', 'Ok, thanks...'];

/** Ask Ungadulu for a fresh set of seeds after the last one withered. */
export async function askForMoreSeeds(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.YOMMI_SEEDS) > 0 || heldId(LQ_ID.YOMMI_SEEDS_GERM) > 0) {
        return true;
    }
    const shaman = Npcs.query().name(LQ_NPC.UNGADULU).within(12).nearest();
    if (!shaman) {
        log('Ungadulu is not in range for more seeds');
        return false;
    }
    if (!(await shaman.interact('Talk-to'))) {
        return false;
    }
    return driveUntil(() => heldId(LQ_ID.YOMMI_SEEDS) > 0, SEEDS_AGAIN_PREFER, log, 90_000);
}
