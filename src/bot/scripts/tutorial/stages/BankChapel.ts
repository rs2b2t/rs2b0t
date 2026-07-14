import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Bank } from '../../../api/hud/Bank.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Skills } from '../../../api/hud/Skills.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { actions, reader } from '../../../adapter/ClientAdapter.js';
import type TutorialBot from '../../TutorialBot.js';
import { StageTask } from '../StageTask.js';
import { doorAt, MINE_Z, walkToward } from './helpers.js';

/**
 * Bank & chapel section — server ladder 500 -> 610,
 * content confirmed against `lostcity-dev/content/scripts/tutorial/` (274)'s
 * `locs/tut_bank_booth.rs2` + `npcs/tut_banker.rs2` +
 * `guides/financial_advisor.rs2` + `guides/brother_brace.rs2` +
 * `tut_doors_and_gates.rs2` + `tut_chatbox_steps.rs2` + `tutorial.rs2`,
 * geometry pinned from the packed map (`tools/nav/probe-locs.ts`): use a
 * bank booth -> Banker prompt -> "Yes." opens the bank (500 -> 510, 25
 * coins `inv_add`ed to the BANK inv) -> close it and open `newbie_door6`
 * (510 -> 520) -> talk to the Financial Advisor (520 -> 530) -> open
 * `newbie_door7` (530 -> 540) -> walk south and enter the chapel through
 * its (ungated) Large doors -> talk to Brother Brace (540 -> 550) -> click
 * the flashing Prayer tab (550 -> 560) -> talk (560 -> 570) -> click the
 * flashing Friends tab (570 -> 580) -> click the flashing Ignore tab
 * (580 -> 590) -> talk (590 -> 600) -> exit through `newbie_door8`
 * (600 -> 610).
 *
 * Follows the Combat.ts shape: observable `validate()` -> one idempotent
 * `execute()`; one-shots latch only on VERIFIED outcomes; flag-carried
 * transitions ride a per-run `BankChapelProgress` (never module-level).
 *
 * 1. THE BANKER PROMPT IS ANSWERED BY `AdvanceDialog`, NOT HERE: the booth's
 *    `[oploc1,newbiebankbooth]` finds the Banker within 2 and runs his
 *    "would you like to access your bank account?" multi2 ("Yes." /
 *    "No thanks."). `Dialog.ts`'s `DECLINE_SKIP` was rescoped to the
 *    skip-prompt's exact label — 'no thanks' was in that list and matched
 *    the banker's decline FIRST, which would have refused the bank forever
 *    (`MOVE_ON`'s existing 'yes.' now picks "Yes.", writing 500 -> 510 and
 *    opening the bank). `UseBankBooth` itself just clicks the booth and
 *    latches `progress.bankOpened` on the OBSERVED `Bank.isOpen()`.
 * 2. If the Banker is transiently missing (`npc_find` radius 2 from the
 *    clicked booth), the booth falls through to a bare `@openbank` WITHOUT
 *    advancing 500 -> 510 — the bank then opens with the varp still at 500
 *    and `newbie_door6` mesboxes ("You need to open your bank first.").
 *    `OpenAdvisorDoor` detects exactly that (open dispatched, no crossing,
 *    a chat modal up) and re-arms `progress.bankOpened` so the booth is
 *    re-used; same self-heal shape on `ExitAdvisorRoom`/`ExitChapel`, whose
 *    doors mesbox below their rungs too.
 * 3. GEOMETRY (probe-locs, mapsquare 48,48): booths `newbiebankbooth` id
 *    3045, display "Bank booth", `op1=Use`, SOLID 1x1 at (3120,3124) +
 *    (3122,3124); `newbie_door6` id 3024 "Door" (3125,3124) angle 0 (west
 *    edge — bank side x <= 3124, advisor side x >= 3125); `newbie_door7`
 *    id 3025 "Door" (3130,3124) angle 0 (advisor room x 3125-3129, outside
 *    x >= 3130); chapel entrance = generic "Large door" pair loc_1516/1519
 *    (3129,3106)/(3129,3107) angle 0 (interior x <= 3128) — ungated, but
 *    unlike every `newbie_door*` the open does NOT teleport through (see
 *    `EnterChapel`); `newbie_door8` id 3026 "Door" (3122,3102) angle 1
 *    (north edge — chapel side z >= 3103, outside z <= 3102). The 540 walk
 *    from door7 must swing EAST around a fence that hangs off the advisor
 *    building's SE corner and runs diagonally down to the chapel's NE
 *    corner ((3132,3119) -> (3129,3111), probe-locs) — MOVE_GAMECLICK's
 *    BFS handles it (live-probed: 6 hops, (3130,3124) -> (3129,3106)), no
 *    waypoints needed. DECOYS pinned out by
 *    tile-box: plain doors at (3124,3126) + (3118,3124) sit right beside
 *    `newbie_door6`, and the bank's own south entrance is a "Large door"
 *    pair at (3121,3119)/(3122,3119) (already open — op "Close" — so the
 *    `.action('Open')` filter also excludes it).
 * 4. TALK OUTCOMES, in the established order of preference: `TalkBrace`
 *    latches on the PRAYER TAB ATTACHING (the 550 step proc's
 *    `if_settab(prayer, ^tab_prayer)` + `tut_flash`; the login script only
 *    re-attaches it while `%tutorial > 550` — the `TalkVannaka` idiom, no
 *    flag needed, relog-proof); `TalkBrace2` likewise latches on the
 *    FRIENDS tab attach (570 step proc, login re-attach only > 570). The
 *    Advisor talk (520 -> 530) and the last Brace talk (590 -> 600) have NO
 *    independent client observable (no item/xp/tab change) — they thread
 *    per-run flags to their door stages, exactly like QuestGuide's
 *    `talkedAgain` (worst case after a mid-section restart: a re-talk hits
 *    the guide's recap prompt, which the content tolerates and
 *    `AdvanceDialog` terminates — "No thanks." / "Nope, I'm ready to move
 *    on!" both end recaps).
 * 5. THE CHAPEL TABS: prayer 5 / friends 8 / ignore 9
 *    (general/configs/tabs.constant). The `[tutorial,_]` TUT_CLICKSIDE
 *    handler advances 550 -> 560 / 570 -> 580 / 580 -> 590 on the flashed
 *    tab's click itself; each click stage is a one-shot (`OpenWornTab`
 *    idiom). The ignore tab attaches at 580 (the friends CLICK's step
 *    proc), so `sideTabInterface(9) !== -1` is a faithful 580 signal.
 * 6. SECTION-ERA GATE: every stage requires `pastCombat()` — ranged xp > 0
 *    (first lands 460 -> 470, permanent, and zero through every earlier
 *    section) AND on the surface (`z < MINE_Z`, false during the fight
 *    itself). Position boxes then keep each stage in its own room: nothing
 *    here can fire pre-500, underground, or (post-610) south of the chapel
 *    — the exit crossing (z <= 3102) leaves every box, and the one-shots/
 *    attach gates are all latched by then anyway.
 * 7. The 500-jump hazard this task's test exposed lives in the EARLIER
 *    sections, fixed there: a fresh script instance at 500
 *    re-armed Chef's `OpenQuestGuideDoor` + the whole QuestGuide chain,
 *    whose `ClimbToMine` would drag a >= 500 account back down the mine and
 *    strand it (the combat chain can't re-run at 500 — the rat-pen gate
 *    refuses). Those stages now carry a `Skills.xp('mining') === 0` era
 *    gate (false from 294 onward, true throughout their real 130-260
 *    window), so the bankchapel-test kit grants mining/smithing xp.
 */

