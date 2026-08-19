import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Prayer } from '../../../../prayer/Prayer.js';
import { Skills } from '../../../../skills/Skills.js';
import { Reach } from '../../../../walking/Reach.js';
import { hasFlag, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { settleScene } from '../../exec/prompts.js';
import { attackable } from '../trollstronghold/combat.js';
import { FT_LOC, FT_TILE, PEER, THORVALD, inBattleground } from './areas.js';
import { PEER_BANK } from './seer.js';
import { walkTo } from './supplies.js';

const KOSCHEI = 'Koschei the deathless';

// Why: Thorvald's test is bravery, not victory — `viking_honour_death` passes the trial on the blow that would have killed you.
// Why: Koschei's fourth form has 255 hitpoints and 255 defence against a strength of 5, so dying to him is the only outcome the fight has.

/** Thorvald's trial: fight Koschei bare-handed until he wins. */
export function warriorStep(snap: QuestSnapshot): QuestStep | null {
    if (hasFlag(snap.progress, 'warrior-done')) {
        return null;
    }
    if (!hasFlag(snap.progress, 'warrior-started')) {
        return { kind: 'talk', stop: THORVALD(['Yes']) };
    }
    if (inBattleground(snap.tile)) {
        return { kind: 'custom', name: 'fight Koschei to the death', run: fightKoschei };
    }
    // Why: the ladder refuses anyone carrying armour, a weapon, runes, logs, arrows or a clue, and Peer's spell is the nearest bank.
    if (snap.inv.size > 0 || snap.worn.size > 0) {
        return { kind: 'talk', stop: PEER(PEER_BANK) };
    }
    return { kind: 'custom', name: "climb down to Thorvald's battleground", run: enterBattleground };
}

// Why: the honourable death drops the character on Thorvald's loft, which the walker has no baked edge off — every route out reads unreachable until this ladder is climbed.

/** Where `viking_honour_death` teleports the character, and the only exit that means the trial passed. */
function onLoft(here: { x: number; z: number; level: number } | null | undefined): boolean {
    return !!here && here.level === 1 && FT_TILE.WARRIOR_LOFT.distanceTo(here) <= 6;
}

/** The climb down from the loft, whatever the quest is doing next. */
export function leaveLoftStep(snap: QuestSnapshot): QuestStep | null {
    if (!onLoft(snap.tile)) {
        return null;
    }
    return { kind: 'custom', name: 'climb down from the loft', run: leaveLoft };
}

async function enterBattleground(log: (m: string) => void): Promise<boolean> {
    const status = await Reach.locOp({
        name: 'Ladder',
        op: 'Climb-down',
        near: FT_TILE.WARRIOR_LADDER,
        id: FT_LOC.WARRIOR_LADDER,
        expect: () => inBattleground(Game.tile()),
        expectMs: 15_000,
        log
    });
    return status === 'done';
}

/** Ticks of swinging before the fight is declared stuck; the four forms hold 30, 50, 70 and 255 hitpoints. */
const FIGHT_GUARD = 3000;
const PROTECT_MELEE = 'protect from melee';
export const PROTECT_MELEE_LEVEL = 43;

// Why: only the fourth form is wired to `viking_honour_death` — the first three kill an unarmed character outright, and at 70 stats they did.
// Why: Protect from Melee is what carries those three, and it does not cost the trial: `playerhit_n_melee_viking` zeroes the damage while it holds, so the exact-lethal blow lands once prayer has drained on the form that cannot kill you any other way.
// Why: the shared `fight` helper is the wrong loop for the second half — it spends every damaged tick calling `Sustain` for food this trial forbids carrying, and stops swinging while it does.

/** Beat Koschei's first three forms under prayer, then let the fourth win. */
async function fightKoschei(log: (m: string) => void): Promise<boolean> {
    log('unarmed against Koschei — three forms to beat, then the fourth passes the trial by killing you');
    const canPray = Skills.level('prayer') >= PROTECT_MELEE_LEVEL;
    if (!canPray) {
        log(`prayer below ${PROTECT_MELEE_LEVEL} — the first three forms will land every hit`);
    }
    Game.setAutoRetaliate(true);
    let attacking = -1;
    let reported = -1;
    for (let i = 0; i < FIGHT_GUARD; i++) {
        if (!inBattleground(Game.tile())) {
            if (onLoft(Game.tile())) {
                log('Koschei landed the last blow — the trial is passed');
                return true;
            }
            // Why: `combat_viking_damage_player` only calls `viking_honour_death` when the roll lands on the last remaining hitpoint, and an overkill is an ordinary death in Lumbridge.
            log('Koschei overshot the killing blow — that was a real death, walking back for another round');
            return false;
        }
        if (EventSignal.pending()) {
            log('yielding to a random event');
            return false;
        }
        if (canPray && Prayer.points() > 0 && !Prayer.active(PROTECT_MELEE)) {
            await Prayer.set(PROTECT_MELEE, true);
            continue;
        }
        const target = attackable(KOSCHEI, 14);
        if (!target) {
            await Execution.delayTicks(2);
            continue;
        }
        const now = Game.tick();
        if (now - reported >= 40) {
            reported = now;
            log(`${KOSCHEI}: hp=${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} prayer=${Prayer.points()}`);
        }
        if (target.index !== attacking || !Game.inCombat()) {
            if (await target.interact('Attack')) {
                attacking = target.index;
            }
        }
        await Execution.delayTicks(1);
    }
    log(`gave up on Koschei after ${FIGHT_GUARD} ticks`);
    return false;
}

async function leaveLoft(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(FT_TILE.WARRIOR_LOFT_LADDER, 1, log))) {
        return false;
    }
    await settleScene();
    const status = await Reach.locOp({
        name: 'Ladder',
        op: 'Climb-down',
        near: FT_TILE.WARRIOR_LOFT_LADDER,
        id: FT_LOC.WARRIOR_LADDER_DOWN,
        expect: () => Game.tile()?.level === 0,
        expectMs: 15_000,
        log
    });
    return status === 'done';
}
