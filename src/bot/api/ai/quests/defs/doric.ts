import { actions, reader } from '../../../../adapter/ClientAdapter.js';
import { EventSignal } from '../../../execution/EventSignal.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import { Reachability } from '../../../../event/webwalk/geometry/Reachability.js';
import Tile from '../../../../geometry/Tile.js';
import { Traversal } from '../../../walking/Traversal.js';
import { ChatDialog } from '../../../ui/dialogue/ChatDialog.js';
import { Equipment } from '../../../equipment/Equipment.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Quests } from '../../../ui/questlog/Quests.js';
import { Skills } from '../../../skills/Skills.js';
import { GroundItems } from '../../../grounditems/GroundItems.js';
import { Locs } from '../../../locs/Locs.js';
import { ROCK_TYPES } from '../../../../data/miningRocks.js';
import { PICKAXES } from '../../../acquisition/Tools.js';
import { QUESTS } from '../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { gotoNpc, talkStrict, type NpcStop } from '../exec/primitives.js';

/** Exact server-side doricquest values, recovered from the client-visible journal. */
export const DORIC_STAGE = {
    NOT_STARTED: 0,
    STARTED: 10,
    COMPLETE: 100
} as const;

export const DORIC_ITEM = {
    CLAY: { name: 'Clay', id: 434, qty: 6 },
    COPPER: { name: 'Copper ore', id: 436, qty: 4 },
    IRON: { name: 'Iron ore', id: 440, qty: 2 },
    BRONZE_PICKAXE: { name: 'Bronze pickaxe', id: 1265 }
} as const;

const PICKAXE_ID: Readonly<Record<string, number>> = {
    'Bronze pickaxe': 1265,
    'Iron pickaxe': 1267,
    'Steel pickaxe': 1269,
    'Adamant pickaxe': 1271,
    'Mithril pickaxe': 1273,
    'Rune pickaxe': 1275
};

/** Best-first, matching the server's Mining-level gates. */
export const DORIC_PICKAXES = PICKAXES.map(pickaxe => ({
    name: pickaxe.name,
    id: PICKAXE_ID[pickaxe.name],
    level: pickaxe.level
}));

type Material = typeof DORIC_ITEM.CLAY | typeof DORIC_ITEM.COPPER | typeof DORIC_ITEM.IRON;
type Mineable = 'Clay' | 'Copper' | 'Iron';

const MATERIALS: readonly Material[] = [DORIC_ITEM.CLAY, DORIC_ITEM.COPPER, DORIC_ITEM.IRON];
const MATERIAL_IDS = new Set<number>(MATERIALS.map(item => item.id));
const PICKAXE_IDS = new Set<number>(DORIC_PICKAXES.map(item => item.id));

const DORIC: NpcStop = {
    npc: 'Doric',
    anchor: new Tile(2952, 3451, 0),
    leash: 6,
    prefer: ['I wanted to use your anvils.', 'Yes, I will get you materials.']
};

const BANKS = [
    new Tile(2946, 3369, 0), // Falador west
    new Tile(3013, 3355, 0), // Falador east
    new Tile(3093, 3243, 0) // Draynor
] as const;

const ORE_ANCHORS: Readonly<Record<Mineable, Tile>> = {
    Clay: new Tile(2986, 3240, 0),
    Copper: new Tile(2978, 3247, 0),
    Iron: new Tile(2972, 3239, 0)
};

// Static bronze pickaxe on the table south of the Rimmington mine.
const BRONZE_PICKAXE_SPAWN = new Tile(2963, 3216, 0);
const PICKAXE_RESPAWN_MS = 70_000;
const ROCK_RESPAWN_MS = 30_000;

