import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Reach } from '../../../../walking/Reach.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { talkStrict, talkThrough } from '../../exec/primitives.js';
import { WT_ITEM, WT_LOC, WT_NPC, WT_TILE, watchtowerArea } from './areas.js';
import { settleScene } from './scene.js';

export const JANGERBERRY_TARGET = 2;

function heldId(id: number): number {
    return Inventory.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

function locNear(id: number, op: string, within = 8): Loc | null {
    return Locs.query().where(loc => loc.id === id).action(op).within(within).nearest();
}

export async function talkToOg(log: (m: string) => void): Promise<boolean> {
    if ((await Reach.npcDialog({ name: WT_NPC.OG, near: WT_TILE.OG, log })) !== 'done') {
        return false;
    }
    // The unmatched option here is "I have come to kill you."
    return talkStrict(WT_NPC.OG, ['I seek entrance to the city of ogres.', 'I have your gold.', 'I have lost the key!'], log);
}

async function enterTobanCamp(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) === 'tobanCamp') {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.TOBAN_CAVE, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const cave = locNear(WT_LOC.TOBAN_CAVE, 'Enter');
    if (!cave || !(await cave.interact('Enter'))) {
        log('no Toban cave entrance in range');
        return false;
    }
    if (!(await Execution.delayUntil(() => watchtowerArea(Game.tile()) === 'tobanCamp', 15_000))) {
        return false;
    }
    await settleScene();
    return true;
}

export async function leaveTobanCamp(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) !== 'tobanCamp') {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.TOBAN_LADDER, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const ladder = locNear(WT_LOC.TOBAN_LADDER_DOWN, 'Climb-down', 6);
    if (!ladder || !(await ladder.interact('Climb-down'))) {
        log("no ladder out of Toban's camp in range");
        return false;
    }
    if (!(await Execution.delayUntil(() => watchtowerArea(Game.tile()) !== 'tobanCamp', 15_000))) {
        return false;
    }
    await settleScene();
    return true;
}

export async function openTobanChest(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.STOLEN_GOLD.id) > 0) {
        return true;
    }
    if (!(await enterTobanCamp(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(WT_TILE.TOBAN_CHEST, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const chest = Locs.query().where(loc => loc.id === WT_LOC.TOBAN_CHEST).within(6).nearest();
    const key = Inventory.items().find(item => item.id === WT_ITEM.TOBAN_KEY.id);
    if (!chest || !key) {
        log("no chest, or no key, at Toban's camp");
        return false;
    }
    // op1 eats the key; using the key on the chest keeps it for a second opening.
    if (!(await key.useOn(chest))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(WT_ITEM.STOLEN_GOLD.id) > 0, 8000);
}

export async function talkToToban(log: (m: string) => void): Promise<boolean> {
    if (!(await enterTobanCamp(log))) {
        return false;
    }
    if ((await Reach.npcDialog({ name: WT_NPC.TOBAN, near: WT_TILE.TOBAN, log })) !== 'done') {
        return false;
    }
    // The unmatched option here is "Die, creature!"
    return talkStrict(
        WT_NPC.TOBAN,
        ['I seek entrance to the city of ogres.', 'I could do something for you...', 'I can\'t find the relic part you gave me.'],
        log
    );
}

async function swingToGrewIsland(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) === 'grewIsland') {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.ROPESWING_STAND, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const tree = Locs.query().where(loc => loc.id === WT_LOC.ROPESWING_NOROPE).within(6).nearest();
    const rope = Inventory.items().find(item => item.id === WT_ITEM.ROPE.id);
    if (!tree || !rope) {
        log('no rope, or no swing tree, at the Grew crossing');
        return false;
    }
    if (!(await rope.useOn(tree))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => watchtowerArea(Game.tile()) === 'grewIsland', 15_000))) {
        return false;
    }
    await settleScene();
    return true;
}

export async function leaveGrewIsland(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) !== 'grewIsland') {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.GREW_EXIT_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const swing = locNear(WT_LOC.ROPESWING, 'Swing-on', 6);
    if (!swing || !(await swing.interact('Swing-on'))) {
        log('no Grew-island rope swing in range');
        return false;
    }
    if (!(await Execution.delayUntil(() => watchtowerArea(Game.tile()) !== 'grewIsland', 15_000))) {
        return false;
    }
    await settleScene();
    return true;
}

export async function talkToGrew(log: (m: string) => void): Promise<boolean> {
    if (!(await swingToGrewIsland(log))) {
        return false;
    }
    if ((await Reach.npcDialog({ name: WT_NPC.GREW, near: WT_TILE.GREW, log })) !== 'done') {
        return false;
    }
    // The unmatched option here is "You will have to kill me first."
    return talkStrict(
        WT_NPC.GREW,
        ['Don\'t eat me; I can help you.', 'I\'ve lost the relic part you gave me.', 'I\'ve lost the crystal you gave me.'],
        log
    );
}

export async function pickJangerberries(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.JANGERBERRIES.id) >= JANGERBERRY_TARGET) {
        return true;
    }
    if (!(await swingToGrewIsland(log))) {
        return false;
    }
    for (const spot of WT_TILE.JANGERBERRIES) {
        if (heldId(WT_ITEM.JANGERBERRIES.id) >= JANGERBERRY_TARGET) {
            return true;
        }
        if (!(await Traversal.walkResilient(spot, { radius: 1, attempts: 2, timeoutMs: 45_000, log }))) {
            continue;
        }
        const berry = GroundItems.query().name(WT_ITEM.JANGERBERRIES.name).within(3).nearest();
        if (!berry) {
            continue;
        }
        const before = heldId(WT_ITEM.JANGERBERRIES.id);
        if (await berry.interact('Take')) {
            await Execution.delayUntil(() => heldId(WT_ITEM.JANGERBERRIES.id) > before, 5000);
        }
    }
    return heldId(WT_ITEM.JANGERBERRIES.id) > 0;
}

export async function killGorad(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.OGRE_TOOTH.id) > 0) {
        return true;
    }
    if (Inventory.free() === 0) {
        log('no free slot — Gorad drops nothing into a full pack');
        return false;
    }
    if (!(await enterTobanCamp(log))) {
        return false;
    }
    if ((await Reach.npcDialog({ name: WT_NPC.GORAD, near: WT_TILE.GORAD, log })) !== 'done') {
        return false;
    }
    if (!(await talkThrough(WT_NPC.GORAD, ["I don't know who you are."], log))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(WT_ITEM.OGRE_TOOTH.id) > 0, 240_000);
}
