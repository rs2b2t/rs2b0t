import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Npc } from '../../../../model/Npc.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import type Tile from '../../../../../geometry/Tile.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { driveDialog, openDialogue, pickPreferred } from '../../exec/primitives.js';
import { driveUntil, heldId, promptLoc, settleScene } from '../../exec/prompts.js';
import { FILLIMAN, inSwamp, NS_ID, NS_LOC, NS_NAME, NS_TILE } from './areas.js';
import { NS_FLAG } from './journal.js';

const findSpirit = (): Npc | null => Npcs.query().name(FILLIMAN.npc).within(8).nearest();

async function reachCamp(log: (m: string) => void): Promise<boolean> {
    return Traversal.walkResilient(NS_TILE.CAMP, { radius: 3, attempts: 4, timeoutMs: 300_000, log });
}

const LEAVE = ['Ok, thanks.', 'Ok thanks.'];

// Why: every topic in Filliman's tree ends by re-offering the same list, so a prefer list naming one picks it again on every pass and the conversation only ends when the driver gives up.
// Why: the topic is therefore taken once and the goodbye taken from then on.

/** Drive an open dialogue, taking `topic` once and then leaving. */
async function driveOnce(topic: string, log: (m: string) => void): Promise<boolean> {
    let taken = false;
    for (let i = 0; i < 40; i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const options = ChatDialog.options();
        if (options.length > 0) {
            const leave = pickPreferred(options, LEAVE);
            const pick = (taken ? null : pickPreferred(options, [topic])) ?? leave;
            if (!pick) {
                log(`no '${topic}' and no goodbye in [${options.join(' | ')}]`);
                return false;
            }
            if (pick !== leave) {
                taken = true;
            }
            await ChatDialog.chooseOption(pick);
            await Execution.delayTicks(2);
            continue;
        }
        if (!ChatDialog.isOpen()) {
            return true;
        }
        await Execution.delayTicks(1);
    }
    return !ChatDialog.isOpen();
}

// Why: the spirit is npc_add'ed by `Enter` on the grotto door and despawns after 100 ticks, so an empty camp is answered by knocking rather than by waiting.
// Why: below the ritual stage the same op opens his dialogue, which is why the prefer list is driven straight off the door.

/** Summon the spirit, take `topic` once if there is one, then leave. */
export async function talkFilliman(topic: string | null, log: (m: string) => void): Promise<boolean> {
    if (!(await reachCamp(log))) {
        return false;
    }
    await settleScene();
    const drive = async (): Promise<boolean> => (topic === null ? driveDialog(LEAVE, log) : driveOnce(topic, log));
    if (findSpirit()) {
        if (!(await openDialogue(FILLIMAN.npc, log))) {
            return false;
        }
        return drive();
    }
    const door = Locs.query().name(NS_LOC.GROTTO_DOOR).action('Enter').within(8).nearest();
    if (!door) {
        log('no grotto door at the camp to summon the spirit with');
        return false;
    }
    if (!(await door.interact('Enter'))) {
        return false;
    }
    await Execution.delayUntil(() => findSpirit() !== null || ChatDialog.isOpen() || ChatDialog.canContinue(), 8000);
    return drive();
}

/** The spirit, summoned if he has despawned. */
async function ensureSpirit(log: (m: string) => void): Promise<boolean> {
    if (findSpirit()) {
        return true;
    }
    if (!(await talkFilliman(null, log))) {
        return false;
    }
    await settleScene();
    return findSpirit() !== null;
}

// Why: taking the washing bowl is what uncovers the mirror underneath it, and the mirror is a second ground spawn rather than a drop.

/** Take the bowl, take the mirror it uncovers, then show the mirror to the spirit. */
export async function mirrorLeg(log: (m: string) => void): Promise<boolean> {
    if (heldId(NS_ID.MIRROR) === 0) {
        if (!(await Traversal.walkResilient(NS_TILE.BOWL, { radius: 1, attempts: 3, timeoutMs: 180_000, log }))) {
            return false;
        }
        await settleScene();
        const mirror = GroundItems.query().name(NS_NAME.MIRROR).within(4).nearest();
        if (mirror) {
            await mirror.interact('Take');
            return Execution.delayUntil(() => heldId(NS_ID.MIRROR) > 0, 6000);
        }
        const bowl = GroundItems.query().name(NS_NAME.BOWL).within(4).nearest();
        if (!bowl) {
            log(`no ${NS_NAME.BOWL} at (${NS_TILE.BOWL.x},${NS_TILE.BOWL.z}) — the mirror is already taken`);
            return false;
        }
        if (!(await bowl.interact('Take'))) {
            return false;
        }
        return Execution.delayUntil(() => GroundItems.query().name(NS_NAME.MIRROR).within(4).nearest() !== null, 6000);
    }
    if (!(await ensureSpirit(log))) {
        return false;
    }
    const target = findSpirit();
    const mirror = Inventory.items().find(i => i.id === NS_ID.MIRROR);
    if (!target || !mirror) {
        return false;
    }
    // Why: the mirror is never deleted — the spirit hands it back — so the dialogue completing is the only oracle this leg has.
    if (!(await mirror.useOn(target))) {
        return false;
    }
    return driveDialog(['Ok, thanks.', 'Ok thanks.'], log);
}

