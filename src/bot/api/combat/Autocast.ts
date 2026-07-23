import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/Execution.js';
import { Game } from '#/bot/api/Game.js';
import { ATTACKSTYLE_MAGIC_VARP, AUTOCAST_ARMED, AUTO_CHOOSE_COM, AUTO_TOGGLE_COM, spellButtonCom } from '#/bot/api/combat/CombatStyleLogic.js';

const COMBAT_TAB = 0;
const STAFF_TAB_ROOT = 328;
const SPELL_PANEL_ROOT = 1829;
const STEP_MS = 3000;

export const Autocast = {
    armed(): boolean {
        return reader.varp(ATTACKSTYLE_MAGIC_VARP) === AUTOCAST_ARMED;
    },

    staffTabAttached(): boolean {
        return reader.sideTabInterface(COMBAT_TAB) === STAFF_TAB_ROOT;
    },

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
