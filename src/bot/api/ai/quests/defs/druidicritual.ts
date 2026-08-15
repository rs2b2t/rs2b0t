import { actions, reader } from '../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import Tile from '../../../../geometry/Tile.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Quests } from '../../../ui/questlog/Quests.js';
import { GroundItems } from '../../../grounditems/GroundItems.js';
import { Locs } from '../../../locs/Locs.js';
import { Npcs } from '../../../npcs/Npcs.js';
import { Traversal } from '../../../walking/Traversal.js';
import { DirectNavigator } from '../../../../event/webwalk/DirectNavigator.js';
import { QUESTS } from '../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { walkWithHops, type LadderHop, type NpcStop } from '../exec/primitives.js';

export const DRUIDIC_RITUAL_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    SPOKEN_TO_SANFEW: 2,
    GIVEN_INGREDIENTS: 3,
    COMPLETE: 4
} as const;

export function parseDruidicRitualJournal(lines: readonly string[] | string): number | undefined {
    const text = (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();

    // Later entries retain earlier history, so match the newest progress first.
    if (text.includes('quest complete!')) return DRUIDIC_RITUAL_STAGE.COMPLETE;
    if (text.includes('gave them to sanfew') || text.includes('claim my reward')) return DRUIDIC_RITUAL_STAGE.GIVEN_INGREDIENTS;
    if (text.includes('sanfew told me for the ritual')) return DRUIDIC_RITUAL_STAGE.SPOKEN_TO_SANFEW;
    if (text.includes('i should speak to sanfew')) return DRUIDIC_RITUAL_STAGE.STARTED;
    if (text.includes('i can start this quest')) return DRUIDIC_RITUAL_STAGE.NOT_STARTED;
    return undefined;
}

async function readDruidicRitualStage(): Promise<number | undefined> {
    const status = Quests.status('Druidic Ritual');
    if (status === 'complete') return DRUIDIC_RITUAL_STAGE.COMPLETE;
    if (status === 'notStarted') return DRUIDIC_RITUAL_STAGE.NOT_STARTED;
    if (status !== 'inProgress') return undefined;

    // Why: druidquest is a server-only permanent varp and is not transmitted to the client, so the server-rendered quest journal is the browser-visible stage oracle.
    const lines = await Quests.journal('Druidic Ritual');
    const stage = parseDruidicRitualJournal(lines);
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return stage;
}

const KAQEMEEX: NpcStop = {
    npc: 'Kaqemeex',
    anchor: new Tile(2924, 3486, 0),
    leash: 8,
    prefer: ["I'm in search of a quest.", 'Ok, I will try and help.']
};

const SANFEW: NpcStop = {
    npc: 'Sanfew',
    anchor: new Tile(2897, 3426, 1),
    leash: 8,
    prefer: ["I've been sent to help purify the Varrock stone circle.", "Ok, I'll do that then."]
};

const FALADOR_WEST_BANK = new Tile(2946, 3369, 0);
const DUNGEON_SURFACE = new Tile(2885, 3397, 0);
const DUNGEON_LADDER = new Tile(2884, 9797, 0);
const CAULDRON_DOOR_OUTSIDE = new Tile(2888, 9831, 0);
const CAULDRON_DOOR_INSIDE = new Tile(2890, 9831, 0);
const CAULDRON_INSIDE = new Tile(2892, 9831, 0);
const CAULDRON_ID = 2142;
const SUIT_OF_ARMOUR_ID = 453;

const DRUIDIC_RITUAL_HOPS: LadderHop[] = [
    {
        stand: DUNGEON_SURFACE,
        locName: 'Ladder',
        op: 'Climb-Down',
        arrive: DUNGEON_LADDER
    },
    {
        stand: DUNGEON_LADDER,
        locName: 'Ladder',
        op: 'Climb-up',
        arrive: new Tile(2884, 3397, 0)
    }
];

interface RitualMeat {
    raw: string;
    enchanted: string;
    npc: string;
    npcId: number;
    anchor: Tile;
}

// All four source NPCs have a guaranteed raw-meat drop on this content pack.
// The order makes one continuous route from Falador through the Lumbridge area.
const RITUAL_MEATS: readonly RitualMeat[] = [
    { raw: 'Raw bear meat', enchanted: 'Enchanted bear', npc: 'Bear', npcId: 105, anchor: new Tile(3159, 3233, 0) },
    { raw: 'Raw rat meat', enchanted: 'Enchanted rat', npc: 'Giant rat', npcId: 87, anchor: new Tile(3206, 3175, 0) },
    { raw: 'Raw chicken', enchanted: 'Enchanted chicken', npc: 'Chicken', npcId: 41, anchor: new Tile(3228, 3298, 0) },
    { raw: 'Raw beef', enchanted: 'Enchanted beef', npc: 'Cow', npcId: 81, anchor: new Tile(3243, 3295, 0) }
];

const KEEP_ITEMS = RITUAL_MEATS.flatMap(meat => [meat.raw.toLowerCase(), meat.enchanted.toLowerCase()]);

type DruidicRitualArea = 'dungeon' | 'mainland' | 'unknown';

export function druidicRitualArea(tile: QuestSnapshot['tile']): DruidicRitualArea {
    if (!tile) {
        return 'unknown';
    }
    if (tile.x >= 2875 && tile.x <= 2950 && tile.z >= 9785 && tile.z <= 9865) {
        return 'dungeon';
    }
    return 'mainland';
}

const held = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name.toLowerCase()) ?? 0) > 0;
const banked = (snap: QuestSnapshot, name: string): number => snap.bank?.get(name.toLowerCase()) ?? 0;
const heldForm = (snap: QuestSnapshot, meat: RitualMeat): boolean => held(snap, meat.raw) || held(snap, meat.enchanted);

