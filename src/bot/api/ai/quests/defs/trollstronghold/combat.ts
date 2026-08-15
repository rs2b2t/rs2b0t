import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Prayer } from '../../../../prayer/Prayer.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Skills } from '../../../../skills/Skills.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { pickPreferred } from '../../exec/primitives.js';
import { PRAYER_SIP_AT } from './areas.js';

export const PROTECT = {
    melee: { name: 'protect from melee', level: 43 },
    missiles: { name: 'protect from missiles', level: 40 },
    magic: { name: 'protect from magic', level: 37 }
} as const;

export type ProtectKind = keyof typeof PROTECT;

class Protection {
    readonly usable: boolean;
    arms = 0;

    constructor(private readonly kind: ProtectKind) {
        this.usable = Skills.level('prayer') >= PROTECT[kind].level;
    }

    up(): boolean {
        return Prayer.active(PROTECT[this.kind].name);
    }

    async hold(): Promise<boolean> {
        if (!this.usable || Prayer.points() <= 0 || this.up()) {
            return false;
        }
        if (await Prayer.set(PROTECT[this.kind].name, true)) {
            this.arms++;
            return true;
        }
        return false;
    }

    async clear(): Promise<void> {
        if (this.up()) {
            await Prayer.set(PROTECT[this.kind].name, false);
        }
    }
}

// Why: a fixed on-at-A-off-at-B window is always wrong at one end — the throwers are behind you well before the stronghold door, and every tick of prayer burnt after that is a tick the fight inside does not get.
// Why: `Sustain` is pumped by the walker on every pass, so borrowing the hook for the duration of the walk gives a per-tick check: up while something is shooting, down the moment it is not.
// Why: the host's own hook (eating) still runs first, as prayer is free when it is already holding and food is not.

/** Run `walk` with a protection prayer that tracks the threat rather than a stretch of map. */
export async function protectedWalk(
    kind: ProtectKind,
    threat: () => boolean,
    walk: () => Promise<boolean>,
    log: (m: string) => void
): Promise<boolean> {
    const guard = new Protection(kind);
    const host = Sustain.hook;
    let armed = false;
    Sustain.set(async () => {
        // The crossing drains too, so the same rule applies out here.
        if (guard.usable && needsSip(Prayer.points(), Prayer.max()) && (await sipPrayer(log))) {
            return;
        }
        if (threat()) {
            if (!armed && (await guard.hold())) {
                armed = true;
                log(`holding Protect from ${kind === 'missiles' ? 'Missiles' : kind}`);
            }
        } else if (armed) {
            armed = false;
            await guard.clear();
            log(`dropping Protect from ${kind === 'missiles' ? 'Missiles' : kind} — nothing in range`);
        }
        await host?.();
    });
    try {
        return await walk();
    } finally {
        Sustain.set(host);
        await guard.clear();
    }
}

export function needsSip(points: number, max: number): boolean {
    return max > 0 && points < max * PRAYER_SIP_AT;
}

/** False when there is nothing to drink, so the caller can spend the tick elsewhere. */
async function sipPrayer(log: (m: string) => void): Promise<boolean> {
    const pot = Inventory.items().find(i => {
        const name = (i.name ?? '').toLowerCase();
        return name.startsWith('prayer potion') && i.actions().some(a => /^drink$/i.test(a));
    });
    if (!pot) {
        return false;
    }
    const before = Prayer.points();
    if (!(await pot.interact('Drink'))) {
        return false;
    }
    const drank = await Execution.delayUntil(() => Prayer.points() > before, 3000);
    if (drank) {
        log(`sipped ${pot.name} — prayer ${before} → ${Prayer.points()}`);
    }
    return drank;
}

/** A tuna's worth of damage is enough to eat on; waiting spends the margin. */
const EAT_AT_MISSING = 12;

function hungry(): boolean {
    const max = Skills.level('hitpoints');
    return max > 0 && Skills.effective('hitpoints') <= max - EAT_AT_MISSING;
}

export interface FightPlan {
    what: string;
    /** The thing to hit, or null while it is out of range or not spawned. */
    target: () => Npc | null;
    /** True once this fight is over — a corpse, a dropped key, a varp move. */
    won: () => boolean;
    protect: ProtectKind;
    /** Ticks before the fight is declared stuck. */
    guard: number;
    // Why: Dad forfeits below 20 hitpoints instead of dying — `defeat_dad` sets the stage, heals him to full and offers "I'll be going now."
    // Why: leaving that dialogue undrained loses the win.

