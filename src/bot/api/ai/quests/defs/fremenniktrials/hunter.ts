import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import Tile from '../../../../../geometry/Tile.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { hasFlag, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { attackable, fight } from '../trollstronghold/combat.js';
import { FT_ID, SIGLI } from './areas.js';
import { combatKit, heldId } from './supplies.js';

const HERE = /the draugen is here/i;
const GUIDE = /the talisman guides you (north-west|south-west|north-east|south-east|north|south|east|west)/i;

const DIRECTION: Record<string, { dx: number; dz: number }> = {
    north: { dx: 0, dz: 1 },
    'north-east': { dx: 1, dz: 1 },
    east: { dx: 1, dz: 0 },
    'south-east': { dx: 1, dz: -1 },
    south: { dx: 0, dz: -1 },
    'south-west': { dx: -1, dz: -1 },
    west: { dx: -1, dz: 0 },
    'north-west': { dx: -1, dz: 1 }
};

/** Locates per hunt before the step gives the tick budget back. */
const LOCATES = 20;

// Why: `draugen_locate` compares the two coordinates axis by axis, so each bearing is the sign of dx and the sign of dz — two independent bisections, not one compass stride.
// Why: `spawn_draugen_butterfly` rolls (2688,3572), (2720,3616), (2656,3616) or (2720,3680), each scattered up to twenty tiles by `map_findsquare`, and this box is their union.

interface Box {
    xlo: number;
    xhi: number;
    zlo: number;
    zhi: number;
}

// Why: `viking_draugen_safe` wanders off its anchor across the thousand ticks it lives, so the box is the province, not the four spawn squares.
const ANCHORS: Box = { xlo: 2600, xhi: 2760, zlo: 3540, zhi: 3720 };

/** Where an aim lands close enough that another walk tells the search nothing. */
const SETTLED = 2;

// Why: `viking_draugen_safe` is an npc and wanders, so a box that has closed on where it was reads as a contradiction — reopening around the character keeps the evidence, reopening wide is what finds it after a long drift.
const LOCAL = 12;

/** Sigli's trial: track the invisible Draugen with his talisman, then kill it. */
export function hunterStep(snap: QuestSnapshot): QuestStep | null {
    if (hasFlag(snap.progress, 'hunter-done')) {
        return null;
    }
    if (heldId(snap, FT_ID.TALISMAN_CHARGED) > 0) {
        return { kind: 'talk', stop: SIGLI([]) };
    }
    // Why: dressing before the first walk north costs one bank trip; dressing after Sigli hands the talisman over costs two.
    const kit = combatKit(snap);
    if (kit) {
        return kit;
    }
    if (!hasFlag(snap.progress, 'hunter-started') || heldId(snap, FT_ID.TALISMAN) === 0) {
        // Sigli hands out a replacement talisman whenever the player turns up without one.
        return { kind: 'talk', stop: SIGLI(["What's a Draugen?", 'Yes']) };
    }
    return { kind: 'custom', name: 'track and kill the Draugen', run: hunt };
}

function lastGuide(mark: number): string | null {
    let dir: string | null = null;
    for (const line of GameMessages.since(mark)) {
        const hit = GUIDE.exec(line.text);
        if (hit) {
            dir = hit[1]!.toLowerCase();
        }
    }
    return dir;
}

async function locate(): Promise<'here' | 'lost' | string> {
    const talisman = Inventory.items().find(i => i.id === FT_ID.TALISMAN);
    if (!talisman) {
        return 'lost';
    }
    const mark = GameMessages.mark();
    if (!(await talisman.interact('Locate'))) {
        return 'lost';
    }
    if (!(await Execution.delayUntil(() => GameMessages.sawSince(mark, HERE) || lastGuide(mark) !== null, 6000))) {
        return 'lost';
    }
    if (GameMessages.sawSince(mark, HERE)) {
        return 'here';
    }
    return lastGuide(mark) ?? 'lost';
}

/** Cut the search box down to the side of the character the bearing points to, on each axis; null once the halves cross. */
export function narrow(box: Box, at: { x: number; z: number }, dir: string): Box | null {
    const sign = DIRECTION[dir];
    if (!sign) {
        return box;
    }
    const next = { ...box };
    if (sign.dx > 0) {
        next.xlo = Math.max(next.xlo, at.x + 1);
    } else if (sign.dx < 0) {
        next.xhi = Math.min(next.xhi, at.x - 1);
    } else {
        next.xlo = next.xhi = at.x;
    }
    if (sign.dz > 0) {
        next.zlo = Math.max(next.zlo, at.z + 1);
    } else if (sign.dz < 0) {
        next.zhi = Math.min(next.zhi, at.z - 1);
    } else {
        next.zlo = next.zhi = at.z;
    }
    return next.xlo > next.xhi || next.zlo > next.zhi ? null : next;
}

/** The box reopened around the character, clamped to the ground the butterfly can be on. */
export function around(at: { x: number; z: number }): Box {
    return {
        xlo: Math.max(ANCHORS.xlo, at.x - LOCAL),
        xhi: Math.min(ANCHORS.xhi, at.x + LOCAL),
        zlo: Math.max(ANCHORS.zlo, at.z - LOCAL),
        zhi: Math.min(ANCHORS.zhi, at.z + LOCAL)
    };
}

export function middle(box: Box): Tile {
    return new Tile(Math.round((box.xlo + box.xhi) / 2), Math.round((box.zlo + box.zhi) / 2), 0);
}

async function hunt(log: (m: string) => void): Promise<boolean> {
    let box: Box = { ...ANCHORS };
    let reopens = 0;
    for (let i = 0; i < LOCATES; i++) {
        if (Inventory.countById(FT_ID.TALISMAN_CHARGED) > 0) {
            return true;
        }
        const reading = await locate();
        if (reading === 'lost') {
            return false;
        }
        if (reading !== 'here') {
            const at = Game.tile();
            if (!at) {
                return false;
            }
            const cut = narrow(box, at, reading);
            if (!cut) {
                box = reopens++ % 2 === 0 ? around(at) : { ...ANCHORS };
                continue;
            }
            const aim = middle(cut);
            if (aim.distanceTo(at) <= SETTLED) {
                box = reopens++ % 2 === 0 ? around(at) : { ...ANCHORS };
                continue;
            }
            box = cut;
            log(`the talisman points ${reading} — aiming for (${aim.x},${aim.z})`);
            const arrived = await Traversal.walkResilient(aim, { radius: 2, attempts: 2, timeoutMs: 60_000, log });
            // Why: half of the box is sea and fenced field, and aiming at the same unreachable middle again reads the same bearing from the same tile forever.
            if (!arrived) {
                box = around(Game.tile() ?? at);
            }
            continue;
        }
        log('the Draugen has surfaced — fighting it for the talisman charge');
        const won = await fight(
            {
                what: 'The Draugen',
                target: () => attackable('The Draugen', 12),
                won: () => Inventory.countById(FT_ID.TALISMAN_CHARGED) > 0,
                protect: 'melee',
                guard: 600
            },
            log
        );
        return won;
    }
    return Inventory.countById(FT_ID.TALISMAN_CHARGED) > 0;
}