function journalText(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

export function parseDoricJournal(lines: readonly string[] | string): number | undefined {
    const text = journalText(lines);
    if (text.includes('quest complete!')) return DORIC_STAGE.COMPLETE;
    if (text.includes('i have spoken to doric') && text.includes('i need to collect some items')) {
        return DORIC_STAGE.STARTED;
    }
    if (text.includes('i can start this quest by talking to') && text.includes('doric')) {
        return DORIC_STAGE.NOT_STARTED;
    }
    return undefined;
}

async function readDoricStage(): Promise<number | undefined> {
    const status = Quests.status("Doric's Quest");
    if (status === 'complete') return DORIC_STAGE.COMPLETE;
    if (status === 'notStarted') return DORIC_STAGE.NOT_STARTED;
    if (status !== 'inProgress') return undefined;

    const lines = await Quests.journal("Doric's Quest");
    const stage = parseDoricJournal(lines);
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return stage;
}

function heldCount(snap: QuestSnapshot, item: Material): number {
    if (snap.invIds !== undefined) return snap.invIds.get(item.id) ?? 0;
    return snap.inv.get(item.name.toLowerCase()) ?? 0;
}

function bankedCount(snap: QuestSnapshot, item: Material): number {
    if (snap.bankIds !== undefined) return snap.bankIds.get(item.id) ?? 0;
    return snap.bank?.get(item.name.toLowerCase()) ?? 0;
}

function pickHeld(snap: QuestSnapshot, pickaxe: (typeof DORIC_PICKAXES)[number]): boolean {
    if (snap.invIds !== undefined || snap.wornIds !== undefined) {
        return (snap.invIds?.get(pickaxe.id) ?? 0) > 0 || (snap.wornIds?.has(pickaxe.id) ?? false);
    }
    const name = pickaxe.name.toLowerCase();
    return (snap.inv.get(name) ?? 0) > 0 || snap.worn.has(name);
}

function pickBanked(snap: QuestSnapshot, pickaxe: (typeof DORIC_PICKAXES)[number]): boolean {
    if (snap.bankIds !== undefined) return (snap.bankIds.get(pickaxe.id) ?? 0) > 0;
    return (snap.bank?.get(pickaxe.name.toLowerCase()) ?? 0) > 0;
}

function bestUsablePickaxe(miningLevel: number, available: (pickaxe: (typeof DORIC_PICKAXES)[number]) => boolean): (typeof DORIC_PICKAXES)[number] | null {
    return DORIC_PICKAXES.find(pickaxe => miningLevel >= pickaxe.level && available(pickaxe)) ?? null;
}

function nearestBank(snap: QuestSnapshot): Tile {
    if (!snap.tile) return BANKS[2];
    return [...BANKS].sort((a, b) => a.distanceTo(snap.tile!) - b.distanceTo(snap.tile!))[0];
}

function talkAtStage(stage: number, action: string): QuestStep {
    return {
        kind: 'custom',
        name: `stage ${stage}: ${action}`,
        run: async log => {
            log(`journal stage ${stage}: ${action}`);
            if (!(await gotoNpc(DORIC, [], log))) {
                log(`stage ${stage}: could not reach Doric`);
                return false;
            }
            if (!(await talkStrict(DORIC.npc, DORIC.prefer, log))) {
                log(`stage ${stage}: Doric dialogue did not complete`);
                return false;
            }
            log(`stage ${stage}: finished Doric's dialogue; re-reading the journal`);
            return true;
        }
    };
}

const COINS_ID = 995;
const DORIC_REWARD_COINS = 180;

// Why: Doric's server script queues the quest-complete scroll before its final dialogue and coin reward.
// Why: a generic dialogue driver sees the chat modal close and returns, leaving the engine free to treat stage 100 as finished before the remaining queue has run.
// Why: success is therefore withheld until the post-scroll queue has awarded the coins and drained.

/** Hand Doric his materials and drive the completion queue to the end. */
async function handInMaterials(log: (message: string) => void): Promise<boolean> {
    if (!(await gotoNpc(DORIC, [], log))) {
        log('stage 10: could not reach Doric for the material hand-in');
        return false;
    }

    const coinsBefore = Inventory.countById(COINS_ID);
    const materialsBefore = MATERIALS.map(item => Inventory.countById(item.id));
    const dialogueClosed = await talkStrict(DORIC.npc, DORIC.prefer, log);
    const materialsTaken = MATERIALS.every((item, index) => Inventory.countById(item.id) <= materialsBefore[index] - item.qty);
    const rewardStarted = materialsTaken || Quests.status("Doric's Quest") === 'complete' || reader.modals().main !== -1;
    if (!dialogueClosed && !rewardStarted) {
        log('stage 10: Doric did not accept the materials');
        return false;
    }

    let closedRewardScroll = false;
    let quietRewardTicks = 0;
    for (let guard = 0; guard < 160; guard++) {
        if (reader.modals().main !== -1) {
            if (!closedRewardScroll) {
                log('stage 10: closing the quest-complete scroll and continuing the server reward queue');
                closedRewardScroll = true;
            }
            if (!actions.closeModal()) {
                log('stage 10: could not close the quest-complete/reward modal');
                return false;
            }
            await Execution.delayTicks(1);
            continue;
        }

        if (ChatDialog.canContinue()) {
            if (!(await ChatDialog.continue())) {
                log("stage 10: could not continue Doric's post-completion dialogue");
                return false;
            }
            await Execution.delayTicks(1);
            continue;
        }

        const options = ChatDialog.options();
        if (options.length > 0) {
            log(`stage 10: unexpected post-completion options [${options.join(' | ')}]`);
            return false;
        }

        const rewarded = Inventory.countById(COINS_ID) >= coinsBefore + DORIC_REWARD_COINS;
        if (rewarded && !ChatDialog.isOpen()) {
            // Require several quiet ticks: the server can award the coins
            // immediately before opening its final NPC chat page.
            quietRewardTicks++;
            if (quietRewardTicks >= 3) {
                log(`stage 10: reward queue drained; received ${DORIC_REWARD_COINS} coins`);
                return true;
            }
            await Execution.delayTicks(1);
            continue;
        }

        quietRewardTicks = 0;
        await Execution.delayTicks(1);
    }

    log(`stage 10: reward queue did not deliver ${DORIC_REWARD_COINS} coins and drain`);
    return false;
}

function liveUsablePickaxe(): string | null {
    const level = Skills.level('mining');
    return DORIC_PICKAXES.find(pickaxe => level >= pickaxe.level && (Inventory.countById(pickaxe.id) > 0 || Equipment.items().some(item => item.id === pickaxe.id)))?.name ?? null;
}

function miningInterrupted(): boolean {
    return EventSignal.pending() || ChatDialog.canContinue() || Game.inCombat() || liveUsablePickaxe() === null;
}

function nearbyRock(type: Mineable) {
    const ids = new Set(ROCK_TYPES[type]);
    return Locs.query()
        .where(loc => ids.has(loc.id) && Reachability.canReach(loc.tile(), { adjacentOk: true }))
        .action('Mine')
        .within(20)
        .nearest();
}

async function mineOne(type: Mineable, item: Material, log: (message: string) => void): Promise<boolean> {
    if (Inventory.isFull()) {
        log(`${type}: inventory is full before mining`);
        return false;
    }
    const pickaxe = liveUsablePickaxe();
    if (!pickaxe) {
        log(`${type}: no usable pickaxe in the inventory or equipment`);
        return false;
    }

    let rock = nearbyRock(type);
    if (!rock) {
        log(`${type}: walking to the Rimmington mine`);
        if (!(await Traversal.walkResilient(ORE_ANCHORS[type], { radius: 4, attempts: 3, timeoutMs: 120_000, log }))) {
            log(`${type}: could not reach the Rimmington mine`);
            return false;
        }
        rock = nearbyRock(type);
    }

    if (!rock) {
        log(`${type}: all nearby rocks are depleted; waiting for a respawn`);
        await Execution.delayUntil(() => nearbyRock(type) !== null || miningInterrupted(), ROCK_RESPAWN_MS);
        if (miningInterrupted()) return false;
        rock = nearbyRock(type);
    }
    if (!rock) {
        log(`${type}: a rock respawn was taken by another player; retrying`);
        return false;
    }

    const before = Inventory.countById(item.id);
    log(`${type}: mining one with ${pickaxe}`);
    if (!(await rock.interact('Mine'))) {
        log(`${type}: Mine interaction failed or lost a player race`);
        return false;
    }
    await Execution.delayUntil(() => Inventory.countById(item.id) > before || Inventory.isFull() || miningInterrupted(), 20_000);
    const obtained = Inventory.countById(item.id) > before;
    if (obtained) {
        log(`${type}: acquired ${item.name}`);
    } else if (EventSignal.pending() || Game.inCombat()) {
        log(`${type}: yielding immediately to a mining random event`);
    } else {
        log(`${type}: no ${item.name} obtained; retrying after the interrupted/depleted swing`);
    }
    return obtained;
}

function nearbyBronzePickaxe() {
    return GroundItems.query()
        .where(item => item.id === DORIC_ITEM.BRONZE_PICKAXE.id)
        .within(12)
        .nearest();
}

async function acquireBronzePickaxe(log: (message: string) => void): Promise<boolean> {
    if (liveUsablePickaxe()) return true;
    if (Inventory.isFull()) {
        log('pickaxe: inventory is full before pickup');
        return false;
    }

    let pickaxe = nearbyBronzePickaxe();
    if (!pickaxe) {
        log('pickaxe: walking to the free Rimmington bronze pickaxe spawn');
        if (!(await Traversal.walkResilient(BRONZE_PICKAXE_SPAWN, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
            log('pickaxe: could not reach the Rimmington spawn');
            return false;
        }
        pickaxe = nearbyBronzePickaxe();
    }
    if (!pickaxe) {
        log('pickaxe: spawn is empty; waiting for its bounded respawn');
        await Execution.delayUntil(() => nearbyBronzePickaxe() !== null || EventSignal.pending() || Game.inCombat(), PICKAXE_RESPAWN_MS);
        if (EventSignal.pending() || Game.inCombat()) return false;
        pickaxe = nearbyBronzePickaxe();
    }
    if (!pickaxe) {
        log('pickaxe: respawn was taken by another player; retrying');
        return false;
    }

    const before = Inventory.countById(DORIC_ITEM.BRONZE_PICKAXE.id);
    if (!(await pickaxe.interact('Take'))) {
        log('pickaxe: Take interaction failed or lost a player race');
        return false;
    }
    const obtained = await Execution.delayUntil(() => Inventory.countById(DORIC_ITEM.BRONZE_PICKAXE.id) > before || EventSignal.pending(), 8000);
    if (obtained && Inventory.countById(DORIC_ITEM.BRONZE_PICKAXE.id) > before) {
        log('pickaxe: acquired the free Bronze pickaxe');
        return true;
    }
    return false;
}

async function dropOneCopper(log: (message: string) => void): Promise<boolean> {
    const before = Inventory.countById(DORIC_ITEM.COPPER.id);
    if (before <= DORIC_ITEM.COPPER.qty) return true;
    const ore = Inventory.items().find(item => item.id === DORIC_ITEM.COPPER.id);
    if (!ore || !(await ore.interact('Drop'))) {
        log('training: could not drop surplus Copper ore');
        return false;
    }
    const dropped = await Execution.delayUntil(() => Inventory.countById(DORIC_ITEM.COPPER.id) < before, 5000);
    if (dropped) log(`training: dropped surplus Copper ore; retaining ${DORIC_ITEM.COPPER.qty} for Doric`);
    return dropped;
}

function preserveQuestItems(bank: Tile): QuestStep {
    return {
        kind: 'deposit',
        keep: [],
        keepIds: [...MATERIAL_IDS, ...PICKAXE_IDS],
        bank,
        exactKeep: true
    };
}

function hasDepositableItem(snap: QuestSnapshot): boolean {
    if (snap.invIds !== undefined) {
        return [...snap.invIds.keys()].some(id => !MATERIAL_IDS.has(id) && !PICKAXE_IDS.has(id));
    }
    const keeps = new Set([...MATERIALS.map(item => item.name.toLowerCase()), ...DORIC_PICKAXES.map(item => item.name.toLowerCase())]);
    return [...snap.inv.keys()].some(name => !keeps.has(name));
}

function makeSpace(snap: QuestSnapshot, needed: number, bank: Tile): QuestStep | null {
    if (snap.freeSlots === undefined || snap.freeSlots >= needed) return null;
    if (hasDepositableItem(snap)) return preserveQuestItems(bank);
    // Why: a restored account can have all 28 slots occupied by exact Doric items — surplus ore, redundant picks, or an unusable high-tier pick — so keeping every quantity would park forever.
    // Why: the exact set is banked too, and the next authoritative bank snapshot withdraws only the material deficits and one best usable pickaxe.
    return {
        kind: 'deposit',
        keep: [],
        keepIds: [],
        bank,
        exactKeep: true
    };
}

function materialWithdrawals(snap: QuestSnapshot): { name: string; id: number; qty: number }[] {
    const withdrawals: { name: string; id: number; qty: number }[] = [];
    for (const item of MATERIALS) {
        const missing = Math.max(0, item.qty - heldCount(snap, item));
        const available = Math.min(missing, bankedCount(snap, item));
        if (available > 0) withdrawals.push({ name: item.name, id: item.id, qty: available });
    }
    return withdrawals;
}

function allMaterialsHeld(snap: QuestSnapshot): boolean {
    return MATERIALS.every(item => heldCount(snap, item) >= item.qty);
}

function stageTen(snap: QuestSnapshot, miningLevel: number, miningXp: number): QuestStep {
    if (allMaterialsHeld(snap)) {
        return {
            kind: 'custom',
            name: 'stage 10: hand Doric 6 Clay, 4 Copper ore, and 2 Iron ore and collect the full reward',
            run: handInMaterials
        };
    }

    const bank = nearestBank(snap);
    if (!snap.bankKnown) return { kind: 'scanBank', bank };

    const withdrawals = materialWithdrawals(snap);
    if (withdrawals.length > 0) {
        const space = makeSpace(
            snap,
            withdrawals.reduce((sum, item) => sum + item.qty, 0),
            bank
        );
        if (space) return space;
        return { kind: 'withdraw', items: withdrawals, bank };
    }

    // Copper above four exists only to train Mining for iron. Drop it one at a
    // time so every engine iteration yields to the random-event supervisor.
    if (heldCount(snap, DORIC_ITEM.COPPER) > DORIC_ITEM.COPPER.qty) {
        return { kind: 'custom', name: 'drop one surplus training Copper ore', run: dropOneCopper };
    }

    const missing = MATERIALS.filter(item => heldCount(snap, item) < item.qty);
    const heldPickaxe = bestUsablePickaxe(miningLevel, pickaxe => pickHeld(snap, pickaxe));
    if (!heldPickaxe) {
        const bankPickaxe = bestUsablePickaxe(miningLevel, pickaxe => pickBanked(snap, pickaxe));
        const space = makeSpace(snap, 1, bank);
        if (space) return space;
        if (bankPickaxe) {
            return {
                kind: 'withdraw',
                items: [{ name: bankPickaxe.name, id: bankPickaxe.id, qty: 1 }],
                bank
            };
        }
        return {
            kind: 'custom',
            name: 'source a free Bronze pickaxe at Rimmington',
            run: acquireBronzePickaxe
        };
    }

    const space = makeSpace(snap, 1, bank);
    if (space) return space;

    if (missing.includes(DORIC_ITEM.CLAY)) {
        return { kind: 'custom', name: `mine Clay ${heldCount(snap, DORIC_ITEM.CLAY)}/${DORIC_ITEM.CLAY.qty}`, run: log => mineOne('Clay', DORIC_ITEM.CLAY, log) };
    }
    if (missing.includes(DORIC_ITEM.COPPER)) {
        return { kind: 'custom', name: `mine Copper ore ${heldCount(snap, DORIC_ITEM.COPPER)}/${DORIC_ITEM.COPPER.qty}`, run: log => mineOne('Copper', DORIC_ITEM.COPPER, log) };
    }
    if (missing.includes(DORIC_ITEM.IRON) && miningLevel < 15) {
        return {
            kind: 'custom',
            name: `train Mining ${miningLevel}/15 on Copper (${Math.floor(miningXp)} XP)`,
            run: log => mineOne('Copper', DORIC_ITEM.COPPER, log)
        };
    }
    if (missing.includes(DORIC_ITEM.IRON)) {
        return { kind: 'custom', name: `mine Iron ore ${heldCount(snap, DORIC_ITEM.IRON)}/${DORIC_ITEM.IRON.qty}`, run: log => mineOne('Iron', DORIC_ITEM.IRON, log) };
    }

    return { kind: 'wait', reason: 'Doric material state could not be resolved' };
}

export function decideForMiningLevel(snap: QuestSnapshot, miningLevel: number, miningXp = 0): QuestStep {
    if (snap.journal === 'complete' || (snap.stage ?? 0) >= DORIC_STAGE.COMPLETE) return { kind: 'done' };
    if (snap.journal === 'unknown') return { kind: 'wait', reason: 'quest journal not loaded' };
    if (snap.stage === undefined) return { kind: 'wait', reason: "Doric's Quest stage unavailable" };

    switch (snap.stage) {
        case DORIC_STAGE.NOT_STARTED:
            return talkAtStage(0, 'ask Doric to use his anvils and accept the materials job');
        case DORIC_STAGE.STARTED:
            return stageTen(snap, miningLevel, miningXp);
        default:
            return { kind: 'wait', reason: `unrecognized Doric's Quest stage ${snap.stage}` };
    }
}

export function decide(snap: QuestSnapshot): QuestStep {
    return decideForMiningLevel(snap, Skills.level('mining'), Skills.xp('mining'));
}

export const doric: QuestModule = {
    record: QUESTS.find(record => record.id === 'doric')!,
    bank: BANKS[0],
    ownsInventory: true,
    readStage: readDoricStage,
    decide
};
