import { afterEach, describe, expect, test } from 'bun:test';

import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Game } from '#/bot/api/Game.js';
import type { Npc } from '#/bot/api/entities/index.js';
import { ActionRouter } from '#/bot/input/ActionRouter.js';
import {
    resolveTeleport,
    resolveTeleportComponent,
    teleportButtonText
} from '#/bot/api/Teleport.js';

const FALLBACKS: Record<string, number> = {
    Varrock: 1164,
    Lumbridge: 1167,
    Falador: 1170,
    Camelot: 1174,
    Ardougne: 1540,
    Watchtower: 1541,
    Trollheim: 7455
};

const originals = {
    ifButton: actions.ifButton,
    buttonByText: reader.buttonByText,
    sideTabInterface: reader.sideTabInterface,
    targetButtonByBase: reader.targetButtonByBase,
    castOnNpc: ActionRouter.driver.castOnNpc,
    openSideTab: Game.openSideTab
};

afterEach(() => {
    actions.ifButton = originals.ifButton;
    reader.buttonByText = originals.buttonByText;
    reader.sideTabInterface = originals.sideTabInterface;
    reader.targetButtonByBase = originals.targetButtonByBase;
    ActionRouter.driver.castOnNpc = originals.castOnNpc;
    Game.openSideTab = originals.openSideTab;
});

describe('resolveTeleport', () => {
    test('accepts destination names case-insensitively with optional cast/teleport text', () => {
        expect(resolveTeleport('varrock')?.name).toBe('Varrock');
        expect(resolveTeleport('  VARROCK teleport ')?.name).toBe('Varrock');
        expect(resolveTeleport('Cast @gre@Varrock teleport')?.name).toBe('Varrock');
    });

    test('contains the fallback component for every standard teleport', () => {
        for (const [name, comId] of Object.entries(FALLBACKS)) {
            expect(resolveTeleport(name)?.fallbackComId).toBe(comId);
        }
    });

    test('fails closed for an unknown teleport', () => {
        expect(resolveTeleport('Edgeville')).toBeNull();
        expect(resolveTeleport('')).toBeNull();
    });
});

describe('resolveTeleportComponent', () => {
    const varrock = resolveTeleport('Varrock')!;

    test('looks up the exact magic button label', () => {
        expect(teleportButtonText(varrock)).toBe('Cast @gre@Varrock teleport');
    });

    test('prefers the component found in the live interface', () => {
        let label = '';
        const comId = resolveTeleportComponent(varrock, value => {
            label = value;
            return 9001;
        });
        expect(label).toBe('Cast @gre@Varrock teleport');
        expect(comId).toBe(9001);
    });

    test('uses the static component only when live lookup misses', () => {
        expect(resolveTeleportComponent(varrock, () => -1)).toBe(1164);
    });
});

describe('Game.teleport', () => {
    test('dispatches the live named component without activating the magic tab', async () => {
        let openedTab = false;
        let clickedComId = -1;
        reader.sideTabInterface = () => 1151;
        reader.buttonByText = (root, label) => {
            expect(root).toBe(1151);
            expect(label).toBe('Cast @gre@Camelot teleport');
            return 8123;
        };
        Game.openSideTab = async () => {
            openedTab = true;
            return false;
        };
        actions.ifButton = comId => {
            clickedComId = comId;
            return true;
        };

        expect(await Game.teleport('Camelot')).toBe(true);
        expect(openedTab).toBe(false);
        expect(clickedComId).toBe(8123);
    });

    test('dispatches the static fallback when the live button name is missing', async () => {
        reader.sideTabInterface = () => 1151;
        reader.buttonByText = () => -1;
        Game.openSideTab = async () => false;
        let clickedComId = -1;
        actions.ifButton = comId => {
            clickedComId = comId;
            return true;
        };

        expect(await Game.teleport('Varrock teleport')).toBe(true);
        expect(clickedComId).toBe(1164);
    });

    test('dispatches the static fallback when the magic root is unavailable', async () => {
        reader.sideTabInterface = () => -1;
        reader.buttonByText = root => {
            expect(root).toBe(-1);
            return -1;
        };
        let clickedComId = -1;
        actions.ifButton = comId => {
            clickedComId = comId;
            return true;
        };

        expect(await Game.teleport('Varrock')).toBe(true);
        expect(clickedComId).toBe(1164);
    });

    test('does not open the interface or click for an unknown destination', async () => {
        let opened = false;
        let clicked = false;
        Game.openSideTab = async () => {
            opened = true;
            return true;
        };
        actions.ifButton = () => {
            clicked = true;
            return true;
        };

        expect(await Game.teleport('Edgeville')).toBe(false);
        expect(opened).toBe(false);
        expect(clicked).toBe(false);
    });
});

describe('Game.castOnNpc', () => {
    test('casts from the loaded magic root without activating the magic tab', async () => {
        let openedTab = false;
        let cast: { comId: number; npcIndex: number } | null = null;
        reader.sideTabInterface = tab => {
            expect(tab).toBe(6);
            return 1151;
        };
        reader.targetButtonByBase = (root, spell) => {
            expect(root).toBe(1151);
            expect(spell).toBe('Wind Strike');
            return 8123;
        };
        Game.openSideTab = async () => {
            openedTab = true;
            return false;
        };
        ActionRouter.driver.castOnNpc = (comId, npcIndex) => {
            cast = { comId, npcIndex };
            return true;
        };

        expect(await Game.castOnNpc('Wind Strike', { index: 42 } as Npc)).toBe(true);
        expect(openedTab).toBe(false);
        expect(cast!).toEqual({ comId: 8123, npcIndex: 42 });
    });

    test('fails naturally when the spell component cannot be resolved', async () => {
        reader.sideTabInterface = () => -1;
        reader.targetButtonByBase = root => {
            expect(root).toBe(-1);
            return -1;
        };
        let cast = false;
        ActionRouter.driver.castOnNpc = () => {
            cast = true;
            return true;
        };

        expect(await Game.castOnNpc('Wind Strike', { index: 42 } as Npc)).toBe(false);
        expect(cast).toBe(false);
    });
});
