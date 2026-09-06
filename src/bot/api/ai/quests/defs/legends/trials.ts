import { DirectNavigator } from '../../../../../event/webwalk/DirectNavigator.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { GroundItems, type GroundItem } from '../../../../grounditems/GroundItems.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Loc } from '../../../../model/Loc.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type Tile from '../../../../../geometry/Tile.js';
import { GEM_ROCKS, LQ_ID, LQ_LOC, LQ_LOC_ID, LQ_TILE, WALL_RUNES, inOctagram, legendsArea } from './areas.js';
import { legendsPocket, type LegendsPocket } from './pockets.js';
import { clearBoxes, driveBoxes, driveUntil, heldId, locNear, modalText, promptLoc, settleScene, useOnLoc } from './scene.js';

/** Which sealed pocket of the cave complex we are standing in. */
export function pocket(): LegendsPocket | null {
    return legendsPocket(Game.tile());
}

// Why: every rung of the descent is a one-way crossing, so a leg resumed below one must not walk back at the stand above it.
const DESCENT: readonly LegendsPocket[] = [
    'shamanCave', 'crevice', 'outerGate', 'boulderOne', 'boulderTwo', 'innerGate',
    'trials', 'wallRoom', 'gemRoom', 'winchRoom', 'viyeldiLedge'
];

/** Standing at or below the named rung of the descent. */
function past(want: LegendsPocket): boolean {
    const at = pocket();
    return at !== null && DESCENT.indexOf(at) >= DESCENT.indexOf(want);
}

function locById(id: number, within = 10, op?: string): Loc | null {
    const query = Locs.query().where(l => l.id === id).within(within);
    return (op ? query.action(op) : query).nearest();
}

// Why: the outer and inner gates are both out of `doors.json`, as one answers Open with a refusal and the other with a brute-strength prompt, so the crossing after the open is a scene step the pathfinder never sees.

/** Walk the last tile through a gate the module has opened. */
async function stepThrough(to: Tile, want: LegendsPocket, log: (m: string) => void, quiet = false): Promise<boolean> {
    // Why: these gates teleport rather than swing, and the teleport lands a tick or two after the box is clicked away, `~mesbox` suspends the script, so `if_close`, the anim and `open_and_close_double_door2` all come after the dismissal.
    // Why: walking first therefore drags the character back off the tile the script had put it on, and the crossing reads as a gate that would not open. A live run sat at (2809,9331) doing that six times a pass for eleven minutes, with the box saying "you see a lever which you pull on to open the door", the success branch, every time.
    await settleScene();
    if (pocket() === want) {
        return true;
    }
    await DirectNavigator.walkTo(to, 0, 8000);
    await settleScene();
    if (pocket() === want) {
        return true;
    }
    if (!quiet) {
        log(`the gate did not let us through to ${want}`);
    }
    return false;
}

// Why: `stat_random(agility, 60, 254)` decides the crawl and a failure only costs a few ticks, so this retries rather than parking.

