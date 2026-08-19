import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Reach } from '../../../../walking/Reach.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type Tile from '../../../../../geometry/Tile.js';
import { talkStrict } from '../../exec/primitives.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import { RG_ITEM, RG_LOC, RG_NPC, RG_TILE } from './areas.js';
import { RG_STAGE } from './journal.js';
import { pocketAt, travelTirannwn } from './pockets.js';

const IORWERTH = 'Lord Iorwerth';
const TRACKER = 'Elf Tracker';
const MESSENGER = 'Kings messenger';
/** How long the soldier gets before the step gives the decide cycle its turn back. */
const FIGHT_MS = 240_000;
/** How long one attack is left to run before it is renewed. */
const RENEW_MS = 6_000;
/** Below this, with an empty pack, the fight is not worth the walk back. */
const BAIL_HP = 0.4;
/** Idris, Essyllt and Morvran — the three elves of the scout ambush. */
const SCOUT_IDS = [1186, 1187, 1188];

/** Walk anywhere in Tirannwn, crossing whatever seals the target's pocket off. */
export async function walkTo(dest: Tile, radius: number, stage: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === dest.level && dest.distanceTo(here) <= radius) {
        return true;
    }
    return travelTirannwn(dest, radius, stage, log);
}

async function talkAt(name: string, near: Tile, stage: number, prefer: string[], log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(near, 3, stage, log))) {
        return false;
    }
    await settleScene();
    if ((await Reach.npcDialog({ name, near, log })) !== 'done') {
        log(`no dialogue with ${name} near (${near.x},${near.z})`);
        return false;
    }
    return talkStrict(name, prefer, log);
}

function findMessenger(): Npc | null {
    return Npcs.query().where(npc => npc.id === RG_NPC.MESSENGER).within(14).nearest();
}

// Why: `start_king_messenger_timer` is armed at login and fires 400-1200 ticks later, so the messenger comes to the player wherever they stand — there is nowhere to walk to, and his own `ai_opplayer2` opens the conversation and hands over the scroll before the player has clicked anything.

/** Wait for the King's messenger and take his scroll. */
export async function takeSummons(log: (m: string) => void): Promise<boolean> {
    if (heldId(RG_ITEM.SUMMONS.id) > 0) {
        return true;
    }
    if (findMessenger() === null && !ChatDialog.isOpen() && !ChatDialog.canContinue()) {
        log("waiting for the King's messenger");
        if (!(await Execution.delayUntil(() => findMessenger() !== null || ChatDialog.isOpen() || ChatDialog.canContinue(), 180_000))) {
            return false;
        }
    }
    if (await driveUntil(() => heldId(RG_ITEM.SUMMONS.id) > 0, [], log, 30_000)) {
        return true;
    }
    // Why: he only opens the dialogue himself once; after that the scroll is asked for by hand.
    return talkStrict(MESSENGER, [], log);
}

/** King Lathas, upstairs in Ardougne castle — his `regicide_received_message` branch has no choices. */
export async function briefFromLathas(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(RG_TILE.LATHAS, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    await settleScene();
    return talkStrict('King Lathas', [], log);
}

// Why: the scout ambush is a `[timer,spawn_idris]` armed by walking into mapsquare 35_49, 35_50 or 36_50, and NORMAL timers only run under `canAccess()` — so this step must not open the quest journal while it waits, and it must not walk away either, because `spawn_evil_elves` delays whenever the player is more than one tile from Idris.

/** Stand still in the forest until the elf scouts stage their ambush, then hear them out. */
export async function meetScouts(log: (m: string) => void): Promise<boolean> {
    const elfNear = (): boolean =>
        Npcs.query().where(npc => SCOUT_IDS.includes(npc.id)).within(8).nearest() !== null;
    if (!ChatDialog.isOpen() && !ChatDialog.canContinue() && !elfNear()) {
        log('waiting in the forest for the elf scouts');
        if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue() || elfNear(), 90_000))) {
            return false;
        }
    }
    // Why: the ambush is one long scripted chain — Idris hails, is shot, and the pair who shot him then speak — with `p_delay`s between the beats that outlast a dialogue-driver's own idle gap. The goal is the elves leaving, which is what the last line queues.
    return driveUntil(() => !elfNear() && !ChatDialog.isOpen(), [], log, 120_000);
}

export function askIorwerth(stage: number, log: (m: string) => void): Promise<boolean> {
    return talkAt(IORWERTH, RG_TILE.IORWERTH, stage, [], log);
}

