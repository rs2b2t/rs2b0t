import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Shop } from '../../api/shop/Shop.js';
import { Skills } from '../../api/skills/Skills.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Input } from '../../input/Input.js';
import { DUELING_RINGS, PASS } from './loadout.js';
import { near, inNest, inLair, SURFACE, UPPER, type Point } from './policy.js';
import type { Gate } from './party.js';

export async function walk(tile: Point, radius: number, log: (s: string) => void): Promise<boolean> {
    if (near(Game.tile(), tile, radius)) return true;
    return Traversal.walkResilient(tile, { radius, attempts: 2, timeoutMs: 90_000, maxBudget: 120_000, ...Traversal.pureWalk, log });
}

export function step(tile: Point): boolean {
    const local = reader.toLocal(tile.x, tile.z);
    return local !== null && Input.walk(local.lx, local.lz);
}

export async function camelot(): Promise<boolean> {
    const arrived = () => near(Game.tile(), { x: 2757, z: 3478, level: 0 }, 4);
    if (arrived()) return true;
    const hp = Skills.effective('hitpoints');
    if (!(await Game.teleport('Camelot'))) return false;
    await Execution.delayUntilTicks(() => arrived() || Skills.effective('hitpoints') < hp, 4);
    return arrived();
}

export async function duelArena(): Promise<boolean> {
    const arrived = () => near(Game.tile(), { x: 3315, z: 3235, level: 0 }, 4);
    const option = () => reader.chatOptions().find(o => o.text === 'Al Kharid Duel Arena.');
    if (arrived()) return true;
    if (!option()) {
        const ring = Inventory.items().find(i => DUELING_RINGS.includes(i.id));
        const hp = Skills.effective('hitpoints');
        if (!ring || !(await ring.interact('Rub'))) return false;
        await Execution.delayUntilTicks(() => !!option() || Skills.effective('hitpoints') < hp, 3);
        if (Skills.effective('hitpoints') <= 31) return false;
    }
    const choice = option();
    if (!choice || !actions.ifButton(choice.comId)) return false;
    const hp = Skills.effective('hitpoints');
    await Execution.delayUntilTicks(() => arrived() || Skills.effective('hitpoints') < hp, 4);
    return arrived();
}

export async function buyPass(log: (s: string) => void): Promise<boolean> {
    if (Inventory.countById(PASS) > 0) return true;
    if (!(await walk({ x: 3304, z: 3120, level: 0 }, 2, log)) || !(await Shop.open('Shantay'))) return false;
    const bought = await Shop.buy('Shantay pass', 1);
    await Shop.close();
    if (bought !== 1) throw new Error('Could not buy a Shantay pass');
    log('bought Shantay pass');
    return true;
}

export async function pass(log: (s: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.z < 3117) return true;
    if (Inventory.countById(PASS) === 0) throw new Error('Prepared Shantay pass missing');
    if (!(await walk({ x: 3304, z: 3120, level: 0 }, 2, log))) return false;
    const gate = Locs.query().where(l => l.id === 4031).nearest();
    if (!gate || !(await gate.interact('Go-through'))) return false;
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
        if (ChatDialog.canContinue()) await ChatDialog.continue();
        else if (ChatDialog.options().length > 0) await ChatDialog.chooseOption("Yeah, that poster doesn't scare me!");
        else if ((Game.tile()?.z ?? 9999) < 3117) return true;
        else await Execution.delayTicks(1);
    }
    return false;
}

export function ropeReady(gate: Gate): boolean {
    return Locs.query().where(l => l.id === (gate === 'surface' ? 3828 : 3831)).nearest() !== null;
}

export async function placeRope(gate: Gate, log: (s: string) => void): Promise<boolean> {
    if (ropeReady(gate)) return true;
    const loc = Locs.query().where(l => l.id === (gate === 'surface' ? 3827 : 3830)).nearest();
    const rope = Inventory.first('Rope');
    if (!loc || !rope || !(await rope.useOn(loc))) return false;
    if (!(await Execution.delayUntil(() => ropeReady(gate), 4000))) return false;
    log(`placed ${gate} rope`);
    return true;
}

export async function descend(gate: Gate): Promise<boolean> {
    const loc = Locs.query().where(l => l.id === (gate === 'surface' ? 3828 : 3831)).nearest();
    if (!loc || !(await loc.interact('Climb-down'))) return false;
    return Execution.delayUntilTicks(() => gate === 'surface' ? inNest(Game.tile()) : inLair(Game.tile()), 3);
}

export const gateTile = (gate: Gate): Point => gate === 'surface' ? SURFACE : UPPER;