/** Squeeze through the crevice behind the shaman's bookcase. */
export async function crawlBookcase(log: (m: string) => void): Promise<boolean> {
    if (past('crevice')) {
        return true;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.SHAMAN_BOOKCASE, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    for (let i = 0; i < 6; i++) {
        if (pocket() === 'crevice') {
            await settleScene();
            return true;
        }
        const ok = await promptLoc(
            {
                name: LQ_LOC.BOOKCASE,
                op: 'Search',
                near: LQ_TILE.SHAMAN_BOOKCASE,
                prefer: ['Yes please!'],
                expect: () => pocket() === 'crevice',
                expectMs: 25_000
            },
            log
        );
        if (ok) {
            await settleScene();
            return true;
        }
    }
    log('six squeezes and the crevice still would not take us');
    return false;
}

/** Crawl back west through the crevice into the shaman cave. */
export async function crawlBackFromCrevice(log: (m: string) => void): Promise<boolean> {
    if (pocket() !== 'crevice') {
        return true;
    }
    const ok = await promptLoc(
        {
            name: LQ_LOC.CREVICE,
            op: 'Search',
            near: LQ_TILE.SHAMAN_CREVICE,
            prefer: ['Yes please!'],
            expect: () => pocket() === 'shamanCave',
            expectMs: 20_000
        },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

const PICK_ATTEMPTS = 10;

// Why: `stat_random(thieving, 0, 255)` decides the lock and `stat_random(strength, 0, 255)` the doors, and both leave the character on the stand with the gate still shut, so a miss is a re-click, not a crossing.
const PICK_MISSED = /fail to pick the lock/;
const FORCE_MISSED = /run out of steam/;

// Why: only Search with a lockpick opens the outer gate, and it rolls against thieving each time; Open answers "You push on the doors" from the entering side for ever.

/** Pick the outer ancient gate and step through it. */
export async function openOuterGate(log: (m: string) => void): Promise<boolean> {
    if (past('outerGate')) {
        return true;
    }
    if (!(await crawlBookcase(log))) {
        return false;
    }
    if (heldId(LQ_ID.LOCKPICK) === 0) {
        log('no lockpick in the pack for the outer ancient gate');
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.LOCKPICK_GATE_NORTH, { radius: 0, attempts: 4, timeoutMs: 120_000, log }))) {
        return false;
    }
    // Why: `search_outer_ancient_gate` is a seven-box chain and each box is gone the tick after the driver clicks it, so the open is read off the gate losing its Search op rather than off the text.
    // Why: losing the op is what `next_loc_stage` does. The leaf becomes `inac_lglockpickgatebottom*`, a model with no name and no ops, so absence here means open rather than missing.
    const shut = (): boolean =>
        (locById(LQ_LOC_ID.LOCKPICK_GATE_L, 6, 'Search') ?? locById(LQ_LOC_ID.LOCKPICK_GATE_R, 6, 'Search')) !== null;
    for (let i = 0; i < PICK_ATTEMPTS; i++) {
        await Sustain.run();
        const gate = locById(LQ_LOC_ID.LOCKPICK_GATE_L, 6, 'Search') ?? locById(LQ_LOC_ID.LOCKPICK_GATE_R, 6, 'Search');
        if (gate && (await gate.interact('Search'))) {
            await driveBoxes(() => !shut() || /tumble the lock mechanism|fail to pick the lock/.test(modalText()), 30_000);
            // Why: read before the boxes go, since clearing them is what takes the text away.
            const missed = PICK_MISSED.test(modalText());
            await clearBoxes();
            // Why: a missed roll leaves the door shut and the character where it was, so the next Search goes straight in, the crossing below cannot land and the walk back is to a tile already underfoot, and paying for both is most of the time this leg spends.
            if (missed) {
                continue;
            }
        }
        if (await stepThrough(LQ_TILE.LOCKPICK_GATE_SOUTH, 'outerGate', log, true)) {
            return true;
        }
        await Traversal.walkResilient(LQ_TILE.LOCKPICK_GATE_NORTH, { radius: 0, attempts: 2, timeoutMs: 30_000, log });
    }
    log('ten lockpick attempts and the outer gate is still shut');
    return false;
}

/** The outer gate's leaves, whichever stage they are standing in. */
const outerShut = (): Loc | null =>
    locById(LQ_LOC_ID.LOCKPICK_GATE_L, 6, 'Open') ?? locById(LQ_LOC_ID.LOCKPICK_GATE_R, 6, 'Open');
const outerOpen = (): Loc | null =>
    locById(LQ_LOC_ID.LOCKPICK_GATE_L_OPEN, 6) ?? locById(LQ_LOC_ID.LOCKPICK_GATE_R_OPEN, 6);

/** Open the outer gate from the inside, where it needs no lockpick at all. */
export async function leaveOuterGate(log: (m: string) => void): Promise<boolean> {
    if (pocket() !== 'outerGate') {
        return true;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.LOCKPICK_GATE_SOUTH, { radius: 0, attempts: 4, timeoutMs: 60_000, log }))) {
        return false;
    }
    // Why: the lever swings the doors shut again behind whoever pulled it, so one open and one step is a coin toss. The crossing is retried until it lands.
    let lastClick = 'never dispatched';
    let lastBox = '';
    for (let i = 0; i < 6; i++) {
        await Sustain.run();
        const gate = outerShut();
        if (gate) {
            const dispatched = await gate.interact('Open');
            lastClick = dispatched ? 'dispatched' : 'refused';
            if (dispatched) {
                // Why: `open_outer_ancient_gate` raises a box and suspends on it, so the teleport only comes after it has been clicked away.
                await driveBoxes(() => modalText() !== '', 6000);
                // Why: read before clearing, since the box is the only thing that says which branch `check_axis` took, the push-on-the-doors message is the gate deciding we are outside trying to get in.
                lastBox = modalText().slice(0, 120);
                await clearBoxes();
            }
        } else if (!outerOpen()) {
            // Why: neither stage in the scene means the walk landed somewhere the gate is not, which no amount of retrying fixes.
            log(`no ancient gate in either stage within six tiles of (${LQ_TILE.LOCKPICK_GATE_SOUTH.x},${LQ_TILE.LOCKPICK_GATE_SOUTH.z})`);
            return false;
        }
        if (await stepThrough(LQ_TILE.LOCKPICK_GATE_NORTH, 'crevice', log, true)) {
            return true;
        }
        await Traversal.walkResilient(LQ_TILE.LOCKPICK_GATE_SOUTH, { radius: 0, attempts: 2, timeoutMs: 30_000, log });
    }
    const me = Game.tile();
    log(`six pulls and the outer gate would not let us back out — shut leaf ${outerShut() ? 'present' : 'absent'}, open leaf ${outerOpen() ? 'present' : 'absent'}, click ${lastClick}, stood at (${me?.x},${me?.z}), box "${lastBox}"`);
    return false;
}

