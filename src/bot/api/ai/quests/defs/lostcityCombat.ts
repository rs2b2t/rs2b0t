import { SPELL_DB } from '../../../../data/spelldb.js';
import { castsAvailable } from '../../../combat/CombatStyleLogic.js';
import { reader } from '../../../../adapter/ClientAdapter.js';
import Tile from '../../../../geometry/Tile.js';
import { DirectNavigator } from '../../../../event/webwalk/DirectNavigator.js';
import { EventSignal } from '../../../execution/EventSignal.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Locs } from '../../../locs/Locs.js';
import { Npcs } from '../../../npcs/Npcs.js';
import { Skills } from '../../../skills/Skills.js';
import { Sustain } from '../../../sustain/Sustain.js';
import { Traversal } from '../../../walking/Traversal.js';

const STRIKES = ['Fire Strike', 'Earth Strike', 'Water Strike', 'Wind Strike'];
export const TREE_SPIRIT_SAFESPOT = new Tile(2859, 9731, 0);
export const TREE_SPIRIT_TRAP = new Tile(2859, 9733, 0);
export const TREE_STAND = new Tile(2860, 9733, 0);
export const LURE = [new Tile(2860, 9732, 0), new Tile(2860, 9731, 0), TREE_SPIRIT_SAFESPOT] as const;

const here = () => reader.serverTile() ?? Game.tile();
const at = (tile: Tile) => { const position = here(); return position !== null && tile.equals(position); };
const spirit = () => Npcs.all().find(npc => npc.id === 655 && !npc.targetsAnotherPlayer()
    && !(npc.health === 0 && npc.snap.totalHealth > 0)) ?? null;
const trapped = () => {
    const target = spirit();
    return target !== null && TREE_SPIRIT_TRAP.equals(target.networkTile());
};
const strike = () => highestLostCityStrike(Skills.effective('magic'), name => Inventory.count(name));

export function highestLostCityStrike(magic: number, count: (rune: string) => number): string | null {
    return STRIKES.find(name => SPELL_DB[name]!.level <= magic && castsAvailable(name, [], count) > 0) ?? null;
}

async function takeCover(log: (m: string) => void): Promise<boolean> {
    if (at(TREE_SPIRIT_SAFESPOT) && trapped()) return true;
    if (!(await Traversal.walkResilient(TREE_STAND, { radius: 0, attempts: 2, timeoutMs: 30_000, log }))) return false;
    for (const tile of LURE) {
        if (EventSignal.pending() || !(await DirectNavigator.walk(tile))) return false;
        let arrived = false;
        for (let tick = 0; tick < 8; tick++) {
            if (EventSignal.pending()) return false;
            await Sustain.run();
            if (at(tile)) { arrived = true; break; }
            await Execution.delayTicks(1);
        }
        if (!arrived) return false;
    }
    for (let tick = 0; tick < 15; tick++) {
        if (EventSignal.pending() || !at(TREE_SPIRIT_SAFESPOT)) return false;
        if (trapped()) {
            log('Tree Spirit trapped behind the fungus; casting from 2859,9731');
            return true;
        }
        await Sustain.run();
        await Execution.delayTicks(1);
    }
    log('Tree Spirit did not reach the trapped tile; withholding casts');
    return false;
}

export async function defeatTreeSpirit(log: (m: string) => void, complete: () => Promise<boolean>): Promise<boolean> {
    if (EventSignal.pending()) return false;
    const retaliate = Game.autoRetaliateOn();
    Game.setAutoRetaliate(false);
    if (!(await Execution.delayUntilTicks(() => !Game.autoRetaliateOn(), 5))) return false;
    if (!spirit()) {
        if (await complete()) { Game.setAutoRetaliate(retaliate); return true; }
        if (!strike()) { log('no castable Strike spell; supply runes before summoning the Tree Spirit'); return false; }
        if (Npcs.all().some(npc => npc.id === 655)) {
            log('waiting for the other player to finish their Tree Spirit');
            return false;
        }
        if (!(await Traversal.walkResilient(TREE_STAND, { radius: 0, attempts: 2, timeoutMs: 90_000, log }))) return false;
        const tree = Locs.query().where(loc => loc.id === 1292).action('Chop down').within(8).nearest();
        if (!tree || !(await tree.interact('Chop down'))) return false;
        if (!(await Execution.delayUntilTicks(() => spirit() !== null, 20))) return false;
    }
    if (!(await takeCover(log))) return false;
    const deadline = performance.now() + 540_000;
    let casts = 0;
    let missing = 0;
    while (performance.now() < deadline && casts < 300) {
        if (EventSignal.pending()) return false;
        await Sustain.run();
        const target = spirit();
        if (!target) {
            if (++missing < 5) { await Execution.delayTicks(1); continue; }
            if (!(await complete())) { log('Tree Spirit disappeared without quest credit'); return false; }
            log(`Tree Spirit defeated with ${casts} Strike casts`);
            Game.setAutoRetaliate(retaliate);
            return true;
        }
        missing = 0;
        if (Game.autoRetaliateOn()) { Game.setAutoRetaliate(false); return false; }
        if (!at(TREE_SPIRIT_SAFESPOT) || !trapped()) {
            log('Tree Spirit safespot changed; withholding casts');
            await takeCover(log);
            return false;
        }
        const spell = strike();
        if (!spell) {
            log('no castable Strike spell; holding the Tree Spirit safespot');
            return false;
        }
        const before = Inventory.count('Mind rune');
        let consumed = false;
        let pending = true;
        try {
            if (!(await Game.castOnNpc(spell, target))) {
                log(`could not cast ${spell}; holding the Tree Spirit safespot`);
                return false;
            }
            for (let tick = 0; tick < 10; tick++) {
                if (EventSignal.pending()) return false;
                await Sustain.run();
                if (!at(TREE_SPIRIT_SAFESPOT)) {
                    pending = !(await DirectNavigator.walk(TREE_SPIRIT_SAFESPOT));
                    log('cast moved away from the Tree Spirit safespot');
                    return false;
                }
                if (Game.autoRetaliateOn() || (spirit() && !trapped())) {
                    Game.setAutoRetaliate(false);
                    log('Tree Spirit moved before the cast settled; cancelling');
                    return false;
                }
                consumed ||= Inventory.count('Mind rune') < before;
                if (tick >= 5 && consumed) break;
                await Execution.delayTicks(1);
            }
            if (!consumed) { log(`${spell} did not consume runes; holding cover`); return false; }
            pending = false;
        } finally {
            if (pending) {
                const position = here();
                if (position) await DirectNavigator.walk(position);
            }
        }
        casts++;
        log(`Tree Spirit: ${spell} cast ${casts}`);
    }
    log('Tree Spirit cast budget reached; holding cover');
    return false;
}