const ADVISOR = 'Financial Advisor';
const BRACE = 'Brother Brace';

/** general/configs/tabs.constant — verified live. */
const PRAYER_TAB = 5;
const FRIENDS_TAB = 8;
const IGNORE_TAB = 9;

/** Booth pair (3120,3124)/(3122,3124) — file-header note 3. */
const BOOTH_BOX = { minX: 3119, maxX: 3123, minZ: 3123, maxZ: 3125 };
const ADVISOR_DOOR = { x: 3125, z: 3124 }; // newbie_door6
const ADVISOR_EXIT_DOOR = { x: 3130, z: 3124 }; // newbie_door7
/** Chapel entrance "Large door" pair (3129,3106)/(3129,3107) — note 3. */
const CHAPEL_DOOR_BOX = { minX: 3127, maxX: 3131, minZ: 3104, maxZ: 3109 };
/** Walk-through target once the doors are open: Brace's corner, well past
 *  the doorway tile (the open does NOT teleport — see `EnterChapel`). */
const CHAPEL_INSIDE = { x: 3125, z: 3106 };
const CHAPEL_EXIT_DOOR = { x: 3122, z: 3102 }; // newbie_door8

/** Advisor room: between door6's wall line (x=3125) and door7's (x=3129 inside edge). */
const ADVISOR_ROOM = { minX: 3125, maxX: 3129, minZ: 3120, maxZ: 3128 };
/** Chapel interior (altar (3121,3106), Brace ~(3125,3106); door8's wall line is z=3103's south edge). */
const CHAPEL = { minX: 3118, maxX: 3128, minZ: 3103, maxZ: 3111 };

