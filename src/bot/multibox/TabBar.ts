import { MAIN_TAB } from './MultiBoxController.js';

const TAB_MIME = 'application/x-mbx-tab';

export interface TabBarCallbacks {
    onSelect(name: string): void;
    // return false to reject the name; the input stays open and is flagged
    onAdd(name: string): boolean;
    onRename(oldName: string, newName: string): boolean;
    onRemove(name: string): void;
    // toIndex is in full tabs() space, where Main is pinned at 0
    onMove(name: string, toIndex: number): void;
    onDropBot(botId: number, tab: string): void;
}

export class TabBar {
    private tabs: string[] = [MAIN_TAB];
    private active: string = MAIN_TAB;
    private lastSig: string | null = null;
    private editing = false;
    private menu: HTMLElement | null = null;
    private closeOnAway: ((ev: MouseEvent) => void) | null = null;

    constructor(
        private container: HTMLElement,
        private cb: TabBarCallbacks
    ) {}

    render(tabs: string[], active: string): void {
        if (this.editing) {
            return;
        }
        // rebuild only on change so the 1 Hz repaint can't eat drag markers
        const sig = JSON.stringify([tabs, active]);
        if (sig === this.lastSig) {
            return;
        }
        this.lastSig = sig;
        this.tabs = [...tabs];
        this.active = active;
        this.rebuild();
    }

    private rebuild(): void {
        this.closeMenu();
        this.container.textContent = '';
        for (const name of this.tabs) {
            this.container.appendChild(this.chip(name));
        }
        this.container.appendChild(this.addChip());
    }

    private chip(name: string): HTMLElement {
        const chip = document.createElement('div');
        chip.className = 'mbx-tabchip';
        chip.dataset.tab = name;
        const custom = name !== MAIN_TAB;
        if (custom) {
            chip.setAttribute('draggable', 'true');
        }
        const label = document.createElement('span');
        label.className = 'mbx-tabname';
        label.textContent = name;
        chip.appendChild(label);
        if (name === this.active) {
            chip.classList.add('is-active');
            if (custom) {
                const gear = document.createElement('button');
                gear.className = 'mbx-tabgear';
                gear.type = 'button';
                gear.title = 'rename or delete this tab';
                gear.textContent = '⚙';
                gear.addEventListener('click', ev => {
                    ev.stopPropagation();
                    this.toggleMenu(chip, name);
                });
                chip.appendChild(gear);
            }
        }
        chip.addEventListener('click', () => this.cb.onSelect(name));

        chip.addEventListener('dragstart', ev => {
            if (!custom) {
                ev.preventDefault();
                return;
            }
            chip.classList.add('is-dragging');
            if (ev.dataTransfer) {
                ev.dataTransfer.effectAllowed = 'move';
                ev.dataTransfer.setData(TAB_MIME, name);
            }
        });
        chip.addEventListener('dragover', ev => {
            const dt = ev.dataTransfer;
            if (!dt) {
                return;
            }
            if (dt.types.includes(TAB_MIME)) {
                ev.preventDefault();
                dt.dropEffect = 'move';
                this.clearDropMarkers();
                const rect = chip.getBoundingClientRect();
                chip.classList.add(ev.clientX < rect.left + rect.width / 2 ? 'mbx-tabdrop-before' : 'mbx-tabdrop-after');
            } else if (dt.types.includes('text/plain')) {
                // a bot tile drag — dropping it here files the bot into this tab
                ev.preventDefault();
                dt.dropEffect = 'move';
                chip.classList.add('mbx-tabdrop-into');
            }
        });
        chip.addEventListener('dragleave', () => chip.classList.remove('mbx-tabdrop-into'));
        chip.addEventListener('drop', ev => {
            const dt = ev.dataTransfer;
            if (!dt) {
                return;
            }
            if (dt.types.includes(TAB_MIME)) {
                ev.preventDefault();
                this.clearDropMarkers();
                const dragged = dt.getData(TAB_MIME);
                const from = this.tabs.indexOf(dragged);
                const targetIdx = this.tabs.indexOf(name);
                if (from < 0 || targetIdx < 0 || dragged === name) {
                    return;
                }
                const rect = chip.getBoundingClientRect();
                let dest = targetIdx + (ev.clientX >= rect.left + rect.width / 2 ? 1 : 0);
                if (from < dest) {
                    dest--;
                }
                if (dest !== from) {
                    this.cb.onMove(dragged, dest);
                }
            } else if (dt.types.includes('text/plain')) {
                ev.preventDefault();
                chip.classList.remove('mbx-tabdrop-into');
                const id = Number.parseInt(dt.getData('text/plain'), 10);
                if (Number.isSafeInteger(id)) {
                    this.cb.onDropBot(id, name);
                }
            }
        });
        chip.addEventListener('dragend', () => {
            chip.classList.remove('is-dragging');
            this.clearDropMarkers();
        });
        return chip;
    }

