import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Shop } from '../../../../shop/Shop.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Reach } from '../../../../walking/Reach.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { promptLoc, settleScene } from '../../exec/prompts.js';
import { SM_ID, SM_LOC, SM_LOC_ID, SM_NAME, SM_NPC, SM_TILE } from './areas.js';
import { permSerumVialId, serumVialId } from './supplies.js';

// Why: `book` is opened by `if_openmain`, and its forward-page arrow is a graphic with no label, so the component id is the only handle on it.
/** `book` interface root and its right-arrow button, from interface.pack. */
const BOOK_MODAL = 837;
const BOOK_NEXT = 841;
/** The diary's last page, the one that starts the quest. */
const BOOK_LAST_PAGE = 'index of solution';
const BOOK_PAGES = 16;

const OK_OPTION = /^ok\b/i;

/** Dropped once the serums exist: the temple loadout fills every remaining slot. */
export const JUNK_IDS: readonly number[] = [SM_ID.DIARY, SM_ID.ROTTEN_FOOD, SM_ID.UNID_ROGUES_PURSE];

// Why: several of these menus loop back to themselves after the option that moves the quest, so a plain preference list picks the same line forever.

/** Drive a dialogue taking each scripted option once, then leaving by its exit line. */
export async function driveOnce(script: readonly string[], log: (m: string) => void): Promise<boolean> {
    const pending = [...script];
    for (let i = 0; i < 80; i++) {
        if (EventSignal.pending()) {
            return false;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            const wantIndex = pending.findIndex(want => opts.some(o => o.toLowerCase().includes(want.toLowerCase())));
            if (wantIndex >= 0) {
                const want = pending.splice(wantIndex, 1)[0]!;
                await ChatDialog.chooseOption(opts.find(o => o.toLowerCase().includes(want.toLowerCase()))!);
                await Execution.delayTicks(2);
                continue;
            }
            const exit = opts.find(o => OK_OPTION.test(o.trim()));
            if (!exit) {
                log(`no scripted or exit option in [${opts.join(' | ')}]`);
                return false;
            }
            await ChatDialog.chooseOption(exit);
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

/** Either face of a villager: the afflicted one, or the one a dose of serum bought a couple of minutes of. */
export function villager(cured: string, afflicted: string): Npc | null {
    return Npcs.query().where(n => n.name === cured || n.name === afflicted).within(12).nearest();
}

// Why: `opnpc1` on an afflicted villager only ever answers in gibberish, and the serum's `opnpcu` both sets the visible bit and opens the conversation in the same action.
// Why: `npc_changetype` and the visible bit run the same 200-tick clock, so the villager's own name is the oracle for whether a dose is still needed.

/** Talk to a villager, spending a dose of serum first only if he has gone back to gibberish. */
export async function talkVillager(
    cured: string,
    afflicted: string,
    anchor: typeof SM_TILE.RAZMIRE,
    script: readonly string[],
    log: (m: string) => void
): Promise<boolean> {
    await Modals.closeIfOpen();
    if (!(await Traversal.walkResilient(anchor, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    if (Npcs.query().name(cured).within(12).nearest()) {
        const status = await Reach.npcDialog({ name: cured, near: anchor, log });
        if (status === 'done') {
            return driveOnce(script, log);
        }
        log(`${cured} did not answer — falling back to a dose of serum`);
    }
    // Why: the sanctified vial is spent first — its dose sets the villager's permanent bit, so it buys every later visit as well as this one.
    const vialId = permSerumVialId() ?? serumVialId();
    if (vialId === null) {
        log(`no serum 207 in the pack to use on ${cured}`);
        return false;
    }
    const npc = villager(cured, afflicted);
    const serum = Inventory.items().find(i => i.id === vialId);
    if (!npc || !serum) {
        log(`no ${cured} beside (${anchor.x},${anchor.z}) or no serum to use`);
        return false;
    }
    if (!(await serum.useOn(npc))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) {
        log(`the serum on ${cured} opened no dialogue`);
        return false;
    }
    return driveOnce(script, log);
}

/** A talk step for one villager. */
export const visit = (
    cured: string,
    afflicted: string,
    anchor: typeof SM_TILE.RAZMIRE,
    script: readonly string[]
) => (log: (m: string) => void): Promise<boolean> => talkVillager(cured, afflicted, anchor, script, log);

/** Take Herbi Flax's diary off the shelf. */
export async function takeDiary(log: (m: string) => void): Promise<boolean> {
    // The shelf answers with an objbox, which sits on main until something closes it.
    const took = await promptLoc({
        name: SM_LOC.SHELF,
        op: 'Search',
        near: SM_TILE.SHELF,
        id: SM_LOC_ID.SHELF,
        within: 8,
        expect: () => Inventory.countById(SM_ID.DIARY) > 0,
        expectMs: 15_000
    }, log);
    await Modals.closeIfOpen();
    return took || Inventory.countById(SM_ID.DIARY) > 0;
}

// Why: the quest only starts once the reader reaches page 25, so the book has to be paged all the way through rather than merely opened.
// Why: `[opheld1,serum_book]` puts an `~objbox` in front of the book, and `~objbox` ends in `p_pausebutton` — the script sits on that chat box until it is clicked, so the book opens after the continue rather than after the Read.

/** Read the diary to its last page. */
export async function readDiary(log: (m: string) => void): Promise<boolean> {
    const diary = Inventory.items().find(i => i.id === SM_ID.DIARY);
    if (!diary) {
        log('no diary in the pack to read');
        return false;
    }
    await Modals.closeIfOpen();
    if (!(await diary.interact('Read'))) {
        return false;
    }
    const bookOpen = (): boolean => reader.modals().main === BOOK_MODAL;
    for (let i = 0; i < 20 && !bookOpen(); i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
        }
        await Execution.delayTicks(1);
    }
    if (!bookOpen()) {
        log(`the diary never opened the book interface (main modal ${reader.modals().main})`);
        return false;
    }
    const onLastPage = (): boolean =>
        reader.mainModalTexts().join(' ').toLowerCase().includes(BOOK_LAST_PAGE);
    for (let page = 0; page < BOOK_PAGES && !onLastPage(); page++) {
        actions.ifButton(BOOK_NEXT);
        await Execution.delayTicks(1);
    }
    const read = onLastPage();
    if (!read) {
        log(`the diary stopped at "${reader.mainModalTexts().slice(1, 3).join(' / ')}"`);
    }
    await Modals.close();
    return read;
}

// Why: the table hands out its three herbs once per player and never again, so a search that finds nothing is a dead end rather than a retry.

/** Search the smashed table for the two tarromin the serums need. */
export async function searchTable(log: (m: string) => void): Promise<boolean> {
    const before = Inventory.countById(SM_ID.UNID_TARROMIN);
    const found = await promptLoc({
        name: SM_LOC.TABLE,
        op: 'Search',
        near: SM_TILE.TABLE,
        id: SM_LOC_ID.TABLE,
        within: 8,
        expect: () => Inventory.countById(SM_ID.UNID_TARROMIN) > before,
        expectMs: 15_000
    }, log);
    await Modals.closeIfOpen();
    return found;
}

// Why: every unid renders as "Herb", so the tarromin is picked out of the pack by id.

/** Identify one held unidentified tarromin. */
export async function identifyTarromin(log: (m: string) => void): Promise<boolean> {
    const unid = Inventory.items().find(i => i.id === SM_ID.UNID_TARROMIN);
    if (!unid) {
        log('no unidentified tarromin in the pack');
        return false;
    }
    const before = Inventory.countById(SM_ID.TARROMIN);
    if (!(await unid.interact('Identify'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(SM_ID.TARROMIN) > before, 8000);
}

const vialSpawn = () => GroundItems.query().where(g => g.id === SM_ID.VIAL_EMPTY).within(8).nearest();

// Why: the two empty-vial spawns in the experiment house are the only source of glass inside Morytania, and they come back on their own timer.

/** Take an empty vial from the spawns beside the shelf. */
export async function takeVial(log: (m: string) => void): Promise<boolean> {
    const before = Inventory.countById(SM_ID.VIAL_EMPTY);
    if (!vialSpawn()) {
        if (!(await Traversal.walkResilient(SM_TILE.VIALS, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
            return false;
        }
        await settleScene();
    }
    const vial = vialSpawn();
    if (!vial) {
        log('no empty vial on the experiment-house floor yet — waiting for the spawn');
        await Execution.delayTicks(4);
        return false;
    }
    if (!(await vial.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(SM_ID.VIAL_EMPTY) > before, 8000);
}

/** Combine two held items and wait for the product. */
async function combine(a: number, b: number, product: number, what: string, log: (m: string) => void): Promise<boolean> {
    const first = Inventory.items().find(i => i.id === a);
    const second = Inventory.items().find(i => i.id === b);
    if (!first || !second) {
        log(`${what}: the pack is missing an ingredient`);
        return false;
    }
    const before = Inventory.countById(product);
    if (!(await first.useOn(second))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(product) > before, 10_000);
}

/** Tarromin into a vial of water. */
export const mixUnfinished = (log: (m: string) => void): Promise<boolean> =>
    combine(SM_ID.TARROMIN, SM_ID.VIAL_WATER, SM_ID.TARROMIN_UNF, 'unfinished potion', log);

/** Ashes into the unfinished potion — serum 207, and the stage that follows it. */
export const mixSerum = (log: (m: string) => void): Promise<boolean> =>
    combine(SM_ID.ASHES, SM_ID.TARROMIN_UNF, SM_ID.SERUM3, 'serum 207', log);

export interface ShopOrder {
    /** `Trade-General-Store` or `Trade-Builders-Store`. */
    op: string;
    // Why: Razmire's menu is a different shape either side of the rebuild, so a counter is named by every line that reaches it.
    /** Dialogue lines that reach this counter when Razmire has to be cured first. */
    asks: readonly string[];
    items: readonly { name: string; qty: number; id: number; stack?: boolean }[];
}

const bought = (order: ShopOrder): boolean =>
    order.items.every(w => Inventory.countById(w.id) >= w.qty);

/** Pack slots the outstanding half of an order still needs. */
function slotsWanted(order: ShopOrder): number {
    return order.items.reduce((sum, w) => {
        const held = Inventory.countById(w.id);
        if (held >= w.qty) {
            return sum;
        }
        return sum + (w.stack ? (held > 0 ? 0 : 1) : w.qty - held);
    }, 0);
}

async function fillOrder(order: ShopOrder, log: (m: string) => void): Promise<boolean> {
    if (!(await Execution.delayUntil(() => Shop.isOpen(), 8000))) {
        log(`'${order.op}' never opened a shop`);
        return false;
    }
    for (const want of order.items) {
        const short = want.qty - Inventory.countById(want.id);
        if (short > 0) {
            await Shop.buy(want.name, short);
        }
    }
    await Shop.close();
    if (!bought(order)) {
        log(`short after the shop: ${order.items.map(m => `${m.name} ${Inventory.countById(m.id)}/${m.qty}`).join(', ')}`);
        return false;
    }
    return true;
}

// Why: Razmire's two counters are `opnpc3` and `opnpc4` rather than a plain Trade, and neither op exists while he is afflicted — the dialogue's store menu is the way in that a fresh dose buys.

/** Open one of Razmire's counters, curing him first if his ops have gone, and buy the order out. */
export function shopAtRazmire(order: ShopOrder): (log: (m: string) => void) => Promise<boolean> {
    return async (log: (m: string) => void): Promise<boolean> => {
        if (bought(order)) {
            return true;
        }
        // Why: a shop trip on a full pack buys nothing and, on the retry, spends a dose of serum re-curing Razmire for it.
        if (Inventory.free() < slotsWanted(order)) {
            log(`no room for the order — ${Inventory.free()} free, ${slotsWanted(order)} wanted`);
            return false;
        }
        await Modals.closeIfOpen();
        if (!(await Traversal.walkResilient(SM_TILE.RAZMIRE, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
            return false;
        }
        await settleScene();
        const counter = Npcs.query().name(SM_NPC.RAZMIRE).action(order.op).within(12).nearest();
        if (counter && (await counter.interact(order.op))) {
            return fillOrder(order, log);
        }
        if (!(await talkVillager(SM_NPC.RAZMIRE, SM_NPC.RAZMIRE_AFFLICTED, SM_TILE.RAZMIRE, order.asks, log))) {
            return false;
        }
        return fillOrder(order, log);
    };
}

// Why: the stage-40 conversation ends in the store menu, so the handover, the builders counter and the general counter all fit inside the one dose it costs.

/** Hand Razmire the five sets of remains, then stock both counters on the same visit. */
export function handoverAndStock(orders: readonly ShopOrder[]): (log: (m: string) => void) => Promise<boolean> {
    return async (log: (m: string) => void): Promise<boolean> => {
        const [first, ...rest] = orders;
        const script = first ? first.asks : [];
        if (!(await talkVillager(SM_NPC.RAZMIRE, SM_NPC.RAZMIRE_AFFLICTED, SM_TILE.RAZMIRE, script, log))) {
            return false;
        }
        if (!first) {
            return true;
        }
        if (!(await fillOrder(first, log))) {
            return false;
        }
        for (const order of rest) {
            if (!(await shopAtRazmire(order)(log))) {
                return false;
            }
        }
        return true;
    };
}

// Why: the temple loadout fills twenty-seven slots, and the swamp crossing arrives holding a diary that has done its job and whatever the ghasts turned the food into.

/** Drop the read diary and the ghasts' leavings. */
export const dropJunk = (log: (m: string) => void): Promise<boolean> => dropDown(JUNK_IDS.map(id => ({ id, keep: 0 })), log);

// Why: only the pyre consumes a set of remains, so anything past a spare is a slot the temple load wants back.

/** Drop each id down to the count it is worth keeping. */
export async function dropDown(wants: readonly { id: number; keep: number }[], log: (m: string) => void): Promise<boolean> {
    for (const want of wants) {
        while (Inventory.countById(want.id) > want.keep) {
            const before = Inventory.countById(want.id);
            const item = Inventory.items().find(i => i.id === want.id);
            if (!item || !(await item.interact('Drop'))) {
                log(`item ${want.id} would not drop`);
                return false;
            }
            if (!(await Execution.delayUntil(() => Inventory.countById(want.id) < before, 5000))) {
                return false;
            }
        }
    }
    return true;
}

export const RAZMIRE_START_SCRIPT: readonly string[] = [
    'What are all these shadow creatures',
    "Yes, I'll dispatch those dark and evil creatures"
];

export const ULSQUIRE_TEMPLE_SCRIPT: readonly string[] = ['What can you tell me about that temple'];

const SHOP_GENERAL = 'Trade-General-Store';
const SHOP_BUILDERS = 'Trade-Builders-Store';

// Why: a set is a plank, a brick and five paste, and each one is 800 points into a rebuild that spends about 2600.
// Why: five is what the stage-45 loadout can carry; a pack with less room buys fewer sets and comes back, which the empty-pool branch already handles.
export const BUILD_SETS = 5;
export const PASTE_PER_SET = 6;

/** Sets that fit, given the pack's free slots: a plank and a brick each, plus one for the paste stack. */
export function setsThatFit(freeSlots: number): number {
    return Math.max(0, Math.min(BUILD_SETS, Math.floor((freeSlots - 1) / 2)));
}

export const buildersOrder = (sets: number = BUILD_SETS): ShopOrder => ({
    op: SHOP_BUILDERS,
    asks: [
        'I keep running out of building materials',
        'Can you open a store for me',
        'Can I see the building store'
    ],
    items: [
        { name: SM_NAME.SWAMP_PASTE, qty: sets * PASTE_PER_SET, id: SM_ID.SWAMP_PASTE, stack: true },
        { name: SM_NAME.PLANK, qty: sets, id: SM_ID.PLANK },
        { name: SM_NAME.LIMESTONE_BRICK, qty: sets, id: SM_ID.LIMESTONE_BRICK }
    ]
});

export const generalOrder = (want: { hammer: boolean; oil: boolean }): ShopOrder => ({
    op: SHOP_GENERAL,
    asks: ['Can you open a store for me', 'Can I see the general store'],
    items: [
        ...(want.hammer ? [{ name: SM_NAME.HAMMER, qty: 1, id: SM_ID.HAMMER }] : []),
        ...(want.oil ? [{ name: SM_NAME.OLIVE_OIL3, qty: 1, id: SM_ID.OLIVE_OIL3 }] : [])
    ]
});
