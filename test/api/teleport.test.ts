import { afterEach, describe, expect, test } from 'bun:test';

import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Game } from '#/bot/api/Game.js';
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
    openSideTab: Game.openSideTab
};

afterEach(() => {
    actions.ifButton = originals.ifButton;
    reader.buttonByText = originals.buttonByText;
    reader.sideTabInterface = originals.sideTabInterface;
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
    test('opens magic and dispatches the live named component', async () => {
        let openedTab = -1;
        let clickedComId = -1;
        reader.sideTabInterface = () => 1151;
        reader.buttonByText = (root, label) => {
            expect(root).toBe(1151);
            expect(label).toBe('Cast @gre@Camelot teleport');
            return 8123;
        };
        Game.openSideTab = async tab => {
            openedTab = tab;
            return true;
        };
        actions.ifButton = comId => {
            clickedComId = comId;
            return true;
        };

        expect(await Game.teleport('Camelot')).toBe(true);
        expect(openedTab).toBe(6);
        expect(clickedComId).toBe(8123);
    });

    test('dispatches the static fallback when the live button name is missing', async () => {
        reader.sideTabInterface = () => 1151;
        reader.buttonByText = () => -1;
        Game.openSideTab = async () => true;
        let clickedComId = -1;
        actions.ifButton = comId => {
            clickedComId = comId;
            return true;
        };

        expect(await Game.teleport('Varrock teleport')).toBe(true);
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
