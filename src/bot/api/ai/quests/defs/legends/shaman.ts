import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Skills } from '../../../../skills/Skills.js';
import { Reach } from '../../../../walking/Reach.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { LQ_ID, LQ_LOC, LQ_LOC_ID, LQ_NPC, LQ_TILE, inOctagram } from './areas.js';
import { drinkPrayer } from './fight.js';
import { enterJungle, leaveJungle, summonGujuo, talkGujuoStatus, type GujuoTalk } from './jungle.js';
import { climbOutOfTrials, leaveOctagram } from './trials.js';
import { driveBoxes, driveToEnd, driveUntil, heldId, here, locNear, modalText, offerTo, promptLoc, settleScene, useOnLoc } from './scene.js';

const CRAWL_ATTEMPTS = 6;

/** The 3 mossy rocks that hide the shaman cave, by id. */
const ROCK_IDS: readonly number[] = [LQ_LOC_ID.MOSSY_ROCK_1, LQ_LOC_ID.MOSSY_ROCK_2, LQ_LOC_ID.MOSSY_ROCK_3];

// Why: The crawl has a level-50 gate, then an Agility roll; failure costs 5 HP without moving the player.

/** Squeeze through the rocks in the north-west jungle into Ungadulu's cave. */
export async function enterShamanCave(log: (m: string) => void): Promise<boolean> {
    if (here() === 'shamanCaves') {
        return true;
    }
    if (!(await enterJungle(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.MOSSY_ROCKS, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    for (let i = 0; i < CRAWL_ATTEMPTS; i++) {
        if (here() === 'shamanCaves') {
            await settleScene();
            return true;
        }
        // Why: Jungle ore veins share these names, so match the three cave-mouth ids.
        const rock = Locs.query().where(l => ROCK_IDS.includes(l.id)).action('Search').within(8).nearest();
        if (!rock) {
            log('no mossy rock offering Search near the cave mouth');
            return false;
        }
        if (!(await rock.interact('Search'))) {
            continue;
        }
        await driveUntil(() => here() === 'shamanCaves', ["Yes, I'll crawl through"], log, 25_000);
    }
    log('six crawls and still outside the shaman cave');
    return false;
}

// Why: "Who are you?" unlocks Gujuo's pure-water branch and must be asked before the water question.
const UNGADULU_PREFER = ['Who are you?', 'Where do I get pure water from?'];

/** Talk to Ungadulu through the flames until he has named the sacred water. */
export async function speakToUngadulu(log: (m: string) => void): Promise<boolean> {
    // Why: From inside the ring, Investigate opens a different menu outside this driver's preference list.
    if (inOctagram(Game.tile()) && !(await leaveOctagram(log))) {
        log('cannot get out of the octagram to talk to Ungadulu through the flames');
        return false;
    }
    if (!(await enterShamanCave(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.FIRE_WALL_WEST, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    const wall = locNear(LQ_LOC.FIRE_WALL, 'Investigate', 6);
    if (!wall) {
        log('no fire wall offering Investigate beside the octagram');
        return false;
    }
    if (!(await wall.interact('Investigate'))) {
        return false;
    }
    // The message box appears before the option list.
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) {
        log('the fire wall raised nothing — is Ungadulu still in the octagram?');
        return false;
    }
    // Why: Require "Who are you?" because a missing Ungadulu produces two boxes and no menu, which otherwise looks successful.
    return driveToEnd(UNGADULU_PREFER, log, 60_000, 'Who are you?');
}

// Why: The last two choices finish the dialogue after Gujuo gives the sketch.
const GUJUO_WATER_PREFER = [
    'I need some pure water to douse some magic flames.',
    'Where is the pool of sacred water?',
    'What kind of a vessel?',
    'Ungadulu looks a little strange.',
    'How do I bless the vessel?',
    'Ok thanks for your help.'
];

// Why: Receiving the sketch also advances the stage, so the item proves success without reading the journal.

const gujuoWaterTalk = talkGujuoStatus(
    GUJUO_WATER_PREFER,
    () => heldId(LQ_ID.GOLD_BOWL_SKETCH) > 0,
    120_000
);

// Why: A menu without the water topic means the invisible Ungadulu bit still needs setting; no dialogue is retried locally.

/** Next action after trying Gujuo's water dialogue. */
export function waterTalkAnswer(talk: GujuoTalk): 'done' | 'retry' | 'caves' {
    if (talk === 'goal') {
        return 'done';
    }
    return talk === 'nodialog' ? 'retry' : 'caves';
}

/** Ask Gujuo where the pure water comes from, going back to Ungadulu if he cannot say. */
export async function askGujuoForWater(log: (m: string) => void): Promise<boolean> {
    const first = await gujuoWaterTalk(log);
    if (waterTalkAnswer(first) === 'done') {
        return true;
    }
    if (waterTalkAnswer(first) === 'retry') {
        log('Gujuo would not open a dialogue — trying him again rather than walking the caves for a bit he never spoke about');
        return (await gujuoWaterTalk(log)) === 'goal';
    }
    log('Gujuo has no pure-water topic — Ungadulu has not been asked who he is');
    if (!(await speakToUngadulu(log))) {
        return false;
    }
    const after = await gujuoWaterTalk(log);
    if (after !== 'goal') {
        log(`back from Ungadulu and the sketch still did not come — ${after === 'nodialog' ? 'no conversation happened' : 'no topic on his menu'}`);
    }
    return after === 'goal';
}

// Why: These paths reach the blessing offer; goodbye options leave the bowl unchanged.
const BLESS_PREFER = [
    "Yes, I'd like you to bless my gold bowl.",
    "Yes, I'd like to bless my gold bowl.",
    'How do I bless the vessel?',
    'What kind of a vessel?',
    'I need some pure water to douse some magic flames.'
];

// Why: Using the bowl on Gujuo opens the blessing menu directly.

/** Gujuo blesses the bowl; the trance rolls against prayer and re-offers on a miss. */
export async function blessBowl(log: (m: string) => void): Promise<boolean> {
    const blessed = (): boolean =>
        heldId(LQ_ID.GOLD_BOWL_BLESSED) > 0 || heldId(LQ_ID.GOLD_BOWL_BLESSED_PURE) > 0 || heldId(LQ_ID.GOLD_BOWL_BLESSED_WATER) > 0;
    if (blessed()) {
        return true;
    }
    if (!(await summonGujuo(log))) {
        return false;
    }
    // Why: The use-on sometimes produces no dialogue, so retry the offer after a short wait.
    for (let i = 0; i < BLESS_ATTEMPTS; i++) {
        const gujuo = Npcs.query().name(LQ_NPC.GUJUO).within(12).nearest();
        if (!gujuo) {
            log('no Gujuo in range for the bowl');
            return false;
        }
        if (!(await topUpPrayer(log))) {
            log(`prayer at ${Skills.effective('prayer')} with nothing left to drink, and the trance refuses below ${BLESS_FLOOR}`);
            return false;
        }
        const offered = await offerTo(LQ_ID.GOLD_BOWL, gujuo, log);
        const outcome = offered ? await driveBlessing(blessed) : 'quiet';
        if (outcome === 'blessed') {
            return true;
        }
        if (needsDose(outcome, Skills.effective('prayer'))) {
            await drinkPrayer(log);
        }
        log(`bowl on Gujuo ${offered ? 'sent' : 'refused'} at ${gujuo.tile().x},${gujuo.tile().z}, prayer ${Skills.effective('prayer')}/${Skills.level('prayer')}, trance ${outcome}`);
        await settleScene();
    }
    log(`Gujuo took the bowl ${BLESS_ATTEMPTS} times and never blessed it`);
    return blessed();
}

// Why: Starting at 99 Prayer can take 11 misses to reach the optimal 42; 20 attempts leave margin beyond that worst case.
const BLESS_ATTEMPTS = 20;

// Why: A miss drains 5 Prayer and closes the dialogue when that drops below Gujuo's level-42 gate.
const BLESS_MS = 40_000;

// Why: The trance has 12 ticks of overhead dialogue with no widget, so shorter waits would retry before it resolves.

/** Idle ticks that end the wait, longer than the trance's own 12 of silence. */
const BLESS_IDLE_TICKS = 20;

/** Result inferred from Gujuo's dialogue. */
export type Trance = 'blessed' | 'refused' | 'missed' | 'quiet';

/** The trance failed after consuming 5 Prayer. */
const BLESS_MISSED = /deep enough trance/;

/** The server rejected the attempt for being below the Prayer gate. */
const BLESS_REFUSED = /too inexperienced/;

/** Drive Gujuo's trance, ending once it blesses the bowl or the conversation closes without it. */
async function driveBlessing(blessed: () => boolean): Promise<Trance> {
    let opened = false;
    let idle = 0;
    let missed = false;
    let refused = false;
    const ended = (): boolean => {
        if (blessed()) {
            return true;
        }
        const said = modalText();
        missed = missed || BLESS_MISSED.test(said);
        refused = refused || BLESS_REFUSED.test(said);
        if (ChatDialog.isOpen() || ChatDialog.canContinue() || Modals.isOpen()) {
            opened = true;
            idle = 0;
            return false;
        }
        idle++;
        return opened && idle >= BLESS_IDLE_TICKS;
    };
    // Why: `driveBoxes` checks between clicks, preserving the failure text that `driveChoice` would dismiss.
    await driveBoxes(ended, BLESS_MS, BLESS_PREFER);
    if (blessed()) {
        return 'blessed';
    }
    if (refused) {
        return 'refused';
    }
    return missed ? 'missed' : 'quiet';
}

// Why: The stat block can lag by two ticks, so account for the 5-point miss and trust a server refusal immediately.

/** The points `gujuo_bless_bowl` takes on a miss. */
const BLESS_MISS_COST = 5;

/** Whether another attempt needs a Prayer dose. */
export function needsDose(outcome: Trance, points: number): boolean {
    if (outcome === 'refused') {
        return true;
    }
    return outcome === 'missed' && points - BLESS_MISS_COST < BLESS_FLOOR;
}

/** Minimum Prayer accepted by Gujuo. */
const BLESS_FLOOR = 42;

// Why: The miss roll rises about 1.73 per Prayer point, from 3 in 5 at level 42 to 98 in 100 at level 99, so hold at the minimum.

/** Prayer target for each attempt. */
export function blessPrayerFloor(): number {
    return BLESS_FLOOR;
}

/** Restore Prayer to Gujuo's minimum. */
async function topUpPrayer(log: (m: string) => void): Promise<boolean> {
    return Skills.effective('prayer') >= blessPrayerFloor() ? true : drinkPrayer(log);
}

const BOWL_ATTEMPTS = 6;

// Why: The anvil has no ops, and failed forging can consume one or both bars, so retry while two remain.

/** Hammer 2 gold bars into a golden bowl at the Tai Bwo Wannai anvil. */
export async function makeGoldenBowl(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.GOLD_BOWL) > 0) {
        return true;
    }
    if (!(await leaveJungle(log))) {
        return false;
    }
    for (let i = 0; i < BOWL_ATTEMPTS; i++) {
        if (heldId(LQ_ID.GOLD_BOWL) > 0) {
            return true;
        }
        if (heldId(LQ_ID.GOLD_BAR) < 2) {
            log('fewer than two gold bars left for the bowl');
            return false;
        }
        await useOnLoc(
            LQ_ID.GOLD_BAR,
            { name: LQ_LOC.ANVIL, near: LQ_TILE.ANVIL },
            ['Yes'],
            () => heldId(LQ_ID.GOLD_BOWL) > 0,
            log
        );
    }
    return heldId(LQ_ID.GOLD_BOWL) > 0;
}

/** Cut a hollow reed at the sacred pool; the knife and the machete both work. */
export async function cutReed(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.HOLLOW_REED) > 0) {
        return true;
    }
    if (!(await enterJungle(log))) {
        return false;
    }
    const tool = heldId(LQ_ID.KNIFE) > 0 ? LQ_ID.KNIFE : LQ_ID.MACHETE;
    return useOnLoc(
        tool,
        { name: LQ_LOC.TALL_REEDS, near: LQ_TILE.TALL_REEDS },
        [],
        () => heldId(LQ_ID.HOLLOW_REED) > 0,
        log
    );
}

// Why: Only the reed reaches the water through the rocks, and siphoning consumes it.

/** Syphon the jungle pool into the blessed bowl. */
export async function fillBowlFromPool(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.GOLD_BOWL_BLESSED_PURE) > 0) {
        return true;
    }
    if (!(await cutReed(log))) {
        return false;
    }
    return useOnLoc(
        LQ_ID.HOLLOW_REED,
        { name: LQ_LOC.SACRED_WATER, near: LQ_TILE.SACRED_POOL, id: LQ_LOC_ID.SACRED_WATER },
        [],
        () => heldId(LQ_ID.GOLD_BOWL_BLESSED_PURE) > 0,
        log
    );
}