const MINE_ATTEMPTS = 20;
const WINCH_ATTEMPTS = 6;

const BOULDERS: readonly { id: number; from: LegendsPocket; north: Tile; to: LegendsPocket; south: Tile }[] = [
    { id: LQ_LOC_ID.BOULDER_1, from: 'outerGate', north: LQ_TILE.BOULDER_1_NORTH, to: 'boulderOne', south: LQ_TILE.BOULDER_1_SOUTH },
    { id: LQ_LOC_ID.BOULDER_2, from: 'boulderOne', north: LQ_TILE.BOULDER_1_SOUTH, to: 'boulderTwo', south: LQ_TILE.BOULDER_2_SOUTH },
    { id: LQ_LOC_ID.BOULDER_3, from: 'boulderTwo', north: LQ_TILE.BOULDER_2_SOUTH, to: 'innerGate', south: LQ_TILE.BOULDER_3_SOUTH }
];

// Why: mining a boulder teleports the miner past it and drops another behind, so each of the three is a one-shot crossing that has to be re-mined from the other side to come back.
// Why: `stat_random(mining, 90, 255)` decides each swing and a failure costs a mining level, so the loop is generous.
// Why: a missed swing answers with the scratch line and changes nothing else, so waiting on the crossing alone spends the per-swing budget on every miss, twenty of those is five minutes per boulder, and there are three of them each way.
const SCRATCHED = /only succeed in scratching the rock/;

