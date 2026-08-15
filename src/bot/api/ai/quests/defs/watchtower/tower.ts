import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Reach } from '../../../../walking/Reach.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { driveDialog, talkThrough } from '../../exec/primitives.js';
import { WT_ITEM, WT_LOC, WT_NPC, WT_TILE, watchtowerArea } from './areas.js';
import { WATCHTOWER_QUEST, WATCHTOWER_STAGE } from './journal.js';
import { settleScene } from './scene.js';

function level(): number {
    return Game.tile()?.level ?? -1;
}

function locNear(id: number, op: string, within = 8): Loc | null {
    return Locs.query().where(loc => loc.id === id).action(op).within(within).nearest();
}

async function climbWall(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(WT_TILE.WALL_CLIMB_STAND, { radius: 1, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const wall = locNear(WT_LOC.WALL_CLIMB, 'Climb-up', 6);
    if (!wall || !(await wall.interact('Climb-up'))) {
        log('no climbable Watchtower wall in range');
        return false;
    }
    return Execution.delayUntil(() => level() === 1, 10_000);
}

async function climbTowerLadder(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(WT_TILE.TOWER_LADDER_STAND, { radius: 1, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const ladder = locNear(WT_LOC.TOWER_LADDER, 'Climb-up', 6);
    if (!ladder || !(await ladder.interact('Climb-up'))) {
        log('no Watchtower ladder in range');
        return false;
    }
    return Execution.delayUntil(() => level() === 1, 10_000);
}

export async function climbToWizard(stage: number, log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) === 'towerFloor') {
        return true;
    }
    if (level() === 0) {
        // The tower guard refuses the ladder until the quest is started, so the
        // baked ground-to-first-floor edge is a lie at stage 0.
        const up = stage <= WATCHTOWER_STAGE.NOT_STARTED ? await climbWall(log) : await climbTowerLadder(log);
        if (!up) {
            return false;
        }
    }
    if (level() !== 1) {
        return false;
    }
    await settleScene();
    if (!(await Traversal.walkResilient(WT_TILE.LADDER_UP_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const ladder = locNear(WT_LOC.WATCH_LADDER_UP, 'Climb-up', 6);
    if (!ladder || !(await ladder.interact('Climb-up'))) {
        log('no ladder to the wizard floor in range');
        return false;
    }
    return Execution.delayUntil(() => watchtowerArea(Game.tile()) === 'towerFloor', 10_000);
}

export async function leaveWizardFloor(log: (m: string) => void): Promise<boolean> {
    const area = watchtowerArea(Game.tile());
    if (area !== 'towerFloor' && area !== 'mirrorTower') {
        return true;
    }
    const down = locNear(WT_LOC.WATCH_LADDER_DOWN, 'Climb-down', 10);
    if (!down || !(await down.interact('Climb-down'))) {
        log('no Watchtower ladder down in range');
        return false;
    }
    if (!(await Execution.delayUntil(() => level() === 1, 10_000))) {
        return false;
    }
    await settleScene();
    const out = locNear(WT_LOC.LADDER_TOP, 'Climb-down', 10);
    if (!out || !(await out.interact('Climb-down'))) {
        log('no first-floor ladder down in range');
        return false;
    }
    return Execution.delayUntil(() => level() === 0, 10_000);
}

async function talkToWizard(prefer: string[], log: (m: string) => void): Promise<boolean> {
    if ((await Reach.npcDialog({ name: WT_NPC.WIZARD, near: WT_TILE.WIZARD_FLOOR, log })) !== 'done') {
        return false;
    }
    return talkThrough(WT_NPC.WIZARD, prefer, log);
}

export async function startQuest(log: (m: string) => void): Promise<boolean> {
    if (!(await climbToWizard(WATCHTOWER_STAGE.NOT_STARTED, log))) {
        return false;
    }
    return talkToWizard(
        ["What's the matter?", "So how come the spell doesn't work?", 'Can I be of help?'],
        log
    );
}

export async function searchEvidenceBush(log: (m: string) => void): Promise<boolean> {
    if (Inventory.count(WT_ITEM.FINGERNAILS.name) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.BUSH_NAIL, { radius: 1, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    if (Inventory.free() === 0) {
        log('pack is full — the bush cannot hand over the fingernails');
        return false;
    }
    // Forty-odd decoy bushes share the name, and only this one holds evidence.
    const bush = Locs.query()
        .where(loc => loc.id === WT_LOC.BUSH_NAIL)
        .action('Search')
        .within(6)
        .nearest();
    if (!bush || !(await bush.interact('Search'))) {
        log('the fingernail bush is not in range');
        return false;
    }
    return Execution.delayUntil(() => Inventory.count(WT_ITEM.FINGERNAILS.name) > 0, 8000);
}

export async function handInFingernails(log: (m: string) => void): Promise<boolean> {
    if (Inventory.count(WT_ITEM.FINGERNAILS.name) === 0) {
        log('no fingernails to hand in');
        return false;
    }
    if (!(await climbToWizard(WATCHTOWER_STAGE.STARTED, log))) {
        return false;
    }
    return talkToWizard(['What do you suggest I do?', 'So what do I do?'], log);
}

export async function giveRelicPart(id: number, log: (m: string) => void): Promise<boolean> {
    if (!(await climbToWizard(WATCHTOWER_STAGE.GIVEN_FINGERNAILS, log))) {
        return false;
    }
    const part = Inventory.items().find(item => item.id === id);
    if (!part) {
        log(`relic part ${id} is not in the pack`);
        return false;
    }
    const wizard = Npcs.query().name(WT_NPC.WIZARD).nearest();
    if (!wizard || !(await part.useOn(wizard))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => Inventory.items().every(item => item.id !== id), 8000))) {
        return false;
    }
    return driveDialog([], log);
}

export async function askWizardForRelic(log: (m: string) => void): Promise<boolean> {
    if (!(await climbToWizard(WATCHTOWER_STAGE.MADE_RELIC, log))) {
        return false;
    }
    return talkToWizard(['I have lost the relic you gave me.'], log);
}

export async function askWizardAboutShamans(log: (m: string) => void): Promise<boolean> {
    if (!(await climbToWizard(WATCHTOWER_STAGE.FED_NIGHTSHADE, log))) {
        return false;
    }
    return talkToWizard([], log);
}

export async function showCrystalsToWizard(log: (m: string) => void): Promise<boolean> {
    if (!(await climbToWizard(WATCHTOWER_STAGE.MADE_POTION, log))) {
        return false;
    }
    const crystal = Inventory.items().find(item => item.id === WT_ITEM.CRYSTAL1.id);
    const wizard = Npcs.query().name(WT_NPC.WIZARD).nearest();
    if (!crystal || !wizard || !(await crystal.useOn(wizard))) {
        return false;
    }
    return driveDialog(['This is the last one.', 'I have found another crystal!'], log);
}

export async function pullLever(log: (m: string) => void): Promise<boolean> {
    if (!(await climbToWizard(WATCHTOWER_STAGE.FOUND_ALL_CRYSTALS, log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(WT_TILE.LEVER_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const lever = locNear(WT_LOC.LEVER, 'Pull', 6);
    if (!lever || !(await lever.interact('Pull'))) {
        log('no Watchtower lever in range');
        return false;
    }
    return Execution.delayUntil(() => Quests.status(WATCHTOWER_QUEST) === 'complete', 40_000);
}

export async function readSpellScroll(log: (m: string) => void): Promise<boolean> {
    const scroll = Inventory.items().find(item => item.id === WT_ITEM.WATCHTOWER_SPELL.id);
    if (!scroll) {
        return true;
    }
    if (!(await scroll.interact('Read'))) {
        return false;
    }
    await Execution.delayTicks(2);
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    log('memorised the Watchtower Teleport scroll');
    return true;
}