// Why: Using the reed after germination advances the quest to `water_pool_dried_up`.

/** Touch the dried pool, which is what starts the hunt for the source. */
export async function findPoolDried(log: (m: string) => void): Promise<boolean> {
    if (!(await cutReed(log))) {
        return false;
    }
    const dry = (): boolean => locNear(LQ_LOC.POLLUTED_WATER, 'Look', 8) !== null;
    return useOnLoc(
        LQ_ID.HOLLOW_REED,
        { name: LQ_LOC.SACRED_WATER, near: LQ_TILE.SACRED_POOL, id: LQ_LOC_ID.SACRED_WATER },
        [],
        dry,
        log
    ) || dry();
}

// Why: Use the west wall from its own tile; a nearby diagonal section crosses on the wrong axis.

/** Douse the flames with pure water and step into the octagram. */
export async function enterOctagram(log: (m: string) => void): Promise<boolean> {
    if (inOctagram(Game.tile())) {
        return true;
    }
    // Why: Trials pockets also report `shamanCaves`, so leave them before approaching the fire wall.
    if (!(await climbOutOfTrials(log))) {
        return false;
    }
    if (!(await enterShamanCave(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.FIRE_WALL_WEST, { radius: 0, attempts: 4, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    if (heldId(LQ_ID.GOLD_BOWL_BLESSED_PURE) > 0) {
        const splashed = await useOnLoc(
            LQ_ID.GOLD_BOWL_BLESSED_PURE,
            { name: LQ_LOC.FIRE_WALL, near: LQ_TILE.FIRE_WALL_WEST, within: 2 },
            [],
            () => inOctagram(Game.tile()),
            log
        );
        if (splashed) {
            await settleScene();
            return true;
        }
    }
    // Why: Chopping through the dense jungle empties the bowl, so fill it after the last crossing.
    if (heldId(LQ_ID.GOLD_BOWL_BLESSED_PURE) === 0) {
        log('no pure water in the bowl at the flames — the fill has to be the last thing before the cave, as crossing the band boils it off');
    }
    // Why: After the demon dies, Touch crosses the flames without water; keep the attempt bounded because it cannot work earlier.
    const touched = await promptLoc(
        {
            name: LQ_LOC.FIRE_WALL,
            op: 'Touch',
            near: LQ_TILE.FIRE_WALL_WEST,
            within: 2,
            expect: () => inOctagram(Game.tile()),
            expectMs: 6000
        },
        log
    );
    if (touched) {
        await settleScene();
    }
    return touched;
}

/** Open the Book of Binding in front of Ungadulu, which pulls the demon out of him. */
export async function summonDemon(log: (m: string) => void): Promise<boolean> {
    if (!(await enterOctagram(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.OCTAGRAM_INSIDE, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    await settleScene();
    const shaman = Npcs.query().name(LQ_NPC.UNGADULU).within(10).nearest();
    if (!shaman) {
        log('no Ungadulu inside the octagram');
        return false;
    }
    if (!(await offerTo(LQ_ID.BOOK_OF_BINDING, shaman, log))) {
        return false;
    }
    return Execution.delayUntil(() => Npcs.query().name(LQ_NPC.NEZIKCHENED).within(12).exists(), 25_000);
}

const SEEDS_PREFER = [
    'I need to collect some Yommi tree seeds for Gujuo.',
    'I need more Yommi tree seeds.',
    'Ok, thanks...'
];

// Why: After the demon dies, Ungadulu lets the player enter without water.

/** Ask the freed Ungadulu for the 3 Yommi tree seeds. */
export async function askForSeeds(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.YOMMI_SEEDS) > 0 || heldId(LQ_ID.YOMMI_SEEDS_GERM) > 0) {
        return true;
    }
    if (!(await enterOctagram(log))) {
        return false;
    }
    const status = await Reach.npcDialog({ name: LQ_NPC.UNGADULU, near: LQ_TILE.OCTAGRAM_INSIDE, log });
    if (status !== 'done') {
        log('Ungadulu never opened a dialogue');
        return false;
    }
    return driveUntil(() => heldId(LQ_ID.YOMMI_SEEDS) > 0, SEEDS_PREFER, log, 90_000);
}

const GERMINATE_ATTEMPTS = 4;

/** Close the previous dialogue before sending another use-on. */
async function closeChat(log: (m: string) => void): Promise<void> {
    if (!ChatDialog.isOpen() && !ChatDialog.canContinue()) {
        return;
    }
    await driveUntil(() => !ChatDialog.isOpen() && !ChatDialog.canContinue(), [], log, 8_000);
}

/** Germinate the seeds in the bowl of pure water. */
export async function germinateSeeds(log: (m: string) => void): Promise<boolean> {
    const done = (): boolean => heldId(LQ_ID.YOMMI_SEEDS_GERM) > 0;
    if (done()) {
        return true;
    }
    for (let i = 0; i < GERMINATE_ATTEMPTS; i++) {
        // Why: The server drops `opheldu` while Ungadulu's final dialogue page is open.
        await closeChat(log);
        await settleScene();
        const bowl = Inventory.items().find(item => item.id === LQ_ID.GOLD_BOWL_BLESSED_PURE);
        const seeds = Inventory.items().find(item => item.id === LQ_ID.YOMMI_SEEDS);
        if (!bowl || !seeds) {
            log(`pack holds ${bowl ? 'the pure bowl' : `bowls [${bowlsHeld()}]`} and ${seeds ? 'the seeds' : 'no seeds'}`);
            return false;
        }
        // Why: `opheldu` runs the second item's handler, which is defined on the bowl.
        const sent = await seeds.useOn(bowl);
        // Why: The germinated seeds are added only after `~doubleobjbox` is dismissed.
        if (sent && await driveUntil(done, [], log, 20_000)) {
            return true;
        }
        log(`seeds on bowl ${sent ? 'sent' : 'refused'}, chat "${modalText().slice(0, 60)}"`);
    }
    return done();
}

/** Which bowls are in the pack, for when the pure one isn't. */
function bowlsHeld(): string {
    const names: Record<number, string> = {
        [LQ_ID.GOLD_BOWL]: 'plain',
        [LQ_ID.GOLD_BOWL_BLESSED]: 'blessed',
        [LQ_ID.GOLD_BOWL_WATER]: 'water',
        [LQ_ID.GOLD_BOWL_PURE]: 'pure',
        [LQ_ID.GOLD_BOWL_BLESSED_WATER]: 'blessed+water'
    };
    return Object.entries(names).filter(([id]) => heldId(Number(id)) > 0).map(([, name]) => name).join(', ') || 'none';
}
