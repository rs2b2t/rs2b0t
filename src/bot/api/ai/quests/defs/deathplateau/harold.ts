import { actions, reader, type ModalButton } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import Tile from '../../../../../geometry/Tile.js';
import { driveBoxes, driveUntil, promptLoc } from '../../exec/prompts.js';
import { driveDialog, openDialogue, type NpcStop } from '../../exec/primitives.js';
import { DEATH_DICE_MAIN, DEATH_ITEM, HAROLD_DOOR, HAROLD_PURSE_START, MAX_BET } from './areas.js';
import { talkAt, walkTo } from './nav.js';

const held = (id: number): number =>
    Inventory.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);

const coins = (): number => Inventory.count('Coins');

const combinationFound = (): boolean =>
    held(DEATH_ITEM.IOU.id) > 0 || held(DEATH_ITEM.COMBINATION.id) > 0;

// Why: the room is an L, x2905..2906 for z3536..3539 widening to x2907 for z3540..3542, and the room east of it opens onto the corridor with no door.
// Why: a bounding box that swallowed the east room called a stop 2 tiles east of Harold "arrived", with a wall between him and the talk.

/** Harold's bedroom, which the door at (2906,3543) is the only way into. */
export function insideHaroldRoom(tile: { x: number; z: number; level: number } | null | undefined): boolean {
    if (!tile || tile.level !== 1 || tile.x < 2905 || tile.z < 3536 || tile.z > 3542) {
        return false;
    }
    return tile.z >= 3540 ? tile.x <= 2907 : tile.x <= 2906;
}

// Why: `death_harold_door` picks which half of its script to run with `~check_axis`, which for a south-facing wall compares your z with the door's and nothing else.
// Why: clicked from z3544 it takes the leaving branch and teleports you onto the door tile without knocking, so the stand is the door's own tile.

/** Knock, wait for "Come in!", and be teleported into the bedroom. */
export async function enterHaroldRoom(log: (m: string) => void): Promise<boolean> {
    if (insideHaroldRoom(Game.tile())) {
        return true;
    }
    const stand = new Tile(HAROLD_DOOR.x, HAROLD_DOOR.z, HAROLD_DOOR.level);
    if (!(await walkTo(stand, 0, log)) && !insideHaroldRoom(Game.tile())) {
        log(`could not stand on Harold's door tile (${stand.x},${stand.z})`);
        return false;
    }
    if (insideHaroldRoom(Game.tile())) {
        return true;
    }
    await promptLoc({
        name: 'Door',
        op: 'Open',
        id: HAROLD_DOOR.id,
        near: stand,
        within: 6,
        expect: () => insideHaroldRoom(Game.tile()),
        expectMs: 25_000
    }, log);
    // Why: `Reach` reports 'retry' on a crossing that landed, because the teleport happens after its own wait, so your tile is the only oracle.
    if (insideHaroldRoom(Game.tile())) {
        return true;
    }
    log(`still outside Harold's room at ${Game.tile()}`);
    return false;
}

/** Enter the bedroom, then run one of Harold's conversations from inside it. */
export async function talkInHaroldRoom(stop: NpcStop, log: (m: string) => void): Promise<boolean> {
    if (!(await enterHaroldRoom(log))) {
        return false;
    }
    return talkAt(stop, log);
}

// the ale

const ALE_MS = 45_000;

/** Hand Harold the Asgarnian ale his `harold_drink` branch asks for. */
export async function giveAleToHarold(log: (m: string) => void): Promise<boolean> {
    if (held(DEATH_ITEM.ASGARNIAN_ALE.id) === 0) {
        log('no Asgarnian ale in the pack to give Harold');
        return false;
    }
    if (!(await enterHaroldRoom(log))) {
        return false;
    }
    if (!(await openDialogue('Harold', log))) {
        return false;
    }
    const drunk = (): boolean => held(DEATH_ITEM.ASGARNIAN_ALE.id) === 0;
    // Why: the branch ends on the 3-way menu that offers the gamble, so the drive stops when the ale leaves the pack.
    if (!(await driveUntil(drunk, ['Can I buy you a drink?'], log, ALE_MS))) {
        log('Harold never took the ale');
        return false;
    }
    // Why: the branch signs off on the menu, and a menu left standing is a chat modal the next step's clicks get dropped behind.
    await driveDialog(['Can I buy you a drink?'], log);
    return true;
}

// the dice

const diceOpen = (): boolean => reader.modals().main === DEATH_DICE_MAIN;

// Why: the live harness surfaces a bounded number of log lines per poll, so one line per button would only ever show the last.

