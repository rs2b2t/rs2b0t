import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Prayer } from '../../../../prayer/Prayer.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import Tile from '../../../../../geometry/Tile.js';
import { ARENA_COVER, atCover, castFromCover, castStrike, readyStrikes, takeStrikeCover } from '../../strikeCombat.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { FA_NPC, pocketOf } from './areas.js';

export interface ArenaFight {
    what: string;
    npcId: number;
    /** Ticks before the fight is declared stuck. */
    guard: number;
    cover?: Tile;
}

// Why: running out mid-fight hands the tick back to the engine, which reads the journal, and that opens a main modal on top of a boss.
// Why: the budgets are generous for that reason; a stalled fight is the watchdog's problem.
export const FA_FIGHT: Record<'ogre' | 'scorpion' | 'bouncer', ArenaFight> = {
    ogre: { what: 'Khazard Ogre', npcId: FA_NPC.OGRE, guard: 600 },
    scorpion: { what: 'Khazard Scorpion', npcId: FA_NPC.SCORPION, guard: 600 },
    bouncer: { what: 'Bouncer', npcId: FA_NPC.BOUNCER, guard: 1500 }
};

export const PROTECT_MELEE = 'protect from melee';
export const PROTECT_LEVEL = 43;
const SEARCH_RADIUS = 20;
/** Empty-target ticks before the fight counts as won; targets do not respawn within this window. */
const MISSING_TO_WIN = 3;

// Why: an empty scene before the first swing means the server hasn't released the beast yet.

/** True once the target has been gone long enough to be dead. */
export function fightWon(swings: number, missingTicks: number): boolean {
    return swings > 0 && missingTicks >= MISSING_TO_WIN;
}

export type FightResult = 'won' | 'stuck' | 'unengaged';

function target(npcId: number): Npc | null {
    return Npcs.query()
        .where(n => n.id === npcId)
        .action('Attack')
        .where(n => !n.targetsAnotherPlayer())
        .within(SEARCH_RADIUS)
        .nearest();
}

// Why: Victory dialogue releases the next target or advances the stage, so drain it before returning.

/** Drain whatever the win opened, without answering an option. */
async function drainWinDialogue(): Promise<void> {
    for (let i = 0; i < 30; i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (!ChatDialog.isOpen()) {
            return;
        }
        await Execution.delayTicks(1);
    }
}

async function dropPrayer(): Promise<void> {
    if (Prayer.active(PROTECT_MELEE)) {
        await Prayer.set(PROTECT_MELEE, false);
    }
}

// Why: the server decodes 1 player op per tick and drops the rest, so a pass that eats, prays and swings loses 2 of the 3, and the one it loses is the food.

/** Run one arena fight to its win. */
export async function runFight(fight: ArenaFight, log: (m: string) => void): Promise<FightResult> {
    const canPray = Skills.level('prayer') >= PROTECT_LEVEL;
    const cover = fight.cover ?? ARENA_COVER;
    const initial = target(fight.npcId);
    if (!fight.cover && initial && pocketOf(initial.networkTile()) !== 'arena') return 'unengaged';
    if (!(await readyStrikes(log)) || !(await takeStrikeCover(cover, log, !fight.cover && !atCover(cover) ? () => target(fight.npcId) : undefined))) return 'stuck';
    let lastTick = -1;
    let reported = -1;
    let swings = 0;
    let missing = 0;

    try {
        for (let i = 0; i < fight.guard; i++) {
            if (EventSignal.pending()) {
                log(`${fight.what}: yielding to a random event`);
                return 'stuck';
            }
            const now = Game.tick();
            if (now === lastTick) {
                await Execution.delayTicks(1);
                continue;
            }
            lastTick = now;

            if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
                await drainWinDialogue();
                continue;
            }
            if (canPray && Prayer.points() > 0 && !Prayer.active(PROTECT_MELEE)) {
                await Prayer.set(PROTECT_MELEE, true);
                continue;
            }
            const foodBefore = Inventory.items().length;
            await Sustain.run();
            if (Inventory.items().length < foodBefore) { await Execution.delayTicks(1); continue; }

            const npc = target(fight.npcId);
            if (!npc) {
                missing++;
                if (fightWon(swings, missing)) {
                    log(`${fight.what}: down after ${swings} attacks`);
                    await drainWinDialogue();
                    await dropPrayer();
                    return 'won';
                }
                await Execution.delayTicks(1);
                continue;
            }
            missing = 0;
            if (now - reported >= 40) {
                reported = now;
                log(`${fight.what}: hp=${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}`
                    + ` prayer=${Prayer.points()} attacks=${swings} at (${npc.tile().x},${npc.tile().z})`);
            }
            if (!atCover(cover)) {
                await takeStrikeCover(cover, log);
                return 'stuck';
            }
            if (!fight.cover && !castFromCover(cover, npc)) {
                const arrived = await Execution.delayUntilTicks(() => {
                    const current = target(fight.npcId);
                    return current !== null && castFromCover(cover, current);
                }, 12);
                if (!arrived) {
                    log(`${fight.what}: luring back around the rock`);
                    await takeStrikeCover(cover, log, () => target(fight.npcId));
                }
                continue;
            }
            if (await castStrike(cover, npc, log)) {
                swings++;
            } else {
                log(`${fight.what}: no cast landed from cover`);
                return 'stuck';
            }
            await Execution.delayTicks(1);
        }
        log(`${fight.what}: gave up after ${fight.guard} ticks (${swings} attacks)`);
        return 'stuck';
    } finally {
        if (!Game.inCombat()) {
            await dropPrayer();
        }
    }
}
