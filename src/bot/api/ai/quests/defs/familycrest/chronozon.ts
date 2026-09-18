import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import Tile from '../../../../../geometry/Tile.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import type { Npc } from '../../../../model/Npc.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { heldId, settleScene } from '../../exec/prompts.js';
import { ANTIPOISON_IDS, FC_ID, FC_ITEM, FC_NPC, inChronozonLair } from './areas.js';

const WEAKENS = /chronozon weakens/i;
const POISONED = /you have been poisoned/i;

// Why: the south end of the chamber, 2 tiles clear of the demon's furthest-south 3x3 placement, on an open x=3089 column with line of sight north.
// Why: the east alcove at (3092,9940) is inside the poison spiders' roam (spawn z 9943-9945, `wanderrange=10`, `maxrange=12`); here the nearest spawn is 11 to 13 away.
// Why: derived by `tools/nav/chronozon-safespot.ts`; the west passage is a sealed island and the corridor north of the gates is behind a gate that blocks the cast (3 live casts never landed).
export const SAFESPOT = new Tile(3089, 9932, 0);

/** How many casts to spend proving the safespot before giving up on it. */
const SAFESPOT_PROBE_CASTS = 3;

// Why: `~chronozon_spell` runs inside `pvm_spell_success`, so a splash sets nothing; "Chronozon weakens..." is emitted when the bit is set, so each spell is retried until that line appears.

// The 4 spells that unlock the kill, in casting order.
export const BLASTS = ['Wind blast', 'Water blast', 'Earth blast', 'Fire blast'] as const;

// Why: a dose sets `%poison = min(%poison, -5)`, a cure plus a short immunity, so it's drunk on the way out; the poison comes from the gate tiles and threatens the walk home, and the safespot is 11 tiles clear of the spiders.
// Why: `%poison` is `scope=perm` with no transmit, so the tell is the server's "You have been poisoned!" line; the drink is rate-limited so a retried step doesn't drink the potion dry.
const IMMUNITY_MS = 80_000;
let lastDrink = 0;

async function drinkAntipoison(log: (m: string) => void): Promise<boolean> {
    if (performance.now() - lastDrink < IMMUNITY_MS) {
        return true;
    }
    const dose = Inventory.items().find(i => (ANTIPOISON_IDS as readonly number[]).includes(i.id));
    if (!dose) {
        return false;
    }
    if (!(await dose.interact('Drink'))) {
        return false;
    }
    lastDrink = performance.now();
    await Execution.delayTicks(2);
    log('drank antipoison — the spiders on the gate tiles poison on contact');
    return true;
}

// Why: hp loss can't tell the demon from poison or the size-1 spiders that follow into the alcove; the reported tile is the middle of a 3x3, so within 2 is melee reach.

/** Whether the demon's body is touching us. */
function demonInReach(): boolean {
    const target = chronozon();
    const me = Game.tile();
    if (!target || !me) {
        return false;
    }
    const t = target.tile();
    return t.level === me.level && Math.max(Math.abs(t.x - me.x), Math.abs(t.z - me.z)) <= 2;
}

function onSafespot(): boolean {
    const here = Game.tile();
    return here !== null && here.level === 0 && here.x === SAFESPOT.x && here.z === SAFESPOT.z;
}

// Why: a false here means the fight happens in the open, which is the proven path.

/** Try to stand on the safespot; returns whether we are on it. */
async function takeSafespot(log: (m: string) => void): Promise<boolean> {
    if (onSafespot()) {
        return true;
    }
    const ok = await Traversal.walkResilient(SAFESPOT, { radius: 0, attempts: 3, timeoutMs: 90_000, log });
    if (ok && onSafespot()) {
        log(`on the safespot at (${SAFESPOT.x},${SAFESPOT.z}) — no 3x3 placement reaches here, and the spiders do not roam this far south`);
        return true;
    }
    log('could not take the safespot — fighting in the open');
    return false;
}

function chronozon(): Npc | null {
    return Npcs.query().where(n => n.id === FC_NPC.CHRONOZON_NPC_ID).within(16).nearest();
}