/** Every button the panel is showing, on one line. */
const diceState = (): string =>
    reader.modalButtons(DEATH_DICE_MAIN)
        .map(b => `${b.comId}:${b.label || b.menu}${b.pause ? ' pause' : ''}${b.hidden ? ' hidden' : ''}`)
        .join(', ');

// Why: `com_28` is `buttontype=normal` and `com_30` is `buttontype=pause`, and both pack ids are the server's own, so match on label and pause flag.
const rollButton = (): ModalButton | null =>
    reader.modalButtons(DEATH_DICE_MAIN).find(b => !b.pause && b.label.toLowerCase().startsWith('roll dice')) ?? null;
const continueButton = (): ModalButton | null =>
    reader.modalButtons(DEATH_DICE_MAIN).find(b => b.pause) ?? null;

/** How long Harold's own 2 dice may take. `harold_roll` spends 3 `p_delay(2)` before it unhides anything. */
const ROLL_ARMED_MS = 20_000;
const PRESS_MS = 3_000;
const SETTLE_MS = 30_000;

type RoundResult = 'win' | 'loss' | 'iou' | 'abort';

// Why: `death_dice` is on the engine's do-not-auto-close list, so a round that bails with it up leaves a main modal nothing shuts and the next round can't talk past it.

/** Shut the dice interface if a round left it open. */
export async function closeDiceIfOpen(log: (m: string) => void): Promise<void> {
    if (!diceOpen()) {
        return;
    }
    // Why: `Player.closeModal` drops a script suspended on `p_pausebutton`, so the close both clears the screen and frees Harold for the next round.
    actions.closeModal();
    if (!(await Execution.delayUntil(() => !diceOpen(), 3000))) {
        log('Harold gamble: the dice interface would not close');
    }
}

// Why: the client sends one RESUME_PAUSEBUTTON per interface open and silently refuses later presses, and `Player.runScript` silently drops an `if_button` that arrives while Harold is still delayed.
// Why: each press waits for its layer to be unhidden, the same `if_sethide` the script arms the button with.

async function pressWhenArmed(
    find: () => ModalButton | null,
    press: (comId: number) => boolean,
    landed: () => boolean,
    what: string,
    log: (m: string) => void
): Promise<boolean> {
    if (!(await Execution.delayUntil(() => find()?.hidden === false, ROLL_ARMED_MS))) {
        log(`Harold gamble: the ${what} button never came out of hiding; panel shows [${diceState()}]`);
        return false;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
        const button = find();
        if (!button || button.hidden) {
            return landed();
        }
        press(button.comId);
        if (await Execution.delayUntil(landed, PRESS_MS)) {
            return true;
        }
    }
    log(`Harold gamble: three presses on ${what} changed nothing`);
    return false;
}

// Why: the settle queue speaks in bursts, a line then an objbox page with a tick of nothing between, so one quiet poll proves nothing.

/** Click away everything `haroldgamble_end` says after the interface closes. */
async function drainRoundTail(log: (m: string) => void): Promise<void> {
    const busy = (): boolean => ChatDialog.isOpen() || ChatDialog.canContinue() || Modals.isOpen();
    const deadline = performance.now() + SETTLE_MS;
    let quiet = 0;
    while (performance.now() < deadline && quiet < 4) {
        // Why: a menu means the queue is done and Harold has started a fresh conversation.
        if (ChatDialog.options().length > 0) {
            return;
        }
        if (busy()) {
            quiet = 0;
            await driveBoxes(() => !busy(), SETTLE_MS, [], log);
            continue;
        }
        quiet++;
        await Execution.delayTicks(1);
    }
}

