// docs/QUESTS.md
import { actions, reader } from '../../../../adapter/ClientAdapter.js';
import { DirectNavigator } from '../../../../event/webwalk/DirectNavigator.js';
import Tile from '../../../../geometry/Tile.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import { GameMessages } from '../../../chatbox/gameMessages.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Locs } from '../../../locs/Locs.js';
import { Modals } from '../../../ui/widgets/Modals.js';
import { Npcs, type Npc } from '../../../npcs/Npcs.js';
import { ChatDialog } from '../../../ui/dialogue/ChatDialog.js';
import { Quests } from '../../../ui/questlog/Quests.js';
import { Traversal } from '../../../walking/Traversal.js';
import { QUESTS } from '../data/quests.js';
import type { QuestModule, QuestProgress, QuestSnapshot, QuestStep } from '../engine/types.js';
import { gotoNpc, talkStrict, talkThrough, type NpcStop } from '../exec/primitives.js';
import { driveUntil, heldId, settleScene } from '../exec/prompts.js';
import { gatherMilk } from './cooksassistant.js';

const QUEST = "Gertrude's Cat";

/** `%fluffs`. */
export const FLUFFS_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    PAID_BOY: 2,
    GAVE_MILK: 3,
    GAVE_SARDINE: 4,
    RESCUED: 5,
    COMPLETE: 6
} as const;

export const FLUFFS_OBJ = {
    doogleLeaves: 1573,
    rawSardine: 327,
    seasonedSardine: 1552,
    bucketOfMilk: 1927,
    kitten: 1554
} as const;

/** Fluffs herself, and the six crates that might hold her kitten. */
const CAT_NPC = 759;
const CRATE_NPC = 767;

const BOY_PAYMENT = 100;
/** Enough for the boy plus the sardine, with change. */
const COIN_TOPUP = 1000;
const SARDINE_GP = 100;

const BANK = new Tile(3185, 3440, 0);

const GERTRUDE: NpcStop = {
    npc: 'Gertrude',
    anchor: new Tile(3151, 3410, 0),
    leash: 8,
    prefer: ['Well, I suppose I could']
};

const MARKET = new Tile(3221, 3434, 0);
// Why: option 2 buys the location; option 1 threatens the boy and option 3 walks away, both of which end the dialogue with nothing spent and nothing learnt.
const PAY_PREFER = ['What will make you tell me?', "I'll pay"];

const DOOGLE_WOODS = new Tile(3153, 3400, 0);
const SARDINE_SHOP = { npc: 'Gerrant', anchor: new Tile(3016, 3223, 0) };

const YARD_ENTRY = new Tile(3305, 3496, 0);
const LADDER_BASE = new Tile(3310, 3509, 0);
const LADDER_TOP = new Tile(3310, 3509, 1);
const CAT_STAND = new Tile(3306, 3512, 1);

// Why: this is the one tile the server routes to from every crate, the ladder and the fence alike — aim anywhere else from beside a crate and the walk is refused in silence.

/** The yard's hub: every leg inside it starts and ends here. */
const YARD_HUB = new Tile(3305, 3504, 0);

// Why: the sixth crate sits in the corner behind the yard's shed, and the route round it is long enough that the server's own finder gives up and walks the character to the closest tile it liked — nine tiles short, with no refusal.
// Why: it is searched first for the same reason, since the walk in is only reliable from the open ground by the fence and not from the tile the previous crate leaves the character on.

/** Waypoints into and back out of that corner, each a leg short enough for the server to route in one go. */
const NW_CORNER_IN: Tile[] = [YARD_HUB, new Tile(3304, 3511, 0), new Tile(3300, 3512, 0), new Tile(3298, 3513, 0)];
const NW_CORNER_OUT: Tile[] = [new Tile(3300, 3512, 0), new Tile(3304, 3511, 0), YARD_HUB];
/** The way south, through the hub. */
const YARD_EXIT: Tile[] = [YARD_HUB, YARD_ENTRY];

interface CrateStop {
    tile: Tile;
    /** Legs to walk before the Search, and back out afterwards. */
    approach?: { in: Tile[]; out: Tile[] };
}