/** Loc-aware clicks path themselves from ~this range (Mining.ts's `USE_ON_RANGE` finding). */
const CLICK_RANGE = 12;

const noDialog = () => !ChatDialog.isOpen();

const inBox = (box: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean => {
    const t = Game.tile();
    return t !== null && t.x >= box.minX && t.x <= box.maxX && t.z >= box.minZ && t.z <= box.maxZ;
};

/**
 * Section-era gate (file-header note 6): ranged xp is permanent from the
 * combat section's 460 -> 470 kill and zero before it; the surface check
 * keeps the section quiet during that underground fight itself.
 */
const pastCombat = (): boolean => {
    const t = Game.tile();
    return t !== null && t.z < MINE_Z && Skills.xp('ranged') > 0;
};

/** West of `newbie_door6`'s wall line, on the bank's side of the island — the
 *  500 -> 510 leg (ladder landing (3111,3125) through the booth row z=3124).
 *  False in the advisor room (x >= 3125), the chapel (z <= 3111) and beyond. */
const preAdvisorArea = (): boolean => {
    const t = Game.tile();
    return t !== null && t.x <= 3124 && t.z >= 3112;
};

/** The field east of door7 leading south to the chapel doors — the 540 leg.
 *  False west of the chapel-door wall line and south of the chapel itself;
 *  wide enough east (x 3140) that no detour snap-hop can exit it. */
const chapelApproach = (): boolean => {
    const t = Game.tile();
    return t !== null && t.x >= 3129 && t.x <= 3140 && t.z >= 3103 && t.z <= 3126;
};

const inAdvisorRoom = () => inBox(ADVISOR_ROOM);
const insideChapel = () => inBox(CHAPEL);

/**
 * Flag-carried transitions (file-header notes 2/4) — built fresh per
 * `bankChapelStages()` call, never module-level (the `QuestGuideProgress`
 * precedent: module state would leak a stale `true` across a script
 * stop/restart in the same page).
 */
interface BankChapelProgress {
    /** Bank observed open (the booth leg's outcome); re-armed by note 2's self-heal. */
    bankOpened: boolean;
    /** Advisor dialogue observed open; re-armed if door7 mesboxes (note 2). */
    advisorTalked: boolean;
    /** Final Brace dialogue observed open; re-armed if door8 mesboxes (note 2). */
    braceFinished: boolean;
}

/**
 * Stage 500 -> 510: use a bank booth; the Banker's "Yes." (picked by
 * `AdvanceDialog` — file-header note 1) opens the bank and writes 510.
 * Latches `progress.bankOpened` only on the OBSERVED open. The booth is a
 * solid 1x1 loc: dispatch the loc-aware click within `CLICK_RANGE` and
 * walk-snap only beyond it (the furnace lesson — never require
 * `walkToward` to converge onto a solid loc's own tile).
 */
class UseBankBooth extends StageTask {
    constructor(
        bot: TutorialBot,
        private readonly progress: BankChapelProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.progress.bankOpened && noDialog() && pastCombat() && preAdvisorArea();
    }

    async execute(): Promise<void> {
        if (Bank.isOpen()) {
            this.progress.bankOpened = true;
            return;
        }

        const booth = Locs.query().name('Bank booth').action('Use').inside(BOOTH_BOX).nearest();
        if (!booth) {
            await walkToward({ x: 3121, z: 3123 });
            return;
        }

        if (booth.distance() > CLICK_RANGE) {
            await walkToward(booth.tile());
            return;
        }

        await booth.interact('Use');
        await Execution.delayUntil(() => ChatDialog.isOpen() || Bank.isOpen(), 8000);
        if (Bank.isOpen()) {
            this.progress.bankOpened = true;
        }
    }
}

/**
 * Close the bank whenever it is open (it re-opens on any later booth use
 * too). Runs before the door stage each loop, so the door click never fights
 * the modal; `actions.closeModal()` sends the real CLOSE_MODAL packet so the
 * server's `[if_close]` runs (the shop-close rationale, ClientAdapter.ts).
 * Also latches `bankOpened` — it can be the first observer when the open
 * happened during `AdvanceDialog`'s turn.
 */
class CloseBank extends StageTask {
    constructor(
        bot: TutorialBot,
        private readonly progress: BankChapelProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return Bank.isOpen() && pastCombat();
    }

    async execute(): Promise<void> {
        this.progress.bankOpened = true;
        actions.closeModal();
        await Execution.delayUntil(() => !Bank.isOpen(), 3000);
    }
}

/**
 * Stage 510 -> 520: open `newbie_door6` (3125,3124). The open teleports
 * through (all tutorial doors); the one-shot latches on the observed
 * crossing to the advisor side (x >= 3125). If the door mesboxes instead —
 * the bank opened without the Banker prompt, varp still 500 (file-header
 * note 2) — re-arm the booth stage.
 */
class OpenAdvisorDoor extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: BankChapelProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && this.progress.bankOpened && !Bank.isOpen() && noDialog() && pastCombat() && preAdvisorArea();
    }

    async execute(): Promise<void> {
        const door = doorAt(ADVISOR_DOOR).nearest();
        if (!door) {
            await walkToward(ADVISOR_DOOR);
            return;
        }

        if (door.distance() > CLICK_RANGE) {
            await walkToward(door.tile());
            return;
        }

        await door.interact('Open');
        const crossed = await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && t.x >= ADVISOR_DOOR.x;
        }, 5000);
        if (crossed) {
            this.done = true;
        } else if (ChatDialog.isOpen()) {
            this.progress.bankOpened = false;
        }
    }
}

