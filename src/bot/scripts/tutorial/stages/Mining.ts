import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Locs, type Loc } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import type TutorialBot from '../../TutorialBot.js';
import { StageTask } from '../StageTask.js';
import { MINE_Z, walkToward } from './helpers.js';

/**
 * Mining + smithing section — server ladder 260 -> 360 (docs/tutorial-map.md),
 * content confirmed against `lostcity-dev/content/scripts/tutorial/` (274)'s
 * `guides/mining_instructor.rs2` + `skills/tut_mining.rs2` +
 * `skills/tut_smelting.rs2` + `skills/tut_smithing.rs2` +
 * `skill_smithing/scripts/smithing/smithing.rs2` + `tut_doors_and_gates.rs2`:
 * talk to the Mining Instructor (270) -> prospect copper + tin, either order
 * (274/275/279/280) -> talk again for a pickaxe (290) -> mine copper + tin,
 * either order (294/295/320) -> smelt a bronze bar (330) -> talk again for a
 * hammer (340) -> smith a bronze dagger via the anvil's make-menu (350) ->
 * open the mining-area exit gate (360).
 *
 * Follows the Chef.ts/QuestGuide.ts shape: observable `validate()` -> one
 * idempotent action per `execute()`; every one-shot latches on a VERIFIED
 * outcome (item gained, dialogue/make-panel opened, position crossed), never
 * on dispatch. This section's geometry and mechanics were confirmed live
 * (`tools/nav/probe-locs.ts` against the packed map + a scratch browser
 * probe — not guessed from the task brief's sketch), because the brief's
 * `mineByColour` try-each fallback and its module-level `let
 * prospectedCopper` both needed replacing per house discipline:
 *
 * 1. WHOLE SECTION IS UNDERGROUND (mine mapsquare, world z >= `MINE_Z`
 *    (9000) — `helpers.ts`, shared with `QuestGuide.ts`'s `ClimbToMine`).
 *    Every stage gates on `inMine()` so nothing here can fire above ground,
 *    and nothing from an earlier section can hijack a stage down here.
 * 2. ROCK DISAMBIGUATION: both the copper and tin rock clusters display as
 *    plain "Rocks" (`op1=Mine`, `op2=Prospect`) — identical name, so
 *    `.name('Rocks')` alone can't tell them apart. `probe-locs.ts` against
 *    the packed map (`newbiecopperrock`/`newbietinrock`) pins them by loc
 *    TYPE id instead of tile (more robust than a tile pin: several rock
 *    tiles exist per ore, e.g. any of them advances the stage) — confirmed
 *    live via a scratch harness probe (not shipped): `COPPER_ROCK_ID` (3042)
 *    clusters x 3083-3091 z 9498-9503 next to the instructor; `TIN_ROCK_ID`
 *    (3043) clusters x 3073-3077 z 9501-9509 by the furnace/anvils.
 * 3. PROSPECT OUTCOME IS A REAL CHAT MODAL, not a plain chat-log message.
 *    `~mesbox("This rock contains copper.")` (tut_mining.rs2) opens
 *    `modals().chat` just like every other tutorial mesbox (confirmed live:
 *    `ChatDialog.isOpen()` flips true ~3-4s after the Prospect click, via
 *    the content's own `p_delay(3)`) — `Game.recentChat()` never sees it
 *    (that reader filters to OTHER players' public chat; a server "mes"/
 *    "mesbox" line has no username and isn't public chat at all). So
 *    `ChatDialog.isOpen()` is the correct latch for both Prospect stages,
 *    not the brief's `Game.recentChat(/copper|tin/i)`.
 * 4. MINING OUTCOME is `inv_add` BEFORE its own `~mesbox(...)`
 *    (tut_mining.rs2), so `Inventory.contains('Copper ore'/'Tin ore')` is a
 *    faithful, low-latency completion signal (the trailing mesbox is just
 *    cleared by `AdvanceDialog`, same as every other section).
 * 5. SMELTING AND SMITHING SUCCESS MESSAGES ARE `mes(...)`, NOT
 *    `mesbox(...)` (tut_smelting.rs2/smithing.rs2's `smithing_anvil` proc) —
 *    no chat modal opens on a successful smelt/smith, so those stages gate
 *    purely on inventory (Bronze bar / Bronze dagger appearing).
 * 6. THE ANVIL'S MAKE-MENU IS A MAIN-MODAL PANEL, NOT A CHAT SKILL-MULTI
 *    MENU — the real gap in the brief's "check exact accessor names"
 *    instruction. `smithing.rs2` opens its interface with `if_openmain
 *    (smithing)`, and live-probing it (`reader.debugDumpTree`, a scratch
 *    tool, not shipped) showed 6 sibling TYPE_INV "column" components (one
 *    per weapon/armour/ammo group), each holding several product icons that
 *    all SHARE one row of ops (`iop`: "Make"/"Make 5"/"Make 10", or "Make
 *    set"/... for ammo) — structurally identical to how `bankItems()`/
 *    `equipment()` already read TYPE_INV components, but NOTHING like
 *    `makeProducts()`'s chat-modal shape (one icon + a separate run of
 *    "Make N" BUTTON_OK captions). `reader.makeProducts()`/`ChatDialog.
 *    isMakeMenu()`/`.make()` genuinely saw nothing here (`chatModalId`
 *    stays -1 throughout — confirmed live). Fixed by adding
 *    `reader.mainSkillMultiItems()` (ClientAdapter.ts) + `ChatDialog.
 *    isMainMakePanel()`/`.mainMakeProducts()`/`.makeFromPanel()` — the
 *    MAIN-modal counterpart, dispatched via `ActionRouter.driver.invButton`
 *    (Bank.ts's own withdraw/deposit mechanism, not `heldOp`/`ifButton`).
 *    Verified live end-to-end (bar -> anvil -> make-menu -> pick "dagger" ->
 *    Bronze dagger in the pack, Bronze bar consumed, panel auto-closes).
 *    `makeProducts()`/`ChatDialog.make()` were ALSO given a harmless CHAT-OR-
 *    MAIN fallback while investigating this (in case some other skill's
 *    menu uses `if_openmain` with the simpler BUTTON_OK shape), but the
 *    smithing panel needed the dedicated panel API, not that fallback.
 * 7. THE EXIT GATE (`newbiedoor4l`/`newbiedoor4r`, display "Gate",
 *    `category=tut_mining_exit`) sits on a fixed wall line `x = 3094`
 *    (z 9502-9503) — live-probed teleport: opening from the mine side
 *    (x < 3094) lands the player at x = 3095, one tile PAST the line, so
 *    `t.x > EXIT_GATE_X` is the section's terminal one-shot outcome. The
 *    Combat Instructor's rat-pen area (Task 11) is further east
 *    (`newbiedoor5_l/r` at x = 3111) and ALSO underground (same z range),
 *    so `inMine()` alone can't separate the two sections — every stage here
 *    additionally gates on section-local observables (item possession, the
 *    Mining Instructor's own name/proximity) that go permanently quiet once
 *    their real-world precondition is gone, so nothing in this file can
 *    re-fire once the bot is on the combat side.
 * 8. TALK STAGES THAT HAND OUT AN ITEM (270->274/275 gets nothing yet, but
 *    290 grants the pickaxe, 330->340 grants the hammer) one-shot + latch on
 *    the ITEM appearing (stronger than dialogue-open, per house rule) —
 *    the two prospect talks and the first talk have no item of their own,
 *    so they latch on dialogue-open like every other section's talk stages,
 *    threading a per-run `MiningProgress` (never module-level state, see
 *    QuestGuide.ts's `QuestGuideProgress` precedent) for the one transition
 *    (274/275 -> both-prospected) with no independent client-observable.
 */

