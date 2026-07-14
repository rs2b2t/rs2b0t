import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Equipment } from '../../../api/hud/Equipment.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs, type Npc } from '../../../api/queries/Npcs.js';
import { reader } from '../../../adapter/ClientAdapter.js';
import type TutorialBot from '../../TutorialBot.js';
import { StageTask } from '../StageTask.js';
import { MINE_Z, walkToward } from './helpers.js';

/**
 * Combat section — server ladder 360 -> 500 (docs/tutorial-map.md), content
 * confirmed against `lostcity-dev/content/scripts/tutorial/`'s
 * `guides/combat_instructor.rs2` + `tutorial.rs2` + `tut_chatbox_steps.rs2`
 * + `tut_doors_and_gates.rs2` + `npcs/tut_giant_rat.rs2` +
 * `player/scripts/equip.rs2`, geometry pinned from the packed map
 * (`tools/nav/probe-locs.ts` + `content/maps/m48_148.jm2`'s NPC table — not
 * guessed from the task brief's sketch, which had three real bugs, notes
 * 1/3/5): talk to Vannaka (360 -> 370) -> click the flashing worn-equipment
 * tab (370 -> 380) -> wield the bronze dagger (380 -> 390) -> talk again for
 * sword + shield (390 -> 400) -> equip both, sword first (400 -> 410, note
 * 4) -> click the flashing combat-options tab (410 -> 420) -> open the
 * rat-pen gate (420 -> 430) -> attack (430 -> 440) + kill a giant rat
 * (440 -> 450, on the rat's death queue) -> exit the pen + talk for bow +
 * arrows (450 -> 460) -> ranged-kill a rat from OUTSIDE the pen (460 ->
 * 470) -> climb the ladder out (470 -> 500, skipping the unused 480/490
 * slots).
 *
 * `Equipment.equip`'s first real workout (Task 3 proved it in isolation):
 * four chained equips including the codebase's first STACKABLE equip
 * (Bronze arrow x50 — `iop2=Wield` in skill_combat/configs/ranged/
 * arrows.obj, so the normal held-op path applies unchanged; note 7).
 *
 * Follows the Mining.ts/QuestGuide.ts shape: observable `validate()` -> one
 * idempotent `execute()`; one-shots latch only on VERIFIED outcomes; the
 * two kill confirmations ride a per-run `CombatProgress` (never
 * module-level — the `QuestGuideProgress`/`MiningProgress` precedent).
 *
 * 1. THE BOT ARRIVES ALREADY CARRYING A BRONZE DAGGER — it smithed one to
 *    finish the mining section. The brief's sketch gated the first talk on
 *    NOT having a dagger, which can therefore never fire (live-confirmed:
 *    run 1 sat at 360 for 9+ minutes). The correct "talked at 360"
 *    observable is the WORN TAB ATTACHING: `tutorial_step_wielding_weapons`
 *    (tut_chatbox_steps.rs2), fired by `~set_tutorial_progress` the moment
 *    the first talk writes 370, does `if_settab(wornitems, ^tab_wornitems)`
 *    + `tut_flash` — and the login script only re-attaches it while
 *    `%tutorial > 370`, so `reader.sideTabInterface(WORN_TAB) === -1` is a
 *    faithful haven't-talked-yet gate on both real and stage-jumped runs
 *    (same idiom as QuestGuide.ts's note 3). Vannaka's 370/380 cases also
 *    re-grant the dagger via `~newbie_combat_instructor_replace_items` if
 *    it were somehow lost — self-healing content, no bot handling needed.
 * 2. WIELDING BEFORE 380 IS A NO-OP: `[opheld2,bronze_dagger]`
 *    (levelrequire/tier1.rs2) routes `tutorial_island_equip` (tutorial.rs2)
 *    which mesboxes "You'll be told how to equip items later." and returns
 *    without equipping while `%tutorial < 380`. `WieldDagger` gates on the
 *    worn tab being ACTIVE (the click that just advanced 370 -> 380 via
 *    TUT_CLICKSIDE) and carries no one-shot: a too-early wield mesboxes,
 *    `AdvanceDialog` clears it, and the stage self-heals next loop.
 * 3. PEN GEOMETRY (packed map, probe-locs.ts + m48_148.jm2's NPC rows;
 *    mapsquare base (3072,9472)): Vannaka spawns at (3106,9509); the
 *    thirteen giant-rat spawns fill x 3098-3109, z 9512-9521 inside a
 *    railing fence whose east opening is the pen gate `newbiedoor5_l/r`
 *    (display "Gate", tiles (3111,9518)/(3111,9519), WALL shape on the
 *    west edge of x=3111); the exit ladder `newbieladder2` ("Ladder",
 *    `op1=Climb-up`) is at (3111,9526). Two consequences the brief's
 *    sketch missed:
 *    (a) rats are within ~5 tiles of Vannaka THROUGH THE FENCE, so any
 *        "rats nearby" query is true for the whole section and cannot
 *        distinguish inside from outside — `inPen()` is a position box
 *        (x <= PEN_EAST_X && z >= PEN_SOUTH_Z) instead;
 *    (b) TWO other locs collide with naive queries: the mining exit gate
 *        (also display "Gate", (3094,9502-3)) is within 15 of Vannaka, and
 *        the mine's return ladder (`newbieladder1`, also "Ladder"/
 *        "Climb-up", (3088,9519)) is within 20 of the pen — so the gate
 *        and ladder queries here are tile-boxed (helpers.ts's `doorAt`
 *        rationale).
 *    The pen gate teleports ±1 in x on every open, direction picked by
 *    which side you stand on (`[oploc1,_rat_pit_cage]`) — one bidirectional
 *    loc shared by `EnterRatPen` (in) and `TalkForBow` (out).
 * 4. SWORD-BEFORE-SHIELD IS LOAD-BEARING: `player/scripts/equip.rs2`'s
 *    tutorial hook advances 400 -> 410 only on an equip call where the
 *    rhand item BEFORE the call (`$previous`) is the bronze sword and the
 *    lhand AFTER is the wooden shield — i.e. only when the SHIELD is
 *    equipped while the sword is already worn. `EquipSwordShield` equips
 *    sword then shield in that fixed order (each leg no-ops when already
 *    worn). Equipping the sword auto-swaps the worn dagger back to the
 *    backpack; `WieldDagger`'s `!hasSwordOrShield()` guard keeps that
 *    returned dagger from being re-wielded. THE SAME SWAP BITES AGAIN AT
 *    460: the shortbow is TWO-HANDED, so equipping it bounces sword AND
 *    shield back to the pack — `EquipSwordShield` therefore one-shots on
 *    the verified both-worn outcome and guards on `!hasBow()` (its doc
 *    comment has the live stall this fixed).
 * 5. KILL CONFIRMATION MUST BE TARGET DEATH, NOT XP: melee/ranged xp lands
 *    PER HIT, so `xp > 0` flips true seconds into the fight, long before
 *    the rat dies — and the 440 -> 450 / 460 -> 470 writes happen in the
 *    rat's DEATH queue (`set_rat_kill`, tut_giant_rat.rs2). Walking off
 *    mid-fight to the next stage abandons the kill ("you will continue to
 *    attack the rat until it's dead OR YOU DO SOMETHING ELSE") and, worse,
 *    the exit ladder's not-ready guard is skippable (`newbieladder2`'s
 *    handler only blocks when `npc_find` sees Vannaka that tick — the
 *    same UNCONDITIONAL-climb quirk as the mine ladder, QuestGuide.ts note
 *    6), which would strand the account below 500 on the surface. Both
 *    kill stages therefore track their target rat's scene INDEX and latch
 *    `CombatProgress` only when that entity DESPAWNS (died); the follow-on
 *    stages gate on the progress flag, never raw xp.
 * 6. RANGED FIRES FROM OUTSIDE THE PEN: `[apnpc2,newbiegiantrat]` only
 *    hard-requires bow + arrows WORN (mesbox otherwise); the "don't enter
 *    the pit" line is the pen gate's flavour refusal at 460, not a combat
 *    block. The shortbow's ap-range attack paths the shot over the fence,
 *    and the pen gate itself REFUSES to open at 460 while Vannaka is
 *    findable (tut_doors_and_gates.rs2), so `RangedKillRat` simply gates
 *    on `!inPen()` and attacks the nearest rat — the server's ap-walk
 *    handles range, and a rat that wanders out of reach is re-acquired
 *    next loop.
 * 7. STACKABLE-EQUIP FINDING: `Equipment.equip('Bronze arrow')` needed no
 *    changes — `Inventory.first()` matches the stack, its `Wield` op
 *    dispatches OPHELD like any other item, and the whole stack moves to
 *    the ammo slot (the worn-tab verification sees it). Recorded here as
 *    the codebase's first stackable-equip consumer.
 *
 * Quiet in both directions: every stage but `ClimbOutLadder` gates on
 * `inCombatArea()` — underground (`z >= MINE_Z`) AND east of the mining
 * exit gate's wall line (`x > MINE_GATE_X`, Mining.ts's live-probed
 * `EXIT_GATE_X`) — so nothing here fires on the mine side (mining's own
 * stages run there) or above ground. `ClimbOutLadder` is the underground ->
 * surface transition itself, so its gate is the `rangedKillDone` progress
 * flag + its own surfacing-verified one-shot; it surfaces at (3111,3125)
 * (live-confirmed), east of every earlier surface stage's geometry:
 * QuestGuide.ts's boxes top out at x 3094 and its talk stages need the
 * guide within 10 (he wanders ~(3084,3123), 26+ away), and Chef.ts's
 * `OpenQuestGuideDoor` — whose `z < 3126` gate IS true at the landing —
 * stays quiet through its one-shot (latched by the real 200 -> 220
 * crossing in any run that walked the surface) plus its `runEnabled()`
 * gate on jump-started runs that never toggled run.
 */