/** `%fluffs_crate` picks one of these six at random when the sardine is eaten. */
const CRATES: CrateStop[] = [
    { tile: new Tile(3298, 3514, 0), approach: { in: NW_CORNER_IN, out: NW_CORNER_OUT } },
    { tile: new Tile(3307, 3507, 0) },
    { tile: new Tile(3311, 3511, 0) },
    { tile: new Tile(3303, 3506, 0) },
    { tile: new Tile(3305, 3500, 0) },
    { tile: new Tile(3310, 3499, 0) }
];

/** The wrong crate answers with a chat line and no modal, so waiting on the kitten alone costs a timeout per crate. */
const FOUND_NOTHING = /you find nothing/i;

/** Long enough for the server to walk the yard's full width before the four-tick search starts. */
const CRATE_SEARCH_MS = 30_000;

// Why: `npc_find` measures the brothers against each other, not against us, and both wander two tiles from their own spawn.
// Why: the check runs four chat lines into the conversation, so the gap has to start well inside the script's own limit of 3 — at 2 the pair drifted out of range on two attempts in three.

/** How close the brothers must stand before the dialogue is opened. */
const BROTHER_GAP = 1;

const PAY_ATTEMPTS = 6;
const SEASON_ATTEMPTS = 3;
const OFFER_ATTEMPTS = 3;
/** `p_delay(1) + p_delay(0) + p_delay(1) + p_delay(4)` in the hand-over, plus a tick of slack. */
const CUTSCENE_TICKS = 8;

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: the pages are cumulative, so the newest sentence has to be tested before the ones it was appended to.
export function parseGertrudesCatJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const at = (stage: number): QuestProgress => ({ stage, flags: new Set() });
    if (text.includes('quest complete!')) {
        return at(FLUFFS_STAGE.COMPLETE);
    }
    if (text.includes('i gave fluffs her kitten back')) {
        return at(FLUFFS_STAGE.RESCUED);
    }
    if (text.includes('i gave the cat milk and sardines')) {
        return at(FLUFFS_STAGE.GAVE_SARDINE);
    }
    if (text.includes('i found the lost cat but it')) {
        return at(FLUFFS_STAGE.GAVE_MILK);
    }
    if (text.includes('go to their play area')) {
        return at(FLUFFS_STAGE.PAID_BOY);
    }
    if (text.includes('i accepted the challenge of finding')) {
        return at(FLUFFS_STAGE.STARTED);
    }
    if (text.includes('i can start this quest by talking to')) {
        return at(FLUFFS_STAGE.NOT_STARTED);
    }
    return undefined;
}

