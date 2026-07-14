/**
 * Autocast driver — arms a staff's autocast spell via the combat tab.
 *
 * Engine flow (skill_combat/player/auto_cast.rs2, all content-verified):
 * wielding a staff attaches the `combat_staff_2` tab (root com 328). Clicking
 * `auto_choose` (353) swaps the tab to the `staff_spells` panel (root 1829)
 * and RESETS attackstyle_magic to 0; clicking a spell button (1830+ssb) sets
 * the perm-but-untransmitted `autocast_spell` varp and attackstyle_magic=2;
 * clicking `auto_toggle` (349) flips bit 0 → 3 = armed. attackstyle_magic
 * (varp 108, transmit=yes) is the readable armed signal, but it does NOT
 * carry the spell identity — so `arm` always replays the full sequence
 * (idempotent: the choose step zeroes whatever state came before) rather
 * than trusting a leftover armed state from an earlier session.
 */
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/Execution.js';
import { Game } from '#/bot/api/Game.js';
import { ATTACKSTYLE_MAGIC_VARP, AUTOCAST_ARMED, AUTO_CHOOSE_COM, AUTO_TOGGLE_COM, spellButtonCom } from '#/bot/api/combat/CombatStyleLogic.js';

const COMBAT_TAB = 0;
const STAFF_TAB_ROOT = 328; // combat_staff_2
const SPELL_PANEL_ROOT = 1829; // staff_spells
const STEP_MS = 3000;

export const Autocast = {
    /** attackstyle_magic says a spell is chosen AND the autocast style is on. */
    armed(): boolean {
        return reader.varp(ATTACKSTYLE_MAGIC_VARP) === AUTOCAST_ARMED;
    },

    /** The combat tab shows the staff layout (i.e. a staff is wielded). */
    staffTabAttached(): boolean {
        return reader.sideTabInterface(COMBAT_TAB) === STAFF_TAB_ROOT;
    },

    /**
     * Replay choose→select→toggle for `spellName` and verify varp 108 lands
     * on 3. Requires a staff wielded; re-run once per session (the style varp
     * resets on login even though the chosen spell persists server-side).
     */
    async arm(spellName: string, log: (m: string) => void): Promise<boolean> {
        const ssbCom = spellButtonCom(spellName);
        if (ssbCom === -1) {
            log(`'${spellName}' is not an autocastable spell — see SPELL_DB (Wind Strike … Fire Wave)`);
            return false;
        }
        if (!this.staffTabAttached()) {
            log('combat tab is not the staff layout — is a staff wielded?');
            return false;
        }
        if (!(await Game.openSideTab(COMBAT_TAB))) {
            log('could not open the combat tab');
            return false;
        }

        actions.ifButton(AUTO_CHOOSE_COM);
        if (!(await Execution.delayUntil(() => reader.sideTabInterface(COMBAT_TAB) === SPELL_PANEL_ROOT, STEP_MS))) {
            log('spell chooser did not open');
            return false;
        }

        actions.ifButton(ssbCom);
        // set_autocast_spell closes the chooser (initalltabs → staff tab back)
        // and sets attackstyle_magic=2; a level-gated spell silently keeps 0
        if (!(await Execution.delayUntil(() => reader.varp(ATTACKSTYLE_MAGIC_VARP) === 2, STEP_MS))) {
            log(`choosing '${spellName}' did not take — magic level too low?`);
            return false;
        }

        actions.ifButton(AUTO_TOGGLE_COM);
        if (!(await Execution.delayUntil(() => this.armed(), STEP_MS))) {
            log('autocast toggle did not arm');
            return false;
        }
        log(`autocast armed: ${spellName}`);
        return true;
    }
};