const VANNAKA = 'Combat Instructor';
const RAT = 'Giant rat';

/** general/configs/tabs.constant: ^tab_wornitems = 4, ^tab_combat_options = 0. */
const WORN_TAB = 4;
const COMBAT_TAB = 0;

/** Mining.ts's live-probed `EXIT_GATE_X` — the combat area is east of it (file-header quiet note). */
const MINE_GATE_X = 3094;

/** Pen geometry (file-header note 3). The gate sits on the west edge of x=3111; inside is x <= 3110. */
const PEN_EAST_X = 3110;
const PEN_SOUTH_Z = 9512;
/** Tile box pinning the rat-pen gate (3111,9518)/(3111,9519) — NOT the mining exit gate 17 tiles west. */
const PEN_GATE_BOX = { minX: 3109, maxX: 3113, minZ: 9516, maxZ: 9521 };
/** Tile box pinning the exit ladder `newbieladder2` (3111,9526) — NOT the mine's return ladder (3088,9519). */
const EXIT_LADDER_BOX = { minX: 3106, maxX: 3116, minZ: 9522, maxZ: 9530 };

const noDialog = () => !ChatDialog.isOpen();

const inCombatArea = (): boolean => {
    const t = Game.tile();
    return t !== null && t.z >= MINE_Z && t.x > MINE_GATE_X;
};

