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

/** The attackable junior. jr1..jr3 are the 3 ticks of its spawn animation. */
const DAGANNOTH_JR = 1347;

// Why: `npc_max_dealt` zeroes every hit the current form isn't weak to, so the form's npc id from `npc_changetype` picks the spell.

// The mother's 6 forms.
export const FORM_ELEMENT: Record<number, 'Wind' | 'Water' | 'Earth' | 'Fire'> = {
    1348: 'Wind',
    1349: 'Wind',
    1350: 'Wind',
    1351: 'Wind',
    1352: 'Water',
    1353: 'Fire',
    1354: 'Earth'
};

// Why: no spell touches `horror_dagganoth_ranged` (1355) or `horror_dagganoth_melee` (1356), named in `npc.dat` for the style they're weak to; a wielded melee weapon turns 1356's 30 ticks into a fight.
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

// Why: at stage 4 this queues the junior and at stage 5 the mother; neither respawns on its own, so it's how a death resumes.

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

// Why: `horror_dagannoth_jr4` has no `ai_*player2`, so it runs the default melee AI at `damagetype=stab_style`; Protect from Melee zeroes it and Protect from Missiles does nothing.
// Why: the mother melees in `opplayer2` and ranges in `applayer2`, and `ai_applayer2` puts her back on melee once missiles are protected, so missiles forces her onto the single-figure style.
// Why: alternating prayers only wins if the flip lands every tick, and eating spends the tick's one action, so hold one prayer.
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

/** One spell per 5 ticks; anything faster is dropped. */
const CAST_TICKS = 5;

// Why: eat at a tuna's worth of damage; waiting for a shark's worth spends the margin a bad 30 ticks eats through.
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
    // Why: melee keeps swinging on its own, so it's issued once per form and re-issued only when combat drops; re-clicking spends the tick's one action.

    /** True while this form should be hit with the wielded weapon instead of a spell. */
    melee?: (npc: Npc) => boolean;
    won: () => boolean;
    /** Ticks to wait after re-summoning before looking again. */
    summonDelay: number;
/** Protection prayer matching this dagannoth's attack style. */
    protect: ProtectKind;
    // Why: `spawn_dagmother` puts the mother straight into `applayer2`, and re-arming in the next step costs a quest-engine round trip she spends ranging for up to 24 a hit.

    /** Prayer to leave standing when this fight is won. */
    handover?: ProtectKind;
    guard: number;
}

// Why: the server runs one op per tick and drops the rest, so it's one action per tick in the order pray, eat, cast.
// Why: eating first spends every damaged tick on food and the prayer never re-arms; prayer is a no-op once the varp says it's up, so it goes first.

/** Run one fight to its win condition. */
async function fightLoop(plan: FightPlan, log: (m: string) => void): Promise<boolean> {
    const prayers = new Protection(plan.protect);
    if (!prayers.usable) {
        log(`prayer below ${PROTECT[plan.protect].level} — the ${plan.what} will land hits this fight`);
    }
    // Prayer first, tab second. Whatever is already attacking doesn't wait for an interface.
    await prayers.hold();
    // The spellbook root is only walkable once its tab is built, so open it before the first form change.
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
                // Already swinging at this form: the op stands, so don't re-target.
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
                    // A cast that never selects is silent: no message, no animation.
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

/** Kill the junior. It only becomes attackable on the 4th tick of its spawn. */
export async function fightJunior(log: (m: string) => void): Promise<boolean> {
    const magic = Skills.level('magic');
    const tier = spellTier(magic);
    if (!tier) {
        log(`magic ${magic} cannot cast any combat spell`);
        return false;
    }
    // It takes damage from anything, so a wielded weapon beats a spell: no cast delay, no runes, no 5-tick cap.
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
        // She is added on the junior's death tick and set ranging 3 ticks later, so the swap happens here.
        handover: 'missiles',
        guard: 3000
    }, log);
}

// Why: 2 of her 6 forms take no damage from a magic loadout, so the loop prays through those 30 ticks; the 4 elemental windows clear 120 hp in a cycle and a half.

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
        // Why: the casket lands in the pack and the completion teleport leaves the cavern, so either proves the win; a full pack only gets the teleport.
        won: () => Inventory.countById(HD_ID.CASKET) > 0 || (Game.tile()?.z ?? 0) >= 9984,
        summonDelay: 8,
        protect: 'missiles',
        guard: 6000
    }, log);
}
