import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Prayer } from '../../../../prayer/Prayer.js';
import { Reach } from '../../../../walking/Reach.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Skills } from '../../../../skills/Skills.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { driveDialog } from '../../exec/primitives.js';
import { settleScene } from '../../exec/prompts.js';
import { HD_ID, HD_TILE } from './areas.js';
import { meleeReady, meleeWeaponName } from './supplies.js';

const MAGIC_TAB = 6;

/** The attackable junior. jr1..jr3 are the three ticks of its spawn animation. */
const DAGANNOTH_JR = 1347;

// Why: `npc_max_dealt` zeroes every hit that is not the one the current form is weak to.
// Why: the form's npc id, which `npc_changetype` puts on the wire, is therefore what picks the spell.

// The mother's six forms.
export const FORM_ELEMENT: Record<number, 'Wind' | 'Water' | 'Earth' | 'Fire'> = {
    1348: 'Wind',
    1349: 'Wind',
    1350: 'Wind',
    1351: 'Wind',
    1352: 'Water',
    1353: 'Fire',
    1354: 'Earth'
};

// Why: the two forms no spell can touch are `horror_dagganoth_ranged` (1355) and `horror_dagganoth_melee` (1356), from `npc.dat`, named for the style they are weak to like the elemental forms.
// Why: 1356 is immune only to a magic-only loadout — with a melee weapon wielded it is a fight like any other, which is thirty ticks of the cycle spent killing her instead of praying through.
export const RANGED_FORM = 1355;
export const MELEE_FORM = 1356;

/** Nothing in this loadout carries a bow, so the ranged form is always immune. */
export const IMMUNE_FORMS = new Set([RANGED_FORM, MELEE_FORM]);

export const MOTHER_IDS = [1348, 1349, 1350, 1351, 1352, 1353, 1354, 1355, 1356];

/** Best tier the account can cast, highest first. */
const TIERS: readonly { suffix: string; level: number }[] = [
    { suffix: 'blast', level: 59 },
    { suffix: 'bolt', level: 35 },
    { suffix: 'strike', level: 13 }
];

export function spellTier(magic: number): string | null {
    return TIERS.find(t => magic >= t.level)?.suffix ?? null;
}

const byIds = (ids: readonly number[]): Npc | null =>
    Npcs.query().where(n => ids.includes(n.id)).nearest();

const mother = (): Npc | null => byIds(MOTHER_IDS);
const junior = (): Npc | null => byIds([DAGANNOTH_JR]);

// Why: at stage 4 this queues the junior's attack and at stage 5 the mother.
// Why: that is what makes the fight resumable after a death, as neither respawns on its own.

