// docs/superpowers/specs/2026-07-29-shilo-village-design.md
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Sustain } from '../../../api/Sustain.js';
import { Traversal } from '../../../api/Traversal.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Equipment } from '../../../api/hud/Equipment.js';
import type { Npc } from '../../../api/entities/index.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { SV_ITEM, SV_LOC, SV_NPC, SV_TILE, inDolmenRoom, type ShiloArea } from './areas.js';
import { driveChoice, heldId, here, locNear, promptLoc, settleScene, useOnLoc } from './scene.js';

/** The doors hide themselves again about fifty ticks after the trees are searched. */
function carvedDoors(): ReturnType<typeof locNear> {
    return locNear(SV_LOC.CARVED_DOORS, 'Search', 10) ?? locNear(SV_LOC.CARVED_DOORS, 'Open', 10);
}

function hillsideEntrance(): ReturnType<typeof locNear> {
    return locNear(SV_LOC.HILLSIDE_ENTRANCE, 'Enter', 10);
}

export async function revealDoors(log: (m: string) => void): Promise<boolean> {
    if (carvedDoors() || hillsideEntrance()) {
        return true;
    }
    return promptLoc(
        {
            name: SV_LOC.PALM_TREE,
            op: 'Search',
            near: SV_TILE.PALM_TREES,
            expect: () => carvedDoors() !== null || hillsideEntrance() !== null,
            expectMs: 10_000
        },
        log
    );
}

/**
 * Searching the doors is what teaches the bone lock, and the engine only records it
 * while the stage is exactly `entered_tomb_bervirius` — so this runs after the
 * Bervirius dolmen and before the bone key is cut.
 */