/** Smash one trial boulder and land on the far side of it. */
async function mineBoulder(boulder: (typeof BOULDERS)[number], reverse: boolean, log: (m: string) => void): Promise<boolean> {
    const want = reverse ? boulder.from : boulder.to;
    const stand = reverse ? boulder.south : boulder.north;
    if (pocket() === want || (!reverse && past(want))) {
        return true;
    }
    if (!(await Traversal.walkResilient(stand, { radius: 0, attempts: 4, timeoutMs: 60_000, log }))) {
        return false;
    }
    await settleScene();
    for (let i = 0; i < MINE_ATTEMPTS; i++) {
        if (pocket() === want) {
            await settleScene();
            return true;
        }
        const rock = locById(boulder.id, 6, 'Smash-to-bits');
        if (!rock) {
            log(`boulder ${boulder.id} is not in the scene from (${stand.x},${stand.z})`);
            return false;
        }
        await Sustain.run();
        const mark = GameMessages.mark();
        if (!(await rock.interact('Smash-to-bits'))) {
            continue;
        }
        await Execution.delayUntil(() => pocket() === want || GameMessages.sawSince(mark, SCRATCHED), 15_000);
    }
    log(`twenty swings and boulder ${boulder.id} is still in the way`);
    return false;
}

const STRENGTH_ATTEMPTS = 10;

// Why: the inner gate rolls against strength on every push and drains a level on a miss, so the loop retries rather than parking on one bad roll.

/** Force the inner ancient gate open and step through it. */
export async function openInnerGate(reverse: boolean, log: (m: string) => void): Promise<boolean> {
    const want: LegendsPocket = reverse ? 'innerGate' : 'trials';
    const stand = reverse ? LQ_TILE.STRENGTH_GATE_SOUTH : LQ_TILE.STRENGTH_GATE_NORTH;
    const landing = reverse ? LQ_TILE.STRENGTH_GATE_NORTH : LQ_TILE.STRENGTH_GATE_SOUTH;
    if (pocket() === want || (!reverse && past(want))) {
        return true;
    }
    if (!(await Traversal.walkResilient(stand, { radius: 0, attempts: 4, timeoutMs: 60_000, log }))) {
        return false;
    }
    // Why: a forced gate keeps its Open op. That is how it is shut again, and the success box is gone the tick after the driver clicks it, so the crossing itself is the only oracle.
    for (let i = 0; i < STRENGTH_ATTEMPTS; i++) {
        await Sustain.run();
        const gate = locById(LQ_LOC_ID.STRENGTH_GATE_L, 6, 'Open') ?? locById(LQ_LOC_ID.STRENGTH_GATE_R, 6, 'Open');
        if (gate && (await gate.interact('Open'))) {
            await driveBoxes(
                () => /manage to force the doors open|run out of steam/.test(modalText()),
                25_000,
                ["Yes, I'm very strong"]
            );
            const missed = FORCE_MISSED.test(modalText());
            await clearBoxes();
            if (missed) {
                continue;
            }
        }
        if (await stepThrough(landing, want, log, true)) {
            return true;
        }
        await Traversal.walkResilient(stand, { radius: 0, attempts: 2, timeoutMs: 30_000, log });
    }
    log('ten pushes and the inner gate has not budged');
    return false;
}

const JUMP_ATTEMPTS = 8;

// Why: the jump is `stat_random(agility, 50, 200)`, which misses often enough at the quest's own requirement that one attempt is not a leg.

/** Jump the jagged wall between the trials corridor and the rune wall room. */
export async function jumpJaggedWall(reverse: boolean, log: (m: string) => void): Promise<boolean> {
    const want: LegendsPocket = reverse ? 'trials' : 'wallRoom';
    const stand = reverse ? LQ_TILE.JAGGED_WALL_NORTH : LQ_TILE.JAGGED_WALL_SOUTH;
    if (pocket() === want || (!reverse && past(want))) {
        return true;
    }
    if (!(await Traversal.walkResilient(stand, { radius: 0, attempts: 4, timeoutMs: 90_000, log }))) {
        return false;
    }
    await settleScene();
    for (let i = 0; i < JUMP_ATTEMPTS; i++) {
        if (pocket() === want) {
            await settleScene();
            return true;
        }
        const wall = Locs.query().name(LQ_LOC.JAGGED_WALL).action('Jump-over').within(6).nearest();
        if (!wall) {
            log('no jagged wall offering Jump-over from the stand');
            return false;
        }
        if (!(await wall.interact('Jump-over'))) {
            continue;
        }
        await Execution.delayUntil(() => pocket() === want, 15_000);
        if (pocket() !== want) {
            await Traversal.walkResilient(stand, { radius: 0, attempts: 2, timeoutMs: 30_000, log });
        }
    }
    log('eight jumps and the jagged wall is still between us and the rune wall');
    return false;
}