/** Talk to Jossik to queue the next dagannoth. */
async function pokeJossik(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(HD_TILE.JOSSIK, { radius: 3, attempts: 4, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    const status = await Reach.entityOp({
        find: () => Npcs.query().name('Jossik').nearest(),
        op: 'Talk-to',
        expect: () => ChatDialog.isOpen() || ChatDialog.canContinue(),
        what: 'Jossik',
        log
    });
    if (status !== 'done') {
        return false;
    }
    await driveDialog([], log);
    return true;
}

// Why: the two dagannoths take different prayers because they are different fights.
// Why: `horror_dagannoth_jr4` declares no `ai_*player2` of its own, so it runs the default melee AI at `damagetype=stab_style` — Protect from Melee zeroes it and Protect from Missiles does nothing, which is why a "protected" junior fight still cost seventeen hitpoints.
// Why: the mother overrides both, meleeing in `opplayer2` and ranging in `applayer2`, and `ai_applayer2` puts her back on melee the moment missiles are protected, so missiles forces her onto the style whose max hit is single figures.
// Why: alternating the two is the better play only if the flip lands every tick, since each switch costs her the turn and in perfect lockstep she never attacks.
// Why: a bot cannot promise every tick — taking damage makes the loop eat, eating spends the tick's one action, and the prayer stops flipping when it matters, half the time on the wrong one.
// Why: holding one prayer is worse in theory and survives in practice.
const PROTECT = {
    melee: { name: 'protect from melee', level: 43 },
    missiles: { name: 'protect from missiles', level: 40 }
} as const;

type ProtectKind = keyof typeof PROTECT;

class Protection {
    readonly usable: boolean;
    private readonly prayer: string;
    arms = 0;

    constructor(private readonly kind: ProtectKind) {
        this.prayer = PROTECT[kind].name;
        this.usable = Skills.level('prayer') >= PROTECT[kind].level;
    }

    up(): boolean {
        return Prayer.active(this.prayer);
    }

    /** Cheap when already up: `Prayer.set` reads the varp and returns. */
    async hold(): Promise<void> {
        if (!this.usable || Prayer.points() <= 0 || this.up()) {
            return;
        }
        if (await Prayer.set(this.prayer, true)) {
            this.arms++;
        }
    }

    active(): string {
        return this.up() ? this.kind : 'none';
    }

    async clear(): Promise<void> {
        await Prayer.set(this.prayer, false);
    }
}

/** A spell every five ticks is the cast rate; anything faster is dropped. */
const CAST_TICKS = 5;

// Why: a tuna's worth of damage taken is enough to eat on.
// Why: waiting for a shark's worth wastes none of the heal but spends the margin first, and the margin is what a bad thirty ticks eats through.
const EAT_AT_MISSING = 12;

function hungry(): boolean {
    const max = Skills.level('hitpoints');
    return max > 0 && Skills.effective('hitpoints') <= max - EAT_AT_MISSING;
}

interface FightPlan {
    what: string;
    /** The thing to hit, or null when it has to be summoned again. */
    target: () => Npc | null;
    /** The element its current form takes damage from, or null while immune. */
    element: (npc: Npc) => string | null;
    // Why: melee is one op that keeps swinging on its own, so it is issued once per form and only re-issued when the fight drops out of combat.
    // Why: re-clicking every tick would spend the tick's one action re-targeting.

    /** True while this form should be hit with the wielded weapon instead of a spell. */
    melee?: (npc: Npc) => boolean;
    won: () => boolean;
    /** Ticks to wait after re-summoning before looking again. */
    summonDelay: number;
    /** The protection prayer that answers *this* dagannoth's attack style. */
    protect: ProtectKind;
    // Why: `spawn_dagmother` puts the mother straight into `applayer2`, so she is ranging before the junior's corpse is cold.
    // Why: dropping the junior's protection on the way out and re-arming inside the next step costs a quest-engine round trip, journal read and all, and she spends it hitting an unprotected character for up to twenty-four a time.
    // Why: that window killed a full end-to-end run from 99 hitpoints.

    /** Prayer to leave standing when this fight is won, instead of clearing. */
    handover?: ProtectKind;
    guard: number;
}

// Why: the server runs a single op per tick and silently drops the rest, so a loop that eats, prays and casts in the same breath loses two of the three — one action per tick, in the order pray, eat, cast.
// Why: with eating first, taking damage spends every tick on food, the prayer never gets re-armed, and the fight is lost while the pack is still full.
// Why: prayer is cheap, a no-op once the varp says it is up, so it goes first and costs nothing on the ticks it is already holding.

/** Run one fight to its win condition. */
async function fightLoop(plan: FightPlan, log: (m: string) => void): Promise<boolean> {
    const prayers = new Protection(plan.protect);
    if (!prayers.usable) {
        log(`prayer below ${PROTECT[plan.protect].level} — the ${plan.what} will land hits this fight`);
    }
    // Prayer first, tab second. Whatever is already attacking does not wait for
    // an interface to be built.
    await prayers.hold();
    // The spellbook root is only walkable once its tab has been built, and the
    // fight is casts: open it before the first form change, not during.
    await Game.openSideTab(MAGIC_TAB);
    Game.setAutoRetaliate(false);
    let casts = 0;
    let refused = 0;
    let lastTick = -1;
    let lastCast = -CAST_TICKS;
    let reported = -1;
    let handedOver = false;
    let swings = 0;
    let meleeing = -1;
    try {
        for (let i = 0; i < plan.guard; i++) {
            if (plan.won()) {
                log(`the ${plan.what} is dead (${casts} casts, ${swings} melee attacks, ${prayers.arms} prayer re-arms)`);
                if (plan.handover) {
                    await new Protection(plan.handover).hold();
                    handedOver = true;
                }
                return true;
            }
            const now = Game.tick();
            if (now === lastTick) {
                await Execution.delayTicks(1);
                continue;
            }
            lastTick = now;
            const target = plan.target();
            if (!target) {
                if (!(await pokeJossik(log))) {
                    return false;
                }
                await Execution.delayTicks(plan.summonDelay);
                continue;
            }
            if (now - reported >= 40) {
                reported = now;
                log(`${plan.what}: form ${target.id} hp=${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}`
                    + ` prayer=${prayers.active()} (${Prayer.points()}) casts=${casts} swings=${swings}`);
            }
            if (prayers.usable && !prayers.up() && Prayer.points() > 0) {
                await prayers.hold();
                continue;
            }
            if (hungry()) {
                await Sustain.run();
                continue;
            }
            if (plan.melee?.(target)) {
                // Already swinging at this form: the op stands, so spend the
                // tick on nothing rather than re-targeting the same npc.
                if (target.index === meleeing && Game.inCombat()) {
                    await Execution.delayTicks(1);
                    continue;
                }
                if (await target.interact('Attack')) {
                    meleeing = target.index;
                    swings++;
                } else if (++refused >= 5) {
                    log(`could not attack form ${target.id} — the weapon is not wielded`);
                    return false;
                }
                await Execution.delayTicks(1);
                continue;
            }
            meleeing = -1;
            const element = plan.element(target);
            if (element && now - lastCast >= CAST_TICKS) {
                if (await Game.castOnNpc(element, target)) {
                    lastCast = now;
                    casts++;
                    refused = 0;
                } else if (++refused >= 5) {
                    // A cast that never selects is silent: no message, no
                    // animation, a fight that stands still until it loses.
                    log(`could not select ${element} — magic level or runes short`);
                    return false;
                }
            }
            await Execution.delayTicks(1);
        }
        return plan.won();
    } finally {
        Game.setAutoRetaliate(true);
        if (!handedOver) {
            await prayers.clear();
        }
    }
}

/** Kill the junior. It only becomes attackable on the fourth tick of its spawn. */
export async function fightJunior(log: (m: string) => void): Promise<boolean> {
    const magic = Skills.level('magic');
    const tier = spellTier(magic);
    if (!tier) {
        log(`magic ${magic} cannot cast any combat spell`);
        return false;
    }
    // It takes damage from anything, so a wielded weapon is strictly better than
    // a spell: no cast delay, no runes, and the 5-tick cast rate does not cap it.
    const melee = meleeReady();
    log(melee
        ? `meleeing the junior with the ${meleeWeaponName()}`
        : `no melee weapon wielded — casting Wind ${tier} at the junior`);
    return fightLoop({
        what: 'dagannoth junior',
        target: junior,
        melee: () => melee,
        element: () => `Wind ${tier}`,
        won: () => mother() !== null,
        summonDelay: 6,
        protect: 'melee',
        // She is added during the junior's death tick and set ranging three
        // ticks later, so the swap has to happen here, not in the next step.
        handover: 'missiles',
        guard: 3000
    }, log);
}

// Why: two of her six forms take no damage from anything a magic loadout carries, so the loop prays through those thirty ticks.
// Why: the four elemental windows clear 120 hitpoints in a cycle and a half.

/** Kill the Dagannoth mother. */
export async function fightMother(log: (m: string) => void): Promise<boolean> {
    const magic = Skills.level('magic');
    const tier = spellTier(magic);
    if (!tier) {
        log(`magic ${magic} cannot cast any combat spell`);
        return false;
    }
    const melee = meleeReady();
    log(melee
        ? `meleeing form ${MELEE_FORM} with the ${meleeWeaponName()}; form ${RANGED_FORM} still has to be prayed through`
        : `no melee weapon wielded — forms ${MELEE_FORM} and ${RANGED_FORM} will be prayed through`);
    return fightLoop({
        what: 'Dagannoth mother',
        target: mother,
        melee: npc => melee && npc.id === MELEE_FORM,
        element: npc => {
            const form = FORM_ELEMENT[npc.id];
            if (!form && !IMMUNE_FORMS.has(npc.id)) {
                log(`unexpected dagannoth form ${npc.id}`);
            }
            return form ? `${form} ${tier}` : null;
        },
        // Why: the casket lands in the pack and the completion teleport moves the character out of the cavern, so either one proves the win.
        // Why: a full pack means only the teleport arrives.
        won: () => Inventory.countById(HD_ID.CASKET) > 0 || (Game.tile()?.z ?? 0) >= 9984,
        summonDelay: 8,
        protect: 'missiles',
        guard: 6000
    }, log);
}
