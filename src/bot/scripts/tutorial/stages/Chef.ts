import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Skills } from '../../../api/hud/Skills.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { actions, reader } from '../../../adapter/ClientAdapter.js';
import type TutorialBot from '../../TutorialBot.js';
import { StageTask } from '../StageTask.js';
import { doorAt, QUEST_GUIDE_DOOR, walkToward } from './helpers.js';

/**
 * Chef + controls section — server ladder 130 -> 220 (docs/tutorial-map.md),
 * content confirmed against `lostcity-dev/content/scripts/tutorial/` (274):
 * the Master Chef's door (140) -> talk (150, grants flour+water) -> make
 * dough (160) -> bake bread (170) -> music tab (180) -> exit door (190) ->
 * controls tab (195) -> toggle run on (200) -> Quest Guide's door (220).
 *
 * Follows the Survival.ts shape: observable `validate()` -> one idempotent
 * action per `execute()`; `TutorialBot` (a `TaskBot`) re-validates every
 * loop and runs the first matching stage. Talk stages set their one-shot
 * flag as soon as the dialogue OPENS and return, letting the
 * higher-priority `AdvanceDialog` click the pages.
 *
 * HOUSE RULE (Task 7 review) + a Task 8 addendum it took a live stall to
 * learn: every stage needs a PERMANENT completion gate, and a one-shot flag
 * may only latch on VERIFIED OUTCOME — never on dispatch. This section's
 * first cut latched `OpenChefDoor.opened` on `interact()` returning true
 * (= the OPLOC packet went out), and the very first full run stalled at
 * 130 forever: the click fired once from the survival-gate landing tile
 * (10 tiles out, no walkable line), the server answered "I can't reach
 * that!", and the latched one-shot never allowed a retry. Door stages now
 * gate on / latch from POSITION CHANGES the door's own teleport-through
 * produces, so a whiffed attempt self-heals next loop.
 *
 * Interaction-at-range mechanics behind that stall (live-confirmed, worth
 * keeping in mind for every future loc stage): the client dispatches OPLOC
 * via `interactWithLoc` -> `tryMove(..., tryNearest=false, ...)` — if its
 * BFS can't complete a path to the loc, the player does not move AT ALL,
 * but the OPLOC packet still goes out. This dev engine runs
 * `clientRoutefinder=true` (the WorldConfig default), so players use the
 * NAIVE server routefinder (`MoveStrategy.NAIVE`, Player.ts ~422) — the
 * server can't path around obstacles on its own either, walks until it
 * hits one, then clears the interaction with "I can't reach that!". Net:
 * `interact()` on a loc is only reliable when the client BFS can already
 * complete the path; from farther out, `actions.walkTo` (MOVE_GAMECLICK,
 * tryNearest=true — snaps to the nearest reachable tile) must close the
 * distance first, iteratively. Hence the shared `walkToward()` helper
 * (`stages/helpers.ts` — promoted there in Task 9 so QuestGuide.ts's ladder
 * stage didn't have to copy it) + per-stage distance gates below. ALSO:
 * doors/gates on this build re-close ~3 ticks after
 * opening (`loc_change(inviswall, 3)` — the Task 7 gate finding is
 * actually generic to every tutorial door), so "the closed door loc is
 * still there" is NEVER evidence an open failed — only the
 * teleport-through position change is.
 *
 * Content mechanics confirmed by reading the trigger scripts (not guessed):
 *
 * 1. `newbie_door2`/`newbie_door3` (chef entrance/exit) are both display
 *    name "Door", 7-9 tiles apart — from beside the Range the WRONG one is
 *    nearest, so door queries pin to a live-probed tile box (`doorAt`),
 *    never "nearest Door".
 * 2. Dough: flour.useOn(water) — the engine's OPHELDU handler
 *    (OpHeldUHandler.ts) checks the SELECTED item's trigger first, and
 *    `[opheldu,newbie_pot_flour]` (tut_cooking.rs2) checks the TARGET for
 *    `is_water_source` -> `@tut_make_dough` (150 -> 160).
 * 3. Baking: the Range (`newbierange`, live-confirmed name "Range") is
 *    use-item-on-loc only. `[oplocu,newbierange]` FORCES success while
 *    `%tutorial == 160` (the only time `BakeBread` can run), granting
 *    Bread + cooking xp and writing 170.
 * 4. Tabs: the music tab (13) is attached (`if_settab`) + flashed by the
 *    stage-170 step proc, the controls tab (12) by the stage-190 one —
 *    `reader.sideTabInterface(tab) !== -1` is therefore the exact entry
 *    signal for each (the same mechanism Survival's stage-20/50 tab stages
 *    use). The TUT_CLICKSIDE from clicking the flashing tab is what writes
 *    180 / 195. Both stages one-shot on the click sticking: the attach is
 *    permanent, so without the latch the two tab stages would flip the
 *    sidebar back and forth forever, starving everything after them.
 * 5. Run toggle: `option_run` (varp 173, player_controls.varp) is
 *    `transmit=yes` — unlike TUTORIAL_VARP it DOES mirror client-side, so
 *    `Game.runEnabled()` is trustworthy. `[if_button,controls:com_5]`
 *    requires `runenergy = 100` and writes 195 -> 200 in the same click;
 *    the stage-195 step proc force-runs-OFF on entry, which self-heals any
 *    early/racing run-on click (run flips back off, the stage revalidates,
 *    the re-click lands at exactly 195).
 * 6. The Quest Guide's door (`newbie_door4`) is ~36 tiles from the chef
 *    exit — far beyond any completable interact-path — so its stage
 *    walk-snaps toward the known tile until close, then interacts. Its
 *    open (at 200) writes 220 and teleports through the south wall
 *    (content hint: `hint_coord(^hint_south, 0_48_48_14_54)`); crossing to
 *    z >= 3126 is the verified outcome the one-shot latches on.
 *
 * Geometry (live probes, this task — recorded in docs/tutorial-map.md):
 * survival gate teleport lands ON the gate tile (3089,3091); Master Chef
 * wanders ~(3075,3086) inside his house (interior ~x 3073-3078, z
 * 3081-3091); entrance `newbie_door2` (3079,3084, loc id 3017, wall on its
 * WEST edge); Range (3075,3081, loc id 3039); exit `newbie_door3`
 * (3072,3090, loc id 3018, wall on its EAST edge); Quest Guide's door
 * `newbie_door4` (3086,3126, loc id 3019, approached from the south).
 */

