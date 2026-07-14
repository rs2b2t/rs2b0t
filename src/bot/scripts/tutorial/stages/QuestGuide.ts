import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Skills } from '../../../api/hud/Skills.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { reader } from '../../../adapter/ClientAdapter.js';
import type TutorialBot from '../../TutorialBot.js';
import { StageTask } from '../StageTask.js';
import { doorAt, MINE_Z, QUEST_GUIDE_DOOR, walkToward } from './helpers.js';

/**
 * Quest Guide section — server ladder 220 -> 260,
 * content confirmed against `lostcity-dev/content/scripts/tutorial/` (274)'s
 * `guides/quest_guide.rs2` + `tutorial.rs2` + `tut_doors_and_gates.rs2`:
 * get inside the hall -> talk to the Quest Guide (230) -> open the Quest
 * Journal tab (240) -> talk again (250) -> climb the ladder down to the
 * mine (260).
 *
 * Follows the Chef.ts/Survival.ts shape: observable `validate()` -> one
 * idempotent action per `execute()`, one stage running per `TutorialBot`
 * loop tick (`TaskBot.loop()` runs the FIRST stage in array order whose
 * `validate()` is true — Bot.ts). Every one-shot here latches ONLY on a
 * verified outcome (position change / dialogue-open / tab-switch / z-jump
 * observed), never on dispatch — the house rule Chef.ts's file header
 * derived the hard way in Task 8.
 *
 * Content/geometry mechanics confirmed by reading the trigger scripts and
 * live probes (not guessed):
 *
 * 1. THE HALL IS SEALED FROM THE NORTH — the section needs an entry stage.
 *    Chef's `OpenQuestGuideDoor` ends the 200 -> 220 transition with the
 *    verified crossing to `z >= 3126`, i.e. NORTH of `newbie_door4`
 *    (3086,3126) — but the Quest Guide (wanders ~(3084-3085,3122-3124)) and
 *    the mine ladder (3088,3119) are both SOUTH of it, inside his hall, and
 *    a live probe proved a Talk-to op-click from (3086,3127) CANNOT path in:
 *    the approach-walk dead-ends on the wall line at (3084,3126) and the
 *    dialogue never opens (vs. opening in ~1.4s from the ladder tile).
 *    `EnterQuestHall` therefore re-opens the door — every open teleports the
 *    player through to the other side (`open_and_close_doors.rs2`, the same
 *    mechanic Task 7/8 mapped) — and latches on the observed arrival at
 *    `z < 3126`.
 * 2. `quest_guide.rs2`'s `[opnpc1,newbie_quest_instructor]` switches on the
 *    EXACT `%tutorial` value: 220 (`^newbie_quest_instructor_start`) ->
 *    chatnpc + writes 230; 230 (talked again before the tab click) -> a
 *    one-line "Have you not opened that menu yet?" reminder, no advance;
 *    240 (`^..._opened_menu`) -> chatnpc + writes 250; anything else -> a
 *    harmless recap prompt. The content tolerates mistimed re-talks, but
 *    each talk stage still carries its own one-shot (note 4).
 * 3. The Quest Journal tab's attach+flash is a STEP PROC exactly like the
 *    music/controls/inventory/stats tabs (Chef.ts file-header note 4):
 *    `tutorial_step_open_quest_journal` (tut_chatbox_steps.rs2), fired by
 *    `~set_tutorial_progress`'s switch the moment `%tutorial` becomes 230
 *    (a side effect of the FIRST talk, not a separate step), does
 *    `tut_flash(^tab_quest_journal)` + `if_settab(questlist,
 *    ^tab_quest_journal)`. So `reader.sideTabInterface(QUEST_TAB) !== -1`
 *    is the exact "230 reached" entry signal for `OpenQuestTab` — same
 *    idiom as `OpenMusicTab`/`OpenControlsTab`, and the `[tutorial,_]`
 *    TUT_CLICKSIDE handler advances 230 -> 240 on the click itself. (The
 *    login script does NOT attach this tab until `%tutorial > 230`, so the
 *    attach signal is trustworthy even on a stage-jumped account.)
 * 4. HOUSE-RULE GAP CLOSED vs the task brief's sketch: it gave
 *    `TalkQuestGuide`/`OpenQuestTab` no one-shots at all. Traced through
 *    `TaskBot.loop()` that's a real starvation bug, not a style nit: once
 *    the first dialogue closes, `TalkQuestGuide` would validate true again
 *    and — earlier in the stage array — win over `OpenQuestTab` forever.
 *    Every stage here has a private one-shot latched on its observed
 *    outcome (`TalkChef`/`OpenMusicTab` pattern).
 * 5. The 240 -> 250 transition (the second talk) has NO independent
 *    client-observable side effect (no item/xp/tab change, just chatnpc
 *    lines) — unlike every Chef/Survival talk, whose successors gate on an
 *    item/xp/tab the dialogue produced. `ClimbToMine` therefore needs to
 *    know the SECOND talk specifically succeeded. Sharing that via a
 *    module-level `let` (the brief's sketch) is a real bug: module state
 *    survives a script stop/restart in the same page (a normal operator
 *    action), so a stale `true` would skip the gate on a fresh run's first
 *    loop. Fixed with a `{ talkedAgain }` object built fresh inside
 *    `questGuideStages()` (called once per `TutorialBot.onStart()`) and
 *    threaded into the two stages that share it.
 * 6. That gate is not cosmetic: `newbieladdertop1`'s handler
 *    (tut_doors_and_gates.rs2) only shows its "not ready" dialogue when
 *    `npc_find` sees the Quest Guide within 10 at the exact tick of the
 *    climb — if he's transiently out of range, the check is skipped and
 *    `~climb_ladder` runs UNCONDITIONALLY, moving the player into the mine
 *    with the server-side ladder step desynced. `ClimbToMine` never fires
 *    off ladder proximity alone.
 * 7. The mine ladder is the only `Climb-down` "Ladder" anywhere near the
 *    hall (the (3082,3124) "Staircase" is `Climb-up`, and `newbieladdertop2`
 *    near the combat area is a different mapsquare), so no tile-pin is
 *    needed for it. Climbing shifts world z by a fixed +6400
 *    (`~climb_ladder` -> `movecoord(coord, 0, 0, 6400)`, confirmed against
 *    the engine's MOVECOORD handler; x/level unchanged) — live landing
 *    ~(3088,9519,0), so `z >= MINE_Z` is the section's terminal observable.
 * 8. SECTION-ERA GATE: every stage also requires
 *    `Skills.xp('mining') === 0` — zero throughout the section's real
 *    220 -> 260 window (the first mining xp lands at 294, in the mine) and
 *    permanently non-zero afterwards. Without it, a bank-section stage-jump
 *    (500) re-armed this whole chain on the surface: `EnterQuestHall` walked
 *    the bot back into the hall, the two talks re-ran as recaps, and
 *    `ClimbToMine` — gated only on the per-run `talkedAgain` flag those
 *    recaps set — dragged a >= 500 account back down the mine, where
 *    nothing could bring it back up (the combat chain can't re-run at 500:
 *    the rat-pen gate refuses outside exactly 420-460). Same law as the
 *    Addendum: a one-shot's entry gates must be false everywhere a
 *    LATER section's jump can strand the bot, and mining xp is the earliest
 *    permanent observable that separates this section's era from
 *    everything after the mine.
 */