    private addChip(): HTMLElement {
        const chip = document.createElement('div');
        chip.className = 'mbx-tabchip mbx-tabadd';
        chip.title = 'add a tab';
        chip.textContent = '+';
        chip.addEventListener('click', () => this.openInput(chip, '', value => this.cb.onAdd(value)));
        return chip;
    }

    private openInput(host: HTMLElement, initial: string, commit: (value: string) => boolean): void {
        this.editing = true;
        this.closeMenu();
        host.textContent = '';
        host.classList.add('is-editing');
        const input = document.createElement('input');
        input.className = 'mbx-tabinput';
        input.value = initial;
        const close = (): void => {
            this.editing = false;
            // the owner re-renders inside a successful commit; when it didn't
            // (rejected rename to the same name, plain cancel), restore the chips
            if (this.container.contains(input)) {
                this.lastSig = null;
                this.rebuild();
            }
        };
        input.addEventListener('keydown', ev => {
            ev.stopPropagation();
            if (ev.key === 'Enter') {
                ev.preventDefault();
                this.editing = false;
                if (commit(input.value)) {
                    close();
                } else {
                    this.editing = true;
                    input.classList.add('is-invalid');
                }
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                close();
            }
        });
        input.addEventListener('blur', () => {
            if (this.editing) {
                close();
            }
        });
        host.appendChild(input);
        input.focus();
    }

    private toggleMenu(chip: HTMLElement, name: string): void {
        if (this.menu) {
            this.closeMenu();
            return;
        }
        const menu = document.createElement('div');
        menu.className = 'mbx-tabmenu';
        const rename = document.createElement('button');
        rename.type = 'button';
        rename.className = 'mbx-tabmenu-rename';
        rename.textContent = 'rename';
        rename.addEventListener('click', ev => {
            ev.stopPropagation();
            this.closeMenu();
            this.openInput(chip, name, value => this.cb.onRename(name, value));
        });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'mbx-tabmenu-delete';
        del.textContent = 'delete';
        del.addEventListener('click', ev => {
            ev.stopPropagation();
            this.closeMenu();
            this.cb.onRemove(name);
        });
        menu.append(rename, del);
        menu.style.left = `${chip.offsetLeft}px`;
        menu.style.top = `${chip.offsetTop + chip.offsetHeight}px`;
        this.container.appendChild(menu);
        this.menu = menu;
        // the opening gear click never reaches document (stopPropagation), so
        // this can attach immediately without closing itself
        this.closeOnAway = ev => {
            if (!menu.contains(ev.target as Node)) {
                this.closeMenu();
            }
        };
        document.addEventListener('click', this.closeOnAway);
    }

    private closeMenu(): void {
        if (!this.menu) {
            return;
        }
        this.menu.remove();
        this.menu = null;
        if (this.closeOnAway) {
            document.removeEventListener('click', this.closeOnAway);
            this.closeOnAway = null;
        }
    }

    private clearDropMarkers(): void {
        for (const el of Array.from(this.container.querySelectorAll('.mbx-tabdrop-before, .mbx-tabdrop-after, .mbx-tabdrop-into'))) {
            el.classList.remove('mbx-tabdrop-before', 'mbx-tabdrop-after', 'mbx-tabdrop-into');
        }
    }
}
