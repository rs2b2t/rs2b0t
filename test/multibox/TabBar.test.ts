import { beforeEach, describe, expect, test } from 'bun:test';
import { TabBar } from '#/bot/multibox/TabBar.js';

interface FakeDataTransfer {
    types: string[];
    effectAllowed: string;
    dropEffect: string;
    setData(type: string, value: string): void;
    getData(type: string): string;
}

function fakeDt(types: string[] = [], data: Record<string, string> = {}): FakeDataTransfer {
    return {
        types,
        effectAllowed: '',
        dropEffect: '',
        setData(type: string, value: string) {
            data[type] = value;
            if (!this.types.includes(type)) {
                this.types.push(type);
            }
        },
        getData(type: string) {
            return data[type] ?? '';
        }
    };
}

function drag(el: Element, type: string, dt: FakeDataTransfer, clientX = 0): void {
    const ev = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer: dt, clientX });
    el.dispatchEvent(ev);
}

function press(el: Element, key: string): void {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function makeBar() {
    const calls: string[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const bar = new TabBar(container, {
        onSelect: n => {
            calls.push(`select:${n}`);
        },
        onAdd: n => {
            calls.push(`add:${n}`);
            return !n.startsWith('bad');
        },
        onRename: (o, n) => {
            calls.push(`rename:${o}:${n}`);
            return true;
        },
        onRemove: n => {
            calls.push(`remove:${n}`);
        },
        onMove: (n, i) => {
            calls.push(`move:${n}:${i}`);
        },
        onDropBot: (id, t) => {
            calls.push(`dropbot:${id}:${t}`);
        }
    });
    return { bar, container, calls };
}

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('TabBar', () => {
    test('renders Main, customs, and the add chip; gear only on the active custom', () => {
        const { bar, container } = makeBar();
        bar.render(['Main', 'alts'], 'Main');
        const chips = Array.from(container.querySelectorAll<HTMLElement>('.mbx-tabchip:not(.mbx-tabadd)'));
        expect(chips.map(c => c.dataset.tab)).toEqual(['Main', 'alts']);
        expect(chips[0].classList.contains('is-active')).toBe(true);
        expect(chips[1].classList.contains('is-active')).toBe(false);
        expect(chips[0].getAttribute('draggable')).not.toBe('true');
        expect(chips[1].getAttribute('draggable')).toBe('true');
        expect(container.querySelector('.mbx-tabgear')).toBeNull();
        expect(container.querySelector('.mbx-tabadd')).not.toBeNull();

        bar.render(['Main', 'alts'], 'alts');
        expect(container.querySelector('.mbx-tabchip[data-tab="alts"] .mbx-tabgear')).not.toBeNull();
        expect(container.querySelector('.mbx-tabchip[data-tab="Main"] .mbx-tabgear')).toBeNull();
    });

    test('clicking a chip selects its tab', () => {
        const { bar, container, calls } = makeBar();
        bar.render(['Main', 'alts'], 'Main');
        container.querySelector<HTMLElement>('.mbx-tabchip[data-tab="alts"]')!.click();
        expect(calls).toEqual(['select:alts']);
    });

    test('+ opens an inline input; Enter commits, Escape cancels', () => {
        const { bar, container, calls } = makeBar();
        bar.render(['Main'], 'Main');
        container.querySelector<HTMLElement>('.mbx-tabadd')!.click();
        const input = container.querySelector<HTMLInputElement>('.mbx-tabinput')!;
        expect(input).not.toBeNull();
        input.value = 'miners';
        press(input, 'Enter');
        expect(calls).toEqual(['add:miners']);
        expect(container.querySelector('.mbx-tabinput')).toBeNull();

        container.querySelector<HTMLElement>('.mbx-tabadd')!.click();
        const input2 = container.querySelector<HTMLInputElement>('.mbx-tabinput')!;
        input2.value = 'dropped';
        press(input2, 'Escape');
        expect(container.querySelector('.mbx-tabinput')).toBeNull();
        expect(calls).toEqual(['add:miners']);
    });

    test('a rejected name keeps the input open and flags it', () => {
        const { bar, container, calls } = makeBar();
        bar.render(['Main'], 'Main');
        container.querySelector<HTMLElement>('.mbx-tabadd')!.click();
        const input = container.querySelector<HTMLInputElement>('.mbx-tabinput')!;
        input.value = 'bad one';
        press(input, 'Enter');
        expect(calls).toEqual(['add:bad one']);
        const still = container.querySelector<HTMLInputElement>('.mbx-tabinput')!;
        expect(still).not.toBeNull();
        expect(still.classList.contains('is-invalid')).toBe(true);
    });

    test('render is suppressed while a name is being typed', () => {
        const { bar, container } = makeBar();
        bar.render(['Main'], 'Main');
        container.querySelector<HTMLElement>('.mbx-tabadd')!.click();
        bar.render(['Main', 'x'], 'Main');
        expect(container.querySelector('.mbx-tabinput')).not.toBeNull();
    });

    test('the gear opens a menu that renames and deletes without selecting', () => {
        const { bar, container, calls } = makeBar();
        bar.render(['Main', 'alts'], 'alts');
        container.querySelector<HTMLElement>('.mbx-tabgear')!.click();
        const menu = container.querySelector<HTMLElement>('.mbx-tabmenu')!;
        expect(menu).not.toBeNull();
        menu.querySelector<HTMLElement>('.mbx-tabmenu-rename')!.click();
        const input = container.querySelector<HTMLInputElement>('.mbx-tabinput')!;
        expect(input.value).toBe('alts');
        input.value = 'mules';
        press(input, 'Enter');
        expect(calls).toEqual(['rename:alts:mules']);
        expect(container.querySelector('.mbx-tabinput')).toBeNull();

        bar.render(['Main', 'mules'], 'mules');
        container.querySelector<HTMLElement>('.mbx-tabgear')!.click();
        container.querySelector<HTMLElement>('.mbx-tabmenu-delete')!.click();
        expect(calls).toEqual(['rename:alts:mules', 'remove:mules']);
        expect(container.querySelector('.mbx-tabmenu')).toBeNull();
    });

    test('dragging a chip reorders tabs and clears markers on dragend', () => {
        const { bar, container, calls } = makeBar();
        bar.render(['Main', 'a', 'b'], 'Main');
        const a = container.querySelector<HTMLElement>('.mbx-tabchip[data-tab="a"]')!;
        const b = container.querySelector<HTMLElement>('.mbx-tabchip[data-tab="b"]')!;
        const dt = fakeDt();
        drag(b, 'dragstart', dt);
        expect(dt.getData('application/x-mbx-tab')).toBe('b');
        a.getBoundingClientRect = () => ({ left: 100, width: 50, top: 0, height: 0, right: 150, bottom: 0, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect;
        drag(a, 'dragover', dt, 105);
        expect(a.classList.contains('mbx-tabdrop-before')).toBe(true);
        drag(a, 'drop', dt, 105);
        expect(calls).toEqual(['move:b:1']);
        drag(b, 'dragend', dt);
        expect(container.querySelector('.mbx-tabdrop-before, .mbx-tabdrop-after')).toBeNull();
    });

    test('the Main chip never starts a tab drag', () => {
        const { bar, container, calls } = makeBar();
        bar.render(['Main', 'a'], 'Main');
        const main = container.querySelector<HTMLElement>('.mbx-tabchip[data-tab="Main"]')!;
        const a = container.querySelector<HTMLElement>('.mbx-tabchip[data-tab="a"]')!;
        const dt = fakeDt();
        drag(main, 'dragstart', dt);
        drag(a, 'dragover', dt, 0);
        drag(a, 'drop', dt, 0);
        expect(calls).toEqual([]);
    });

    test('a bot tile dropped on a chip files that bot into the tab', () => {
        const { bar, container, calls } = makeBar();
        bar.render(['Main', 'alts'], 'Main');
        const chip = container.querySelector<HTMLElement>('.mbx-tabchip[data-tab="alts"]')!;
        const dt = fakeDt(['text/plain'], { 'text/plain': '7' });
        drag(chip, 'dragover', dt);
        drag(chip, 'drop', dt);
        expect(calls).toEqual(['dropbot:7:alts']);
    });
});