/** Inside the rat pen (file-header note 3a) — a position box, never an npc-proximity check. */
const inPen = (): boolean => {
    const t = Game.tile();
    return t !== null && t.z >= MINE_Z && t.x <= PEN_EAST_X && t.z >= PEN_SOUTH_Z;
};

const hasSwordOrShield = () =>
    Inventory.contains('Bronze sword') || Inventory.contains('Wooden shield') || Equipment.contains('Bronze sword') || Equipment.contains('Wooden shield');

const hasBow = () => Inventory.contains('Shortbow') || Equipment.contains('Shortbow');

const penGate = () => Locs.query().name('Gate').action('Open').inside(PEN_GATE_BOX).nearest();

/**
 * Kill confirmations, shared into the stages that must not run until a rat
 * is verifiably DEAD (file-header note 5) — built fresh per
 * `combatStages()` call, never module-level.
 */
interface CombatProgress {
    meleeKillDone: boolean;
    rangedKillDone: boolean;
}

/**
 * Shared fight driver for both kill stages (file-header note 5): attack
 * the nearest attackable rat, remember its scene index, then each call
 * either wait out the ongoing fight or re-engage; returns true only once
 * the tracked target has DESPAWNED (died — the engine removes the npc
 * after its death animation; slot reuse by the respawn happens far outside
 * the 600ms poll cadence).
 */