export async function searchCarvedDoors(log: (m: string) => void): Promise<boolean> {
    if (!(await revealDoors(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(SV_TILE.CARVED_DOORS, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    const doors = locNear(SV_LOC.CARVED_DOORS, 'Search', 10);
    if (!doors) {
        log('the carved doors closed again before they could be searched');
        return false;
    }
    if (!(await doors.interact('Search'))) {
        return false;
    }
    // The bit lands with the message box and nothing else changes, so the journal
    // on the next pass is the only honest confirmation.
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) {
        return false;
    }
    return driveChoice([], log);
}

export async function unlockCarvedDoors(log: (m: string) => void): Promise<boolean> {
    if (hillsideEntrance()) {
        return true;
    }
    if (!(await revealDoors(log))) {
        return false;
    }
    return useOnLoc(
        SV_ITEM.BONE_KEY.id,
        { name: SV_LOC.CARVED_DOORS, near: SV_TILE.CARVED_DOORS },
        [],
        () => hillsideEntrance() !== null,
        log
    );
}

export async function enterRashTomb(log: (m: string) => void): Promise<boolean> {
    if (here() !== 'karamja') {
        return true;
    }
    if (!(await revealDoors(log))) {
        return false;
    }
    // Once the bone key has been used the doors answer a plain Open and become the
    // Hillside entrance for good — but a restart finds them shut again behind the
    // palms, and nothing named "Hillside entrance" exists to Enter yet.
    if (!hillsideEntrance()) {
        const shut = locNear(SV_LOC.CARVED_DOORS, 'Open', 10);
        if (shut && (await shut.interact('Open'))) {
            await Execution.delayUntil(() => hillsideEntrance() !== null, 10_000);
        }
    }
    const ok = await promptLoc(
        {
            name: SV_LOC.HILLSIDE_ENTRANCE,
            op: 'Enter',
            near: SV_TILE.CARVED_DOORS,
            expect: () => here() === 'rashEntry'
        },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

/**
 * `zq_open_tombexit` refuses to open for anyone carrying the bone key — the key has
 * to be *used on* the door instead. That inversion is the whole trick of the exit.
 */
export async function leaveRashTomb(log: (m: string) => void): Promise<boolean> {
    if (here() !== 'rashEntry') {
        return true;
    }
    if (heldId(SV_ITEM.BONE_KEY.id) === 0) {
        const ok = await promptLoc(
            {
                name: SV_LOC.TOMB_EXIT,
                op: 'Open',
                near: SV_TILE.TOMB_EXIT,
                expect: () => here() !== 'rashEntry'
            },
            log
        );
        if (ok) {
            await settleScene();
        }
        return ok;
    }
    const ok = await useOnLoc(
        SV_ITEM.BONE_KEY.id,
        { name: SV_LOC.TOMB_EXIT, near: SV_TILE.TOMB_EXIT },
        [],
        () => here() !== 'rashEntry',
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

/**
 * The gate teleports across itself in whichever direction you came from, so both
 * crossings are the same click. Southbound it refuses anyone not wearing the Beads
 * of the Dead — and summons Rashiliyia instead of saying so.
 */
export async function passGate(dir: 'in' | 'out', log: (m: string) => void): Promise<boolean> {
    const want: ShiloArea = dir === 'in' ? 'rashLedge' : 'rashEntry';
    if (here() === want) {
        return true;
    }
    if (dir === 'in' && !Equipment.contains(SV_ITEM.DEAD_BEADS.name)) {
        log('the Beads of the Dead are not worn — the gate would summon Rashiliyia');
        return false;
    }
    const gate = locNear(SV_LOC.ANCIENT_GATE, 'Open', 12);
    if (!gate) {
        // Out of range: walk up to the gate and let the next pass click it.
        const ok = await promptLoc(
            {
                name: SV_LOC.ANCIENT_GATE,
                op: 'Open',
                near: SV_TILE.ANCIENT_GATE,
                expect: () => here() === want
            },
            log
        );
        if (ok) {
            await settleScene();
        }
        return ok;
    }
    if (!(await gate.interact('Open'))) {
        return false;
    }
    const ok = await Execution.delayUntil(() => here() === want, 15_000);
    if (ok) {
        await settleScene();
    }
    return ok;
}

/**
 * The rocks are clicked from wherever the gate dropped us — the ledge is unwalkable
 * in the baked pack, so nothing may try to walk onto it first.
 */
export async function climbRashRocks(dir: 'down' | 'up', log: (m: string) => void): Promise<boolean> {
    const want: ShiloArea = dir === 'down' ? 'rashInner' : 'rashLedge';
    if (here() === want) {
        return true;
    }
    const rocks = locNear(SV_LOC.RASH_ROCKS, 'Climb', 8);
    if (!rocks) {
        log(`no climbable rocks in range going ${dir}`);
        return false;
    }
    if (!(await rocks.interact('Climb'))) {
        return false;
    }
    const ok = await Execution.delayUntil(() => here() === want, 20_000);
    if (ok) {
        await settleScene();
    }
    return ok;
}

/** Three plain bones, one recess at a time; the third opens the doors and pushes you through. */
export async function placeBone(log: (m: string) => void): Promise<boolean> {
    if (heldId(SV_ITEM.BONES.id) === 0) {
        log('no bones left for the door recesses');
        return false;
    }
    const before = heldId(SV_ITEM.BONES.id);
    return useOnLoc(
        SV_ITEM.BONES.id,
        { name: SV_LOC.TOMB_DOORS, near: SV_TILE.TOMB_DOORS },
        [],
        () => heldId(SV_ITEM.BONES.id) < before,
        log
    );
}

/**
 * The dolmen is on the far side of the skeletal doors, and the doors revert to
 * closed three ticks after any crossing — so every trip through them is another
 * `Open`, which teleports rather than walks. Nothing routes through them: they are
 * excluded from the door bake precisely because three bones is the only way in.
 */
export async function crossTombDoors(dir: 'north' | 'south', log: (m: string) => void): Promise<boolean> {
    const want = dir === 'north';
    const there = (): boolean => inDolmenRoom(Game.tile()) === want;
    if (there()) {
        return true;
    }
    const stand = want ? SV_TILE.TOMB_DOORS : SV_TILE.TOMB_DOORS_INSIDE;
    if (!(await Traversal.walkResilient(stand, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    const doors = locNear(SV_LOC.TOMB_DOORS, 'Open', 8);
    if (!doors) {
        log(`no skeletal doors in range to cross ${dir}`);
        return false;
    }
    if (!(await doors.interact('Open'))) {
        return false;
    }
    const ok = await Execution.delayUntil(there, 15_000);
    if (ok) {
        await settleScene();
    }
    return ok;
}

/**
 * Leaving the chamber is three moves, not one: back through the skeletal doors,
 * east to the foot of the climbing rocks, then up. Nothing but the doors connects
 * the dolmen room to the rest of the tomb.
 */
export async function leaveTombChamber(log: (m: string) => void): Promise<boolean> {
    if (here() !== 'rashInner') {
        return true;
    }
    if (!(await crossTombDoors('south', log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(SV_TILE.RASH_ROCKS_BOTTOM, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    return climbRashRocks('up', log);
}

const FIGHT_MS = 240_000;

/**
 * Searching the dolmen either summons the next Nazastarool or, once all three are
 * down, yields the remains. Driving both from one step keeps the state machine
 * honest when the journal still claims kills the engine has already reset.
 */
export async function workTheDolmen(log: (m: string) => void): Promise<boolean> {
    if (heldId(SV_ITEM.RASH_CORPSE.id) > 0) {
        return true;
    }
    const boss = (): Npc | null => Npcs.query().name(SV_NPC.NAZASTAROOL).action('Attack').within(14).nearest();
    if (boss()) {
        return fightNazastarool(log);
    }
    if (!(await crossTombDoors('north', log))) {
        return false;
    }
    const searched = await promptLoc(
        {
            name: SV_LOC.RASH_DOLMEN,
            op: 'Search',
            near: SV_TILE.RASH_DOLMEN,
            expect: () => heldId(SV_ITEM.RASH_CORPSE.id) > 0 || boss() !== null,
            // The summon is deliberately delayed five to eight ticks.
            expectMs: 20_000
        },
        log
    );
    if (!searched) {
        return false;
    }
    if (heldId(SV_ITEM.RASH_CORPSE.id) > 0) {
        return true;
    }
    return fightNazastarool(log);
}

export async function fightNazastarool(log: (m: string) => void): Promise<boolean> {
    const deadline = performance.now() + FIGHT_MS;
    while (performance.now() < deadline) {
        const target = Npcs.query().name(SV_NPC.NAZASTAROOL).action('Attack').within(14).nearest();
        if (!target) {
            return true;
        }
        await Sustain.run();
        if (!Game.inCombat()) {
            await target.interact('Attack');
            await Execution.delayUntil(() => Game.inCombat(), 5000);
        }
        await Execution.delayTicks(2);
    }
    log('Nazastarool outlasted the fight budget');
    return false;
}

export function beadsOn(): boolean {
    return Equipment.contains(SV_ITEM.DEAD_BEADS.name);
}
