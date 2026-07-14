import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Skills } from '../../../api/hud/Skills.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { reader } from '../../../adapter/ClientAdapter.js';
import type TutorialBot from '../../TutorialBot.js';
import { StageTask } from '../StageTask.js';
import { walkToward } from './helpers.js';

/**
 * Magic section + mainland — server ladder 610 -> 1000, content
 * confirmed against `lostcity-dev/content/
 * scripts/tutorial/` (274)'s `guides/magic_instructor.rs2` +
 * `npcs/tut_chicken.rs2` + `skills/tut_player_magic.rs2` + `tutorial.rs2` +
 * `tut_chatbox_steps.rs2`: talk to the Magic Instructor (610 -> 620) ->
 * click the flashing magic tab (620 -> 630, and the click AUTO-CHAINS to
 * 640 — see note 2) -> cast Wind Strike on a caged chicken twice, a forced
 * splash then a forced success (640 -> 650 -> 660) -> talk again and accept
 * "Do you want to go to the mainland?" (660 -> 670 -> `@tutorial_complete`:
 * writes **1000**, telejumps to Lumbridge (3222,3222), replaces the pack
 * with the full starter kit).
 *
 * First consumer of `Game.castOnNpc`: the spell is a
 * BUTTON_TARGET component found by `targetBase` caption at runtime; the
 * armed cast dispatches TGT_BUTTON + TGT_NPC and the client walks/OPNPCTs
 * itself (`DirectInputDriver.castOnNpc`).
 *
 * 1. MAGIC XP IS NOT A SUCCESS SIGNAL — it lands on EVERY cast, splash
 *    included: `~tut_pvm_spell_cast` (tut_player_magic.rs2) runs
 *    `~tutorial_give_xp(magic, ...)` BEFORE the forced splash/success
 *    branch. The task brief's sketch gated the cast stage on
 *    `Skills.xp('magic') === 0`, which would stop after the splash and
 *    stall at 650 forever. The faithful per-cast confirmation is the xp
 *    INCREASING across a cast; `CastWindStrike` counts TWO confirmed casts
 *    (the content's forced splash -> forced success ladder) on a per-run
 *    `MagicProgress` — the `CombatProgress` precedent.
 * 2. THE TAB CLICK AUTO-RUNS THE RUNES DIALOGUE: the `[tutorial,_]`
 *    TUT_CLICKSIDE handler at 620 writes 630 and, if `npc_find` sees
 *    Terrova within 10, immediately runs `@newbie_magic_instructor_opened_
 *    tab` — the runes doubleobjbox (5 Air + 5 Mind) + the 630 -> 640 write,
 *    no second talk needed. The bot just talked to Terrova (adjacent), so
 *    the chain normally fires; if it misses (clicked far away), the varp
 *    sits at 630 with no runes and `TalkForRunes` self-heals (Terrova's 630
 *    case runs the same label; his 640/650 cases re-grant up to a 25-rune
 *    cap).
 * 3. Attacking the chicken is refused (`[apnpc2,newbiechicken]` mesboxes
 *    "Cast the Wind Strike spell..."), so the cast is the only path. The
 *    chickens are caged at ~(3139,3092) (hint `0_49_48_3_20`); the cast's
 *    ap-range walk handles the fence line like the ranged rat kill did.
 * 4. Completion/quieting: the mainland teleport (x 3222 >> the island's
 *    ~3070-3155) takes the bot out of `inMagicArea()` forever — every
 *    stage here position-gates on the island's south field, so nothing in
 *    this file (or any earlier section — all boxed to island geometry) can
 *    fire on the mainland. `FinishTutorial` deliberately carries NO
 *    one-shot: it must retry the final talk until the teleport is
 *    OBSERVED (its gates go false only via the teleport), and the 660/670
 *    recap cases tolerate re-talks.
 * 5. TALK OUTCOMES: `TalkTerrova` latches on the MAGIC TAB ATTACHING (the
 *    620 step proc's `if_settab(magic, ^tab_magic)` + `tut_flash`; the
 *    login script only re-attaches it while `%tutorial > 620`) — the
 *    `TalkVannaka` idiom, flag-free and relog-proof.
 */

const TERROVA = 'Magic Instructor';
const CHICKEN = 'Chicken';

/** general/configs/tabs.constant — 6 = magic (the tutorial varp ladder tab table). */
const MAGIC_TAB = 6;

/** Caged-chicken pen center (hint coord 0_49_48_3_20, probe-confirmed area). */
const CHICKEN_PEN = { x: 3139, z: 3092 };

const noDialog = () => !ChatDialog.isOpen();

/**
 * The island's south field: the chapel-exit landing (3122,3101), the path
 * east, the wizard's yard and the chicken cage. Excludes every earlier
 * section's geometry (bank/chapel z >= 3103; chef house x <= 3078; the
 * survival clearing x <= 3110 sits north of z 3088... its overlap is
 * excluded by x >= 3118) and the mainland (x 3222 > 3155).
 */