const SLID = /slide the .* into the .* depression/;
const BURNED = /burns red hot in your hand/;

// Why: the five depressions take soul, mind, earth, law and law in that order and nothing else, and a rune offered out of turn burns and drops to the floor rather than saying which one is next.
// Why: the message box is the only oracle for which depression was filled, so each rune is offered once and a burn moves on to the next.

/** Feed the marked wall its five runes and walk into the gem room. */
async function placeWallRunes(wall: Tile, want: LegendsPocket, log: (m: string) => void): Promise<boolean> {
    for (const rune of WALL_RUNES) {
        if (pocket() === want) {
            return true;
        }
        if (heldId(rune.id) === 0) {
            log(`no ${rune.name} left for the marked wall`);
            continue;
        }
        const mark = GameMessages.mark();
        await useOnLoc(
            rune.id,
            { name: LQ_LOC.MARKED_WALL, near: wall, within: 6, id: LQ_LOC_ID.MARKED_WALL },
            ["Yes, I'll go through!"],
            () => SLID.test(modalText()) || pocket() === want || GameMessages.sawSince(mark, BURNED),
            log
        );
        await driveUntil(() => pocket() === want, ["Yes, I'll go through!"], log, 8000);
        await clearBoxes();
    }
    return pocket() === want;
}

/** Cross the marked wall in the named direction. */
export async function crossMarkedWall(reverse: boolean, log: (m: string) => void): Promise<boolean> {
    const want: LegendsPocket = reverse ? 'wallRoom' : 'gemRoom';
    const stand = reverse ? LQ_TILE.MARKED_WALL_OUT : LQ_TILE.MARKED_WALL_IN;
    if (pocket() === want || (!reverse && past(want))) {
        return true;
    }
    if (!(await Traversal.walkResilient(stand, { radius: 1, attempts: 4, timeoutMs: 90_000, log }))) {
        return false;
    }
    await settleScene();
    // Why: `[oploc1,lgancientwalldoor]` answers "You see no way to use that.... Perhaps you should search it?" until `^legends_law_rune_2_used` is set, and that bit is invisible from here, so a Use tried first spends its `expectMs` proving the wall is still shut. A rune still in the pack is the client-visible proof the wall has not been fed, and feeding it opens the door itself.
    // Why: offering a spare rune to an already-fed wall is safe, `legends_wall_wrong_rune` jumps straight to `enter_marked_wall` once the fifth is in, so the rune is neither burned nor lost.
    if (!reverse && WALL_RUNES.some(rune => heldId(rune.id) > 0)) {
        const placed = await placeWallRunes(stand, want, log);
        if (placed) {
            await settleScene();
        }
        return placed;
    }
    // Why: once the fifth rune is in, both walls answer a plain Use, which is also the only way back.
    const opened = await promptLoc(
        {
            name: LQ_LOC.MARKED_WALL,
            op: 'Use',
            near: stand,
            within: 6,
            id: LQ_LOC_ID.MARKED_WALL,
            prefer: ["Yes, I'll go through!"],
            expect: () => pocket() === want,
            expectMs: 15_000
        },
        log
    );
    if (opened) {
        await settleScene();
        return true;
    }
    if (reverse) {
        log('the marked wall will not open from the gem room');
        return false;
    }
    const placed = await placeWallRunes(stand, want, log);
    if (placed) {
        await settleScene();
    }
    return placed;
}

// Why: each gem answers only its own carved rock, and a gem already hovering there is refused without being consumed, so a resume re-offers every gem and lets the wall sort them out.

