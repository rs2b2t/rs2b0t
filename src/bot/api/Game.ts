import { actions, reader, type WorldTile } from '../adapter/ClientAdapter.js';
import { BotHost } from '../BotHost.js';
import { ActionRouter } from '../input/ActionRouter.js';
import { Execution } from './Execution.js';
import type { Npc } from './entities/index.js';

const COM_MODE_VARP = 43;

const RUN_VARP = 173;

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

    setCombatStyle(mode: number): boolean {
        const root = reader.sideTabInterface(0);
        if (root === -1) {
            return false;
        }

        const btn = reader.selectButtonByVarp(root, COM_MODE_VARP, mode);
        return btn !== -1 && actions.ifButton(btn);
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