/** Search the grotto tree for Tarlock's journal, then hand it over. */
export async function journalLeg(log: (m: string) => void): Promise<boolean> {
    if (heldId(NS_ID.JOURNAL) === 0) {
        return promptLoc({
            name: NS_LOC.GROTTO_TREE,
            op: 'Search',
            near: NS_TILE.GROTTO_TREE,
            expect: () => heldId(NS_ID.JOURNAL) > 0
        }, log);
    }
    if (!(await ensureSpirit(log))) {
        return false;
    }
    const target = findSpirit();
    const journal = Inventory.items().find(i => i.id === NS_ID.JOURNAL);
    if (!target || !journal) {
        return false;
    }
    if (!(await journal.useOn(target))) {
        return false;
    }
    return driveUntil(() => heldId(NS_ID.JOURNAL) === 0, ['Ok thanks.', 'Ok, thanks.'], log);
}

/** The option that hands over the bloom scroll. */
export async function askToHelp(log: (m: string) => void): Promise<boolean> {
    if (!(await talkFilliman('How can I help?', log))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(NS_ID.SPELL) > 0, 6000);
}

const BLOOMABLE: readonly string[] = [NS_LOC.LOG, NS_LOC.BRANCH, NS_LOC.BUSH];
const PICKABLE: readonly (readonly [string, string])[] = [
    [NS_LOC.FUNGI_LOG, 'Pick'],
    [NS_LOC.BUDDING_BRANCH, 'Take-cutting'],
    [NS_LOC.PEAR_BUSH, 'Pick']
];

/** A bloomed loc within reach, or null. */
export function pickable(within = 10): { name: string; op: string } | null {
    for (const [name, op] of PICKABLE) {
        if (Locs.query().name(name).action(op).within(within).nearest()) {
            return { name, op };
        }
    }
    return null;
}

// Why: the bloom affects the eight tiles around the caster and not the caster's own, and every bloomable is blockwalk=no — so standing on one is the way to miss it.

// Why: every bloomable is inside Mort Myre, and the blessing that precedes this leg happens in the mausoleum — a scene query from there sees no swamp at all.

/** Stand next to something bloomable, never on it. */
export async function standBeside(log: (m: string) => void, names: readonly string[] = BLOOMABLE): Promise<boolean> {
    if (!inSwamp(Game.tile())) {
        if (!(await reachCamp(log))) {
            return false;
        }
        await settleScene();
    }
    const beside = (): boolean => {
        const here = Game.tile();
        if (!here) {
            return false;
        }
        return names.some(name => Locs.query().name(name)
            .where(l => l.tile().distanceTo(here) === 1).nearest() !== null);
    };
    if (beside()) {
        return true;
    }
    const target = names.map(name => Locs.query().name(name).within(40).nearest()).find(l => l !== null && l !== undefined);
    if (!target) {
        log('nothing bloomable within 40 tiles');
        return false;
    }
    const at = target.tile();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const stand: Tile = at.translate(dx, dz);
        if (await Traversal.walkResilient(stand, { radius: 0, attempts: 2, timeoutMs: 120_000, log })) {
            await settleScene();
            if (beside()) {
                return true;
            }
        }
    }
    return beside();
}

/** Take one item off whatever bloomed. */
async function pickHarvest(log: (m: string) => void): Promise<boolean> {
    const target = pickable();
    if (!target) {
        log('nothing bloomed within reach');
        return false;
    }
    const before = Inventory.used();
    const loc = Locs.query().name(target.name).action(target.op).within(10).nearest();
    if (!loc || !(await loc.interact(target.op))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.used() > before, 8000);
}