/** Hover all seven gems over their rocks, which is what conjures the Book of Binding. */
export async function placeGems(log: (m: string) => void): Promise<boolean> {
    for (const gem of GEM_ROCKS) {
        if (heldId(gem.id) === 0) {
            continue;
        }
        // Why: both the placement and the refusal are `mes` game messages rather than boxes, so a gem already hovering is invisible to the modal text and the leg would wait out its budget on it.
        const mark = GameMessages.mark();
        const placed = await useOnLoc(
            gem.id,
            { name: LQ_LOC.CARVED_ROCK, near: gem.rock, within: 4, id: LQ_LOC_ID.GEM_ROCK },
            [],
            () => heldId(gem.id) === 0 || GameMessages.sawSince(mark, GEM_SETTLED),
            log
        );
        if (!placed) {
            log(`the ${gem.name} would not settle over its rock at (${gem.rock.x},${gem.rock.z})`);
            return false;
        }
        await clearBoxes();
    }
    return true;
}

const GEM_SETTLED = /glows and starts spinning|already placed/;
const BOOK_MS = 90_000;

function findBook(): GroundItem | null {
    return GroundItems.query().where(item => item.id === LQ_ID.BOOK_OF_BINDING).within(20).nearest();
}

/** Take the Book of Binding once the seventh gem has conjured it. */
export async function takeBookOfBinding(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.BOOK_OF_BINDING) > 0) {
        return true;
    }
    if (!findBook() && !(await placeGems(log))) {
        return false;
    }
    // The conjuring is a thirteen-tick cutscene that blows the player to the middle of the room.
    if (!(await Execution.delayUntil(() => findBook() !== null, BOOK_MS))) {
        log('the seven gems are placed but no book appeared');
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.BOOK_SPAWN, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const book = findBook();
    if (!book || !(await book.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(LQ_ID.BOOK_OF_BINDING) > 0, 8000);
}

// Why: the magic gate takes any charge-orb spell with an unpowered orb in the pack, and the four differ only in level and element, water is the one this quest's magic requirement buys.
const ORB_SPELLS = ['Charge water orb', 'Charge earth orb', 'Charge fire orb', 'Charge air orb'] as const;

/** Cast a charge-orb spell at the magic gate and be blown into the winch room. */
export async function castMagicGate(log: (m: string) => void): Promise<boolean> {
    if (past('winchRoom')) {
        return true;
    }
    if (heldId(LQ_ID.UNPOWERED_ORB) === 0) {
        log('no unpowered orb in the pack for the magic gate');
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.MAGIC_GATE_SOUTH, { radius: 1, attempts: 4, timeoutMs: 90_000, log }))) {
        return false;
    }
    await settleScene();
    for (const spell of ORB_SPELLS) {
        const gate = locById(LQ_LOC_ID.MAGIC_GATE, 8, 'Open');
        if (!gate) {
            log('no ancient gate in range of the magic trial stand');
            return false;
        }
        if (!(await Game.castOnLoc(spell, gate))) {
            continue;
        }
        if (await Execution.delayUntil(() => pocket() === 'winchRoom', 20_000)) {
            await settleScene();
            return true;
        }
    }
    log('no charge-orb spell moved the magic gate — level, runes or orb short');
    return false;
}

// Why: from the north the gate pulls anyone who touches it straight through for free, which is the return trip.