class RatFight {
    private targetIndex = -1;

    async advance(range: number): Promise<boolean> {
        if (this.targetIndex !== -1) {
            const target = Npcs.query()
                .name(RAT)
                .where((n: Npc) => n.index === this.targetIndex)
                .first();
            if (!target) {
                this.targetIndex = -1;
                return true;
            }

            if (Game.inCombat() || target.inCombat) {
                await Execution.delayTicks(5);
                return false;
            }

            // Fight never started (or broke) — re-acquire rather than assume.
            this.targetIndex = -1;
        }

        const rat = Npcs.query().name(RAT).action('Attack').within(range).nearest();
        if (!rat) {
            return false;
        }

        await rat.interact('Attack');
        // Entity snapshots are frozen at query time — re-query for the live
        // combat flag rather than reading the stale `rat.inCombat`.
        const index = rat.index;
        const engaged = await Execution.delayUntil(
            () =>
                Game.inCombat() ||
                Npcs.query()
                    .name(RAT)
                    .where((n: Npc) => n.index === index)
                    .results()
                    .some(n => n.inCombat),
            8000
        );
        if (engaged) {
            this.targetIndex = index;
        }

        return false;
    }
}

/**
 * Stage 360 -> 370: talk to Vannaka. Completion observable = the worn tab
 * attaching (file-header note 1) — NOT dagger possession (the bot arrives
 * carrying its smithed dagger) and not a private flag (the attach is the
 * verified outcome itself, and it's permanent for the run).
 */
class TalkVannaka extends StageTask {
    validate(): boolean {
        return noDialog() && inCombatArea() && reader.sideTabInterface(WORN_TAB) === -1;
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(VANNAKA).within(40).nearest();
        if (!npc) {
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => reader.sideTabInterface(WORN_TAB) !== -1, 8000);
    }
}

/**
 * Stage 370 -> 380: click the flashing Worn Equipment tab (the
 * TUT_CLICKSIDE handler advances the varp on the click itself). One-shot —
 * same idiom as Chef's `OpenMusicTab` / QuestGuide's `OpenQuestTab`.
 */
class OpenWornTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && inCombatArea() && reader.sideTabInterface(WORN_TAB) !== -1 && reader.activeSideTab() !== WORN_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(WORN_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

/**
 * Stage 380 -> 390: wield the dagger (file-header note 2). No one-shot:
 * the worn-dagger outcome is the gate, and the `!hasSwordOrShield()` guard
 * (note 4) keeps the dagger — auto-returned to the backpack when the sword
 * takes its slot — from being re-wielded later in the run.
 */
class WieldDagger extends StageTask {
    validate(): boolean {
        return (
            noDialog() &&
            inCombatArea() &&
            reader.activeSideTab() === WORN_TAB &&
            Inventory.contains('Bronze dagger') &&
            !Equipment.contains('Bronze dagger') &&
            !hasSwordOrShield()
        );
    }

    async execute(): Promise<void> {
        await Equipment.equip('Bronze dagger');
    }
}

/**
 * Stage 390 -> 400: talk to Vannaka for the sword + shield (granted
 * together via `~doubleobjbox` in `~newbie_combat_instructor_replace_items`
 * — the talk latches on the ITEMS appearing, house rule for item-granting
 * talks). Gated on the dagger being WORN — the content case that advances
 * (`^..._dagger_equipped`) only exists once the wield wrote 390.
 */
class TalkForSword extends StageTask {
    validate(): boolean {
        return noDialog() && inCombatArea() && Equipment.contains('Bronze dagger') && !hasSwordOrShield();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(VANNAKA).within(40).nearest();
        if (!npc) {
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => Inventory.contains('Bronze sword') || Inventory.contains('Wooden shield'), 8000);
    }
}

/**
 * Stage 400 -> 410: equip sword then shield, fixed order (file-header note
 * 4 — the varp hook fires on the SHIELD equip with the sword already in
 * rhand). ONE-SHOT latched on the verified both-worn outcome, and ALSO
 * guarded on `!hasBow()`: the shortbow is TWO-HANDED, so `RangedKillRat`'s
 * equip at 460 bounces the sword AND shield back to the backpack — without
 * the latch this stage re-armed there and the two stages ping-ponged
 * bow/sword forever (live: run 2 stalled at exactly 460 for 13 minutes).
 * The bow guard also covers a fresh script instance started at >= 460
 * (section-test jumps), where the one-shot starts false but the bow's
 * presence proves the section is past 410.
 */
class EquipSwordShield extends StageTask {
    private done = false;

    validate(): boolean {
        return (
            !this.done &&
            noDialog() &&
            inCombatArea() &&
            !hasBow() &&
            (Inventory.contains('Bronze sword') || Inventory.contains('Wooden shield')) &&
            !(Equipment.contains('Bronze sword') && Equipment.contains('Wooden shield'))
        );
    }

    async execute(): Promise<void> {
        if (Inventory.contains('Bronze sword')) {
            await Equipment.equip('Bronze sword');
        }
        if (Inventory.contains('Wooden shield')) {
            await Equipment.equip('Wooden shield');
        }
        if (Equipment.contains('Bronze sword') && Equipment.contains('Wooden shield')) {
            this.done = true;
        }
    }
}

/**
 * Stage 410 -> 420: click the flashing Combat Options tab (attached by the
 * 410 step proc's `~update_weapon_category`; the TUT_CLICKSIDE handler
 * advances the varp on the click). One-shot, same idiom as `OpenWornTab`.
 */
class OpenCombatTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return (
            !this.opened &&
            noDialog() &&
            inCombatArea() &&
            Equipment.contains('Bronze sword') &&
            Equipment.contains('Wooden shield') &&
            reader.sideTabInterface(COMBAT_TAB) !== -1 &&
            reader.activeSideTab() !== COMBAT_TAB
        );
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(COMBAT_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

/**
 * Stage 420 -> 430: open the pen gate from outside (file-header note 3 —
 * tile-boxed query, position latch). Entry-gated on the combat tab being
 * active (before 420 the gate just chats "get away from there") and on the
 * melee kill not being done (never re-enter once past); the one-shot
 * latches only on the OBSERVED arrival inside the pen. A premature open
 * self-heals: the refusal dialogue is cleared by `AdvanceDialog` and the
 * unlatched stage retries.
 */
class EnterRatPen extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: CombatProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && noDialog() && inCombatArea() && !inPen() && !this.progress.meleeKillDone && reader.activeSideTab() === COMBAT_TAB && !Game.inCombat();
    }

    async execute(): Promise<void> {
        const gate = penGate();
        if (!gate) {
            return;
        }

        if (gate.distance() > 5) {
            await walkToward(gate.tile());
            return;
        }

        await gate.interact('Open');
        const entered = await Execution.delayUntil(() => inPen(), 8000);
        if (entered) {
            this.done = true;
        }
    }
}

/**
 * Stages 430 -> 440 (the attack click) and 440 -> 450 (the rat's death
 * queue): melee-kill a giant rat. Gated on being INSIDE the pen; latches
 * `progress.meleeKillDone` only when the tracked rat despawns (file-header
 * note 5) — raw xp flips true on the first hit and is NOT the kill.
 */
class MeleeKillRat extends StageTask {
    private readonly fight = new RatFight();

    constructor(
        bot: TutorialBot,
        private readonly progress: CombatProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.progress.meleeKillDone && noDialog() && inPen() && Equipment.contains('Bronze sword');
    }

    async execute(): Promise<void> {
        if (await this.fight.advance(12)) {
            this.progress.meleeKillDone = true;
        }
    }
}