function acquisitionSpace(snap: QuestSnapshot, slots: number): QuestStep | null {
    if (snap.freeSlots === undefined || snap.freeSlots >= slots) {
        return null;
    }
    const hasSpillover = [...snap.inv.keys()].some(name => !KEEP_ITEMS.includes(name));
    return {
        kind: 'deposit',
        // If only ritual items fill the pack, bank every form and withdraw one
        // per species on the next pass instead of parking on harmless duplicates.
        keep: hasSpillover ? KEEP_ITEMS : [],
        bank: FALADOR_WEST_BANK,
        exactKeep: true
    };
}

async function takeMeatDrop(meat: RitualMeat): Promise<boolean> {
    const drop = GroundItems.query().name(meat.raw).within(15).nearest();
    if (!drop || !(await drop.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.contains(meat.raw), 8000);
}

async function huntMeat(meat: RitualMeat, log: (message: string) => void): Promise<boolean> {
    if (Inventory.contains(meat.raw) || Inventory.contains(meat.enchanted)) {
        return true;
    }
    if (await takeMeatDrop(meat)) {
        return true;
    }
    if (!(await Traversal.walkResilient(meat.anchor, { radius: 7, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    if (await takeMeatDrop(meat)) {
        return true;
    }
    if (Game.inCombat()) {
        await Execution.delayUntil(() => !Game.inCombat(), 120_000);
        return takeMeatDrop(meat);
    }
    const target = Npcs.query()
        .where(n => n.id === meat.npcId && !n.inCombat && !n.targetsAnotherPlayer())
        .action('Attack')
        .within(15)
        .nearest();
    if (!target) {
        log(`waiting for an available ${meat.npc} at the guaranteed ${meat.raw} source`);
        await Execution.delayTicks(2);
        return false;
    }
    Game.setCombatStyle('strength');
    log(`attacking ${meat.npc} for ${meat.raw}`);
    if (!(await target.interact('Attack'))) {
        return false;
    }
    await Execution.delayUntil(() => GroundItems.query().name(meat.raw).within(15).nearest() !== null || !target.valid(), 120_000);
    return takeMeatDrop(meat);
}

function inCauldronRoom(): boolean {
    const tile = Game.tile();
    return tile !== null && tile.x >= 2890 && tile.x <= 2896 && tile.z >= 9827 && tile.z <= 9835;
}

async function fightLivingSuit(log: (message: string) => void): Promise<boolean> {
    const suit = Npcs.query()
        .where(n => n.id === SUIT_OF_ARMOUR_ID)
        .action('Attack')
        .within(10)
        .nearest();
    if (!suit) {
        return false;
    }
    if (!Game.inCombat()) {
        if (!(await suit.interact('Attack'))) {
            log('could not attack the animated Suit of armour — yielding safely');
            return true;
        }
        if (!(await Execution.delayUntil(() => Game.inCombat() || !suit.valid(), 5000))) {
            log('the animated Suit of armour did not engage — yielding safely');
            return true;
        }
    }
    log('defeating the animated Suit of armour guarding the cauldron');
    await Execution.delayUntil(() => !Game.inCombat() || !suit.valid(), 120_000);
    return true;
}

async function enterCauldronRoom(log: (message: string) => void): Promise<boolean> {
    if (inCauldronRoom()) {
        return true;
    }
    const tile = Game.tile();
    if (!tile || druidicRitualArea(tile) !== 'dungeon') {
        return walkWithHops(CAULDRON_DOOR_OUTSIDE, 1, DRUIDIC_RITUAL_HOPS, log).then(() => false);
    }
    if (CAULDRON_DOOR_OUTSIDE.distanceTo(tile) > 2) {
        if (!(await Traversal.walkResilient(CAULDRON_DOOR_OUTSIDE, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
            return false;
        }
    }
    if (await fightLivingSuit(log)) {
        return false;
    }
    const door = Locs.query().name('Prison door').action('Open').within(5).nearest();
    if (door) {
        log('opening the Prison door guarding the Cauldron of Thunder');
        if (!(await door.interact('Open'))) {
            return false;
        }
        await Execution.delayUntil(
            () =>
                inCauldronRoom() ||
                Npcs.query()
                    .where(n => n.id === SUIT_OF_ARMOUR_ID)
                    .within(10)
                    .nearest() !== null ||
                Locs.query().name('Prison door').action('Open').within(5).nearest() === null,
            8000
        );
        if (
            Npcs.query()
                .where(n => n.id === SUIT_OF_ARMOUR_ID)
                .within(10)
                .nearest() !== null
        ) {
            return false;
        }
        if (Locs.query().name('Prison door').action('Open').within(5).nearest() !== null) {
            return false;
        }

        // Why: the double-door script first moves an outside player onto the threshold, and the open leaf closes three server ticks later.
        await DirectNavigator.walkTo(CAULDRON_DOOR_INSIDE, 0, 3000);
        return inCauldronRoom();
    }
    return Traversal.walkResilient(CAULDRON_INSIDE, { radius: 1, attempts: 3, timeoutMs: 60_000, log });
}

async function dipMeat(meat: RitualMeat, log: (message: string) => void): Promise<boolean> {
    if (Inventory.contains(meat.enchanted)) {
        return true;
    }
    if (!Inventory.contains(meat.raw)) {
        return false;
    }
    if (!(await enterCauldronRoom(log))) {
        return false;
    }
    const cauldron = Locs.query()
        .where(loc => loc.id === CAULDRON_ID)
        .within(6)
        .nearest();
    const raw = Inventory.first(meat.raw);
    if (!cauldron || !raw) {
        log(`could not find ${meat.raw} or the Cauldron of Thunder in its room`);
        return false;
    }
    const rawBefore = Inventory.count(meat.raw);
    const enchantedBefore = Inventory.count(meat.enchanted);
    log(`dipping ${meat.raw} into the Cauldron of Thunder`);
    if (!(await raw.useOn(cauldron))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.count(meat.raw) < rawBefore && Inventory.count(meat.enchanted) > enchantedBefore, 10_000);
}

async function leaveDungeon(log: (message: string) => void): Promise<boolean> {
    const tile = Game.tile();
    if (!tile || druidicRitualArea(tile) !== 'dungeon') {
        return true;
    }
    return walkWithHops(DUNGEON_SURFACE, 2, DRUIDIC_RITUAL_HOPS, log);
}

function stageTwo(snap: QuestSnapshot): QuestStep {
    const allEnchantedHeld = RITUAL_MEATS.every(meat => held(snap, meat.enchanted));
    if (allEnchantedHeld) {
        return { kind: 'talk', stop: SANFEW };
    }

    const missingHeld = RITUAL_MEATS.filter(meat => !heldForm(snap, meat));
    const rawHeld = RITUAL_MEATS.find(meat => held(snap, meat.raw));
    const area = druidicRitualArea(snap.tile);

    if (area === 'dungeon') {
        if (missingHeld.length > 0) {
            return { kind: 'custom', name: 'leave the dungeon to recover missing ritual meat', run: leaveDungeon };
        }
        if (rawHeld) {
            return { kind: 'custom', name: `dip ${rawHeld.raw} in the Cauldron of Thunder`, run: log => dipMeat(rawHeld, log) };
        }
    }

    if (missingHeld.length > 0) {
        if (!snap.bankKnown) {
            return { kind: 'scanBank', bank: FALADOR_WEST_BANK };
        }
        const withdraw: { name: string; qty: number }[] = [];
        for (const meat of missingHeld) {
            if (banked(snap, meat.enchanted) > 0) {
                withdraw.push({ name: meat.enchanted, qty: 1 });
            } else if (banked(snap, meat.raw) > 0) {
                withdraw.push({ name: meat.raw, qty: 1 });
            }
        }
        if (withdraw.length > 0) {
            const space = acquisitionSpace(snap, withdraw.length);
            return space ?? { kind: 'withdraw', items: withdraw, bank: FALADOR_WEST_BANK };
        }
        const space = acquisitionSpace(snap, 1);
        const meat = missingHeld[0];
        return space ?? { kind: 'custom', name: `hunt ${meat.npc} for ${meat.raw}`, run: log => huntMeat(meat, log) };
    }

    if (rawHeld) {
        return { kind: 'custom', name: `dip ${rawHeld.raw} in the Cauldron of Thunder`, run: log => dipMeat(rawHeld, log) };
    }
    return { kind: 'wait', reason: 'ritual meat state is incomplete' };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete' || (snap.stage ?? 0) >= DRUIDIC_RITUAL_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.stage === undefined) {
        return { kind: 'wait', reason: 'Druidic Ritual stage unavailable' };
    }
    if (snap.stage === DRUIDIC_RITUAL_STAGE.NOT_STARTED) {
        return { kind: 'talk', stop: KAQEMEEX };
    }
    if (snap.stage === DRUIDIC_RITUAL_STAGE.STARTED) {
        return { kind: 'talk', stop: SANFEW };
    }
    if (snap.stage === DRUIDIC_RITUAL_STAGE.SPOKEN_TO_SANFEW) {
        return stageTwo(snap);
    }
    if (snap.stage === DRUIDIC_RITUAL_STAGE.GIVEN_INGREDIENTS) {
        return { kind: 'talk', stop: KAQEMEEX };
    }
    return { kind: 'wait', reason: `unrecognized Druidic Ritual stage ${snap.stage}` };
}

export const druidicritual: QuestModule = {
    record: QUESTS.find(record => record.id === 'druid')!,
    hops: DRUIDIC_RITUAL_HOPS,
    bank: FALADOR_WEST_BANK,
    grind: ['Bear', 'Giant rat', 'Chicken', 'Cow', 'Suit of armour'],
    tools: KEEP_ITEMS,
    ownsInventory: true,
    readStage: readDruidicRitualStage,
    decide
};
