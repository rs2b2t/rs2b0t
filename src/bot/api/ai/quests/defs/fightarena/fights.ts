import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Prayer } from '../../../../prayer/Prayer.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { FA_NPC } from './areas.js';

export interface ArenaFight {
    what: string;
    npcId: number;
    /** Ticks before the fight is declared stuck. */
    guard: number;
}

// Why: running out mid-fight hands the tick back to the engine, which reads the journal, and that opens a main modal on top of a boss.
// Why: the budgets are generous for that reason; a fight that has stalled is the watchdog's problem, not this loop's.
export const FA_FIGHT: Record<'ogre' | 'scorpion' | 'bouncer', ArenaFight> = {
    ogre: { what: 'Khazard Ogre', npcId: FA_NPC.OGRE, guard: 600 },
    scorpion: { what: 'Khazard Scorpion', npcId: FA_NPC.SCORPION, guard: 600 },
    bouncer: { what: 'Bouncer', npcId: FA_NPC.BOUNCER, guard: 1500 }
};

export const PROTECT_MELEE = 'protect from melee';
export const PROTECT_LEVEL = 43;
/** A lobster's worth of damage is enough to eat on; waiting spends the margin. */
const EAT_AT_MISSING = 15;
const SEARCH_RADIUS = 20;
/** Ticks with nothing to hit before the fight counts as won. Nothing here respawns inside 100. */
const MISSING_TO_WIN = 3;

// Why: an empty scene before the first swing means the server has not released the beast yet, which is a different problem from having killed it.

/** True once the target has been gone long enough to be dead rather than unreleased. */
export function fightWon(swings: number, missingTicks: number): boolean {
    return swings > 0 && missingTicks >= MISSING_TO_WIN;
}

// Why: a caged beast is in the scene and offers Attack, so presence proves nothing — the server drops every op against it and the swing counter climbs to the guard while hitpoints never move.

/** Swings taken with no combat before the target counts as unreachable. */
export const ENGAGE_PROOF = 12;

/** True when the target answers Attack but never joins combat, which is what a cage looks like. */
export function unengaged(swings: number, everEngaged: boolean): boolean {
    return !everEngaged && swings >= ENGAGE_PROOF;
}

export type FightResult = 'won' | 'stuck' | 'unengaged';

function hungry(): boolean {
    const max = Skills.level('hitpoints');
    return max > 0 && Skills.effective('hitpoints') <= max - EAT_AT_MISSING;
}

function target(npcId: number): Npc | null {
    return Npcs.query()
        .where(n => n.id === npcId)
        .action('Attack')
        .where(n => !n.targetsAnotherPlayer())
        .within(SEARCH_RADIUS)
        .nearest();
}

// Why: the win opens the dialogue that releases the next beast — the scorpion's summons Bouncer, and Bouncer's frees the Servils and moves the stage.
// Why: leaving it undrained loses the release and parks the quest one step later.

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

// Why: the server decodes one player op per tick and drops the rest, so a pass that eats, prays and swings loses two of the three, and the one it loses is the food.

/** Run one arena fight to its win. */
export async function runFight(fight: ArenaFight, log: (m: string) => void): Promise<FightResult> {
    const canPray = Skills.level('prayer') >= PROTECT_LEVEL;
    if (!canPray) {
        log(`prayer below ${PROTECT_LEVEL} — ${fight.what} will land hits this fight`);
    }
    Game.setAutoRetaliate(true);
    let lastTick = -1;
    let reported = -1;
    let swings = 0;
    let attacking = -1;
    let missing = 0;
    let everEngaged = false;
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
            if (hungry()) {
                await Sustain.run();
                continue;
            }

            const npc = target(fight.npcId);
            if (!npc) {
                attacking = -1;
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
            everEngaged = everEngaged || Game.inCombat();
            if (unengaged(swings, everEngaged)) {
                log(`${fight.what}: ${swings} attacks and never in combat at (${npc.tile().x},${npc.tile().z}) — still caged`);
                return 'unengaged';
            }
            if (now - reported >= 40) {
                reported = now;
                log(`${fight.what}: hp=${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}`
                    + ` prayer=${Prayer.points()} attacks=${swings} at (${npc.tile().x},${npc.tile().z})`);
            }
            // Why: melee keeps swinging on its own, so re-clicking the same target spends the tick's one action on re-targeting.
            if (npc.index === attacking && Game.inCombat()) {
                await Execution.delayTicks(1);
                continue;
            }
            if (await npc.interact('Attack')) {
                attacking = npc.index;
                swings++;
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
