// docs/reference/quest-primitives.md
import { reader } from '../../../../adapter/ClientAdapter.js';
import { ChatDialog } from '../../../ui/dialogue/ChatDialog.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import { Inventory, type InvItem } from '../../../inventory/Inventory.js';
import { Locs } from '../../../locs/Locs.js';
import { Modals } from '../../../ui/widgets/Modals.js';
import { Reach } from '../../../walking/Reach.js';
import { Traversal } from '../../../walking/Traversal.js';
import type Tile from '../../../../geometry/Tile.js';
import type { NpcStop } from './primitives.js';
import { driveChoice, promptLoc, settleScene } from './prompts.js';

const CLIMB_MS = 12_000;
const WALK_MS = 120_000;

// Why: the scene keeps the shut id for a tick after the Open lands, so one check calls a successful open a failure.

/** Open a shut container and wait for its open twin to appear in the scene. */
export async function openContainer(
    name: string,
    shutId: number,
    openId: number,
    stand: Tile,
    log: (m: string) => void
): Promise<boolean> {
    const open = () => Locs.query().within(6).where(l => l.id === openId).nearest();
    for (let attempt = 0; attempt < 3; attempt++) {
        if (open()) {
            return true;
        }
        await promptLoc({
            name,
            op: 'Open',
            near: stand,
            id: shutId,
            within: 6,
            expect: () => open() !== null
        }, log);
        await settleScene();
    }
    if (open()) {
        return true;
    }
    log(`the shut ${name.toLowerCase()} (${shutId}) never became ${openId}`);
    return false;
}

/** Climb a loc that changes level, proving the arrival rather than the click. */
export async function climb(
    locId: number,
    op: string,
    stand: Tile,
    arrive: Tile,
    log: (m: string) => void
): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === arrive.level) {
        return true;
    }
    if (!(await Traversal.walkResilient(stand, { radius: 1, attempts: 3, timeoutMs: WALK_MS, log }))) {
        return false;
    }
    const loc = Locs.query().action(op).within(4).where(l => l.id === locId).nearest();
    if (!loc) {
        log(`no loc ${locId} offering '${op}' near (${stand.x},${stand.z})`);
        return false;
    }
    if (!(await loc.interact(op))) {
        log(`loc ${locId} refused '${op}'`);
        return false;
    }
    await Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && t.level === arrive.level;
    }, CLIMB_MS);
    await settleScene();
    if (Game.tile()?.level === arrive.level) {
        return true;
    }
    log(`'${op}' on loc ${locId} never reached level ${arrive.level}`);
    return false;
}

// Why: `talkThrough` never walks, and `gotoNpc`'s shared hop calls a stand two tiles off "arrived" without moving.

/** Walk to a stop and drive its dialogue. */
export async function walkAndTalk(
    stop: NpcStop,
    prefer: readonly string[],
    log: (m: string) => void
): Promise<boolean> {
    const here = Game.tile();
    if (!here || stop.anchor.distanceTo(here) > stop.leash || here.level !== stop.anchor.level) {
        await Traversal.walkResilient(stop.anchor, { radius: 2, attempts: 3, timeoutMs: WALK_MS, log });
    }
    const status = await Reach.npcDialog({ name: stop.npc, near: stop.anchor, log });
    if (status !== 'done') {
        log(`could not open a dialogue with ${stop.npc} (${status})`);
        return false;
    }
    return driveChoice([...prefer], log);
}

// Why: `opheldu` is declared on one item of a pair and the client cannot tell which, so a combine that
// only tries one direction fails on half the recipes in the game.

/** Use one carried item on another and wait for the product, trying both directions. */
export async function combineById(
    aId: number,
    bId: number,
    productId: number,
    log: (m: string) => void
): Promise<boolean> {
    const held = (id: number): number =>
        Inventory.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
    if (held(productId) > 0) {
        return true;
    }
    const find = (id: number): InvItem | null => Inventory.items().find(item => item.id === id) ?? null;
    for (const [useId, ontoId] of [[aId, bId], [bId, aId]]) {
        const source = find(useId);
        const target = find(ontoId);
        if (!source || !target) {
            log(`cannot combine ${aId} with ${bId} — one of them is not in the pack`);
            return false;
        }
        if (await source.useOn(target)) {
            if (await Execution.delayUntil(() => held(productId) > 0, 8_000)) {
                return true;
            }
        }
    }
    log(`combining ${aId} with ${bId} produced no ${productId}`);
    return false;
}

// Why: a conversation that signs off with `~mesbox` leaves a main modal up, and the next leg's
// player, npc or trade click is swallowed by it with no refusal to say why.

/** Walk to a stop, drive its dialogue, and clear whatever modal it signed off with. */
export async function talkAndClose(
    stop: NpcStop,
    prefer: readonly string[],
    log: (m: string) => void
): Promise<boolean> {
    const ok = await walkAndTalk(stop, prefer, log);
    if (reader.modals().main !== -1) {
        await Modals.close();
    }
    return ok;
}

// Why: `~mesbox` and `~objbox` build a MAIN modal that no dialogue driver can see, and the curator and the king both use them mid-conversation — a chat-only driver stalls on the first one.

/** Drive a conversation that mixes chat with mesboxes, until the goal lands. */
export async function talkUntil(
    stop: NpcStop,
    prefer: readonly string[],
    expect: () => boolean,
    log: (m: string) => void,
    ms = 45_000
): Promise<boolean> {
    if (expect()) {
        return true;
    }
    await walkAndTalk(stop, prefer, log);
    const deadline = performance.now() + ms;
    while (performance.now() < deadline && !expect()) {
        if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
            await driveChoice([...prefer], log);
            continue;
        }
        if (reader.modals().main !== -1) {
            await Modals.close();
            await Execution.delayTicks(1);
            continue;
        }
        await Execution.delayTicks(1);
    }
    // Why: the closing mesbox stays up after the goal lands, and a main modal blocks the next leg's player interaction.
    if (reader.modals().main !== -1) {
        await Modals.close();
    }
    if (!expect()) {
        log(`${stop.npc} conversation ended without the expected result`);
    }
    return expect();
}

