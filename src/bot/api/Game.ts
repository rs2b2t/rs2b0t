import { actions, reader, type WorldTile } from '../adapter/ClientAdapter.js';
import { BotHost } from '../BotHost.js';
import { ActionRouter } from '../input/ActionRouter.js';
import { Execution } from './Execution.js';
import { CombatStyleController, type CombatStyleResolution, type MeleeCombatStyle } from './CombatStyle.js';
import type { Npc } from './entities/index.js';

const COM_MODE_VARP = 43;

const RUN_VARP = 173;

function offeredCombatModes() {
    const root = reader.sideTabInterface(0);
    return root === -1 ? null : reader.selectButtonLabelsByVarp(root, COM_MODE_VARP);
}

function selectCombatMode(mode: number): boolean {
    const root = reader.sideTabInterface(0);
    if (root === -1) {
        return false;
    }
    const btn = reader.selectButtonByVarp(root, COM_MODE_VARP, mode);
    return btn !== -1 && actions.ifButton(btn);
}

const meleeCombatStyles = new CombatStyleController({
    offeredModes: offeredCombatModes,
    currentMode: () => reader.varp(COM_MODE_VARP),
    selectMode: selectCombatMode
});

/**
 * Local player and world state.
 * @see docs/API.md#game
 */
export const Game = {
    ingame(): boolean {
        return reader.ingame();
    },

    tile(): WorldTile | null {
        return reader.worldTile();
    },

    energy(): number {
        return reader.energy();
    },

    runEnabled(): boolean {
        return reader.varp(RUN_VARP) === 1;
    },

    weight(): number {
        return reader.weight();
    },

    inCombat(): boolean {
        return reader.inCombat();
    },

    animating(): boolean {
        return reader.selfAnim() !== -1;
    },

    tick(): number {
        return BotHost.tickCount;
    },

    combatMode(): number {
        return reader.varp(COM_MODE_VARP);
    },

    combatStyleResolution(style: MeleeCombatStyle): CombatStyleResolution | null {
        return meleeCombatStyles.resolution(style);
    },

    combatStyleMode(style: MeleeCombatStyle): number | null {
        return meleeCombatStyles.mode(style);
    },

    hasCombatStyle(style: MeleeCombatStyle): boolean {
        return meleeCombatStyles.has(style);
    },

    setCombatStyle(style: MeleeCombatStyle | number): boolean {
        if (typeof style === 'number') {
            return Game.setCombatMode(style);
        }
        return meleeCombatStyles.set(style);
    },

    /** Set an exact combat-tab varp mode (used by ranged styles). */
    setCombatMode(mode: number): boolean {
        return selectCombatMode(mode);
    },

    /**
     * Toggle Auto Retaliate. Gathering / agility scripts turn this off so
     * multi-combat pests (wildy spiders, skeletons) don't pin the bot in a fight.
     */
    setAutoRetaliate(on: boolean): boolean {
        return actions.setRetaliate(on);
    },

    myName(): string | null {
        return reader.localPlayerName();
    },

    async openSideTab(tab: number): Promise<boolean> {
        if (reader.activeSideTab() === tab) {
            return true;
        }

        if (!actions.clickSideTab(tab)) {
            return false;
        }

        return Execution.delayUntil(() => reader.activeSideTab() === tab, 2000);
    },

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
