import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../Execution.js';

/** specwep.rs2: %sa_energy, 0–1000, +100 every 50 ticks. */
export const SA_ENERGY_VARP = 300;
/** %sa_attack — set by the spec bar, cleared by set_sa_vars once the hit lands. */
export const SA_ARMED_VARP = 301;
export const SA_MAX_ENERGY = 1000;

const ARM_CONFIRM_TICKS = 2;

/**
 * Combat-tab root → its spec bar component.
 *
 * The wielded weapon decides which combat interface the tab shows, and the spec
 * bars sit in their own block (7462, 7487, … spacing 25) with no fixed offset
 * from the interface root — so the bar has to be looked up, not computed.
 */
const SPECBAR_BY_ROOT = new Map<number, number>([
    [425, 7462], // combat_blunt
    [1698, 7487], // combat_axe
    [1749, 7512], // combat_crossbow
    [1764, 7537], // combat_bow
    [2276, 7562], // combat_stabsword
    [2423, 7587], // combat_hacksword
    [3796, 7612], // combat_spiked
    [4446, 7637], // combat_thrown
    [4679, 7662], // combat_spear
    [4705, 7687], // combat_heavysword
    [5570, 7712], // combat_pickaxe
    [5855, 7737], // combat_unarmed
    [7762, 7788], // combat_claw
    [8460, 8481] // combat_polearm
]);

/**
 * `param=sa_energy` per weapon carrying `param=specwep`. Dragon battleaxe and
 * Excalibur declare specwep with no cost — their specials are self-buffs with
 * no scripted attack here, so they are deliberately absent.
 */
const SPEC_COST = new Map<string, number>([
    ['dragon dagger', 250],
    ['dragon dagger(p)', 250],
    ['dragon longsword', 250],
    ['dragon mace', 250],
    ['dragon spear', 250],
    ['dragon spear(p)', 250],
    ['dragon spear(kp)', 250],
    ['dragon halberd', 300],
    ['rune claws', 250],
    ['rune thrownaxe', 100],
    ['magic shortbow', 350],
    ['magic longbow', 350]
]);

/**
 * Weapon special attacks.
 *
 * Arming is one-shot, not a mode: the spec bar flips `%sa_attack`, the next
 * attack spends it, and `set_sa_vars` clears the flag again — so this has to be
 * re-armed per special rather than set once.
 *
 * `~sa_enabled` also requires a members world (`map_members`), which is a
 * world-level flag, not a per-area one.
 */
export const Special = {
    /** 0–1000. */
    energy(): number {
        return reader.varp(SA_ENERGY_VARP);
    },

    /** Armed and waiting to be spent on the next attack. */
    armed(): boolean {
        return reader.varp(SA_ARMED_VARP) === 1;
    },

    /** Energy this weapon's special costs, or null if it has none. */
    cost(weaponName: string): number | null {
        return SPEC_COST.get(weaponName.trim().toLowerCase()) ?? null;
    },

    /** Whether this weapon could special right now on energy alone. */
    ready(weaponName: string): boolean {
        const cost = Special.cost(weaponName);
        return cost !== null && Special.energy() >= cost;
    },

    /** The spec bar for whatever is wielded, or -1 when the tab is unreadable. */
    barComponent(): number {
        const root = reader.sideTabInterface(0);
        return root === -1 ? -1 : (SPECBAR_BY_ROOT.get(root) ?? -1);
    },

    /** Arm the next attack. Idempotent: a already-armed special is left alone. */
    async arm(): Promise<boolean> {
        if (Special.armed()) {
            return true;
        }
        const bar = Special.barComponent();
        if (bar === -1) {
            return false;
        }
        if (!actions.ifButton(bar)) {
            return false;
        }
        return Execution.delayUntilTicks(() => Special.armed(), ARM_CONFIRM_TICKS);
    }
};