/** Let the magic gate pull us back south into the gem room. */
export async function fallThroughMagicGate(log: (m: string) => void): Promise<boolean> {
    if (pocket() === 'gemRoom') {
        return true;
    }
    const ok = await promptLoc(
        {
            name: LQ_LOC.ANCIENT_GATE,
            op: 'Open',
            near: LQ_TILE.MAGIC_GATE_NORTH,
            within: 8,
            id: LQ_LOC_ID.MAGIC_GATE,
            expect: () => pocket() === 'gemRoom',
            expectMs: 20_000
        },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

/** Tie the rope to the winch and climb down into the Viyeldi caves. */
export async function climbDownWinch(log: (m: string) => void): Promise<boolean> {
    if (legendsPocket(Game.tile()) === 'viyeldiLedge') {
        return true;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.WINCH, { radius: 3, attempts: 4, timeoutMs: 90_000, log }))) {
        return false;
    }
    await settleScene();
    const roped = (): Loc | null => locById(LQ_LOC_ID.WINCH_ROPE, 8, 'Climb-down');
    // Why: the rope is thrown over for thirty ticks and then falls off again, so tying it and climbing it are one pass rather than two steps.
    // Why: the tie is what sets `legends_tied_rope_winch`, and from then on the beams hand the rope back to a Search rather than wanting another one.
    for (let i = 0; i < WINCH_ATTEMPTS; i++) {
        if (legendsPocket(Game.tile()) === 'viyeldiLedge') {
            return true;
        }
        if (!roped()) {
            const beams = locById(LQ_LOC_ID.WINCH_NO_ROPE, 8, 'Search');
            if (beams && (await beams.interact('Search'))) {
                await Execution.delayUntil(() => roped() !== null, 6000);
            }
        }
        if (!roped() && heldId(LQ_ID.ROPE) > 0) {
            await useOnLoc(
                LQ_ID.ROPE,
                { name: LQ_LOC.WINCH, near: LQ_TILE.WINCH, within: 8, id: LQ_LOC_ID.WINCH_NO_ROPE },
                [],
                () => roped() !== null,
                log
            );
        }
        if (!roped()) {
            log('the winch will not hold a rope');
            await Execution.delayTicks(2);
            continue;
        }
        const ok = await promptLoc(
            {
                name: LQ_LOC.WINCH,
                op: 'Climb-down',
                near: LQ_TILE.WINCH,
                within: 8,
                id: LQ_LOC_ID.WINCH_ROPE,
                prefer: ["Yes, I'll shimmy down the rope"],
                expect: () => legendsPocket(Game.tile()) === 'viyeldiLedge',
                expectMs: 25_000
            },
            log
        );
        if (ok) {
            await settleScene();
            return true;
        }
    }
    log('six goes at the winch and the rope never took us down');
    return false;
}