const CHEF = 'Master Chef';
/** general/configs/tabs.constant — confirmed live (docs/tutorial-map.md's tab table). */
const MUSIC_TAB = 13;
const CONTROLS_TAB = 12;

/** Live-probed door tiles (file header). QUEST_GUIDE_DOOR (newbie_door4) is
 *  shared with QuestGuide.ts and lives in ./helpers.js. */
const CHEF_DOOR_IN = { x: 3079, z: 3084 }; // newbie_door2
const CHEF_DOOR_OUT = { x: 3072, z: 3090 }; // newbie_door3

/** Chef-house interior (live-probed furniture/chef-wander bounds; the
 *  entrance door's host tile (3079,3084) is just OUTSIDE it, and the
 *  teleport-through lands at (3078,3084) — just inside). */
const CHEF_HOUSE = { minX: 3073, maxX: 3078, minZ: 3081, maxZ: 3091 };

/** West of the survival-gate fence line (x=3089) = the chef section's side
 *  of the island. The gate teleport lands exactly ON the line. */
const GATE_LINE_X = 3089;

const noDialog = () => !ChatDialog.isOpen();
const nearChef = () => Npcs.query().name(CHEF).within(8).exists();

const insideChefHouse = () => {
    const t = Game.tile();
    return t !== null && t.x >= CHEF_HOUSE.minX && t.x <= CHEF_HOUSE.maxX && t.z >= CHEF_HOUSE.minZ && t.z <= CHEF_HOUSE.maxZ;
};

const onChefSide = () => {
    const t = Game.tile();
    return t !== null && t.x <= GATE_LINE_X;
};

/** The bread chain hasn't started: no chef handout/product in the pack yet.
 *  Bread never leaves the inventory afterwards, so this doubles as the
 *  permanent "section entry is done" gate for the entrance-door stage. */
const breadChainNotStarted = () => !Inventory.contains('Pot of flour') && !Inventory.contains('Bread dough') && !Inventory.contains('Bread');

