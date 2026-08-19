import { Npcs } from '../../../../npcs/Npcs.js';
import type { QuestStep } from '../../engine/types.js';
import { gotoNpc, talkThrough, type NpcStop } from '../../exec/primitives.js';
import { protectedWalk } from '../trollstronghold/combat.js';

const THROWER = 'Thrower Troll';
/** `troll_thrower` attackrange is 8; arm a little before they can start. */
const THROWER_RANGE = 11;

const throwerNear = (): boolean => Npcs.query().name(THROWER).within(THROWER_RANGE).nearest() !== null;

// Why: five thrower trolls stand across the only way onto Trollheim and open on sight, and nothing in a walk fights back — the crossing is chip damage that Protect from Missiles refuses.
// Why: this quest crosses it a dozen times, and three live runs died to it carrying the thin food float the scarecrow leg leaves room for.
// Why: the prayer follows the threat rather than the map, so it is up only while something is shooting and the bar is still full for the next crossing.

/** Run a leg with Protect from Missiles tracking the throwers. */
export function guarded(name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep {
    return {
        kind: 'custom',
        name,
        run: log => protectedWalk('missiles', throwerNear, () => run(log), log)
    };
}

/** A `talk` step that holds the prayer through the mountain crossing. */
export function guardedTalk(stop: NpcStop): QuestStep {
    return guarded(`talk to ${stop.npc}`, async log =>
        (await gotoNpc(stop, [], log)) && talkThrough(stop.npc, stop.prefer, log));
}
