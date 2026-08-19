import { Equipment } from '../../../../equipment/Equipment.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { fight } from '../trollstronghold/combat.js';
import { talkThrough } from '../../exec/primitives.js';
import { settleScene } from '../../exec/prompts.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { HERO_ID, HERO_NAMED, HERO_NPC, HERO_SHOP, HERO_TILE, onEntrana } from './areas.js';
import { kitStep, type Purchasable } from './shops.js';
import { anywhere, bankedId, foodName, heldFood, heldId, wornId } from './state.js';

// Why: the Ice Queen is level 111 with 104 hitpoints, and the kit is Scavvo's on the Champions' Guild
// upper floor. Each float clears the asking price of a shop below base stock, which buys at more.
const COMBAT_KIT: readonly Purchasable[] = [
    { id: 1113, name: 'Rune chainbody', qty: 1, sources: [{ ...HERO_SHOP.SCAVVO, gp: 80_000 }] },
    { id: 1079, name: 'Rune platelegs', qty: 1, sources: [{ ...HERO_SHOP.SCAVVO, gp: 100_000 }] },
    { id: 1303, name: 'Rune longsword', qty: 1, sources: [{ ...HERO_SHOP.SCAVVO, gp: 55_000 }] }
];

const FOOD_TARGET = 12;
const FIREBIRD_MS = 90_000;
const ICE_QUEEN_TICKS = 600;
const PLANK_TRIES = 6;

/** Everything Entrana's monks allow: the gloves carry no `armour_*` category, coins and food never did. */
function entranaKeep(): string[] {
    return [HERO_NAMED.ICE_GLOVES.toLowerCase(), 'coins', foodName().toLowerCase()];
}

function hasEntranaSpillover(snap: QuestSnapshot): boolean {
    const keep = entranaKeep();
    return [...snap.inv.keys()].some(name => !keep.includes(name));
}

// Why: the engine lowercases both `inv` and `worn`, so a display-cased comparison here reads every
// stripped bot as still wearing something and repeats the step until the watchdog parks it.
function wearingAnythingElse(snap: QuestSnapshot): boolean {
    const gloves = HERO_NAMED.ICE_GLOVES.toLowerCase();
    return [...snap.worn].some(name => name !== gloves);
}

async function unequipAll(_log: (m: string) => void): Promise<boolean> {
    for (const item of Equipment.items()) {
        if (item.name === HERO_NAMED.ICE_GLOVES) {
            continue;
        }
        if (item.name && !(await Equipment.unequip(item.name))) {
            return false;
        }
    }
    return Equipment.items().every(item => item.name === HERO_NAMED.ICE_GLOVES);
}

export function combatKitStep(snap: QuestSnapshot): QuestStep | null {
    return kitStep(snap, COMBAT_KIT);
}

function iceQueen(): Npc | null {
    return Npcs.query().where(n => n.id === HERO_NPC.ICE_QUEEN).nearest();
}

function glovesOnFloor(): { interact(op: string): boolean | Promise<boolean> } | null {
    return GroundItems.query().where(g => g.id === HERO_ID.ICE_GLOVES).within(12).nearest();
}

// Why: on the `:8890` content every entrance to the lair sits on a plateau the map flags seal, so this
// leg says so once rather than repathing forever. See docs/decisions/quest-pitfalls-35.md.

/** Kill the Ice Queen and take the gloves she drops. */
export async function killIceQueen(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(HERO_ID.ICE_GLOVES) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(HERO_TILE.ICE_QUEEN, { radius: 3, attempts: 2, timeoutMs: 180_000, log }))) {
        log('no route into the Ice Queen lair: every ladder down sits on a sealed plateau'
            + ' (x 2800-2861, z 3500-3521) — the map flags admit nobody, so the gloves have no in-world source');
        return false;
    }
    const won = await fight({
        what: 'Ice Queen',
        target: () => iceQueen(),
        won: () => iceQueen() === null || glovesOnFloor() !== null,
        protect: 'melee',
        guard: ICE_QUEEN_TICKS
    }, log);
    if (!won) {
        return false;
    }
    const drop = glovesOnFloor();
    if (!drop) {
        log('the Ice Queen is down but no ice gloves are on the floor');
        return false;
    }
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(HERO_ID.ICE_GLOVES) > 0, 8_000);
}

// Why: every ferry lands on the deck at level 1 and the Gangplank loc is absent from the scene for a
// tick or two after the region change, so a click too early leaves the bot aboard and `onEntrana` false.

/** Cross the gangplank off whatever deck the character is standing on. */
async function stepOffShip(log: (m: string) => void): Promise<boolean> {
    if (Game.tile()?.level === 0) {
        return true;
    }
    for (let attempt = 0; attempt < PLANK_TRIES; attempt++) {
        await settleScene();
        const plank = Locs.query().name('Gangplank').action('Cross').within(12).nearest();
        if (plank && (await plank.interact('Cross'))
            && (await Execution.delayUntil(() => Game.tile()?.level === 0, 10_000))) {
            return true;
        }
    }
    log('still on the ship deck: no Gangplank offered Cross');
    return false;
}

