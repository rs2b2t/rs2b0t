import { reader } from '../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import { Reach } from '../../../walking/Reach.js';
import { Traversal } from '../../../walking/Traversal.js';
import { ChatDialog } from '../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Modals } from '../../../ui/widgets/Modals.js';
import { Npcs, type Npc } from '../../../npcs/Npcs.js';
import { GameMessages } from '../../../chatbox/gameMessages.js';
import { driveUntil } from '../exec/prompts.js';
import {
    BARBARIAN_GUARD_ID,
    BARCRAWL_CARD,
    BAR_PREFER,
    BARS,
    COINS,
    GATE_IS_OPEN,
    GUARD_PREFER,
    GUARD_TILE,
    TOO_DRUNK,
    nextBar,
    parseCard,
    type Bar,
    type BarcrawlProgress
} from './BarcrawlLogic.js';

// Why: the scroll is a main modal built with `if_settext`, so no dialogue driver can see it.
// Why: every other modal read comes back empty while it is up, so it has to be closed again, like a quest journal.

/** How many times a Read that opens nothing is re-sent before the card is called unreadable. */
const READ_TRIES = 3;

/** Read the barcrawl card. */
export async function readCard(log?: (m: string) => void): Promise<BarcrawlProgress | null> {
    if (!Inventory.first(BARCRAWL_CARD)) {
        return null;
    }
    // Why: the previous read's close takes a tick to land, and a `before` sampled while that scroll is still up can never differ from the id the next Read opens — every read after a successful one then times out on a scroll that is on screen.
    await Modals.closeIfOpen();
    await Execution.delayUntil(() => reader.modals().main === -1, 3000);
    const before = reader.modals().main;
    const mark = GameMessages.mark();
    // Why: the client clears the modal on the close it sends, but the server clears it a tick or more later and drops an `opheld` that arrives in between — so the first Read after a read of its own opens nothing at all.
    // Why: `drinkAt` survived that by reading three times; every other caller read once and called the card unreadable, which is a failed quest step per bar.
    let idChanged = false;
    let parsed: BarcrawlProgress | null = null;
    for (let attempt = 0; attempt < READ_TRIES && !idChanged; attempt++) {
        if (attempt > 0) {
            await Execution.delayTicks(3);
        }
        const card = Inventory.first(BARCRAWL_CARD);
        if (!card) {
            return null;
        }
        if (!(await card.interact('Read'))) {
            log?.('the card refused its Read op');
            return null;
        }
        // Why: the modal id arrives in `if_openmain`, each line of the scroll arrives in its own `if_settext`, and component text persists in the interface list between modals.
        // Why: sampling on the tick the id changes therefore reads an empty scroll, or the previous read's.
        // Why: settling a tick and waiting for text that parses as the card is what makes the read honest, where waiting on the id alone is not.
        idChanged = await Execution.delayUntil(() => {
            const main = reader.modals().main;
            return main !== -1 && main !== before;
        }, 5000);
    }
    if (idChanged) {
        await Execution.delayTicks(1);
        await Execution.delayUntil(() => parseCard(reader.mainModalTexts()) !== null, 5000);
        parsed = parseCard(reader.mainModalTexts());
        await Modals.closeIfOpen();
    }
    if (parsed) {
        return parsed;
    }
    // Why: `opheld1,barcrawl_card` stops opening the scroll once every bar is signed, and "You are too drunk to be able to read the barcrawl card" is the finished state.
    // Why: taking that line for a failed read leaves the tour looping at the tenth bar forever.
    if (GameMessages.sawSince(mark, TOO_DRUNK)) {
        return { remaining: [], done: true };
    }
    log?.(idChanged
        ? 'the card scroll opened but never rendered a parseable line'
        : 'the card scroll never opened, and no "too drunk" message came back');
    return null;
}

/** Every bartender in the game renders "Bartender", so they are found by id. */
const byId = (id: number): Npc | null => Npcs.query().where(n => n.id === id).nearest();

// Why: `[opnpcu,<bartender>]` takes the card straight to the barcrawl branch, skipping the four-option menu the talk op puts up.
// Why: that branch behaves the same at every one of the ten bars.

/** Drink at one bar. */
async function drinkAt(bar: Bar, log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(bar.tile, { radius: 3, attempts: 3, timeoutMs: 300_000, log }))) {
        log(`could not reach the ${bar.line} bartender`);
        return false;
    }
    await Execution.delayTicks(2);
    const npc = byId(bar.id);
    const card = Inventory.first(BARCRAWL_CARD);
    if (!npc || !card) {
        log(`no bartender ${bar.id} or no card at the ${bar.line}`);
        return false;
    }
    const beforeCoins = Inventory.count(COINS);
    if (!(await card.useOn(npc))) {
        return false;
    }
    // Why: nine of the ten go straight into the drink, but the Rising Sun's barmaid offers her ale list first.
    // Why: the barcrawl line therefore has to be in the preference list, or her menu sits unanswered and the card never signs.
    // Why: the coin deduction is what says the drink was bought, as the card only turns green several `p_delay`s later, so the read is retried rather than taken once.
    await driveUntil(() => Inventory.count(COINS) < beforeCoins, BAR_PREFER, log, 20_000);
    for (let attempt = 0; attempt < 3; attempt++) {
        await Execution.delayTicks(5);
        const after = await readCard(m => log(`  read ${attempt + 1}/3: ${m}`));
        if (after !== null && !after.remaining.some(b => b.line === bar.line)) {
            log(`signed at the ${bar.line}`);
            return true;
        }
    }
    log(`the ${bar.line} did not sign the card`);
    return false;
}