/**
 * Stage 450 -> 460: exit the pen (the same bidirectional gate, outbound —
 * file-header note 3) and talk to Vannaka for the bow + arrows. Latches on
 * the ITEMS appearing (house rule); gated on the CONFIRMED melee kill,
 * never raw xp (note 5).
 */
class TalkForBow extends StageTask {
    constructor(
        bot: TutorialBot,
        private readonly progress: CombatProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return this.progress.meleeKillDone && noDialog() && inCombatArea() && !hasBow() && !Game.inCombat();
    }

    async execute(): Promise<void> {
        if (inPen()) {
            const gate = penGate();
            if (!gate) {
                return;
            }

            if (gate.distance() > 5) {
                await walkToward(gate.tile());
                return;
            }

            await gate.interact('Open');
            await Execution.delayUntil(() => !inPen(), 8000);
            return;
        }

        const npc = Npcs.query().name(VANNAKA).within(40).nearest();
        if (!npc) {
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => Inventory.contains('Shortbow'), 8000);
    }
}

/**
 * Stage 460 -> 470: equip shortbow + bronze arrows (file-header note 7 —
 * the stackable equip), then ranged-kill a rat from OUTSIDE the pen (note
 * 6). Same death-latched fight driver as the melee kill; the pen gate's
 * own 460 refusal plus the `!inPen()` gate keep the shot outside.
 */
class RangedKillRat extends StageTask {
    private readonly fight = new RatFight();

    constructor(
        bot: TutorialBot,
        private readonly progress: CombatProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.progress.rangedKillDone && this.progress.meleeKillDone && noDialog() && inCombatArea() && !inPen() && hasBow();
    }

    async execute(): Promise<void> {
        if (!Equipment.contains('Shortbow')) {
            await Equipment.equip('Shortbow');
            return;
        }
        if (!Equipment.contains('Bronze arrow')) {
            await Equipment.equip('Bronze arrow');
            return;
        }

        if (await this.fight.advance(15)) {
            this.progress.rangedKillDone = true;
        }
    }
}

/**
 * Stage 470 -> 500: climb the exit ladder (`newbieladder2`, (3111,9526) —
 * tile-boxed, file-header note 3b). Gated on the CONFIRMED ranged kill —
 * never raw xp or ladder proximity, because the ladder's not-ready guard
 * is skippable when `npc_find` misses Vannaka that tick (note 5) and an
 * early climb would strand the account below 500. One-shot latches on the
 * VERIFIED surfacing (z < MINE_Z) — the section's terminal outcome; per
 * the task brief this is the one stage without an `inCombatArea()` gate
 * (it IS the transition), and the progress flag + latch keep it quiet on
 * both sides.
 */
class ClimbOutLadder extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: CombatProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && this.progress.rangedKillDone && noDialog() && Locs.query().name('Ladder').action('Climb-up').inside(EXIT_LADDER_BOX).exists();
    }

    async execute(): Promise<void> {
        const ladder = Locs.query().name('Ladder').action('Climb-up').inside(EXIT_LADDER_BOX).nearest();
        if (!ladder) {
            return;
        }

        if (ladder.distance() > 5) {
            await walkToward(ladder.tile());
            return;
        }

        await ladder.interact('Climb-up');
        const surfaced = await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && t.z < MINE_Z;
        }, 8000);
        if (surfaced) {
            this.done = true;
        }
    }
}

/**
 * In ladder order — `TutorialBot` runs the first whose `validate()` matches
 * each loop. `progress` is fresh per call (once per script start, never
 * module-level — file-header note 5).
 */
export function combatStages(bot: TutorialBot): Task[] {
    const progress: CombatProgress = { meleeKillDone: false, rangedKillDone: false };
    return [
        new TalkVannaka(bot),
        new OpenWornTab(bot),
        new WieldDagger(bot),
        new TalkForSword(bot),
        new EquipSwordShield(bot),
        new OpenCombatTab(bot),
        new EnterRatPen(bot, progress),
        new MeleeKillRat(bot, progress),
        new TalkForBow(bot, progress),
        new RangedKillRat(bot, progress),
        new ClimbOutLadder(bot, progress)
    ];
}