/**
 * Stage 520 -> 530: talk to the Financial Advisor. The 530 write happens at
 * the END of his money-making speech (`AdvanceDialog` clicks the pages) and
 * leaves NO independent client observable (file-header note 4) — the
 * one-shot latches on dialogue-open and threads `advisorTalked` to the exit
 * door, which re-arms it if the door proves the talk didn't finish.
 */
class TalkAdvisor extends StageTask {
    private talked = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: BankChapelProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.talked && !this.progress.advisorTalked && noDialog() && pastCombat() && inAdvisorRoom() && Npcs.query().name(ADVISOR).within(8).exists();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(ADVISOR).nearest();
        if (!npc) {
            return;
        }

        await npc.interact('Talk-to');
        if (await Execution.delayUntil(() => ChatDialog.isOpen(), 8000)) {
            this.talked = true;
            this.progress.advisorTalked = true;
        }
    }
}

/**
 * Stage 530 -> 540: open `newbie_door7` (3130,3124) out of the advisor
 * room. One-shot latches on the observed crossing east (x >= 3130); a
 * mesbox ("talk to the Financial Advisor before...") means the advisor
 * speech didn't complete — re-arm the talk (file-header note 2). The
 * `talked` one-shot on `TalkAdvisor` stays latched; only the shared flag
 * re-arms, so a genuinely-interrupted talk retries via a fresh recap.
 */