const inMagicArea = (): boolean => {
    const t = Game.tile();
    return t !== null && t.x >= 3118 && t.x <= 3155 && t.z >= 3076 && t.z <= 3102;
};

const hasRunes = () => Inventory.contains('Air rune') && Inventory.contains('Mind rune');

/** Per-run cast confirmations (file-header note 1) — never module-level. */
interface MagicProgress {
    casts: number;
}

/**
 * Stage 610 -> 620: talk to the Magic Instructor. Completion observable =
 * the magic tab attaching (file-header note 5). Walk-snaps the ~20 tiles
 * from the chapel exit first (talk-approach only paths a few unobstructed
 * tiles under the NAIVE routefinder).
 */
class TalkTerrova extends StageTask {
    validate(): boolean {
        return noDialog() && inMagicArea() && reader.sideTabInterface(MAGIC_TAB) === -1;
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(TERROVA).within(40).nearest();
        if (!npc) {
            await walkToward({ x: 3141, z: 3089 });
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => reader.sideTabInterface(MAGIC_TAB) !== -1, 8000);
    }
}

/**
 * Stage 620 -> 630 (-> 640 via the auto-chain, note 2): click the flashing
 * Magic tab. One-shot, the standard flashing-tab idiom.
 */
class OpenMagicTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && inMagicArea() && reader.sideTabInterface(MAGIC_TAB) !== -1 && reader.activeSideTab() !== MAGIC_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(MAGIC_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

/**
 * Self-heal for a missed auto-chain (630 with no runes) and rune restocks:
 * talk to Terrova — his 630 case grants the runes + writes 640; 640/650
 * re-grant lost runes up to the 25 cap (note 2). Quiet once both casts are
 * confirmed; on a fresh instance past 660 this talk IS the finisher (his
 * 660/default case runs the mainland prompt), which `FinishTutorial` also
 * covers.
 */
class TalkForRunes extends StageTask {
    constructor(
        bot: TutorialBot,
        private readonly progress: MagicProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return this.progress.casts < 2 && noDialog() && inMagicArea() && reader.sideTabInterface(MAGIC_TAB) !== -1 && !hasRunes();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(TERROVA).within(40).nearest();
        if (!npc) {
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => hasRunes(), 8000);
    }
}

/**
 * Stages 640 -> 650 -> 660: cast Wind Strike at a caged chicken until TWO
 * casts are confirmed — the content forces splash then success (file-header
 * note 1); each cast is confirmed by the xp increase that lands splash or
 * not. Waits out `Game.inCombat()` between casts (the successful hit can
 * briefly flag combat).
 */
class CastWindStrike extends StageTask {
    constructor(
        bot: TutorialBot,
        private readonly progress: MagicProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return this.progress.casts < 2 && noDialog() && inMagicArea() && hasRunes() && !Game.inCombat();
    }

    async execute(): Promise<void> {
        const chicken = Npcs.query().name(CHICKEN).within(20).nearest();
        if (!chicken) {
            await walkToward(CHICKEN_PEN);
            return;
        }

        if (chicken.distance() > 10) {
            await walkToward(chicken.tile());
            return;
        }

        const before = Skills.xp('magic');
        if (!(await Game.castOnNpc('Wind Strike', chicken))) {
            return;
        }

        const confirmed = await Execution.delayUntil(() => Skills.xp('magic') > before, 10000);
        if (confirmed) {
            this.progress.casts += 1;
        }
    }
}

/**
 * Stages 660 -> 670 -> 1000: the final talk. Terrova's success case writes
 * 670 and opens the mainland multi2 ("Yes." / "No.") — `AdvanceDialog`'s
 * MOVE_ON `'yes.'` accepts it, and `@tutorial_complete` writes 1000 +
 * telejumps to Lumbridge with the starter kit. No one-shot (note 4): the
 * teleport itself is the terminal outcome, and every gate here goes false
 * with it.
 */
class FinishTutorial extends StageTask {
    constructor(
        bot: TutorialBot,
        private readonly progress: MagicProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return this.progress.casts >= 2 && noDialog() && inMagicArea();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(TERROVA).within(40).nearest();
        if (!npc) {
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => ChatDialog.isOpen(), 8000);
    }
}

/**
 * In ladder order — `TutorialBot` runs the first whose `validate()` matches
 * each loop. `progress` is fresh per call (once per script start, never
 * module-level — file-header note 1).
 */
export function magicStages(bot: TutorialBot): Task[] {
    const progress: MagicProgress = { casts: 0 };
    return [new TalkTerrova(bot), new OpenMagicTab(bot), new TalkForRunes(bot, progress), new CastWindStrike(bot, progress), new FinishTutorial(bot, progress)];
}
