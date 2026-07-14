import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Skills } from '../../../api/hud/Skills.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { reader } from '../../../adapter/ClientAdapter.js';
import type TutorialBot from '../../TutorialBot.js';
import { StageTask } from '../StageTask.js';

/**
 * Survival section — server ladder 4 -> 130, content
 * confirmed against `lostcity-dev/content/scripts/tutorial/` (274): the
 * guide's door -> Survival Expert (Brynna) -> inventory tab -> chop -> fire
 * -> stats tab -> talk again -> net -> cook (burn then success) -> gate.
 * Also carries `TalkToGuide` (ladder 1 -> 4): the intro dialogue driver
 * existed (`AdvanceDialog`) but nothing ever STARTED the guide conversation
 * — `dialog-test.ts` clicked the NPC as the test driver, masking the gap
 * until this section's first full live run stalled at tutorial=1.
 *
 * Every stage follows the `DesignAccept` shape: observable `validate()` ->
 * one idempotent action per `execute()`; `TutorialBot` (a `TaskBot`)
 * re-validates every loop and runs the first stage that matches, so a
 * partial/failed action just retries next tick. Talk stages set their
 * one-shot flag as soon as the dialogue OPENS and return — `AdvanceDialog`
 * (higher priority) drives the pages; blocking here until the dialog closed
 * would starve it.
 *
 * Content quirks these validators encode (read from the real trigger
 * scripts, not guessed — file paths below are in `lostcity-dev/content`):
 *
 * 1. The FIRST Survival Expert talk (10 -> 20) shows an objbox of the axe +
 *    tinderbox but does NOT `inv_add` them — the grant happens in
 *    `[tutorial,_]` (tutorial/scripts/tutorial.rs2), i.e. as a side effect
 *    of the TUT_CLICKSIDE the flashing-tab click sends while
 *    `%tutorial == 20`. So "have I talked yet" can't be read from inventory
 *    (backwards: the axe only appears AFTER the tab click) — one-shot flag
 *    instead. The SECOND talk (60 -> 70) `inv_add`s the net directly in the
 *    dialogue, so gating that one on inventory is safe.
 * 2. The stage-20 signal is the tab grant itself: `tutorial_step_view_inventory`
 *    (tut_chatbox_steps.rs2) does `if_settab(inventory, ^tab_inventory)` +
 *    `tut_flash` — a tutorial-locked account has NO sidebar tabs at all
 *    before that (sideIcon[i] == -1, confirmed live), so
 *    `reader.sideTabInterface(3) !== -1` marks the stage exactly. Same for
 *    stats at stage 50 (`tutorial_step_you_gained_experience`).
 * 3. Lighting: `logs.useOn(tinderbox)` (logs selected first). The engine's
 *    OPHELDU handler (Engine-TS OpHeldUHandler.ts) looks up
 *    `[opheldu,<target>]` first, so logs-on-tinderbox resolves
 *    `[opheldu,tinderbox]` (skill_firemaking/scripts/firemaking.rs2) with
 *    `last_useitem = newbielogs` -> `@tut_light_logs_inv`, the branch that
 *    advances `%tutorial`. (The reverse order also lands there via the
 *    handler's swap fallback — but this order needs no fallback.)
 * 4. The `Fire` loc (skill_cooking/configs/cooking_source/cooking_sources.loc)
 *    carries NO right-click ops (cooking is use-item-on-loc only), so
 *    `CookShrimp` must not filter locs by `.action('Cook')` — that always
 *    returns null.
 * 5. The persistent instruction panel (`~tutorialstep`) is TUT_OPEN ->
 *    `tutComId`, a separate client slot from the chat modal — it does NOT
 *    make `ChatDialog.isOpen()` true, so `noDialog()` gates stay usable
 *    through the whole tutorial.
 *
 * Geometry locked from a live probe (fresh account, spawn (3094,3106) —
 * recorded in the tutorial varp ladder): guide door `newbie_door1` at
 * (3098,3107), guide room west of it; Survival Expert wanders ~(3102,3094);
 * fishing spots (3101,3092)/(3103,3092); survival gate halves
 * (3089,3091)/(3089,3092); chop-able trees all over the clearing (nearest
 * ~3 tiles from the expert).
 */

/** Display names confirmed live (content configs/tutorial.npc): op1=Talk-to on both. */
const GUIDE = 'RuneScape Guide';
const EXPERT = 'Survival Expert';

/** general/configs/tabs.constant — ^tab_inventory / ^tab_skills. Confirmed live via the stage-20/50 grants. */
const INVENTORY_TAB = 3;
const STATS_TAB = 1;

/** East wall of the guide's room: `newbie_door1` sits at x=3098 (live probe). On the guide side while x <= 3097. */
const GUIDE_SIDE_MAX_X = 3097;

const noDialog = () => !ChatDialog.isOpen();
const inGuideRoom = () => Npcs.query().name(GUIDE).within(10).exists();
const expertInScene = () => Npcs.query().name(EXPERT).within(30).exists();
const onGuideSide = () => {
    const t = Game.tile();
    return t !== null && t.x <= GUIDE_SIDE_MAX_X;
};