const GUIDE = 'Quest Guide';
/** general/configs/tabs.constant — ^tab_quest_journal (index + live attach timing both confirmed live). */
const QUEST_TAB = 2;

const noDialog = () => !ChatDialog.isOpen();
const nearGuide = () => Npcs.query().name(GUIDE).within(10).exists();

/** Section-era gate (file-header note 8): mining xp is zero throughout the
 *  real 220 -> 260 window and permanently non-zero from 294 onward — false
 *  on any account a later section's stage-jump re-arms this chain on. */
const beforeMine = () => Skills.xp('mining') === 0;

/** South of the hall's north wall line (the door's z) = able to actually
 *  reach the Quest Guide; the hall is sealed from the north (note 1). The
 *  lower bound keeps this false everywhere else on the island (and the
 *  mine's z 9xxx is far outside it anyway). */
const insideHall = () => {
    const t = Game.tile();
    return t !== null && t.z < QUEST_GUIDE_DOOR.z && t.z >= 3110;
};

/** In the strip just NORTH of the door — where Chef's `OpenQuestGuideDoor`
 *  verifiably leaves the bot (its one-shot latches on `z >= 3126`). Includes
 *  the door's own host tile (z = 3126), where the entry race can strand the
 *  bot (`EnterQuestHall` doc). */
