import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import type { Npc } from '../../../../model/Npc.js';
import { Prayer } from '../../../../prayer/Prayer.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { PRAYER_POTIONS } from './supplies.js';

const PROTECT_MELEE = 'Protect from Melee';

/** Off-toggles to send before reporting the prayer stuck on. */
const PRAYER_OFF_ATTEMPTS = 3;

/** Ticks between re-issuing Attack when the engine says we are already in combat. */
const SWING_GAP = 5;

// Why: prayer points equal the prayer level, so 70 is 3.5 minutes of Protect from Melee and the 3 guardians outlast it; the dose goes in well before the prayer lapses.
/** Below this many prayer points, a dose goes in. */
const PRAYER_FLOOR = 25;

// Why: the 3 Viyeldi guardians are all aggressive at once and each hits for double figures, so a pass that starts eating at 55% can lose the rest in the same tick.
/** Fraction of hitpoints below which the loop eats before it does anything else. */
const EAT_BELOW = 0.7;

export interface FightPlan {
    /** Display name of the thing to hit. */
    npc: string;
    /** True once the fight is over, a stage change, an item, a corpse. */
    done: () => boolean;
    /** Overall budget. */
    ms?: number;
    /** Hold Protect from Melee for the duration. */
    pray?: boolean;
}

function target(name: string): Npc | null {
    return Npcs.query().name(name).action('Attack').within(14).nearest();
}

function hurt(): boolean {
    const max = Skills.level('hitpoints');
    return max > 0 && Skills.effective('hitpoints') / max < EAT_BELOW;
}

/** Drink one dose of prayer restore, if the pack has any. */
export async function drinkPrayer(log: (m: string) => void): Promise<boolean> {
    const dose = Inventory.items().find(item => PRAYER_POTIONS.some(p => p.id === item.id));
    if (!dose) {
        return false;
    }
    if (!(await dose.interact('Drink'))) {
        return false;
    }
    log('drank a prayer potion');
    await Execution.delayTicks(1);
    return true;
}

// Why: the server runs one op per tick and drops the rest, so a pass that eats, prays and swings loses 2 of the 3, and the one it loses is the food.
// Why: the order is eat, then top the prayer up, then swing, which keeps hitpoints off the floor against a level-187 demon at 70s.

/**
 * Fight one named NPC to a goal, holding Protect from Melee and eating as needed.
 * @see docs/decisions/quest-pitfalls-2.md
 */
export async function fight(plan: FightPlan, log: (m: string) => void): Promise<boolean> {
    const deadline = performance.now() + (plan.ms ?? 300_000);
    const wantPray = plan.pray !== false && Prayer.known(PROTECT_MELEE) && Skills.level('prayer') >= 43;
    let lastTick = -1;
    let lastSwing = -99;
    // Why: the loop spends its first ticks eating and swinging, and 3 aggressive guardians take a third of the bar in that time, so the prayer goes up before the first blow.
    if (wantPray && !Prayer.active(PROTECT_MELEE) && Prayer.available(PROTECT_MELEE)) {
        await Prayer.set(PROTECT_MELEE, true);
    }
    try {
        while (performance.now() < deadline) {
            if (plan.done()) {
                return true;
            }
            const tick = Game.tick();
            if (tick === lastTick) {
                await Execution.delayTicks(1);
                continue;
            }
            lastTick = tick;

            if (hurt()) {
                await Sustain.run();
                continue;
            }
            if (wantPray && Prayer.points() <= PRAYER_FLOOR && (await drinkPrayer(log))) {
                continue;
            }
            if (wantPray && !Prayer.active(PROTECT_MELEE) && Prayer.available(PROTECT_MELEE)) {
                await Prayer.set(PROTECT_MELEE, true);
                continue;
            }
            const enemy = target(plan.npc);
            if (!enemy) {
                await Execution.delayTicks(2);
                continue;
            }
            // Why: With three attackers, the named NPC may not be the active opponent; repeated Attack ops can consume eating ticks.
            if ((!Game.inCombat() || !enemy.targetsMe()) && tick - lastSwing >= SWING_GAP) {
                lastSwing = tick;
                await enemy.interact('Attack');
                await Execution.delayUntil(() => Game.inCombat() || plan.done(), 5000);
                continue;
            }
            await Execution.delayTicks(1);
        }
    } finally {
        // Why: the server runs one op per tick and drops the rest, and this toggle is sent on the tick the fight ended, which the loop may have spent on a swing, so it's the send most likely to be dropped.
        // Why: left on it drains through the walk out and empties the flask the next fight needs. `Prayer.set` returns false when the toggle doesn't land, so retry it.
        if (wantPray) {
            for (let i = 0; i < PRAYER_OFF_ATTEMPTS && Prayer.active(PROTECT_MELEE); i++) {
                await Prayer.set(PROTECT_MELEE, false);
            }
            if (Prayer.active(PROTECT_MELEE)) {
                log('Protect from Melee would not switch off');
            }
        }
    }
    log(`${plan.npc} outlasted the fight budget`);
    return plan.done();
}