class ExitAdvisorRoom extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: BankChapelProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && this.progress.advisorTalked && noDialog() && pastCombat() && inAdvisorRoom();
    }

    async execute(): Promise<void> {
        const door = doorAt(ADVISOR_EXIT_DOOR).nearest();
        if (!door) {
            await walkToward(ADVISOR_EXIT_DOOR);
            return;
        }

        if (door.distance() > CLICK_RANGE) {
            await walkToward(door.tile());
            return;
        }

        await door.interact('Open');
        const crossed = await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && t.x >= ADVISOR_EXIT_DOOR.x;
        }, 5000);
        if (crossed) {
            this.done = true;
        } else if (ChatDialog.isOpen()) {
            this.progress.advisorTalked = false;
        }
    }
}

/**
 * The 540 leg's un-varped middle step: walk the field south from door7 and
 * enter the chapel through its Large doors. THESE ARE NOT `newbie_door*`
 * DOORS — live-probed: opening them does NOT teleport the player
 * through. The open swings the pair to their open-state locs (hosted one
 * tile WEST at x=3128, op "Close" only) and they stay open for 14s+; the
 * player is left standing on/next to the doorway tile (x=3129) — still
 * OUTSIDE. The first cut of this stage walked to the door's own tile when no
 * closed door matched the query and therefore parked the bot at
 * (3129,3106) — one tile short of `insideChapel()` — forever (the first
 * bankchapel-test run's 540 stall). So: closed door in the box -> approach
 * + click it; no closed door (= the pair is open) -> walk THROUGH the
 * doorway to Brace's corner. Each loop does one step; a mid-walk re-close
 * self-heals via the click branch re-arming.
 *
 * No one-shot flag: `chapelApproach()` is false inside the chapel (x <=
 * 3128), south of it after the 610 exit (z <= 3102), and everywhere the
 * magic section goes (z < 3103) — the position gates fully own quieting,
 * and a flag here could never latch anyway (validate() goes false the
 * moment the walk-through succeeds).
 */
class EnterChapel extends StageTask {
    validate(): boolean {
        return noDialog() && pastCombat() && chapelApproach();
    }

    async execute(): Promise<void> {
        const door = Locs.query().name('Large door').action('Open').inside(CHAPEL_DOOR_BOX).nearest();
        if (!door) {
            await walkToward(CHAPEL_INSIDE);
            return;
        }

        if (door.distance() > CLICK_RANGE) {
            await walkToward(door.tile());
            return;
        }

        await door.interact('Open');
        await Execution.delayTicks(4);
    }
}

/**
 * Stage 540 -> 550: talk to Brother Brace. Completion observable = the
 * PRAYER TAB ATTACHING (the 550 step proc; login re-attach only > 550 —
 * file-header note 4, the `TalkVannaka` idiom): no flag, relog-proof.
 */
class TalkBrace extends StageTask {
    validate(): boolean {
        return noDialog() && pastCombat() && insideChapel() && reader.sideTabInterface(PRAYER_TAB) === -1 && Npcs.query().name(BRACE).within(10).exists();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(BRACE).nearest();
        if (!npc) {
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => reader.sideTabInterface(PRAYER_TAB) !== -1, 8000);
    }
}

/**
 * Stage 550 -> 560: click the flashing Prayer tab (TUT_CLICKSIDE advances
 * the varp on the click — file-header note 5). One-shot, `OpenWornTab`
 * idiom.
 */
class OpenPrayerTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && pastCombat() && insideChapel() && reader.sideTabInterface(PRAYER_TAB) !== -1 && reader.activeSideTab() !== PRAYER_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(PRAYER_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

/**
 * Stage 560 -> 570: talk to Brace about the prayer list. Completion
 * observable = the FRIENDS tab attaching (570 step proc; login re-attach
 * only > 570 — file-header note 4). A mistimed talk at exactly 550 (before
 * the prayer click, which `OpenPrayerTab` — earlier in the array — normally
 * wins) just gets the "open the indicated menu" reminder and self-heals.
 */
class TalkBrace2 extends StageTask {
    validate(): boolean {
        return (
            noDialog() &&
            pastCombat() &&
            insideChapel() &&
            reader.sideTabInterface(PRAYER_TAB) !== -1 &&
            reader.sideTabInterface(FRIENDS_TAB) === -1 &&
            Npcs.query().name(BRACE).within(10).exists()
        );
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(BRACE).nearest();
        if (!npc) {
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => reader.sideTabInterface(FRIENDS_TAB) !== -1, 8000);
    }
}

/** Stage 570 -> 580: click the flashing Friends tab. One-shot (note 5). */
class OpenFriendsTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && pastCombat() && insideChapel() && reader.sideTabInterface(FRIENDS_TAB) !== -1 && reader.activeSideTab() !== FRIENDS_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(FRIENDS_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

/**
 * Stage 580 -> 590: click the flashing Ignore tab (attached by the friends
 * CLICK's own step proc — its presence is a faithful 580 signal, note 5).
 * One-shot.
 */
class OpenIgnoreTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && pastCombat() && insideChapel() && reader.sideTabInterface(IGNORE_TAB) !== -1 && reader.activeSideTab() !== IGNORE_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(IGNORE_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

/**
 * Stage 590 -> 600: the final Brace talk (friends/ignore speech). The 600
 * write lands at the END of the speech with NO client observable
 * (file-header note 4) — one-shot on dialogue-open, `braceFinished`
 * threaded to the exit door (which re-arms it on a mesbox).
 */
class TalkBrace3 extends StageTask {
    private talked = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: BankChapelProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return (
            !this.talked &&
            !this.progress.braceFinished &&
            noDialog() &&
            pastCombat() &&
            insideChapel() &&
            reader.sideTabInterface(IGNORE_TAB) !== -1 &&
            Npcs.query().name(BRACE).within(10).exists()
        );
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(BRACE).nearest();
        if (!npc) {
            return;
        }

        await npc.interact('Talk-to');
        if (await Execution.delayUntil(() => ChatDialog.isOpen(), 8000)) {
            this.talked = true;
            this.progress.braceFinished = true;
        }
    }
}

/**
 * Stage 600 -> 610: exit the chapel through `newbie_door8` (3122,3102) —
 * the section's terminal outcome. One-shot latches on the observed crossing
 * south (z <= 3102); a mesbox ("finish Brother Brace's tasks first") means
 * the final speech didn't complete — re-arm it (file-header note 2; the
 * re-talk lands on Brace's recap, which `AdvanceDialog` terminates via its
 * "ready to move on" match).
 */
class ExitChapel extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: BankChapelProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && this.progress.braceFinished && noDialog() && pastCombat() && insideChapel();
    }

    async execute(): Promise<void> {
        const door = doorAt(CHAPEL_EXIT_DOOR).nearest();
        if (!door) {
            await walkToward(CHAPEL_EXIT_DOOR);
            return;
        }

        if (door.distance() > CLICK_RANGE) {
            await walkToward(door.tile());
            return;
        }

        await door.interact('Open');
        const crossed = await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && t.z <= CHAPEL_EXIT_DOOR.z;
        }, 5000);
        if (crossed) {
            this.done = true;
        } else if (ChatDialog.isOpen()) {
            this.progress.braceFinished = false;
        }
    }
}

/**
 * In ladder order — `TutorialBot` runs the first whose `validate()` matches
 * each loop. `progress` is fresh per call (once per script start, never
 * module-level).
 */
export function bankChapelStages(bot: TutorialBot): Task[] {
    const progress: BankChapelProgress = { bankOpened: false, advisorTalked: false, braceFinished: false };
    return [
        new UseBankBooth(bot, progress),
        new CloseBank(bot, progress),
        new OpenAdvisorDoor(bot, progress),
        new TalkAdvisor(bot, progress),
        new ExitAdvisorRoom(bot, progress),
        new EnterChapel(bot),
        new TalkBrace(bot),
        new OpenPrayerTab(bot),
        new TalkBrace2(bot),
        new OpenFriendsTab(bot),
        new OpenIgnoreTab(bot),
        new TalkBrace3(bot, progress),
        new ExitChapel(bot, progress)
    ];
}
