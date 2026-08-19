import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Prayer } from '../../../../prayer/Prayer.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { heldId, settleScene } from '../../exec/prompts.js';
import { TG_ITEM, TG_TILE } from './areas.js';

const WARLORD_ID = 477;
const COMMANDER_ID = 478;

const PROTECT_MELEE = 'protect from melee';
const PROTECT_LEVEL = 43;

/** A lobster's worth of damage is enough to eat on; waiting spends the margin. */
const EAT_AT_MISSING = 15;
const SEARCH_RADIUS = 16;
const REPORT_TICKS = 40;

function hungry(): boolean {
    const max = Skills.level('hitpoints');
    return max > 0 && Skills.effective('hitpoints') <= max - EAT_AT_MISSING;
}

function target(npcId: number, radius: number): Npc | null {
    return Npcs.query()
        .where(n => n.id === npcId)
        .action('Attack')
        .where(n => !n.targetsAnotherPlayer())
        .within(radius)
        .nearest();
}

async function drainDialogue(): Promise<void> {
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

interface MeleeFight {
    what: string;
    npcId: number;
    radius: number;
    won: () => boolean;
    /** Ticks before the fight is declared stuck. */
    guard: number;
}

// Why: the server decodes one player op per tick and drops the rest, so a pass that prays, eats and swings loses two of the three.
async function meleeFight(fight: MeleeFight, log: (m: string) => void): Promise<boolean> {
    const canPray = Skills.level('prayer') >= PROTECT_LEVEL;
    if (!canPray) {
        log(`prayer below ${PROTECT_LEVEL} — ${fight.what} will land every hit this fight`);
    }
    Game.setAutoRetaliate(true);
    let lastTick = -1;
    let reported = -1;
    let swings = 0;
    let attacking = -1;
    try {
        for (let i = 0; i < fight.guard; i++) {
            if (fight.won()) {
                log(`${fight.what}: down after ${swings} attacks`);
                await drainDialogue();
                return true;
            }
            if (EventSignal.pending()) {
                log(`${fight.what}: yielding to a random event`);
                return false;
            }
            const now = Game.tick();
            if (now === lastTick) {
                await Execution.delayTicks(1);
                continue;
            }
            lastTick = now;

            if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
                await drainDialogue();
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

            const npc = target(fight.npcId, fight.radius);
            if (!npc) {
                attacking = -1;
                await Execution.delayTicks(2);
                continue;
            }
            if (now - reported >= REPORT_TICKS) {
                reported = now;
                log(`${fight.what}: hp=${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}`
                    + ` prayer=${Prayer.points()} attacks=${swings}`);
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
        return false;
    } finally {
        // Why: left holding, Protect from Melee burns the bar flat over the walk to the next fight — the loop re-arms in a tick if this one is not over.
        await dropPrayer();
    }
}

const WARLORD_GUARD = 1500;
const COMMANDER_GUARD = 200;

/** `defeat_warlord` hands the orbs over on his death, so the pack is the oracle. */
export async function killTheWarlord(log: (m: string) => void): Promise<boolean> {
    if (heldId(TG_ITEM.ORBS.id) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(TG_TILE.WARLORD, { radius: 4, attempts: 3, timeoutMs: 240_000, log }))) {
        return false;
    }
    await settleScene();
    return meleeFight({
        what: 'Khazard warlord',
        npcId: WARLORD_ID,
        radius: SEARCH_RADIUS,
        guard: WARLORD_GUARD,
        won: () => heldId(TG_ITEM.ORBS.id) > 0
    }, log);
}

// Why: opening the chest and climbing the wall both run `~npc_retaliate`, and a commander swinging at the bot walks it off every stand the leg depends on.
export async function clearCommander(log: (m: string) => void): Promise<boolean> {
    if (target(COMMANDER_ID, 6) === null) {
        return true;
    }
    log('a Khazard commander is in the way — clearing it');
    return meleeFight({
        what: 'Khazard commander',
        npcId: COMMANDER_ID,
        radius: 6,
        guard: COMMANDER_GUARD,
        won: () => target(COMMANDER_ID, 6) === null
    }, log);
}