/**
 * Stage 130 -> 140: get through the Master Chef's door (`newbie_door2`).
 * Entry: cooking xp > 0 (survival's permanent milestone) AND west of the
 * survival gate (where its script teleported us) — position alone can't
 * misfire during survival, and the earlier survival stages all validate
 * false here (items/one-shots). Completion: standing inside the house
 * (the door's own teleport-through) and, permanently, the bread chain
 * (file-header house-rule addendum: no dispatch-latched one-shot).
 */
class OpenChefDoor extends StageTask {
    validate(): boolean {
        return noDialog() && Skills.xp('cooking') > 0 && onChefSide() && !insideChefHouse() && breadChainNotStarted();
    }

    async execute(): Promise<void> {
        const door = doorAt(CHEF_DOOR_IN).nearest();
        if (!door || door.distance() > 5) {
            await walkToward(CHEF_DOOR_IN);
            return;
        }

        await door.interact('Open');
        await Execution.delayUntil(() => insideChefHouse(), 5000);
    }
}

/**
 * Stage 140 -> 150: talk to the Master Chef — the dialogue grants Pot of
 * flour + Bucket of water (`newbie_cook_instructor_give_ingredients`; the
 * recap branch re-grants them, so a lost handout self-heals via re-talk).
 * One-shot on dialogue-open (Survival's `TalkToGuide` pattern): blocking
 * here until dialog-close would starve `AdvanceDialog`.
 */
class TalkChef extends StageTask {
    private talked = false;

