import { reader } from '../adapter/ClientAdapter.js';
import { el } from './dom.js';

// A popup debug tool: nearby npc/object ids, open widgets, position, tick. Lives
// in a modal (not the sidebar) to keep the main panel uncluttered. update() is
// driven from the panel's draw loop and only touches the DOM while open.
export default class DebugModal {
    private backdrop: HTMLElement;
    private stateCell: HTMLElement;
    private playerCell: HTMLElement;
    private tileCell: HTMLElement;
    private energyCell: HTMLElement;
    private countsCell: HTMLElement;
    private widgetsCell: HTMLElement;
    private tickCell: HTMLElement;
    private npcsList: HTMLElement;
    private locsList: HTMLElement;

    constructor(private tick: () => { count: number; meanMs: number }) {
        this.backdrop = el('div', 'rs2b0t-modal-backdrop');
        this.backdrop.addEventListener('click', e => {
            if (e.target === this.backdrop) {
                this.close();
            }
        });

        const modal = el('div', 'rs2b0t-modal');
        const header = el('div', 'rs2b0t-modal-header');
        const title = el('div', 'rs2b0t-modal-title');
        title.textContent = 'Debug';
        const close = document.createElement('button');
        close.className = 'rs2b0t-button';
        close.textContent = '✕';
        close.style.flex = '0 0 auto';
        close.addEventListener('click', () => this.close());
        header.appendChild(title);
        header.appendChild(close);
        modal.appendChild(header);

        const body = el('div', 'rs2b0t-params-body');
        this.stateCell = row(body, 'state');
        this.playerCell = row(body, 'player');
        this.tileCell = row(body, 'tile');
        this.energyCell = row(body, 'run energy');
        this.countsCell = row(body, 'nearby');
        this.widgetsCell = row(body, 'widgets');
        this.tickCell = row(body, 'tick');
        this.npcsList = listBlock(body, 'nearby npcs (id)');
        this.locsList = listBlock(body, 'nearby objects (id)');
        modal.appendChild(body);

        this.backdrop.appendChild(modal);
        document.body.appendChild(this.backdrop);

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && this.isOpen()) {
                this.close();
            }
        });
    }

    isOpen(): boolean {
        return this.backdrop.style.display === 'flex';
    }

    open(): void {
        this.update();
        this.backdrop.style.display = 'flex';
    }

    close(): void {
        this.backdrop.style.display = 'none';
    }

    update(): void {
        if (!this.isOpen()) {
            return;
        }

        const ingame = reader.ingame();
        this.stateCell.textContent = ingame ? 'ingame' : 'title screen';
        this.playerCell.textContent = reader.localPlayerName() ?? '-';

        const tile = reader.worldTile();
        this.tileCell.textContent = tile ? `${tile.x}, ${tile.z}, ${tile.level}` : '-';

        this.energyCell.textContent = ingame ? `${reader.energy()}%` : '-';
        this.countsCell.textContent = ingame ? `${reader.playerCount()} players, ${reader.npcCount()} npcs` : '-';

        const modals = reader.modals();
        this.widgetsCell.textContent = `main ${modals.main} / side ${modals.side} / chat ${modals.chat}`;

        const t = this.tick();
        this.tickCell.textContent = `${t.count}${t.meanMs > 0 ? ` (${t.meanMs.toFixed(0)}ms)` : ''}`;

        renderList(this.npcsList, ingame ? reader.npcs() : []);
        renderList(this.locsList, ingame ? reader.locs() : []);
    }
}

function row(parent: HTMLElement, label: string): HTMLElement {
    const line = el('div', 'rs2b0t-row');
    const key = el('span', 'rs2b0t-key');
    key.textContent = label;
    const value = el('span', 'rs2b0t-value');
    value.textContent = '-';
    line.appendChild(key);
    line.appendChild(value);
    parent.appendChild(line);
    return value;
}

function listBlock(parent: HTMLElement, label: string): HTMLElement {
    const key = el('div', 'rs2b0t-debug-sub');
    key.textContent = label;
    const list = el('div', 'rs2b0t-debug-list');
    parent.appendChild(key);
    parent.appendChild(list);
    return list;
}

function renderList(host: HTMLElement, entries: { id: number; name: string | null; tile: { x: number; z: number }; distance: number }[]): void {
    host.replaceChildren();
    if (entries.length === 0) {
        const none = el('div', 'rs2b0t-debug-line rs2b0t-dim');
        none.textContent = '(none)';
        host.appendChild(none);
        return;
    }
    const nearest = [...entries].sort((a, b) => a.distance - b.distance).slice(0, 12);
    for (const e of nearest) {
        const div = el('div', 'rs2b0t-debug-line');
        div.textContent = `${e.name ?? '?'} #${e.id} @${e.tile.x},${e.tile.z}`;
        host.appendChild(div);
    }
}