const DEZZICK = 'Mining Instructor';

/** Live-probed loc TYPE ids (`tools/nav/probe-locs.ts` against the packed
 *  map; file-header note 2) — NOT tile pins, since several rock tiles exist
 *  per ore and any of them advances the stage. */
const COPPER_ROCK_ID = 3042; // newbiecopperrock
const TIN_ROCK_ID = 3043; // newbietinrock

/**
 * Max distance from which a use-item-on-loc dispatches directly instead of
 * walk-snapping first (`SmeltBronze` doc comment for the live evidence:
 * the loc-aware click paths itself; `walkToward` toward a solid loc's own
 * blocked tile can move the player ZERO tiles). 12 gives headroom over the
 * probe-verified distance-10 smelt; both ore clusters, the furnace and all
 * four anvils sit within it of each other.
 */
const USE_ON_RANGE = 12;

/** Live-probed wall line for the exit gate (file-header note 7). */
const EXIT_GATE_X = 3094;
const EXIT_GATE_BOX = { minX: EXIT_GATE_X - 3, maxX: EXIT_GATE_X + 3, minZ: 9498, maxZ: 9507 };

const noDialog = () => !ChatDialog.isOpen();
const inMine = () => {
    const t = Game.tile();
    return t !== null && t.z >= MINE_Z;
};