    /** Options to take when a dialogue opens mid-fight. */
    dialogue?: readonly string[];
    /** Called with the option taken whenever `dialogue` drives a choice. */
    onDialogue?: (chosen: string) => void;
    /** Nothing found to hit: give the caller a chance to re-spawn or re-approach. */
    onMissing?: () => Promise<boolean>;
}

// Why: the server runs a single op per tick and silently drops the rest, so a loop that eats, prays and swings in the same breath loses two of the three — one action per tick, in the order dialogue, pray, eat, attack.
// Why: prayer goes before food because it is free once the varp says it is up, and because a loop that eats first spends every damaged tick on food and never re-arms.

/** Run one fight to its win condition. */
export async function fight(plan: FightPlan, log: (m: string) => void): Promise<boolean> {
    const prayers = new Protection(plan.protect);
    if (!prayers.usable) {
        log(`prayer below ${PROTECT[plan.protect].level} — the ${plan.what} will land hits this fight`);
    }
    await prayers.hold();
    Game.setAutoRetaliate(true);
    let lastTick = -1;
    let reported = -1;
    let swings = 0;
    let attacking = -1;
    try {
        for (let i = 0; i < plan.guard; i++) {
            if (plan.won()) {
                log(`${plan.what}: done (${swings} attacks, ${prayers.arms} prayer re-arms)`);
                return true;
            }
            // Why: a random event has to be answered by the host, and this loop owns the tick budget until it returns, so it hands back rather than swing through a genie for the next four hundred ticks.
            if (EventSignal.pending()) {
                log(`${plan.what}: yielding to a random event`);
                return false;
            }
            const now = Game.tick();
            if (now === lastTick) {
                await Execution.delayTicks(1);
                continue;
            }
            lastTick = now;

            if (plan.dialogue && (ChatDialog.isOpen() || ChatDialog.canContinue())) {
                await drainDialogue(plan.dialogue, plan.onDialogue, log);
                continue;
            }
            // Sip first: prayer cannot be re-armed on an empty bar.
            if (prayers.usable && needsSip(Prayer.points(), Prayer.max()) && (await sipPrayer(log))) {
                continue;
            }
            if (prayers.usable && !prayers.up() && Prayer.points() > 0) {
                await prayers.hold();
                continue;
            }
            if (hungry()) {
                await Sustain.run();
                continue;
            }

            const target = plan.target();
            if (!target) {
                attacking = -1;
                if (plan.onMissing && !(await plan.onMissing())) {
                    return false;
                }
                await Execution.delayTicks(2);
                continue;
            }
            if (now - reported >= 40) {
                reported = now;
                log(`${plan.what}: hp=${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}`
                    + ` prayer=${Prayer.points()} attacks=${swings}`);
            }
            // Why: melee keeps swinging on its own, so re-clicking the same target spends the tick's one action re-targeting.
            // Why: Dad's slam knocks us seven tiles clear and drops combat, which is when to re-issue.
            if (target.index === attacking && Game.inCombat()) {
                await Execution.delayTicks(1);
                continue;
            }
            if (await target.interact('Attack')) {
                attacking = target.index;
                swings++;
            }
            await Execution.delayTicks(1);
        }
        log(`${plan.what}: gave up after ${plan.guard} ticks`);
        return false;
    } finally {
        if (plan.won()) {
            await prayers.clear();
        }
    }
}

async function drainDialogue(
    prefer: readonly string[],
    onChosen: ((chosen: string) => void) | undefined,
    log: (m: string) => void
): Promise<void> {
    for (let i = 0; i < 20; i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const opts = ChatDialog.options();
        if (opts.length === 0) {
            return;
        }
        const pick = pickPreferred(opts, [...prefer]);
        if (!pick) {
            log(`WARN: mid-fight dialogue had no preferred option in [${opts.join(' | ')}]`);
            return;
        }
        await ChatDialog.chooseOption(pick);
        onChosen?.(pick);
        await Execution.delayTicks(2);
    }
}

/** Nearest NPC of `name` offering Attack and not already someone else's fight. */
export function attackable(name: string, within: number): Npc | null {
    return Npcs.query()
        .name(name)
        .action('Attack')
        .where(n => !n.targetsAnotherPlayer())
        .within(within)
        .nearest();
}