export async function sailToEntrana(log: (m: string) => void): Promise<boolean> {
    if (!(await stepOffShip(log))) {
        return false;
    }
    if (onEntrana(Game.tile())) {
        return true;
    }
    if (!(await Traversal.walkResilient(HERO_TILE.PORT_SARIM_MONK, { radius: 3, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    if (!(await talkThrough('Monk of Entrana', ["Yes, okay, I'm ready to go."], log))) {
        return false;
    }
    const landed = await Execution.delayUntil(() => {
        const tile = Game.tile();
        return tile !== null && tile.x >= 2790 && tile.x <= 2880 && tile.z >= 3290 && tile.z <= 3440;
    }, 30_000);
    if (!landed || !(await stepOffShip(log))) {
        return false;
    }
    return onEntrana(Game.tile());
}

export async function sailFromEntrana(log: (m: string) => void): Promise<boolean> {
    if (!(await stepOffShip(log))) {
        return false;
    }
    if (!onEntrana(Game.tile())) {
        return true;
    }
    if (!(await Traversal.walkResilient(HERO_TILE.ENTRANA_DOCK, { radius: 3, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    if (!(await talkThrough('Monk of Entrana', ["Yes, I'm ready to go."], log))) {
        return false;
    }
    await Execution.delayUntil(() => !onEntrana(Game.tile()), 30_000);
    if (!(await stepOffShip(log))) {
        return false;
    }
    return !onEntrana(Game.tile());
}

// Why: the feather burns for hitpoints/8 + 1 and stays on the floor unless the gloves are WORN, so the
// equip is part of the pickup rather than a step before it.

/** Kill the level-2 firebird barehanded and take the feather with the gloves on. */
export async function takeFeather(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(HERO_ID.FEATHER) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(HERO_TILE.FIREBIRD, { radius: 4, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    if (!Equipment.contains(HERO_NAMED.ICE_GLOVES) && !(await Equipment.equip(HERO_NAMED.ICE_GLOVES))) {
        log('could not wear the ice gloves — the feather cannot be picked up without them');
        return false;
    }
    const feather = (): { interact(op: string): boolean | Promise<boolean> } | null =>
        GroundItems.query().where(g => g.id === HERO_ID.FEATHER).within(12).nearest();
    const bird = (): Npc | null => Npcs.query().where(n => n.id === HERO_NPC.FIREBIRD).nearest();

    const deadline = performance.now() + FIREBIRD_MS;
    while (performance.now() < deadline && feather() === null) {
        const target = bird();
        if (target && !Game.inCombat()) {
            await target.interact('Attack');
        }
        await Sustain.run();
        await Execution.delayTicks(2);
    }
    const drop = feather();
    if (!drop) {
        log('no fire feather on the floor after the firebird fight');
        return false;
    }
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(HERO_ID.FEATHER) > 0, 8_000);
}

/** The feather chain: gloves from the Ice Queen, then a stripped trip to Entrana. */
export function featherStep(snap: QuestSnapshot): QuestStep | null {
    // Why: the island has one way off it and no walkable route home, so a bot standing on it owes the
    // ferry before anything else — including a finished feather.
    if (onEntrana(snap.tile)) {
        if (anywhere(snap, HERO_ID.FEATHER) > 0) {
            return { kind: 'custom', name: 'sail back from Entrana', run: sailFromEntrana };
        }
        return { kind: 'custom', name: 'take the firebird feather', run: takeFeather };
    }
    if (anywhere(snap, HERO_ID.FEATHER) > 0) {
        return null;
    }
    if (heldId(snap, HERO_ID.ICE_GLOVES) === 0 && !wornId(snap, HERO_ID.ICE_GLOVES)) {
        if (bankedId(snap, HERO_ID.ICE_GLOVES) > 0) {
            return { kind: 'withdraw', items: [{ name: HERO_NAMED.ICE_GLOVES, qty: 1, id: HERO_ID.ICE_GLOVES }] };
        }
        const kit = combatKitStep(snap);
        if (kit) {
            return kit;
        }
        if (heldFood(snap) < FOOD_TARGET) {
            return { kind: 'withdraw', items: [{ name: foodName(), qty: FOOD_TARGET }] };
        }
        return { kind: 'custom', name: 'kill the Ice Queen for her gloves', run: killIceQueen };
    }
    if (hasEntranaSpillover(snap)) {
        return { kind: 'deposit', keep: entranaKeep(), bank: HERO_TILE.DRAYNOR_BANK, exactKeep: true };
    }
    if (wearingAnythingElse(snap)) {
        return { kind: 'custom', name: 'strip the Entrana-restricted equipment', run: unequipAll };
    }
    return { kind: 'custom', name: 'sail from Port Sarim to Entrana', run: sailToEntrana };
}

export const ENTRANA_LANDING = new Tile(2834, 3331, 1);