// Why: Chronozon respawns 60 ticks after a kill and this fight kills it repeatedly while arming the 4 bits, so "not in the scene" usually means "not back yet".

/** Walk to Chronozon's chamber, waiting out a respawn. */
async function walkToChronozon(log: (m: string) => void): Promise<boolean> {
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

// Why: killing it before all 4 blasts land is harmless, `ai_queue3` heals it to full and sets it back on you, so the loop never guards its damage output.

/** Land one of each elemental blast, then finish the demon. */
export async function fightChronozon(log: (m: string) => void): Promise<boolean> {
    try {
        return await runFight(log);
    } finally {
        Game.setAutoRetaliate(true);
    }
}

async function runFight(log: (m: string) => void): Promise<boolean> {
    // Why: auto-retaliate breaks the safespot, swinging back at a gate spider walks the bot into the demon's reach.
    Game.setAutoRetaliate(false);

    // Why: `walkToChronozon` closes to within 4 tiles, inside its reach, so the walk targets the safespot; the walker handles the trapdoor and gates.
    let safespot = await takeSafespot(log);
    if (!safespot && !(await walkToChronozon(log))) {
        log('could not reach Chronozon');
        return false;
    }
    const poisonMark = GameMessages.mark();

    /** One cast, with the upkeep every long custom step owes. */
    const cast = async (spell: string): Promise<'landed' | 'missed' | 'gone' | 'nospell'> => {
        await Sustain.run();
        if (safespot && !onSafespot()) {
            safespot = await takeSafespot(log);
        }
        const target = chronozon();
        if (!target) {
            return 'gone';
        }
        const mark = GameMessages.mark();
        if (!(await Game.castOnNpc(spell, target))) {
            return 'nospell';
        }
        return (await Execution.delayUntil(() => GameMessages.sawSince(mark, WEAKENS), 8000)) ? 'landed' : 'missed';
    };

    for (const spell of BLASTS) {
        let landed = false;
        for (let attempt = 0; attempt < 12 && !landed; attempt++) {
            const result = await cast(spell);
            if (result === 'nospell') {
                log(`could not select ${spell} — magic level or runes short`);
                return false;
            }
            if (result === 'gone') {
                if (!(await walkToChronozon(log))) {
                    return false;
                }
                continue;
            }
            landed = result === 'landed';
            // Why: casts not landing, or the demon in reach on the safespot, means the gate is in the way or the spot is wrong; the open fight is the proven fallback.
            if (safespot && attempt + 1 >= SAFESPOT_PROBE_CASTS && !landed) {
                log('safespot casts are not landing — fighting in the open instead');
                safespot = false;
            } else if (safespot && onSafespot() && demonInReach()) {
                log('the demon reaches the safespot after all — fighting in the open instead');
                safespot = false;
            }
            if (!safespot && !onSafespot() && !landed) {
                // Why: abandoning the spot has to move, since whatever blocked the casts still blocks them from here.
                await walkToChronozon(log);
            }
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
            // Cure on the way out: the walk home is the part poison decides.
            if (GameMessages.sawSince(poisonMark, POISONED)) {
                await drinkAntipoison(log);
            }
            return true;
        }
        const drop = GroundItems.query().name(FC_ITEM.CREST_PART).within(16).nearest();
        if (drop) {
            // Taking it means leaving the safespot; the demon is dead by now.
            safespot = false;
            const before = heldId(FC_ID.CREST_FROM_CHRONOZON);
            if (await drop.interact('Take')) {
                if (await Execution.delayUntil(() => heldId(FC_ID.CREST_FROM_CHRONOZON) > before, 6000)) {
                    log("took Johnathon's crest part");
                    if (GameMessages.sawSince(poisonMark, POISONED)) {
                        await drinkAntipoison(log);
                    }
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
        // Why: a rune scimitar against defence 173 outlasts the loop, and from the safespot casting is the only option that keeps the distance.
        if (safespot && !onSafespot()) {
            safespot = await takeSafespot(log);
        }
        if (!(await Game.castOnNpc('Fire blast', target)) && !safespot) {
            if (!target.targetsMe() && !Game.inCombat()) {
                await target.interact('Attack');
            }
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