export function askTracker(stage: number, log: (m: string) => void): Promise<boolean> {
    return talkAt(TRACKER, RG_TILE.TRACKER, stage, [], log);
}

/** The tracks at the west end of the old camp; Follow moves the stage on. */
export async function followTracks(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(RG_TILE.FOOTPRINTS, 2, RG_STAGE.SHOWN_PENDANT, log))) {
        return false;
    }
    await settleScene();
    const tracks = Locs.query().where(loc => loc.id === RG_LOC.FOOTPRINTS).action('Follow').within(10).nearest();
    if (!tracks || !(await tracks.interact('Follow'))) {
        log('no tracks at the west end of the old camp');
        return false;
    }
    await Execution.delayTicks(3);
    return true;
}

function soldierNear(): Npc | null {
    return Npcs.query()
        .where(npc => npc.id === RG_NPC.OLD_CAMP_GUARD || npc.id === RG_NPC.CAMP_GUARD)
        .action('Attack')
        .within(14)
        .nearest();
}

// Why: the soldier is level 110 with 110 hitpoints, 95 strength and a halberd, against an account this quest only asks 56 Agility of. Two runs died to it in under a minute wearing the full rune set, because `Sustain.run()` is not a background task — `Traversal` calls it on every walk and a step that stands still fighting calls it never, so the character fought from start to finish without eating once.
// Why: and one `Attack` click is not enough either. A halberd out-ranges the player, so the walk in and every knockback break the interaction off, and a fight left un-renewed is a character being hit for free.

/** Fight until the soldier is gone, eating every tick and renewing the attack whenever it lapses. */
async function fightSoldier(log: (m: string) => void): Promise<boolean> {
    log("fighting one of King Tyras's men");
    const deadline = performance.now() + FIGHT_MS;
    let renewAt = 0;
    while (performance.now() < deadline) {
        const target = soldierNear();
        if (!target) {
            return true;
        }
        await Sustain.run();
        // Why: a pack with nothing left in it is the one thing this step has to notice for itself — carrying on from here is how a run ends at a Lumbridge grave with its kit on the far side of the palisade, and there is no walking back for it.
        if (Skills.hpFraction() < BAIL_HP && Inventory.count(RG_ITEM.SHARK.name) === 0) {
            log(`breaking off the fight at ${Math.round(Skills.hpFraction() * 100)}% with no food left`);
            return false;
        }
        if (performance.now() >= renewAt) {
            if (!(await target.interact('Attack'))) {
                return false;
            }
            renewAt = performance.now() + RENEW_MS;
        }
        await Execution.delayTicks(1);
    }
    return soldierNear() === null;
}

// Why: two different soldiers can carry this stage. `spawn_tyras_guard` posts the old camp's one only the once — it latches `^regicide_seen_guard` — while the camp entrance posts a fresh `regicide_tyras_camp_guard` on every crossing attempt, so the entrance is the fallback that always works.

/** Kill the soldier that stands between the tracks and Tyras's camp. */
export async function killSoldier(log: (m: string) => void): Promise<boolean> {
    if (soldierNear()) {
        return fightSoldier(log);
    }
    const stage = RG_STAGE.SPOKEN_TRACKER2;
    if (pocketAt(Game.tile()) !== 'old-camp-west') {
        if (!(await walkTo(RG_TILE.OLD_CAMP_WEST, 1, stage, log))) {
            return false;
        }
        await Execution.delayTicks(4);
        if (soldierNear()) {
            return fightSoldier(log);
        }
    }
    if (!(await walkTo(RG_TILE.CAMP_ENTRANCE, 1, stage, log))) {
        return false;
    }
    await settleScene();
    const crossing = Locs.query().where(loc => loc.id === 3998).action('Enter').within(8).nearest();
    if (!crossing || !(await crossing.interact('Enter'))) {
        log('no camp crossing to draw the guard out');
        return false;
    }
    if (!(await driveUntil(() => soldierNear() !== null, [], log, 15_000))) {
        return false;
    }
    return fightSoldier(log);
}

// Why: the stage moves on the crossing itself, not on reaching the tents — `_regicide_cross_over` sets `^regicide_entered_camp` as it puts the player down on the far side. Walking on to the king's pavilion would be four more crossings there and four back for a stage already banked.

/** Squeeze past the camp guard's post, which is what the journal counts as finding the camp. */
export async function enterCamp(log: (m: string) => void): Promise<boolean> {
    return walkTo(RG_TILE.CAMP_INSIDE, 1, RG_STAGE.DEFEATED_GUARD, log);
}