const northOfHall = () => {
    const t = Game.tile();
    return t !== null && t.z >= QUEST_GUIDE_DOOR.z && t.z <= QUEST_GUIDE_DOOR.z + 8 && t.x >= QUEST_GUIDE_DOOR.x - 8 && t.x <= QUEST_GUIDE_DOOR.x + 8;
};

/** Walk-through target while the door is OPEN: a hall tile past the wall
 *  line, never the doorway itself (the BankChapel.ts `EnterChapel` lesson). */
const HALL_INSIDE = { x: 3086, z: 3123 };

/**
 * Shared between `TalkQuestGuideAgain` and `ClimbToMine` (file-header note
 * 5) — built fresh per `questGuideStages()` call so a stop/restart within
 * the same page session can't carry a stale `talkedAgain` into a new run.
 */
interface QuestGuideProgress {
    talkedAgain: boolean;
}

/**
 * Section entry: get from the north side of `newbie_door4` (where the chef
 * section verifiably ends) INSIDE the hall (file-header note 1). Gated on
 * the Quest Guide being in scene + the tight north strip, so it can never
 * fire during 0 -> 220 (Chef's `OpenQuestGuideDoor`, earlier in the array
 * and not yet latched, owns the door until the bot has crossed north) nor
 * from anywhere else on the island.
 *
 * NO one-shot latch (a full-run stall fix): the door's
 * teleport is a multi-hop sequence with a 1-tick pause, so a
 * `delayUntil(insideHall())` can read true MID-TRANSIT while the bot
 * settles back on the door's host tile (3086,3126 — z = 3126, OUTSIDE the
 * hall). A latch armed on that flicker sealed the section shut with the
 * bot parked on the doorway: 3/3 organic full runs stalled at exactly 220
 * (jump-started runs approach the door cold and never hit the race — the
 * full run re-opens it 600ms after the chef section's crossing, INSIDE the
 * door's ~1.8s open window, where the `.action('Open')` query is also
 * empty). Position gates own quieting instead: `insideHall()` makes
 * `northOfHall()` false once genuinely in, and `beforeMine()` (note 8)
 * kills every later-era re-arm. While the door is OPEN (query empty), walk
 * THROUGH the doorway to a tile past the wall line — never AT the host
 * tile (the BankChapel.ts `EnterChapel` lesson); a mid-walk re-close
 * self-heals via the interact branch next loop. The trailing settle ticks
 * let the multi-hop teleport finish before the next validate reads the
 * resting tile.
 */
class EnterQuestHall extends StageTask {
    validate(): boolean {
        return noDialog() && beforeMine() && northOfHall() && Npcs.query().name(GUIDE).within(12).exists();
    }

    async execute(): Promise<void> {
        const door = doorAt(QUEST_GUIDE_DOOR).nearest();
        if (!door) {
            await walkToward(HALL_INSIDE);
            return;
        }

        if (door.distance() > 5) {
            await walkToward(QUEST_GUIDE_DOOR);
            return;
        }

        await door.interact('Open');
        await Execution.delayUntil(() => insideHall(), 8000);
        await Execution.delayTicks(2);
    }
}