function rockQuery(id: number) {
    return Locs.query()
        .name('Rocks')
        .where((l: Loc) => l.id === id);
}

/**
 * Shared between the two Prospect stages and `TalkForPickaxe` (file-header
 * note 8) — built fresh per `miningStages()` call, never module-level (the
 * QuestGuide.ts `QuestGuideProgress` precedent).
 */
interface MiningProgress {
    prospectedCopper: boolean;
    prospectedTin: boolean;
}

/**
 * Stage 260 -> 270: talk to the Mining Instructor (Dezzick). One-shot on
 * dialogue-open, same shape as every other section's first talk — letting
 * the higher-priority `AdvanceDialog` click through the introduction.
 */
class TalkMiningInstructor extends StageTask {
    private talked = false;

    validate(): boolean {
        return !this.talked && inMine() && noDialog();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(DEZZICK).within(40).nearest();
        if (!npc) {
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        if (await Execution.delayUntil(() => ChatDialog.isOpen(), 8000)) {
            this.talked = true;
        }
    }
}

/**
 * Stage 270 -> 274/275: prospect the copper rock (file-header notes 2-3).
 * Always goes first (the ladder's "either order" is a server-side
 * tolerance, not a requirement the bot has to randomize over) — gated on
 * `TalkMiningInstructor` having already talked isn't needed explicitly
 * (array order: this stage can't out-race the first talk since it stays
 * the first validating stage until its own one-shot latches).
 */
class ProspectCopper extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: MiningProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && inMine() && noDialog();
    }

    async execute(): Promise<void> {
        const rock = rockQuery(COPPER_ROCK_ID).within(40).nearest();
        if (!rock) {
            return;
        }

        if (rock.distance() > 5) {
            await walkToward(rock.tile());
            return;
        }

        await rock.interact('Prospect');
        if (await Execution.delayUntil(() => ChatDialog.isOpen(), 8000)) {
            this.done = true;
            this.progress.prospectedCopper = true;
        }
    }
}

/** Stage 274/275 -> 279/280: prospect the tin rock, after copper. */
class ProspectTin extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: MiningProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && inMine() && noDialog() && this.progress.prospectedCopper;
    }

    async execute(): Promise<void> {
        const rock = rockQuery(TIN_ROCK_ID).within(40).nearest();
        if (!rock) {
            return;
        }

        if (rock.distance() > 5) {
            await walkToward(rock.tile());
            return;
        }

        await rock.interact('Prospect');
        if (await Execution.delayUntil(() => ChatDialog.isOpen(), 8000)) {
            this.done = true;
            this.progress.prospectedTin = true;
        }
    }
}

/**
 * Stage 279/280 -> 290: talk to Dezzick again for the bronze pickaxe
 * (file-header note 8 — latches on the ITEM, not dialogue-open).
 */
class TalkForPickaxe extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: MiningProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && inMine() && noDialog() && this.progress.prospectedTin && !Inventory.contains('Bronze pickaxe');
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(DEZZICK).within(40).nearest();
        if (!npc) {
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        if (await Execution.delayUntil(() => Inventory.contains('Bronze pickaxe'), 8000)) {
            this.done = true;
        }
    }
}

