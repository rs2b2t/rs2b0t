import { actions, reader, type WorldTile } from '../../adapter/ClientAdapter.js';
import { BotHost } from '../../runtime/BotHost.js';
import { Input } from '../../input/Input.js';
import { Execution } from '../execution/Execution.js';
import { CombatStyleController, type CombatModeLabel, type CombatStyleResolution, type MeleeCombatStyle } from '../combat/CombatStyle.js';
import { resolveTeleport, resolveTeleportComponent } from '../map/Teleport.js';
import type { Npc } from '../model/Npc.js';

const COM_MODE_VARP = 43;
const RUN_VARP = 173;
const MAGIC_TAB = 6;

/** option_nodef. Inverted: 0 = auto-retaliate on. */
export const RETALIATE_VARP = 172;

export function retaliateOnFromVarp(value: number): boolean {
    return value === 0;
}

/** The engine encodes a player face target as slot + 32768. */
export const PLAYER_FACE_BASE = 32768;

export function facingPlayer(faceEntity: number): boolean {
    return faceEntity >= PLAYER_FACE_BASE;
}

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
 * @see docs/reference/api-game.md
 */
export const Game = {
    ingame(): boolean {
        return reader.ingame();
    },

    /**
     * True when the client is logged in and the local scene is fully built (`sceneState === 2`) with a known world tile.
     * Why: injecting menu or walk packets before this returns true soft-fails or thrash-retries (#445).
     */
    sceneReady(): boolean {
        return reader.ingame() && reader.sceneState() === 2 && reader.worldTile() !== null;
    },

    /** Raw client scene build state: 0 idle/loading, 1 building, 2 ready. */
    sceneState(): number {
        return reader.sceneState();
    },

    tile(): WorldTile | null {
        return reader.worldTile();
    },

    energy(): number {
        return reader.energy();
    },

    /** Orbit camera yaw 0–2047 (client-only). */
    cameraYaw(): number {
        return reader.cameraYaw();
    },

    /** Orbit camera pitch 128–383 (client-only). */
    cameraPitch(): number {
        return reader.cameraPitch();
    },

    /**
     * Snap orbit camera yaw (0–2047). Client-only; no LC/engine change.
     * Prefer Global.navCameraFollow for path auto-facing during walks.
     */
    setCameraYaw(yaw: number): boolean {
        return actions.setCameraYaw(yaw);
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

    autoRetaliateOn(): boolean {
        return retaliateOnFromVarp(reader.varp(RETALIATE_VARP));
    },

    // Our target is a player only if we attacked one or auto-retaliate did; the
    // grind never attacks players.
    attackedByPlayer(): boolean {
        return facingPlayer(reader.selfFaceEntity());
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

    /**
     * The combat-tab style buttons this weapon offers, in on-screen order (top-to-bottom, left-to-right); null until the combat tab has loaded.
     * Why: index into this to pick a style without guessing what the weapon calls it.
     */
    combatStyles(): readonly CombatModeLabel[] | null {
        return offeredCombatModes();
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
        const root = reader.sideTabInterface(MAGIC_TAB);
        const comId = reader.targetButtonByBase(root, spell);
        if (comId === -1) {
            return false;
        }

        return Input.castOnNpc(comId, npc.index);
    },

    /**
     * Cast a standard spellbook teleport by destination name.
     * Why: the magic root is used for live name lookup without activating its side tab, falling back to the 2004 component ID; success confirms dispatch rather than arrival.
     */
    async teleport(name: string): Promise<boolean> {
        const teleport = resolveTeleport(name);
        if (teleport === null) {
            return false;
        }

        const root = reader.sideTabInterface(MAGIC_TAB);
        const comId = resolveTeleportComponent(teleport, label => reader.buttonByText(root, label));
        return actions.ifButton(comId);
    }
};

export type { WorldTile };