    validate(): boolean {
        return !this.talked && noDialog() && insideChefHouse() && nearChef();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(CHEF).nearest();
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
 * Stage 150 -> 160: make dough (file header note 2 for the useOn order).
 * No one-shot needed — flour+water are consumed into dough, closing the
 * gate permanently on its own (Survival's `LightFire` pattern).
 */
class MakeDough extends StageTask {
    validate(): boolean {
        return noDialog() && Inventory.contains('Pot of flour') && Inventory.contains('Bucket of water');
    }

    async execute(): Promise<void> {
        const flour = Inventory.first('Pot of flour');
        const water = Inventory.first('Bucket of water');
        if (!flour || !water) {
            return;
        }

        await flour.useOn(water);
        await Execution.delayUntil(() => Inventory.contains('Bread dough'), 5000);
    }
}

/**
 * Stage 160 -> 170: bake the dough on the Range (file header note 3 — the
 * only run of this stage lands on the content-forced success branch). No
 * one-shot needed: the dough is consumed either way.
 */
class BakeBread extends StageTask {
    validate(): boolean {
        return noDialog() && Inventory.contains('Bread dough');
    }

    async execute(): Promise<void> {
        const dough = Inventory.first('Bread dough');
        const range = Locs.query().name('Range').within(8).nearest();
        if (!dough || !range) {
            return;
        }

        await dough.useOn(range);
        await Execution.delayUntil(() => !Inventory.contains('Bread dough'), 15000);
    }
}

/**
 * Stage 170 -> 180: click the flashing Music tab. Entry gate = the tab
 * interface attaching (file header note 4), exactly like Survival's
 * stage-20/50 tab stages; one-shot because the attach is permanent and
 * `OpenControlsTab` later moves the active tab away from 13.
 */
class OpenMusicTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && reader.sideTabInterface(MUSIC_TAB) !== -1 && reader.activeSideTab() !== MUSIC_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(MUSIC_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

/**
 * Stage 180 -> 190: exit through the chef's far door (`newbie_door3`).
 * Completion signal is the teleport-through putting us OUTSIDE the house
 * box — permanent for the run, since `OpenChefDoor` (the only way back in)
 * is bread-gated shut by now. Listed after `OpenMusicTab`, so the music
 * click always lands first; at exactly 180 the door script advances to
 * 190, and at <180 it just mesboxes (cleared by `AdvanceDialog`, retried).
 */
class ExitChefHouse extends StageTask {
    validate(): boolean {
        return noDialog() && insideChefHouse() && Inventory.contains('Bread');
    }

    async execute(): Promise<void> {
        const door = doorAt(CHEF_DOOR_OUT).nearest();
        if (!door || door.distance() > 5) {
            await walkToward(CHEF_DOOR_OUT);
            return;
        }

        await door.interact('Open');
        await Execution.delayUntil(() => !insideChefHouse(), 5000);
    }
}

/**
 * Stage 190 -> 195: click the flashing Player Controls tab — same
 * attach-gate + one-shot shape as `OpenMusicTab` (file header note 4).
 */
class OpenControlsTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && reader.sideTabInterface(CONTROLS_TAB) !== -1 && reader.activeSideTab() !== CONTROLS_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(CONTROLS_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

/**
 * Stage 195 -> 200: toggle run on (file header note 5). The engine resets
 * run to OFF whenever run-energy hits 0, so `Game.runEnabled()` alone is not
 * a permanent completion gate; a one-shot flag latches only after the toggle
 * outcome is VERIFIED (runEnabled() observed true post-toggle), matching the
 * house-rule pattern. The stage-195 entry proc's forced run-off self-heals
 * the pre-195 race.
 */
class ToggleRunOn extends StageTask {
    private done = false;

    validate(): boolean {
        return !this.done && noDialog() && reader.activeSideTab() === CONTROLS_TAB && !Game.runEnabled() && Game.energy() >= 100;
    }

    async execute(): Promise<void> {
        await actions.setRun(true);
        const enabled = await Execution.delayUntil(() => Game.runEnabled(), 3000);
        if (enabled) {
            this.done = true;
        }
    }
}

/**
 * Stage 200 -> 220: run to and open the Quest Guide's door (`newbie_door4`,
 * ~36 tiles out — file header note 6). `runEnabled()` gates entry but
 * never closes, so the one-shot latches on the VERIFIED teleport-through
 * (crossing to z >= 3126); latching matters because later sections come
 * back south of that line (the mine ladder is at z 3119).
 *
 * ALSO gated on being on the SURFACE south of the door line (Task 10): the
 * whole real 200 -> 220 leg happens at z < 3126, but a mine-section
 * stage-jump re-arms this one-shot on a bot whose (equally re-armed)
 * `ToggleRunOn` turns run on UNDERGROUND (z ~9500, where `newbie_door4`
 * isn't in the scene) — observed live as an infinite walk-toward-nothing
 * loop starving every mining stage at exactly 260. `z < QUEST_GUIDE_DOOR.z`
 * is false both underground and after the real crossing, so it closes the
 * misfire without touching the real flow — including questguide-test's
 * DELIBERATE re-arm (that jump starts at spawn, z ~3106 < 3126).
 *
 * AND on `Skills.xp('mining') === 0` (Task 12): the bank section runs on
 * the surface at z 3124 < 3126, so the z gate alone no longer covers every
 * "elsewhere" — a 500 stage-jump (or a mid-bank-section restart) would
 * re-arm this stage and walk the bot back to the quest door, feeding it to
 * the QuestGuide chain's own re-arm hazard (QuestGuide.ts file-header note
 * 8). Mining xp is zero through the whole real 130 -> 220 window and
 * permanently non-zero from 294 onward.
 */
class OpenQuestGuideDoor extends StageTask {
    private done = false;

    validate(): boolean {
        const t = Game.tile();
        return !this.done && noDialog() && Game.runEnabled() && Skills.xp('mining') === 0 && t !== null && t.z < QUEST_GUIDE_DOOR.z;
    }

    async execute(): Promise<void> {
        const door = doorAt(QUEST_GUIDE_DOOR).nearest();
        if (!door || door.distance() > 5) {
            await walkToward(QUEST_GUIDE_DOOR);
            return;
        }

        await door.interact('Open');
        const crossed = await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && t.z >= QUEST_GUIDE_DOOR.z;
        }, 5000);
        if (crossed) {
            this.done = true;
        }
    }
}

/** In ladder order — `TutorialBot` runs the first whose `validate()` matches each loop. */
export function chefStages(bot: TutorialBot): Task[] {
    return [
        new OpenChefDoor(bot),
        new TalkChef(bot),
        new MakeDough(bot),
        new BakeBread(bot),
        new OpenMusicTab(bot),
        new ExitChefHouse(bot),
        new OpenControlsTab(bot),
        new ToggleRunOn(bot),
        new OpenQuestGuideDoor(bot)
    ];
}
