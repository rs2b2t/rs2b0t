import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Sustain } from '../../../api/Sustain.js';
import { Traversal } from '../../../api/Traversal.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { GroundItems } from '../../../api/queries/GroundItems.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import type { Npc } from '../../../api/entities/index.js';
import { GameMessages } from '../../../events/gameMessages.js';
import { heldId, settleScene } from '../../exec/prompts.js';
import { FC_ID, FC_ITEM, FC_NPC, inChronozonLair } from './areas.js';

const WEAKENS = /chronozon weakens/i;

/**
 * The four spells that unlock the kill, in casting order.
 *
 * `~chronozon_spell` runs inside `pvm_spell_success`, so a splash sets nothing —
 * only a landed cast counts, and the "Chronozon weakens..." line is emitted at
 * exactly the moment the bit is set. Casting is therefore retried per spell
 * until that line appears, rather than counted.
 */
export const BLASTS = ['Wind blast', 'Water blast', 'Earth blast', 'Fire blast'] as const;

function chronozon(): Npc | null {
    return Npcs.query().where(n => n.id === FC_NPC.CHRONOZON_NPC_ID).within(16).nearest();
}

/**
 * Chronozon respawns 60 ticks after a kill, and this fight kills it repeatedly
 * on the way to arming all four bits — so "not in the scene" almost always means
 * "not back yet", not "we are in the wrong place".
 */
export async function walkToChronozon(log: (m: string) => void): Promise<boolean> {
    if (inChronozonLair(Game.tile()) && chronozon()) {
        return true;
    }
    if (!inChronozonLair(Game.tile())
        && !(await Traversal.walkResilient(FC_NPC.CHRONOZON, { radius: 4, attempts: 5, timeoutMs: 300_000, log }))) {
        return false;
    }
    await settleScene();
    if (chronozon()) {
        return true;
    }
    log('Chronozon is not in the scene — waiting for the respawn');
    return Execution.delayUntil(() => chronozon() !== null, 60_000);
}

/**
 * Land one of each elemental blast, then finish the demon.
 *
 * Killing it before all four have landed is harmless: `ai_queue3` heals it to
 * full and sets it back on the player instead of letting it die, which is also
 * why the loop below never has to protect its damage output.
 */
export async function fightChronozon(log: (m: string) => void): Promise<boolean> {
    if (!(await walkToChronozon(log))) {
        log('could not reach Chronozon');
        return false;
    }

    for (const spell of BLASTS) {
        let landed = false;
        for (let attempt = 0; attempt < 12 && !landed; attempt++) {
            // Chronozon is a lvl-170 demon in the wilderness, where the
            // not-too-strong check does not apply — it hits the whole fight.
            await Sustain.run();
            const target = chronozon();
            if (!target) {
                if (!(await walkToChronozon(log))) {
                    return false;
                }
                continue;
            }
            const mark = GameMessages.mark();
            if (!(await Game.castOnNpc(spell, target))) {
                log(`could not select ${spell} — magic level or runes short`);
                return false;
            }
            landed = await Execution.delayUntil(() => GameMessages.sawSince(mark, WEAKENS), 8000);
        }
        if (!landed) {
            log(`${spell} never landed on Chronozon — out of runes?`);
            return false;
        }
        log(`${spell} landed`);
    }

    log('all four blasts landed — killing Chronozon');
    for (let attempt = 0; attempt < 60; attempt++) {
        await Sustain.run();
        if (heldId(FC_ID.CREST_FROM_CHRONOZON) > 0) {
            return true;
        }
        const drop = GroundItems.query().name(FC_ITEM.CREST_PART).within(12).nearest();
        if (drop) {
            const before = heldId(FC_ID.CREST_FROM_CHRONOZON);
            if (await drop.interact('Take')) {
                if (await Execution.delayUntil(() => heldId(FC_ID.CREST_FROM_CHRONOZON) > before, 6000)) {
                    log("took Johnathon's crest part");
                    return true;
                }
            }
            continue;
        }
        const target = chronozon();
        if (!target) {
            // Dead, or wandered: give the drop a tick to land before re-walking.
            await Execution.delayTicks(2);
            if (GroundItems.query().name(FC_ITEM.CREST_PART).within(12).nearest()) {
                continue;
            }
            if (!(await walkToChronozon(log))) {
                return false;
            }
            continue;
        }
        if (!target.targetsMe() && !Game.inCombat()) {
            await target.interact('Attack');
        }
        await Execution.delayTicks(3);
    }
    return heldId(FC_ID.CREST_FROM_CHRONOZON) > 0;
}

/** Combine the three fragments. Any pairing runs the same `combine_crest_parts`. */
export async function combineCrest(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(FC_ID.FAMILY_CREST) > 0) {
        return true;
    }
    const first = Inventory.items().find(i => i.id === FC_ID.CREST_FROM_CALEB);
    const second = Inventory.items().find(i => i.id === FC_ID.CREST_FROM_AVAN);
    if (!first || !second) {
        log('need all three fragments in the pack before they combine');
        return false;
    }
    if (!(await first.useOn(second))) {
        return false;
    }
    const made = await Execution.delayUntil(() => Inventory.countById(FC_ID.FAMILY_CREST) > 0, 8000);
    if (made) {
        log('restored the Family Crest');
    }
    return made;
}
