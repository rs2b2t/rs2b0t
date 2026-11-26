import { afterEach, describe, expect, test } from 'bun:test';

import { readRetaliateControls } from '#/bot/adapter/ClientAdapter.js';
import IfType, { ButtonType, ComponentType } from '#/client/config/IfType.js';

import { component, installComponents } from '../fixtures/if-type.js';

const originalInterfaces = IfType.list;

afterEach(() => {
    IfType.list = originalInterfaces;
});

/** Mirrors `controls`: com_2 = retaliate on, com_3 = off, com_4/5 = run off/on. */
function installControls(baseId: number, withMarker: boolean): { on: number; off: number } {
    const root = component(baseId, ComponentType.TYPE_LAYER);
    const kids = Array.from({ length: 8 }, (_, i) => component(baseId + 1 + i, ComponentType.TYPE_GRAPHIC));
    if (withMarker) {
        kids[0].type = ComponentType.TYPE_TEXT;
        kids[0].text = 'Auto retaliate';
    }
    kids[2].buttonType = ButtonType.BUTTON_SELECT;
    kids[3].buttonType = ButtonType.BUTTON_SELECT;
    root.children = kids.map(k => k.id);

    installComponents([root, ...kids]);
    return { on: kids[2].id, off: kids[3].id };
}

describe('readRetaliateControls', () => {
    test('resolves com_2 as ON and com_3 as OFF', () => {
        const { on, off } = installControls(500, true);
        expect(readRetaliateControls()).toEqual({ onComId: on, offComId: off });
    });

    test('ignores an interface with no Auto retaliate marker', () => {
        installControls(700, false);
        expect(readRetaliateControls()).toBeNull();
    });
});