export async function readGertrudesCatProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(QUEST);
    if (status === 'complete') {
        return { stage: FLUFFS_STAGE.COMPLETE, flags: new Set() };
    }
    if (status === 'notStarted') {
        return { stage: FLUFFS_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const progress = parseGertrudesCatJournal(await Quests.journal(QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}

function inYard(t: { x: number; z: number; level: number }): boolean {
    return t.level === 0 && t.x >= 3288 && t.x <= 3327 && t.z >= 3494 && t.z <= 3527;
}

// Why: the yard's inner walls leave the walk south unplannable from the tiles the crate legs end on — the walker spent five repaths clicking the fence approach from nine tiles away and never moved.
/** Walk back to the fence side, which is where a route out of the yard can be planned from. */
async function leaveYard(log: (m: string) => void): Promise<boolean> {
    if (!(await climbDownToYard(log))) {
        return false;
    }
    return walkVia(YARD_EXIT, log);
}

/** Walk in through the broken fence, the yard's only way in. */
async function enterYard(log: (m: string) => void): Promise<boolean> {
    if (!(await climbDownToYard(log))) {
        return false;
    }
    const here = Game.tile();
    if (here && inYard(here)) {
        return true;
    }
    if (!(await Traversal.walkResilient(YARD_ENTRY, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    const landed = Game.tile();
    return landed !== null && inYard(landed);
}

/** Fluffs sits on the yard's raised walkway, which the baked graph has no edge onto. */
function onPlatform(): boolean {
    const here = Game.tile();
    return here !== null && here.level === LADDER_TOP.level && LADDER_TOP.distanceTo(here) <= 20;
}

async function climbToCat(log: (m: string) => void): Promise<boolean> {
    if (onPlatform()) {
        return true;
    }
    // Why: from outside the yard this is the fence route; from beside a crate it is the one leg the server will walk.
    if (!(await walkVia([YARD_HUB], log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(LADDER_BASE, { radius: 1, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    const ladder = Locs.query().name('Ladder').action('Climb-up').within(4).nearest();
    if (!ladder) {
        log(`gertrudescat: no ladder up to Fluffs at (${LADDER_BASE.x},${LADDER_BASE.z})`);
        return false;
    }
    if (!(await ladder.interact('Climb-up'))) {
        return false;
    }
    const up = await Execution.delayUntil(onPlatform, 10_000);
    if (up) {
        await settleScene();
    }
    return up;
}

async function climbDownToYard(log: (m: string) => void): Promise<boolean> {
    if (!onPlatform()) {
        return true;
    }
    if (!(await Traversal.walkResilient(LADDER_TOP, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const ladder = Locs.query().name('Ladder').action('Climb-down').within(4).nearest();
    if (!ladder) {
        log(`gertrudescat: no ladder down off the platform at (${LADDER_TOP.x},${LADDER_TOP.z})`);
        return false;
    }
    if (!(await ladder.interact('Climb-down'))) {
        return false;
    }
    const down = await Execution.delayUntil(() => !onPlatform(), 10_000);
    if (down) {
        await settleScene();
    }
    return down;
}

// Why: Pick-up and Stroke both make Fluffs claw for 3 damage and give nothing, so every interaction here is a use-on.
function offerToCat(objId: number, what: string): (log: (m: string) => void) => Promise<boolean> {
    return async log => {
        const gone = (): boolean => heldId(objId) === 0;
        if (gone()) {
            return true;
        }
        if (!(await climbToCat(log))) {
            return false;
        }
        const findCat = (): Npc | null => Npcs.query().where(n => n.id === CAT_NPC).nearest();
        if (!findCat()) {
            await Traversal.walkResilient(CAT_STAND, { radius: 2, attempts: 2, timeoutMs: 30_000, log });
            await settleScene();
        }
        // Why: the first use lands while the ladder still has the character delayed, where the engine drops it — and a dropped use is indistinguishable from a refused one.
        for (let attempt = 0; attempt < OFFER_ATTEMPTS && !gone(); attempt++) {
            const cat = findCat();
            const held = Inventory.items().find(item => item.id === objId);
            if (!cat || !held) {
                log(`gertrudescat: no Fluffs in reach, or no ${what} to offer her`);
                return false;
            }
            log(`gertrudescat: offering Fluffs the ${what}`);
            if (!(await held.useOn(cat))) {
                return false;
            }
            await driveUntil(gone, [], log, 12_000);
        }
        if (!gone()) {
            return false;
        }
        await settleCutscene(log);
        return true;
    };
}

// Why: the kitten leaves the pack six ticks before the hand-over cutscene ends, so the wait that watches the pack returns while Fluffs is still walking home.
// Why: a character left holding the closing mesbox cannot move at all — the walker spent a hundred seconds clicking three tiles away and never took a step.
async function settleCutscene(log: (m: string) => void): Promise<void> {
    await Execution.delayTicks(CUTSCENE_TICKS);
    await driveUntil(() => !ChatDialog.isOpen() && !ChatDialog.canContinue(), [], log, 15_000);
    await Modals.closeIfOpen();
}

// Why: which crate holds the kitten is a server-side coord the client never sees, so the only way through is to search them all.
// Why: the yard sits in one scene and every crate blocks its own tile, so the Search op is sent from wherever the bot stands and the server walks it the rest of the way.
async function searchCratesForKitten(log: (m: string) => void): Promise<boolean> {
    const found = (): boolean => heldId(FLUFFS_OBJ.kitten) > 0;
    if (found()) {
        return true;
    }
    if (!(await enterYard(log))) {
        return false;
    }
    for (const stop of CRATES) {
        if (await walkVia(stop.approach?.in ?? [], log)) {
            await searchCrate(stop.tile, found, log);
        }
        // Why: the corner is as hard to leave as it was to enter, and leaving it is what the next leg's walk assumes has happened.
        await walkVia(stop.approach?.out ?? [], log);
        if (found()) {
            return true;
        }
    }
    log('gertrudescat: none of the six crates held the kitten');
    return false;
}

// Why: inside the yard the planner's route and the server's disagree, and the raw walk packet is the server's own answer to a leg the planner has already given up on.
async function walkVia(waypoints: readonly Tile[], log: (m: string) => void): Promise<boolean> {
    for (const wp of waypoints) {
        if (await Traversal.walkResilient(wp, { radius: 1, attempts: 2, timeoutMs: 45_000, log })) {
            continue;
        }
        log(`gertrudescat: the planner gave up short of (${wp.x},${wp.z}) — walking there directly`);
        if (!(await DirectNavigator.walkTo(wp, 1, 12_000))) {
            return false;
        }
    }
    return true;
}

async function searchCrate(spot: Tile, found: () => boolean, log: (m: string) => void): Promise<void> {
    const crate = Npcs.query().where(n => n.id === CRATE_NPC).withinOf(spot, 0).nearest();
    if (!crate) {
        log(`gertrudescat: no crate standing at (${spot.x},${spot.z})`);
        return;
    }
    log(`gertrudescat: searching the crate at (${spot.x},${spot.z})`);
    const mark = GameMessages.mark();
    if (!(await crate.interact('Search'))) {
        return;
    }
    await driveUntil(() => found() || GameMessages.sawSince(mark, FOUND_NOTHING), [], log, CRATE_SEARCH_MS);
}

// Why: this runs the tick after Gerrant's shop closes, and a shop screen that has not finished shutting swallows the use with no refusal — the pack is untouched and the wait times out.
async function seasonSardine(log: (m: string) => void): Promise<boolean> {
    const seasoned = (): boolean => heldId(FLUFFS_OBJ.seasonedSardine) > 0;
    for (let attempt = 0; attempt < SEASON_ATTEMPTS && !seasoned(); attempt++) {
        await Modals.closeIfOpen();
        await Execution.delayTicks(1);
        const leaves = Inventory.items().find(item => item.id === FLUFFS_OBJ.doogleLeaves);
        const raw = Inventory.items().find(item => item.id === FLUFFS_OBJ.rawSardine);
        if (!leaves || !raw) {
            log('gertrudescat: no doogle leaves or no raw sardine to rub them over');
            return false;
        }
        if (!(await leaves.useOn(raw))) {
            return false;
        }
        // Why: "You rub the doogle leaves over the sardine." is a mesbox, and the seasoned sardine only lands once it is dismissed.
        await driveUntil(seasoned, [], log, 8000);
    }
    return seasoned();
}

async function reportToGertrude(log: (m: string) => void): Promise<boolean> {
    // Why: a resumed session can pick the quest up holding the hand-over's closing mesbox, and nothing walks until it is shut.
    await driveUntil(() => !ChatDialog.isOpen() && !ChatDialog.canContinue(), [], log, 5000);
    const here = Game.tile();
    if (onPlatform() || (here !== null && inYard(here))) {
        if (!(await leaveYard(log))) {
            return false;
        }
    }
    if (!(await gotoNpc(GERTRUDE, [], log))) {
        return false;
    }
    return talkThrough(GERTRUDE.npc, GERTRUDE.prefer, log);
}

async function payBrothers(log: (m: string) => void): Promise<boolean> {
    const paired = (): Npc | null => {
        const shilop = Npcs.query().name('Shilop').nearest();
        const wilough = Npcs.query().name('Wilough').nearest();
        if (!shilop || !wilough) {
            return null;
        }
        return shilop.tile().distanceTo(wilough.tile()) <= BROTHER_GAP ? shilop : null;
    };
    for (let attempt = 0; attempt < PAY_ATTEMPTS; attempt++) {
        if (!(await Traversal.walkResilient(MARKET, { radius: 3, attempts: 3, timeoutMs: 180_000, log }))) {
            return false;
        }
        await settleScene();
        if (!(await Execution.delayUntil(() => paired() !== null, 60_000))) {
            log('gertrudescat: Shilop and Wilough never wandered within earshot of each other');
            continue;
        }
        const before = Inventory.count('Coins');
        if (!(await talkStrict('Shilop', PAY_PREFER, log))) {
            continue;
        }
        // Why: the brothers drift apart mid-dialogue and the far-apart branch ends with no options at all, so only the payment proves the location was bought.
        if (await Execution.delayUntil(() => Inventory.count('Coins') <= before - BOY_PAYMENT, 5000)) {
            return true;
        }
        log('gertrudescat: the dialogue ended without paying — the brothers had drifted apart');
    }
    return false;
}

/** Doogle leaves first: they grow behind Gertrude's house, and the sardine is a walk to Port Sarim. */
function gatherSeasonedSardine(snap: QuestSnapshot): QuestStep | null {
    if ((snap.invIds?.get(FLUFFS_OBJ.seasonedSardine) ?? 0) > 0) {
        return null;
    }
    if ((snap.invIds?.get(FLUFFS_OBJ.doogleLeaves) ?? 0) === 0) {
        return { kind: 'grabGround', item: 'Doogle leaves', anchor: DOOGLE_WOODS, waitIfMissing: true };
    }
    if ((snap.invIds?.get(FLUFFS_OBJ.rawSardine) ?? 0) === 0) {
        return { kind: 'buy', item: 'Raw sardine', qty: 1, shop: SARDINE_SHOP, estGp: SARDINE_GP };
    }
    return { kind: 'custom', name: 'season the sardine with doogle leaves', run: seasonSardine };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: GERTRUDE }; }

    const progress = snap.progress;
    if (progress === undefined) { return { kind: 'wait', reason: `${QUEST} journal stage unavailable` }; }

    switch (progress.stage) {
        case FLUFFS_STAGE.STARTED: {
            if ((snap.inv.get('coins') ?? 0) < BOY_PAYMENT) {
                return { kind: 'withdraw', items: [{ name: 'Coins', qty: COIN_TOPUP }], bank: BANK };
            }
            return { kind: 'custom', name: 'buy the play area out of Shilop', run: payBrothers };
        }
        // Why: the sardine is fetched on the milk leg too — its shop and its herb are both on the way out, and coming back for them is a second lap of the map.
        case FLUFFS_STAGE.PAID_BOY: {
            const sardine = gatherSeasonedSardine(snap);
            if (sardine !== null) { return sardine; }
            if (!snap.inv.has('bucket of milk')) { return gatherMilk(snap); }
            return { kind: 'custom', name: 'give Fluffs the milk', run: offerToCat(FLUFFS_OBJ.bucketOfMilk, 'bucket of milk') };
        }
        case FLUFFS_STAGE.GAVE_MILK: {
            const sardine = gatherSeasonedSardine(snap);
            if (sardine !== null) { return sardine; }
            return { kind: 'custom', name: 'give Fluffs the doogle sardine', run: offerToCat(FLUFFS_OBJ.seasonedSardine, 'seasoned sardine') };
        }
        case FLUFFS_STAGE.GAVE_SARDINE: {
            if ((snap.invIds?.get(FLUFFS_OBJ.kitten) ?? 0) === 0) {
                return { kind: 'custom', name: 'search the crates for the kitten', run: searchCratesForKitten };
            }
            return { kind: 'custom', name: 'give Fluffs her kitten', run: offerToCat(FLUFFS_OBJ.kitten, 'kitten') };
        }
        case FLUFFS_STAGE.RESCUED:
            return { kind: 'custom', name: 'take the news back to Gertrude', run: reportToGertrude };
        default:
            return { kind: 'wait', reason: `unexpected ${QUEST} stage ${progress.stage}` };
    }
}

export const gertrudescat: QuestModule = {
    record: QUESTS.find(r => r.id === 'fluffs')!,
    bank: BANK,
    // Why: nothing here fights, but the legs cross Port Sarim and the Lumbridge farms, and a death mid-quest costs the item chain.
    food: 4,
    // Why: the milk, the herb and the sardine are all consumed mid-quest, so the module fetches each on the leg that needs it rather than the provisioner refetching all three on every resume.
    tools: ['coins', 'bucket', 'doogle leaves', 'sardine', "fluffs' kitten"],
    readProgress: readGertrudesCatProgress,
    decide
};