/** Reported once per pass, so a caller's paint tracks the tour rather than the pass. */
export type Progress = (signed: number, total: number) => void;

/** Consecutive bars that answer nothing before the tour is called broken. */
const GIVE_UP = 3;

/**
 * Drive the crawl. Returns once the card is fully signed; the guard still
 * has to be told, which {@link handInBarcrawl} does.
 */
async function runBarcrawl(log: (m: string) => void, onProgress?: Progress): Promise<boolean> {
    let missed = 0;
    for (let pass = 0; pass < BARS.length * 2; pass++) {
        const progress = await readCard(m => log(`  ${m}`));
        if (!progress) {
            log(Inventory.count(BARCRAWL_CARD) === 0
                ? 'no barcrawl card in the pack to read'
                : 'holding a barcrawl card but could not read it — stopping rather than re-walking the tour');
            return false;
        }
        onProgress?.(BARS.length - progress.remaining.length, BARS.length);
        if (progress.done) {
            log('barcrawl card fully signed');
            return true;
        }
        const next = nextBar(progress.remaining, Game.tile());
        if (!next) {
            return true;
        }
        log(`barcrawl: ${progress.remaining.length} bars left, heading for the ${next.line}`);
        // Why: the next pass re-reads the card and re-sorts, so the loop moves on past one bar that will not answer and comes back to it.
        missed = (await drinkAt(next, log)) ? 0 : missed + 1;
        if (missed >= GIVE_UP) {
            log(`${missed} bars in a row refused the card — stopping`);
            return false;
        }
    }
    return (await readCard())?.done ?? false;
}

async function talkToGuard(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(GUARD_TILE, { radius: 4, attempts: 3, timeoutMs: 300_000, log }))) {
        log('could not reach the outpost gate guard');
        return false;
    }
    await Execution.delayTicks(2);
    // Why: the outpost's other "Barbarian guard" is the attackable one and the gate loc runs the same conversation, so a talk aimed by display name can land on either — hence the id.
    if (!byId(BARBARIAN_GUARD_ID)) {
        log('no barbarian guard at the outpost gate');
        return false;
    }
    const status = await Reach.entityOp({
        find: () => byId(BARBARIAN_GUARD_ID),
        op: 'Talk-to',
        expect: () => ChatDialog.isOpen() || ChatDialog.canContinue(),
        what: 'Barbarian guard',
        log
    });
    return status === 'done';
}

// Why: `outpost_guard_progress` consumes the card and sets `%barcrawl` to complete, which is what opens the gate.

/** Give the signed card to the gate guard. */
async function handInBarcrawl(log: (m: string) => void): Promise<boolean> {
    if (!(await talkToGuard(log))) {
        return false;
    }
    await driveUntil(() => Inventory.count(BARCRAWL_CARD) === 0, [], log, 20_000);
    return Inventory.count(BARCRAWL_CARD) === 0;
}

type GuardVerdict = 'complete' | 'issued' | 'retry';

// Why: the guard is the only oracle there is — `%barcrawl` is not on the wire, and an empty pack looks the same before the card is issued as after it is handed in.
// Why: `outpost_guard_talk` branches on the varp — "Oi, whaddya want?" for not started, "'Ello friend." for complete, "So, how's the Barcrawl coming along?" for anything between, and that last branch re-issues a lost card.
// Why: the greeting is the verdict and the empty pack is not, since a random event landing mid-conversation abandons the option chain.
// Why: reading "no card came out" as "already done" sends the bot at a gate that will not open, for good, so only "'Ello friend." means finished.

/** Ask the gate guard where the crawl stands. */
async function askGuard(log: (m: string) => void): Promise<GuardVerdict> {
    if (!(await talkToGuard(log))) {
        log('the outpost guard never opened a dialogue');
        return 'retry';
    }
    const greeting = ChatDialog.texts().join(' / ');
    log(`guard opens with: ${greeting || '(nothing)'}`);
    if (GATE_IS_OPEN.test(greeting)) {
        return 'complete';
    }
    // Why: the branch that issues a card is three menus deep, so stopping at the first lull leaves the choice on screen with the tour un-started.
    await driveUntil(() => Inventory.count(BARCRAWL_CARD) > 0, GUARD_PREFER, log, 25_000);
    const held = Inventory.count(BARCRAWL_CARD);
    log(`guard done — card in pack: ${held}`);
    return held > 0 ? 'issued' : 'retry';
}

/** Everything between "no barcrawl" and a gate that opens; true once the guard will let the character through. */
export async function ensureBarcrawl(log: (m: string) => void, onProgress?: Progress): Promise<boolean> {
    if (Inventory.count(BARCRAWL_CARD) === 0) {
        const verdict = await askGuard(log);
        if (verdict === 'complete') {
            log('the guard waves us through — the barcrawl is already done');
            return true;
        }
        if (verdict === 'retry') {
            // Not "already done": the conversation was cut short, most often by a
            // random event. Fail so the caller walks back and asks again.
            log('the guard handed over no card and did not wave us through — retrying');
            return false;
        }
    }
    if (!(await runBarcrawl(log, onProgress))) {
        return false;
    }
    return handInBarcrawl(log);
}
