import { actions, reader, type WorldTile } from '../adapter/ClientAdapter.js';
import { BotHost } from '../BotHost.js';
import { ActionRouter } from '../input/ActionRouter.js';
import { Execution } from './Execution.js';
import type { Npc } from './entities/index.js';

// com_mode varp: 0 accurate (Attack xp), 1 aggressive (Strength),
// 2 defensive (Defence), 3 controlled — melee semantics; ranged/magic tabs
// map the same slots to their own styles (e.g. bow: accurate/rapid/longrange).
const COM_MODE_VARP = 43;

// option_run varp (content/scripts/interface_controls/configs/player_controls.varp):
// `transmit=yes` (unlike TUTORIAL_VARP), so this DOES mirror correctly
// client-side. 0 = ^player_run_off, 1 = ^player_run_on (player_controls.constant).
const RUN_VARP = 173;

/** Minimal world/self facade for scripts. Grows over Slices 3-4. */
export const Game = {
    ingame(): boolean {
        return reader.ingame();
    },

    /** The local player's world tile, or null before login/scene load. */
    tile(): WorldTile | null {
        return reader.worldTile();
    },

    energy(): number {
        return reader.energy();
    },

    /** Run toggle on/off (option_run varp — see RUN_VARP for why this is trustworthy, unlike the tutorial varp). */
    runEnabled(): boolean {
        return reader.varp(RUN_VARP) === 1;
    },

    weight(): number {
        return reader.weight();
    },

    /** Local player in combat (health bar showing). */
    inCombat(): boolean {
        return reader.inCombat();
    },

    /** Local player is playing a primary animation (mining/chopping/fishing/…). */
    animating(): boolean {
        return reader.selfAnim() !== -1;
    },

    /** Server ticks observed since the client booted (~600ms each). */
    tick(): number {
        return BotHost.tickCount;
    },

    /** Attack style (com_mode: 0=accurate/Attack, 1=aggressive/Strength, 2=defensive/Defence, 3=controlled). Not saved — resets each login. */
    combatMode(): number {
        return reader.varp(COM_MODE_VARP);
    },

    /**
     * Select a combat style by com_mode (1 = aggressive → Strength xp when
     * meleeing) via the style button of whatever combat tab is attached. The
     * button ids are pack-assigned PER WEAPON interface (combat_unarmed/_bow/
     * _stabsword/…) and the server drops clicks on a tab that isn't open —
     * post-tutorial bots wield a weapon, so the ids must be resolved from the
     * live tab, not hardcoded. com_mode isn't persisted, so re-assert it once
     * per session. Returns false if the combat tab isn't attached yet or this
     * weapon has no such style (e.g. mode 3 on a 3-style weapon).
     */
    setCombatStyle(mode: number): boolean {
        const root = reader.sideTabInterface(0);
        if (root === -1) {
            return false;
        }

        const btn = reader.selectButtonByVarp(root, COM_MODE_VARP, mode);
        return btn !== -1 && actions.ifButton(btn);
    },

    /** The local player's display name, or null before login. */
    myName(): string | null {
        return reader.localPlayerName();
    },

    /**
     * Click a sidebar tab icon (0-13 — see the tutorial varp ladder's confirmed
     * tab-index table, e.g. 3 = inventory, 1 = stats). Used for the
     * tutorial's flashing-tab steps. Idempotent: resolves true immediately if
     * already on `tab`; false if that tab has no interface loaded yet, or if
     * the switch doesn't stick within 2s.
     */
    async openSideTab(tab: number): Promise<boolean> {
        if (reader.activeSideTab() === tab) {
            return true;
        }

        if (!actions.clickSideTab(tab)) {
            return false;
        }

        return Execution.delayUntil(() => reader.activeSideTab() === tab, 2000);
    },

    /**
     * Cast a magic-tab spell on an npc by the spell's `targetBase` caption
     * (e.g. 'Wind Strike') — the first spell-cast primitive. Opens
     * the magic tab, finds the spell's BUTTON_TARGET component at runtime
     * (ids are pack-assigned), then dispatches the armed cast; the client
     * walks toward the target and sends OPNPCT itself. False if the magic
     * tab isn't attached yet or the caption doesn't resolve.
     */
    async castOnNpc(spell: string, npc: Npc): Promise<boolean> {
        const MAGIC_TAB = 6;
        const root = reader.sideTabInterface(MAGIC_TAB);
        if (root === -1 || !(await Game.openSideTab(MAGIC_TAB))) {
            return false;
        }

        const comId = reader.targetButtonByBase(root, spell);
        if (comId === -1) {
            return false;
        }

        return ActionRouter.driver.castOnNpc(comId, npc.index);
    }
};

export type { WorldTile };