/**
 * Stage 220 -> 230: talk to the Quest Guide (file-header note 2). One-shot
 * on dialogue-open, same shape as Chef's `TalkChef` / Survival's
 * `TalkToGuide`: latch only once the dialogue is CONFIRMED open, letting the
 * higher-priority `AdvanceDialog` click through it. `insideHall()` keeps the
 * unreachable through-the-wall talk from outside (note 1) from ever
 * dispatching — `nearGuide()` alone can be true across the wall (Npc
 * queries are scene-wide, walls don't matter to them).
 */
class TalkQuestGuide extends StageTask {
    private talked = false;

    validate(): boolean {
        return !this.talked && noDialog() && beforeMine() && insideHall() && nearGuide();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(GUIDE).nearest();
        if (!npc) {
            return;
        }

        await npc.interact('Talk-to');
        if (await Execution.delayUntil(() => ChatDialog.isOpen(), 8000)) {
            this.talked = true;
        }
    }
}

/**
 * Stage 230 -> 240: click the flashing Quest Journal tab (file-header note
 * 3). Entry/one-shot shape identical to Chef's `OpenMusicTab`/
 * `OpenControlsTab`: the tab's attach is permanent once granted, so without
 * the one-shot this would re-fire any time a LATER section's stage clicks
 * some other tab (the exact `OpenStatsTab` hijack fixed before).
 */
class OpenQuestTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && beforeMine() && reader.sideTabInterface(QUEST_TAB) !== -1 && reader.activeSideTab() !== QUEST_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(QUEST_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

/**
 * Stage 240 -> 250: talk to the Quest Guide again. The transient
 * `activeSideTab() === QUEST_TAB` entry gate is trusted the same way Chef's
 * `ToggleRunOn` trusts its controls-tab gate: array order means nothing
 * else in this section touches tabs between `OpenQuestTab` and here. The
 * one-shot latches `progress.talkedAgain` for `ClimbToMine` to observe
 * (file-header note 5) — there is no independent item/xp/tab signal for
 * this transition.
 */
class TalkQuestGuideAgain extends StageTask {
    private talked = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: QuestGuideProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.talked && noDialog() && beforeMine() && insideHall() && nearGuide() && reader.activeSideTab() === QUEST_TAB;
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(GUIDE).nearest();
        if (!npc) {
            return;
        }

        await npc.interact('Talk-to');
        if (await Execution.delayUntil(() => ChatDialog.isOpen(), 8000)) {
            this.talked = true;
            this.progress.talkedAgain = true;
        }
    }
}

/**
 * Stage 250 -> 260: climb down the mine ladder (`newbieladdertop1`, display
 * name "Ladder", `op1=Climb-down`, (3088,3119) — file-header note 7). Gated
 * on `progress.talkedAgain`, never ladder proximity alone (note 6). A loc
 * interaction beyond ~5 tiles walk-snaps first (house rule; shared
 * `walkToward`). One-shot latches on the observed z-jump into the mine —
 * the section's terminal outcome.
 */
class ClimbToMine extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: QuestGuideProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && noDialog() && beforeMine() && this.progress.talkedAgain && Locs.query().name('Ladder').action('Climb-down').within(10).exists();
    }

    async execute(): Promise<void> {
        const ladder = Locs.query().name('Ladder').action('Climb-down').within(10).nearest();
        if (!ladder) {
            return;
        }

        if (ladder.distance() > 5) {
            await walkToward(ladder.tile());
            return;
        }

        await ladder.interact('Climb-down');
        const arrived = await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && t.z >= MINE_Z;
        }, 8000);
        if (arrived) {
            this.done = true;
        }
    }
}

/**
 * In ladder order — `TutorialBot` runs the first whose `validate()` matches
 * each loop. `progress` is fresh per call (once per script start, never
 * module-level — file-header note 5).
 */
export function questGuideStages(bot: TutorialBot): Task[] {
    const progress: QuestGuideProgress = { talkedAgain: false };
    return [new EnterQuestHall(bot), new TalkQuestGuide(bot), new OpenQuestTab(bot), new TalkQuestGuideAgain(bot, progress), new ClimbToMine(bot, progress)];
}