/**
 * Ladder 1 -> 4: start the RuneScape Guide conversation. `AdvanceDialog`
 * clicks the pages through (declining the dev-only skip prompt); the stage
 * write happens at the end of the welcome speech. One-shot: set once the
 * dialogue is observed open, so a whiffed click retries but a finished
 * conversation is never restarted (re-talking would just loop the recap).
 */
class TalkToGuide extends StageTask {
    private talked = false;

    validate(): boolean {
        return !this.talked && noDialog() && inGuideRoom();
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
 * Stage 4 -> 10: open the guide's door (`newbie_door1` at (3098,3107)). The
 * content teleports us through as part of the open
 * (doors/scripts/open_and_close_doors.rs2 `p_teleport`), flipping
 * `onGuideSide()` false — the stage's own completion signal. Also gated on
 * the guide being nearby: near the SURVIVAL gate (post-130) other tutorial
 * doors (e.g. the Master Chef's) come within 10 tiles, and without the
 * guide-proximity gate this stage would "helpfully" open next section's
 * door.
 */
class OpenGuideDoor extends StageTask {
    validate(): boolean {
        return noDialog() && onGuideSide() && inGuideRoom() && Locs.query().name('Door').action('Open').within(10).exists();
    }

    async execute(): Promise<void> {
        const door = Locs.query().name('Door').action('Open').within(10).nearest();
        if (!door) {
            return;
        }

        await door.interact('Open');
        await Execution.delayTicks(3);
    }
}

/**
 * Stage 10 -> 20: first talk to the Survival Expert (~12 tiles southeast of
 * the door — `interact` walks us there via the client's own approach
 * logic). One-shot on dialogue-open; the axe/tinderbox grant is deferred to
 * the tab click (file-header note 1), so inventory can't gate this.
 */
class TalkSurvivalExpert extends StageTask {
    private talked = false;

    validate(): boolean {
        return !this.talked && noDialog() && !onGuideSide() && expertInScene();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(EXPERT).nearest();
        if (!npc) {
            return;
        }

        await npc.interact('Talk-to');
        if (await Execution.delayUntil(() => ChatDialog.isOpen(), 10000)) {
            this.talked = true;
        }
    }
}

/**
 * Stage 20 -> 30: click the flashing Inventory tab. The click is what
 * actually grants the axe + tinderbox (file-header notes 1-2). Gating:
 * `sideTabInterface(3) !== -1` = the tab exists at all (stage >= 20);
 * no axe yet = the TUT_CLICKSIDE hasn't been accepted yet; activeSideTab
 * guard = don't re-click while the grant is in flight.
 */
class OpenInventoryTab extends StageTask {
    validate(): boolean {
        return noDialog() && reader.sideTabInterface(INVENTORY_TAB) !== -1 && !Inventory.contains('Bronze axe') && reader.activeSideTab() !== INVENTORY_TAB;
    }

    async execute(): Promise<void> {
        await Game.openSideTab(INVENTORY_TAB);
    }
}

/**
 * Stage 30 -> 40: chop a tree for logs. `firemaking xp === 0` keeps this
 * quiet forever once the fire stage has passed (post-fire "no logs" moments
 * would otherwise look identical to "haven't chopped yet"); `CookShrimp`
 * has its own inline re-chop for the relight case. Two-phase wait: first
 * for the walk+chop to start (animation), then for the logs.
 */
class ChopTree extends StageTask {
    validate(): boolean {
        return noDialog() && Skills.xp('firemaking') === 0 && Inventory.contains('Bronze axe') && !Inventory.contains('Logs') && !Game.animating();
    }

    async execute(): Promise<void> {
        const tree = Locs.query().name('Tree').action('Chop down').within(15).nearest();
        if (!tree) {
            return;
        }

        await tree.interact('Chop down');
        await Execution.delayUntil(() => Game.animating() || Inventory.contains('Logs'), 8000);
        await Execution.delayUntil(() => Inventory.contains('Logs') || !Game.animating(), 15000);
    }
}

/**
 * Stage 40 -> 50: light the logs (order per file-header note 3). The
 * `firemaking === 0` gate keeps this quiet after the stage (a stray log
 * picked up later must not trigger fires); before it, a failed light
 * ("You can't light a fire here") leaves the logs in place for a retry.
 */
class LightFire extends StageTask {
    validate(): boolean {
        return noDialog() && Skills.xp('firemaking') === 0 && Inventory.contains('Logs') && Inventory.contains('Tinderbox') && !Game.animating();
    }

    async execute(): Promise<void> {
        const logs = Inventory.first('Logs');
        const box = Inventory.first('Tinderbox');
        if (!logs || !box) {
            return;
        }

        await logs.useOn(box);
        await Execution.delayUntil(() => !Inventory.contains('Logs'), 15000);
    }
}

/**
 * Stage 50 -> 60: click the flashing Stats tab (granted by the same stage —
 * file-header note 2). One-shot: set once the tab open succeeds, so the
 * transient activeSideTab !== STATS_TAB gate doesn't re-trigger this stage
 * when later sections click other tabs (music=13, controls=12, quest=2, etc.).
 */
class OpenStatsTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && Skills.xp('firemaking') > 0 && reader.sideTabInterface(STATS_TAB) !== -1 && reader.activeSideTab() !== STATS_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(STATS_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

/**
 * Stage 60 -> 70: talk to the Survival Expert again — this dialogue
 * `inv_add`s the Small fishing net directly (no tab-click deferral), so the
 * net doubles as the completion signal; no one-shot needed. Can fire a loop
 * early at stage 50 if the stats-tab grant is still in flight
 * (`OpenStatsTab`, listed first, validates false until `sideIcon[1]`
 * arrives) — harmless: the expert just answers with a reminder.
 */
class TalkSurvivalAgain extends StageTask {
    validate(): boolean {
        return noDialog() && Skills.xp('firemaking') > 0 && !Inventory.contains('Small fishing net') && expertInScene();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(EXPERT).nearest();
        if (!npc) {
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => ChatDialog.isOpen(), 10000);
    }
}

/**
 * Stage 70 -> 80 (and the re-catch after the forced burn): net a shrimp.
 * Gated on `cooking xp === 0`, the whole catch/cook cycle's stop signal —
 * the first cook always burns (consuming the raw shrimps again), so "no raw
 * shrimps" alone would re-trigger forever; cooking xp only lands with the
 * successful second cook.
 */
class NetShrimp extends StageTask {
    validate(): boolean {
        return noDialog() && Skills.xp('cooking') === 0 && Inventory.contains('Small fishing net') && !Inventory.contains('Raw shrimps') && !Game.animating();
    }

    async execute(): Promise<void> {
        const spot = Npcs.query().name('Fishing spot').action('Net').within(20).nearest();
        if (!spot) {
            return;
        }

        await spot.interact('Net');
        await Execution.delayUntil(() => Game.animating() || Inventory.contains('Raw shrimps'), 8000);
        await Execution.delayUntil(() => Inventory.contains('Raw shrimps') || !Game.animating(), 20000);
    }
}

/**
 * Stages 80 -> 90 -> 120: cook the raw shrimp on the fire. Content forces
 * burn #1 (90) and success #2 (120); `NetShrimp` re-catches in between. If
 * the fire timed out (placed for ~90s), relight — re-chopping first if the
 * logs are gone too.
 */
class CookShrimp extends StageTask {
    validate(): boolean {
        return noDialog() && Skills.xp('cooking') === 0 && Inventory.contains('Raw shrimps');
    }

    async execute(): Promise<void> {
        const fire = Locs.query().name('Fire').within(10).nearest();
        if (!fire) {
            const logs = Inventory.first('Logs');
            if (!logs) {
                const tree = Locs.query().name('Tree').action('Chop down').within(15).nearest();
                if (tree) {
                    await tree.interact('Chop down');
                    await Execution.delayUntil(() => Inventory.contains('Logs'), 15000);
                }
                return;
            }

            const box = Inventory.first('Tinderbox');
            if (box) {
                await logs.useOn(box);
                await Execution.delayUntil(() => Locs.query().name('Fire').within(10).exists(), 15000);
            }
            return;
        }

        const raw = Inventory.first('Raw shrimps');
        if (!raw) {
            return;
        }

        const before = Inventory.items().filter(i => i.name === 'Raw shrimps').length;
        await raw.useOn(fire);
        await Execution.delayUntil(() => Inventory.items().filter(i => i.name === 'Raw shrimps').length < before, 15000);
    }
}

/**
 * Stage 120 -> 130: through the survival gate (halves at (3089,3091)/
 * (3089,3092) — live probe). One-shot after a dispatched open: the gate
 * script teleports the player across on EVERY use once the section is done
 * (tut_doors_and_gates.rs2 `[oploc1,_tutorial_gate]` falls through to
 * `p_teleport` for any %tutorial >= 120), so re-validating on proximity
 * alone would ping-pong us across it forever after 130.
 */
class OpenSurvivalGate extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && Skills.xp('cooking') > 0 && Locs.query().name('Gate').action('Open').within(20).exists();
    }

    async execute(): Promise<void> {
        const gate = Locs.query().name('Gate').action('Open').within(20).nearest();
        if (!gate) {
            return;
        }

        const dispatched = await gate.interact('Open');
        await Execution.delayTicks(3);
        if (dispatched) {
            this.opened = true;
        }
    }
}

/** In ladder order — `TutorialBot` runs the first whose `validate()` matches each loop. */
export function survivalStages(bot: TutorialBot): Task[] {
    return [
        new TalkToGuide(bot),
        new OpenGuideDoor(bot),
        new TalkSurvivalExpert(bot),
        new OpenInventoryTab(bot),
        new ChopTree(bot),
        new LightFire(bot),
        new OpenStatsTab(bot),
        new TalkSurvivalAgain(bot),
        new NetShrimp(bot),
        new CookShrimp(bot),
        new OpenSurvivalGate(bot)
    ];
}
