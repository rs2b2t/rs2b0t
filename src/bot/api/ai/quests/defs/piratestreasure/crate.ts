import { Execution } from '../../../../execution/Execution.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Locs } from '../../../../locs/Locs.js';
import { settleScene } from '../../exec/prompts.js';
import { PT_LOC, PT_TILE } from './areas.js';

interface CrateState {
    rum: boolean;
    bananas: number;
}

export const CRATE_FULL = 10;

/** `[oploc1,bananacrate]` prints both varps the client cannot read. */
export function readCrateMessages(lines: readonly string[]): CrateState | null {
    const text = lines.join(' ').toLowerCase();
    const rum = text.includes('there is some rum in here') || text.includes('there is also some rum stashed in here');
    if (text.includes('the crate is completely empty')) {
        return { rum: false, bananas: 0 };
    }
    if (text.includes('the crate is full of bananas')) {
        return { rum, bananas: CRATE_FULL };
    }
    const counted = /the crate has (\d+) bananas? inside/.exec(text);
    if (counted) {
        return { rum, bananas: Number(counted[1]) };
    }
    if (rum) {
        return { rum: true, bananas: 0 };
    }
    return null;
}

/** Walk to the plantation crate, Search it, and read what it says back. */
export async function searchBananaCrate(log: (m: string) => void): Promise<CrateState | null> {
    if (!(await Traversal.walkResilient(PT_TILE.BANANA_CRATE, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        log('could not reach the plantation crate');
        return null;
    }
    await settleScene();
    const crate = Locs.query().where(l => l.id === PT_LOC.BANANA_CRATE).action('Search').within(6).nearest();
    if (!crate) {
        log('no searchable Crate at the plantation');
        return null;
    }
    const mark = GameMessages.mark();
    if (!(await crate.interact('Search'))) {
        return null;
    }
    const said = (): string[] => GameMessages.since(mark).map(m => m.text);
    await Execution.delayUntil(() => readCrateMessages(said()) !== null, 8000);
    const state = readCrateMessages(said());
    if (state) {
        log(`plantation crate: rum=${state.rum} bananas=${state.bananas}`);
    } else {
        log(`plantation crate said nothing readable: [${said().join(' | ')}]`);
    }
    return state;
}
