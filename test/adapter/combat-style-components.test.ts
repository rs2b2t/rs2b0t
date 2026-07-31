import { afterEach, describe, expect, test } from 'bun:test';

import { readSelectButtonLabelsByVarp } from '#/bot/adapter/ClientAdapter.js';
import IfType, { ButtonType, ComponentType } from '#/config/IfType.js';

const COM_MODE_VARP = 43;
const originalInterfaces = IfType.list;

afterEach(() => {
    IfType.list = originalInterfaces;
});

interface LayoutEntry {
    mode: number;
    buttonY: number;
    label: string;
    labelY: number;
}

function installLayout(entries: LayoutEntry[]): number {
    const root = component(100, ComponentType.TYPE_LAYER);
    const panel = component(101, ComponentType.TYPE_LAYER);
    root.children = [panel.id];
    root.childX = [4];
    root.childY = [60];

    // Match the source .if files: button and label declarations are not in
    // visual or com_mode order, so pairing must come from rendered metadata.
    const children = entries.flatMap((entry, index) => {
        const button = component(200 + index, ComponentType.TYPE_GRAPHIC);
        button.buttonType = ButtonType.BUTTON_SELECT;
        button.width = 72;
        button.height = 36;
        button.scripts = [new Uint16Array([5, COM_MODE_VARP])];
        button.scriptOperand = new Uint16Array([entry.mode]);

        const label = component(300 + index, ComponentType.TYPE_TEXT);
        label.width = 64;
        label.height = 11;
        label.text = entry.label;
        return [
            { com: label, x: 78, y: entry.labelY },
            { com: button, x: 5, y: entry.buttonY }
        ];
    });

    // Deliberately reverse storage order. The component tree's x/y metadata,
    // not declaration order, defines which style belongs to each button.
    children.reverse();
    panel.children = children.map(child => child.com.id);
    panel.childX = children.map(child => child.x);
    panel.childY = children.map(child => child.y);

    IfType.list = [];
    IfType.list[root.id] = root;
    IfType.list[panel.id] = panel;
    for (const child of children) {
        IfType.list[child.com.id] = child.com;
    }
    return root.id;
}

function component(id: number, type: ComponentType): IfType {
    const result = new IfType();
    result.id = id;
    result.type = type;
    return result;
}

describe('combat interface metadata', () => {
    test('axe duplicate-aggressive labels are paired to modes despite source declaration order', () => {
        const root = installLayout([
            { mode: 0, buttonY: 2, label: '(Accurate)', labelY: 15 },
            { mode: 3, buttonY: 129, label: '(Defensive)', labelY: 143 },
            { mode: 2, buttonY: 86, label: '(Aggressive)', labelY: 100 },
            { mode: 1, buttonY: 44, label: '(Aggressive)', labelY: 57 }
        ]);
        expect(readSelectButtonLabelsByVarp(root, COM_MODE_VARP)).toEqual([
            { mode: 0, label: '(Accurate)' },
            { mode: 1, label: '(Aggressive)' },
            { mode: 2, label: '(Aggressive)' },
            { mode: 3, label: '(Defensive)' }
        ]);
    });

    test('polearm and spear preserve their nonstandard controlled semantics', () => {
        const polearm = installLayout([
            { mode: 0, buttonY: 1, label: '(Controlled)', labelY: 14 },
            { mode: 2, buttonY: 85, label: '(Defensive)', labelY: 97 },
            { mode: 1, buttonY: 42, label: '(Aggressive)', labelY: 54 }
        ]);
        expect(readSelectButtonLabelsByVarp(polearm, COM_MODE_VARP)).toEqual([
            { mode: 0, label: '(Controlled)' },
            { mode: 1, label: '(Aggressive)' },
            { mode: 2, label: '(Defensive)' }
        ]);

        const spear = installLayout([
            { mode: 0, buttonY: 1, label: '(Controlled)', labelY: 14 },
            { mode: 3, buttonY: 128, label: '(Defensive)', labelY: 141 },
            { mode: 2, buttonY: 85, label: '(Controlled)', labelY: 97 },
            { mode: 1, buttonY: 42, label: '(Controlled)', labelY: 54 }
        ]);
        expect(readSelectButtonLabelsByVarp(spear, COM_MODE_VARP)).toEqual([
            { mode: 0, label: '(Controlled)' },
            { mode: 1, label: '(Controlled)' },
            { mode: 2, label: '(Controlled)' },
            { mode: 3, label: '(Defensive)' }
        ]);
    });

    test('ignores unrelated text and unknown labels rather than inventing a style', () => {
        const root = installLayout([{ mode: 0, buttonY: 2, label: 'Chop', labelY: 15 }]);
        expect(readSelectButtonLabelsByVarp(root, COM_MODE_VARP)).toEqual([]);
    });
});