/**
 * Stage 290 -> 294/295: mine a copper ore. `this.done` latches PERMANENTLY
 * on the first ore gained — item-only gating (`!Inventory.contains('Copper
 * ore')`) would re-open this the moment `SmeltBronze` consumes the ore,
 * sending the bot back to needlessly mine another (harmless to the tutorial
 * but a real house-rule violation: a one-shot must latch for the run, not
 * just until the item is next missing).
 */
class MineCopper extends StageTask {
    private done = false;

    validate(): boolean {
        return !this.done && inMine() && noDialog() && Inventory.contains('Bronze pickaxe') && !Inventory.contains('Copper ore') && !Game.animating();
    }

    async execute(): Promise<void> {
        const rock = rockQuery(COPPER_ROCK_ID).within(40).nearest();
        if (!rock) {
            return;
        }

        if (rock.distance() > 5) {
            await walkToward(rock.tile());
            return;
        }

        await rock.interact('Mine');
        if (await Execution.delayUntil(() => Inventory.contains('Copper ore'), 15000)) {
            this.done = true;
        }
    }
}

/** Stage 294/295 -> 320: mine a tin ore, after copper (same latch reasoning as `MineCopper`). */
class MineTin extends StageTask {
    private done = false;

    validate(): boolean {
        return !this.done && inMine() && noDialog() && Inventory.contains('Copper ore') && !Inventory.contains('Tin ore') && !Game.animating();
    }

    async execute(): Promise<void> {
        const rock = rockQuery(TIN_ROCK_ID).within(40).nearest();
        if (!rock) {
            return;
        }

        if (rock.distance() > 5) {
            await walkToward(rock.tile());
            return;
        }

        await rock.interact('Mine');
        if (await Execution.delayUntil(() => Inventory.contains('Tin ore'), 15000)) {
            this.done = true;
        }
    }
}

/**
 * Stage 320 -> 330: smelt a bronze bar (ore on Furnace, file-header note 5).
 * No one-shot flag needed — both ores are consumed into the bar and never
 * regained, so the item gate alone is permanent (Chef.ts's `MakeDough`/
 * `BakeBread` pattern). The `.action('Use')` filter is load-bearing: TWO
 * "Furnace" locs share the smithing corner — the real `newbiefurnace`
 * (3078,9495, `op1=Use`) and a DECORATIVE op-less `furnace2` (3081,9496) —
 * and a name-only `nearest()` picked the decoy live (run 2's 320 stall:
 * `useOn` the decoy resolves no server trigger, 15s timeout per loop,
 * forever).
 *
 * USE-ON RANGE (run 3's 320 stall, probe-confirmed): `walkToward` can NEVER
 * converge on this loc — its snapshot tile is inside its own solid 3x3
 * footprint, and from the tin cluster the client BFS's tryNearest fallback
 * moves the player ZERO tiles (8 probe hops, distance pinned at 10), so a
 * `distance() > 5 -> walk-snap` gate loops forever. The loc-aware
 * `useItemOnLoc` click, by contrast, paths on its own: dispatched at
 * distance 10 it walked the player over and completed the smelt end-to-end
 * (bar + varp 330, live probe). So this stage dispatches `useOn` directly
 * within USE_ON_RANGE and only walk-snaps beyond it (both ore clusters are
 * within ~13 tiles of the furnace, so the walk branch is a safety net).
 */
class SmeltBronze extends StageTask {
    validate(): boolean {
        return inMine() && noDialog() && Inventory.contains('Copper ore') && Inventory.contains('Tin ore');
    }

    async execute(): Promise<void> {
        const furnace = Locs.query().name('Furnace').action('Use').within(40).nearest();
        if (!furnace) {
            return;
        }

        if (furnace.distance() > USE_ON_RANGE) {
            await walkToward(furnace.tile());
            return;
        }

        const ore = Inventory.first('Copper ore');
        if (!ore) {
            return;
        }

        await ore.useOn(furnace);
        await Execution.delayUntil(() => Inventory.contains('Bronze bar'), 15000);
    }
}

/**
 * Stage 330 -> 340: talk to Dezzick a third time for the hammer
 * (file-header note 8 — latches on the ITEM).
 */
