import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Reach } from '../../api/Reach.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { isUnderground, type NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

const DOOR_KEY = 'Door key';
const MAGNET = 'Magnet';
const SHED_KEY = 'Key';
const BALL = 'Ball';
const CHEESE = 'Cheese';
const GLOVES = 'Leather gloves';

const EXPERIMENT_FORMS = [
    'Witches experiment',
    'Witches experiment second form',
    'Witches experiment third form',
    'Witches experiment fourth form'
];

const BOY: NpcStop = { npc: 'Boy', anchor: new Tile(2928, 3456, 0), leash: 6, prefer: ["What's the matter?", "Ok, I'll see what I can do."] };

const POT_STAND = new Tile(2900, 3474, 0);
const LADDER_TILE = new Tile(2907, 3476, 0);
const MOUSEHOLE_STAND = new Tile(2903, 3467, 0);
const FOUNTAIN_STAND = new Tile(2909, 3471, 0);
const SHED_STAND = new Tile(2933, 3463, 0);

const CELLAR_UP_STAND = new Tile(2907, 9876, 0);
const GATE_EAST_STAND = new Tile(2904, 9873, 0);
const GATE_WEST_STAND = new Tile(2900, 9873, 0);
const CUPBOARD_STAND = new Tile(2898, 9873, 0);
const GATE_X = 2902;

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name.toLowerCase()) ?? 0) > 0;
const wornGloves = (snap: QuestSnapshot): boolean => snap.worn.has(GLOVES.toLowerCase());

function nearestExperiment() {
    return Npcs.query().name(...EXPERIMENT_FORMS).within(14).nearest();
}