/** One round: answer the bet, wait out Harold's roll, roll, and take the verdict. */
async function playRound(bet: number, log: (m: string) => void): Promise<RoundResult> {
    if (!(await openDialogue('Harold', log))) {
        return 'abort';
    }
    // Why: `harold_gamble` runs `if_close` before `p_countdialog`, so the chat closing is a step in the chain.
    if (!(await driveUntil(() => reader.countDialogOpen() || diceOpen(), ['Would you like to gamble?'], log, 30_000))) {
        log('Harold gamble: the gamble option never led to the bet prompt');
        return 'abort';
    }
    if (reader.countDialogOpen()) {
        if (!actions.answerCountDialog(bet)) {
            log(`Harold gamble: the client refused to enter a bet of ${bet}`);
            return 'abort';
        }
        await Execution.delayUntil(() => !reader.countDialogOpen(), 3_000);
    }
    const mark = GameMessages.mark();
    // Why: 2 `~chatnpc` pages stand between the bet and `if_openmain`, and a refused bet answers in one of them instead.
    if (!(await driveUntil(diceOpen, [], log, 20_000))) {
        const said = GameMessages.since(mark).map(line => line.text).join(' / ');
        log(`Harold gamble: a bet of ${bet} never opened the dice${said ? `; ${said}` : ''}`);
        return 'abort';
    }
    const before = coins();
    if (!(await pressWhenArmed(rollButton, actions.ifButton, () => rollButton()?.hidden !== false, 'Roll Dice', log))) {
        return 'abort';
    }
    if (!(await Execution.delayUntil(() => continueButton()?.hidden === false, ROLL_ARMED_MS))) {
        log(`Harold gamble: the roll landed but no verdict came; panel shows [${diceState()}]`);
        return 'abort';
    }
    // Why: `player_roll` writes the verdict into the panel before it unhides the Continue layer, and pressing Continue removes the panel.
    const won = reader.mainModalTexts().some(text => /you win/i.test(text));
    if (!(await pressWhenArmed(continueButton, actions.pauseButton, () => !diceOpen(), 'Continue', log))) {
        return 'abort';
    }
    await drainRoundTail(log);
    log(`Harold gamble: ${won ? 'won' : 'lost'} ${bet}, coins ${before} → ${coins()}`);
    if (combinationFound()) {
        return 'iou';
    }
    if (!won) {
        return 'loss';
    }
    if (coins() <= before) {
        log(`Harold gamble: a win of ${bet} paid nothing and left no IOU`);
        return 'abort';
    }
    return 'win';
}

const MAX_ROUNDS = 25;

// Why: `death_ig_commander.rs2` gives Harold 100gp when Denulth starts the quest, and `dice_winnings` only writes `harold_lostall` (the IOU) when `harold_gold - bet` goes below zero on a win.
// Why: every loss hands him the stake, so a fixed bet can't bankrupt him after the first: 101 against a purse of 201 pays out and the loop never ends.
// Why: `%death_bits` is not transmitted, so the purse is tracked from the stake and the verdict.

/** The stake that bankrupts a purse this size, as far as the pack and `harold_gamble`'s ceiling allow. */
export function nextStake(purse: number, pack: number): number {
    return Math.min(MAX_BET, pack, purse + 1);
}

// Why: a win Harold could pay proves his purse was larger than the stake and nothing more, so the estimate goes up and hits the ceiling in a few rounds.

/** The purse the round's verdict implies. */
export function purseAfter(purse: number, stake: number, result: 'win' | 'loss'): number {
    return result === 'loss' ? purse + stake : Math.min(MAX_BET, purse * 2 + 1);
}

/** Roll against Harold, raising the stake past his purse, until he writes the IOU. */
export async function gambleWithHarold(log: (m: string) => void): Promise<boolean> {
    if (combinationFound()) {
        return true;
    }
    if (!(await enterHaroldRoom(log))) {
        return false;
    }
    let purse = HAROLD_PURSE_START;
    for (let round = 1; round <= MAX_ROUNDS && !combinationFound(); round++) {
        const bet = nextStake(purse, coins());
        if (bet <= 0) {
            log(`Harold gamble: out of coins after ${round - 1} rounds`);
            return false;
        }
        log(`Harold gamble round ${round}: staking ${bet} against a purse read as ${purse}`);
        let result: RoundResult;
        try {
            result = await playRound(bet, log);
        } finally {
            await closeDiceIfOpen(log);
        }
        if (result === 'iou') {
            break;
        }
        if (result === 'abort') {
            return combinationFound();
        }
        purse = purseAfter(purse, bet, result);
        if (!insideHaroldRoom(Game.tile()) && !(await enterHaroldRoom(log))) {
            return false;
        }
    }
    log(`Harold gamble done: iou=${held(DEATH_ITEM.IOU.id)} coins=${coins()}`);
    return combinationFound();
}

// Why: `harold_reclaim_iou` runs itself off the front of any `opnpc1` once the quest is past `death_given_iou` and neither paper is in the pack, so the conversation only has to be opened and answered.

/** Ask Harold to write the IOU out again. */
export async function reclaimIouFromHarold(log: (m: string) => void): Promise<boolean> {
    if (combinationFound()) {
        return true;
    }
    if (!(await enterHaroldRoom(log))) {
        return false;
    }
    if (!(await openDialogue('Harold', log))) {
        return false;
    }
    if (!(await driveUntil(combinationFound, [], log, SETTLE_MS))) {
        log('Harold gamble: the reclaim conversation ended without a paper');
    }
    await drainRoundTail(log);
    return combinationFound();
}