class TalkForHammer extends StageTask {
    private done = false;

    validate(): boolean {
        return !this.done && inMine() && noDialog() && Inventory.contains('Bronze bar') && !Inventory.contains('Hammer');
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(DEZZICK).within(40).nearest();
        if (!npc) {
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        if (await Execution.delayUntil(() => Inventory.contains('Hammer'), 8000)) {
            this.done = true;
        }
    }
}

/**
 * Stage 340 -> 350: smith a bronze dagger via the Anvil's make-menu
 * (file-header note 6 — the MAIN-modal panel, not a chat make-menu). No
 * one-shot flag needed: the bar is consumed into the dagger and never
 * regained (Chef.ts's item-gated pattern). Same direct-`useOn` shape as
 * `SmeltBronze`: the anvils are solid 1x1 locs (their own tile is blocked,
 * the same `walkToward` trap), and the loc-aware use-click paths itself.
 */
class SmithDagger extends StageTask {
    validate(): boolean {
        return (noDialog() || ChatDialog.isMainMakePanel()) && inMine() && Inventory.contains('Bronze bar') && Inventory.contains('Hammer');
    }

    async execute(): Promise<void> {
        if (ChatDialog.isMainMakePanel()) {
            await ChatDialog.makeFromPanel('dagger');
            await Execution.delayUntil(() => Inventory.contains('Bronze dagger'), 10000);
            return;
        }

        const anvil = Locs.query().name('Anvil').within(40).nearest();
        if (!anvil) {
            return;
        }

        if (anvil.distance() > USE_ON_RANGE) {
            await walkToward(anvil.tile());
            return;
        }

        const bar = Inventory.first('Bronze bar');
        if (!bar) {
            return;
        }

        await bar.useOn(anvil);
        await Execution.delayUntil(() => ChatDialog.isMainMakePanel(), 8000);
    }
}

/**
 * Stage 350 -> 360: open the mining-area exit gate (file-header note 7).
 * One-shot latches on the verified crossing east of the wall line — the
 * section's terminal outcome, and (per file-header note 7) the boundary
 * that keeps this file quiet once the bot is on the Combat Instructor's
 * side.
 *
 * ALSO entry-gated on still being WEST of the line (`x <= EXIT_GATE_X`) —
 * the same jump-re-arm class as Chef's `OpenQuestGuideDoor` (Task 10
 * addendum in the map doc): a future combat-section stage-jump re-arms this
 * one-shot on a bot standing EAST of the gate with the dagger still in its
 * pack, and `[oploc1,_tut_mining_exit]` teleports across on EVERY open —
 * an unguarded re-fire would ping-pong the bot back west forever (the
 * teleport lands exactly ON the 3094/3095 boundary the latch checks). West
 * is where every real 350 run stands, so the gate costs the real flow
 * nothing.
 */
class OpenMineGate extends StageTask {
    private done = false;

    validate(): boolean {
        const t = Game.tile();
        return !this.done && inMine() && noDialog() && Inventory.contains('Bronze dagger') && t !== null && t.x <= EXIT_GATE_X;
    }

    async execute(): Promise<void> {
        const gate = Locs.query().name('Gate').action('Open').inside(EXIT_GATE_BOX).nearest();
        if (!gate) {
            return;
        }

        if (gate.distance() > 5) {
            await walkToward(gate.tile());
            return;
        }

        await gate.interact('Open');
        const crossed = await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && t.x > EXIT_GATE_X;
        }, 8000);
        if (crossed) {
            this.done = true;
        }
    }
}

/** In ladder order — `TutorialBot` runs the first whose `validate()` matches each loop. */
export function miningStages(bot: TutorialBot): Task[] {
    const progress: MiningProgress = { prospectedCopper: false, prospectedTin: false };
    return [
        new TalkMiningInstructor(bot),
        new ProspectCopper(bot, progress),
        new ProspectTin(bot, progress),
        new TalkForPickaxe(bot, progress),
        new MineCopper(bot),
        new MineTin(bot),
        new SmeltBronze(bot),
        new TalkForHammer(bot),
        new SmithDagger(bot),
        new OpenMineGate(bot)
    ];
}