/** Climb the rope back out of the Viyeldi caves into the winch room. */
export async function climbUpRope(log: (m: string) => void): Promise<boolean> {
    if (pocket() === 'winchRoom') {
        return true;
    }
    const ok = await promptLoc(
        {
            name: LQ_LOC.CLIMB_ROPE,
            op: 'Climb',
            near: LQ_TILE.VIYELDI_LEDGE,
            within: 6,
            expect: () => pocket() === 'winchRoom',
            expectMs: 20_000
        },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

// Why: the descent is nine one-way crossings and every one of them is a scripted teleport, so the leg is written once as an ordered chain and each rung is a no-op when it is already behind us.

/** The trials descent as far as the gem room, where the Book of Binding is conjured. */
export async function descendToGemRoom(log: (m: string) => void): Promise<boolean> {
    if (past('gemRoom')) {
        return true;
    }
    // Why: the flames are as solid to the pathfinder as they are to the player, so a descent that starts beside Ungadulu steps out of his octagram first.
    if (!(await leaveOctagram(log))) {
        return false;
    }
    if (!(await openOuterGate(log))) {
        return false;
    }
    for (const boulder of BOULDERS) {
        if (!(await mineBoulder(boulder, false, log))) {
            return false;
        }
    }
    if (!(await openInnerGate(false, log))) {
        return false;
    }
    if (!(await jumpJaggedWall(false, log))) {
        return false;
    }
    return crossMarkedWall(false, log);
}

// Why: the magic gate is the one-way crossing out of the gem room, so anything that still needs the gems has to stop short of it.

/** The trials descent, from the shaman cave to the winch. */
export async function descendToWinch(log: (m: string) => void): Promise<boolean> {
    if (past('winchRoom')) {
        return true;
    }
    if (!(await descendToGemRoom(log))) {
        return false;
    }
    return castMagicGate(log);
}

/** The trials ascent, from the winch back to the shaman cave. */
export async function climbOutOfTrials(log: (m: string) => void): Promise<boolean> {
    const at = pocket();
    if (at === null || at === 'shamanCave' || at === 'octagram') {
        return true;
    }
    if (at === 'viyeldiLedge' && !(await climbUpRope(log))) {
        return false;
    }
    if (pocket() === 'winchRoom' && !(await fallThroughMagicGate(log))) {
        return false;
    }
    if (pocket() === 'gemRoom' && !(await crossMarkedWall(true, log))) {
        return false;
    }
    if (pocket() === 'wallRoom' && !(await jumpJaggedWall(true, log))) {
        return false;
    }
    if (pocket() === 'trials' && !(await openInnerGate(true, log))) {
        return false;
    }
    for (const boulder of [...BOULDERS].reverse()) {
        if (pocket() === boulder.to && !(await mineBoulder(boulder, true, log))) {
            return false;
        }
    }
    if (pocket() === 'outerGate' && !(await leaveOuterGate(log))) {
        return false;
    }
    return crawlBackFromCrevice(log);
}

/** Walk back out of the cave mouth into the jungle. */
export async function leaveShamanCave(log: (m: string) => void): Promise<boolean> {
    if (legendsArea(Game.tile()) !== 'shamanCaves') {
        return true;
    }
    // Why: the two mouth locs sit at (2772,9342) and (2773,9342) with cave wall around them, and the op only lands from the tile below. `Reach` counts a couple of tiles short as arrived, and from (2774,9339) the server answers that it cannot be reached, which spends the prompt's retry budget without a word and strands the run underground.
    await Traversal.walkResilient(LQ_TILE.CAVE_EXIT, { radius: 0, attempts: 3, timeoutMs: 60_000, log });
    const ok = await promptLoc(
        {
            name: LQ_LOC.CAVE_ENTRANCE,
            op: 'Walk through',
            near: LQ_TILE.CAVE_EXIT,
            expect: () => legendsArea(Game.tile()) === 'jungle'
        },
        log
    );
    if (ok) {
        await settleScene();
    } else {
        // Why: this is the last thing between the shaman cave and every errand above ground, and it failed without a word. One walk, an arrival, and a step that gave up. What it could see from where it stood is the question.
        const at = Game.tile();
        const door = locNear(LQ_LOC.CAVE_ENTRANCE, 'Walk through', 8);
        log(`the cave entrance would not let us out — stood at (${at?.x},${at?.z}), '${LQ_LOC.CAVE_ENTRANCE}' ${door ? 'in range' : 'not in range'}`);
    }
    return ok;
}

// Why: Touch only crosses once the demon is dead, before that `legends_touch_fire_wall` burns you for four, and the bowl crosses either way, so a dose is spent when one is carried.
// Why: the bowl holds ten doses rather than one, so spending one on the way out costs nothing the quest needs back.

/** Step back out of the octagram. */
export async function leaveOctagram(log: (m: string) => void): Promise<boolean> {
    if (!inOctagram(Game.tile())) {
        return true;
    }
    if (heldId(LQ_ID.GOLD_BOWL_BLESSED_PURE) > 0) {
        const splashed = await useOnLoc(
            LQ_ID.GOLD_BOWL_BLESSED_PURE,
            { name: LQ_LOC.FIRE_WALL, near: LQ_TILE.OCTAGRAM_INSIDE, within: 6 },
            [],
            () => !inOctagram(Game.tile()),
            log
        );
        if (splashed) {
            await settleScene();
            return true;
        }
    }
    const ok = await promptLoc(
        {
            name: LQ_LOC.FIRE_WALL,
            op: 'Touch',
            near: LQ_TILE.OCTAGRAM_INSIDE,
            within: 6,
            expect: () => !inOctagram(Game.tile())
        },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}
