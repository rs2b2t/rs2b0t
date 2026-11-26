import { Execution } from '../execution/Execution.js';
import { Game } from '../game/Game.js';
import { Locs } from './Locs.js';

export async function climbLadder(name: string, op: string, log: (message: string) => void): Promise<boolean> {
    const ladder = Locs.query().name(name).action(op).nearest();
    if (!ladder) {
        log(`no '${name}' offering '${op}' nearby`);
        return false;
    }
    const before = Game.tile()?.level;
    await ladder.interact(op);
    return Execution.delayUntil(() => {
        const tile = Game.tile();
        return tile !== null && tile.level !== before;
    }, 8000);
}