async function magnetLeg(log: (m: string) => void): Promise<boolean> {
    const t = Game.tile();
    if (t === null) {
        return false;
    }
    if (!isUnderground(t)) {
        const r = await Reach.locOp({
            name: 'Ladder',
            op: 'Climb-down',
            near: LADDER_TILE,
            expect: () => {
                const g = Game.tile();
                return g !== null && isUnderground(g);
            },
            log
        });
        if (r === 'unreachable') {
            log('magnetLeg: cellar ladder unreachable — re-entering to re-plan');
        }
        return false;
    }
    if (t.x >= GATE_X) {
        if (!(await Traversal.walkResilient(GATE_EAST_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
            return false;
        }
        const gate = Locs.query().name('Gate').action('Open').within(4).nearest();
        if (!gate) {
            log('magnetLeg: no Gate to Open (LIVE-VERIFY the iron gate @ 2902,9873)');
            return false;
        }
        await gate.interact('Open');
        await Execution.delayUntil(() => { const g = Game.tile(); return g !== null && g.x <= GATE_X - 1; }, 6000);
        return false;
    }
    if (!(await Traversal.walkResilient(CUPBOARD_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const shut = Locs.query().name('Cupboard').action('Open').within(6).nearest();
    if (shut) {
        await shut.interact('Open');
        await Execution.delayTicks(2);
        return false;
    }
    const open = Locs.query().name('Cupboard').action('Search').within(6).nearest();
    if (!open) {
        log('magnetLeg: no open Cupboard to Search near 2898,9873');
        return false;
    }
    if (!(await open.interact('Search'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.contains(MAGNET), 8000);
}

async function gardenLeg(log: (m: string) => void): Promise<boolean> {
    const t = Game.tile();
    if (t === null) {
        return false;
    }
    if (isUnderground(t)) {
        if (t.x <= GATE_X - 1) {
            if (!(await Traversal.walkResilient(GATE_WEST_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
                return false;
            }
            const gate = Locs.query().name('Gate').action('Open').within(4).nearest();
            if (gate) {
                await gate.interact('Open');
                await Execution.delayUntil(() => { const g = Game.tile(); return g !== null && g.x >= GATE_X + 1; }, 6000);
            }
            return false;
        }
        const ladder = Locs.query().name('Ladder').action('Climb-up').within(6).nearest();
        if (ladder) {
            await ladder.interact('Climb-up');
            await Execution.delayUntil(() => { const g = Game.tile(); return g !== null && !isUnderground(g); }, 10_000);
            return false;
        }
        await Traversal.walkResilient(CELLAR_UP_STAND, { radius: 3, attempts: 2, timeoutMs: 60_000, log });
        return false;
    }
    if (Inventory.contains(MAGNET)) {
        if (!(await Traversal.walkResilient(MOUSEHOLE_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        let mouse = Npcs.query().name('Mouse').within(8).nearest();
        if (!mouse) {
            const cheese = Inventory.first(CHEESE);
            const hole = Locs.query().name('Mouse hole').within(8).nearest();
            if (cheese && hole) {
                await cheese.useOn(hole);
                await Execution.delayUntil(() => Npcs.query().name('Mouse').within(8).nearest() !== null, 6000);
            } else {
                log('gardenLeg: no Cheese or Mouse hole to lure the mouse');
                return false;
            }
            mouse = Npcs.query().name('Mouse').within(8).nearest();
        }
        if (mouse) {
            const magnet = Inventory.first(MAGNET);
            if (magnet) {
                await magnet.useOn(mouse);
                await Execution.delayTicks(3);
            }
        }
    }
    if (!(await Traversal.walkResilient(FOUNTAIN_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    const fountain = Locs.query().name('Fountain').action('Check').within(6).nearest();
    if (!fountain) {
        log('gardenLeg: no Fountain to Check (back door may still be locked — LIVE-VERIFY the mouse/magnet unlock)');
        return false;
    }
    if (!(await fountain.interact('Check'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.contains(SHED_KEY), 8000);
}

async function shedLeg(log: (m: string) => void): Promise<boolean> {
    const exp = nearestExperiment();
    if (exp) {
        if (!Game.inCombat()) {
            await exp.interact('Attack');
            await Execution.delayUntil(() => Game.inCombat() || !exp.valid(), 4000);
        } else {
            await Execution.delayTicks(2);
        }
        return false;
    }
    const ball = GroundItems.query().name(BALL).within(14).nearest();
    if (ball) {
        await ball.interact('Take');
        await Execution.delayUntil(
            () => Inventory.contains(BALL) || nearestExperiment() !== null,
            6000
        );
        return false;
    }
    if (!(await Traversal.walkResilient(SHED_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    const door = Locs.query().name('Door').action('Open').within(4).nearest();
    const key = Inventory.first(SHED_KEY);
    if (door && key) {
        await key.useOn(door);
        await Execution.delayUntil(() => nearestExperiment() !== null, 6000);
    } else {
        log('shedLeg: no shed Door or shed Key to open the shed');
    }
    return false;
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: BOY }; }

    if (has(snap, BALL)) { return { kind: 'talk', stop: BOY }; }

    if (has(snap, SHED_KEY)) { return { kind: 'custom', name: 'shed + experiment fight', run: shedLeg }; }

    if (has(snap, MAGNET)) { return { kind: 'custom', name: 'mouse/magnet + shed key', run: gardenLeg }; }

    if (has(snap, DOOR_KEY)) {
        if (!wornGloves(snap)) {
            if (!has(snap, GLOVES)) { return { kind: 'withdraw', items: [{ name: GLOVES, qty: 1 }] }; }
            return { kind: 'equip', item: GLOVES };
        }
        return { kind: 'custom', name: 'cellar magnet', run: magnetLeg };
    }

    return { kind: 'interactLoc', loc: 'Potted plant', op: 'Look-under', anchor: POT_STAND, expectItem: DOOR_KEY };
}

export const witchshouse: QuestModule = {
    record: QUESTS.find(r => r.id === 'ball')!,
    bank: new Tile(2946, 3369, 0),
    food: 20,
    grind: EXPERIMENT_FORMS,
    tools: ['door key', 'key', 'magnet', 'cheese', 'ball', 'leather gloves'],
    decide
};