// Why: a bloomed loc reverts 25 ticks after it grows, so casting and picking cannot be two decide ticks — a resume that finds neither a fungus nor a bloom has to do both in one step.

/** Cast the paper scroll beside a rotting log and take the fungus it grows. */
export async function bloomWithScroll(log: (m: string) => void): Promise<boolean> {
    for (let cycle = 0; cycle < 8 && heldId(NS_ID.FUNGI) === 0; cycle++) {
        if (pickable()) {
            await pickHarvest(log);
            continue;
        }
        if (!(await standBeside(log, [NS_LOC.LOG]))) {
            return false;
        }
        const scroll = Inventory.items().find(i => i.id === NS_ID.SPELL);
        if (!scroll) {
            log('no Druidic spell held — Filliman re-issues one on request');
            return false;
        }
        if (!(await scroll.interact('Cast'))) {
            return false;
        }
        await Execution.delayUntil(() => pickable() !== null, 8000);
    }
    return heldId(NS_ID.FUNGI) > 0;
}

// Why: all three ritual stones render as "Stone" and sit on adjacent tiles, so each is addressed by its own tile rather than by a nearest-match.

/** Use a carried item on one named stone. */
async function useOnStone(itemId: number, at: Tile, expect: () => boolean, log: (m: string) => void): Promise<boolean> {
    if (expect()) {
        return true;
    }
    if (!(await Traversal.walkResilient(at, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    const stone = Locs.query().name(NS_LOC.STONE).where(l => l.tile().distanceTo(at) === 0).nearest();
    const item = Inventory.items().find(i => i.id === itemId);
    if (!stone || !item) {
        log(`no stone at (${at.x},${at.z}) or no item ${itemId} to place on it`);
        return false;
    }
    if (!(await item.useOn(stone))) {
        return false;
    }
    return driveUntil(expect, ['Ok, thanks.', 'Ok thanks.'], log);
}

// Why: each stone consumes what it is given, so a fed stone must never be re-fed — the journal flags say which are done.

/** Feed the fungus to the nature stone and the spent scroll to the spirit stone. */
export async function feedStones(flags: ReadonlySet<string>, log: (m: string) => void): Promise<boolean> {
    if (!flags.has(NS_FLAG.NATURE)) {
        if (heldId(NS_ID.FUNGI) === 0) {
            log('no Mort myre fungi held for the nature stone');
            return false;
        }
        return useOnStone(NS_ID.FUNGI, NS_TILE.NATURE_STONE, () => heldId(NS_ID.FUNGI) === 0, log);
    }
    const scroll = heldId(NS_ID.SPELL_USED) > 0 ? NS_ID.SPELL_USED : NS_ID.SPELL;
    if (heldId(scroll) === 0) {
        log('no bloom scroll held for the spirit stone');
        return false;
    }
    return useOnStone(scroll, NS_TILE.SPIRIT_STONE, () => heldId(scroll) === 0, log);
}

// Why: the ritual is judged on the player's own tile — `coord = 0_53_52_48_7` — so the faith stone is stood on rather than used.

// Why: the summon is `Enter` on the grotto door, two tiles off the faith stone, so the spirit is called up first and the stone taken second — the other order puts the puzzle option on screen from the wrong tile.

/** Stand on the faith stone and tell the spirit the puzzle is solved. */
export async function solvePuzzle(log: (m: string) => void): Promise<boolean> {
    if (!(await ensureSpirit(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(NS_TILE.FAITH_STONE, { radius: 0, attempts: 4, timeoutMs: 180_000, log }))) {
        log('could not reach the faith stone');
        return false;
    }
    const here = Game.tile();
    if (!here || here.x !== NS_TILE.FAITH_STONE.x || here.z !== NS_TILE.FAITH_STONE.z) {
        log(`standing at (${here?.x},${here?.z}) rather than on the faith stone — the ritual is judged on the tile`);
        return false;
    }
    await settleScene();
    if (!findSpirit()) {
        log('the spirit despawned between the summon and the stone');
        return false;
    }
    if (!(await openDialogue(FILLIMAN.npc, log))) {
        return false;
    }
    // Why: the option is judged against the tile the character is standing on when it is chosen, so a talk that walked us off the stone is abandoned rather than answered.
    const at = Game.tile();
    if (!at || at.x !== NS_TILE.FAITH_STONE.x || at.z !== NS_TILE.FAITH_STONE.z) {
        log(`the talk moved the character to (${at?.x},${at?.z}) — off the faith stone`);
        return false;
    }
    return driveOnce("I think I've solved the puzzle!", log);
}
