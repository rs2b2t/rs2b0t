import { ScriptRegistry, type ScriptMeta } from '../runtime/ScriptRegistry.js';
import { el } from './dom.js';

/** Preferred category order; anything else falls in alphabetically after. */
const CATEGORY_ORDER = ['Combat', 'Woodcutting', 'Fishing', 'Mining', 'Cooking', 'Smithing', 'Fletching', 'Firemaking', 'Crafting', 'Herblore', 'Agility', 'Thieving', 'Runecrafting', 'Prayer', 'Magic', 'Navigation', 'Utility', 'Develop'];

/**
 * Full-screen modal script library: a transparent backdrop over the client
 * with a category filter + search + script cards. Picking a card selects it
 * for the panel. Registry-driven, so loaded/external scripts appear and
 * filter alongside the built-ins.
 */
export default class ScriptLibrary {
    private backdrop: HTMLElement;
    private listEl: HTMLElement;
    private chipsEl: HTMLElement;
    private searchEl: HTMLInputElement;

    private category = 'All';
    private query = '';

    constructor(private onSelect: (name: string) => void) {
        this.backdrop = el('div', 'rs2b0t-modal-backdrop');
        this.backdrop.addEventListener('click', e => {
            if (e.target === this.backdrop) {
                this.close();
            }
        });

        const modal = el('div', 'rs2b0t-modal');

        const header = el('div', 'rs2b0t-modal-header');
        const title = el('div', 'rs2b0t-modal-title');
        title.textContent = 'Script library';
        const close = document.createElement('button');
        close.className = 'rs2b0t-button';
        close.textContent = '✕';
        close.style.flex = '0 0 auto';
        close.addEventListener('click', () => this.close());
        header.appendChild(title);
        header.appendChild(close);
        modal.appendChild(header);

        this.searchEl = document.createElement('input');
        this.searchEl.className = 'rs2b0t-input';
        this.searchEl.type = 'text';
        this.searchEl.placeholder = 'search name / description / tag…';
        this.searchEl.addEventListener('input', () => {
            this.query = this.searchEl.value.trim().toLowerCase();
            this.renderList();
        });
        modal.appendChild(this.searchEl);

        this.chipsEl = el('div', 'rs2b0t-chips');
        modal.appendChild(this.chipsEl);

        this.listEl = el('div', 'rs2b0t-library-list');
        modal.appendChild(this.listEl);

        this.backdrop.appendChild(modal);
        document.body.appendChild(this.backdrop);

        ScriptRegistry.onChange(() => {
            if (this.isOpen()) {
                this.render();
            }
        });
    }

    isOpen(): boolean {
        return this.backdrop.style.display === 'flex';
    }

    open(): void {
        this.render();
        this.backdrop.style.display = 'flex';
        this.searchEl.focus();
    }

    close(): void {
        this.backdrop.style.display = 'none';
    }

    private render(): void {
        this.renderChips();
        this.renderList();
    }

    private categories(): string[] {
        const present = new Set<string>();
        for (const m of ScriptRegistry.list()) {
            present.add(m.category ?? 'Other');
        }
        const ordered = CATEGORY_ORDER.filter(c => present.has(c));
        const rest = [...present].filter(c => !CATEGORY_ORDER.includes(c)).sort();
        return ['All', ...ordered, ...rest];
    }

    private renderChips(): void {
        this.chipsEl.replaceChildren();
        for (const cat of this.categories()) {
            const count = cat === 'All' ? ScriptRegistry.list().length : ScriptRegistry.list().filter(m => (m.category ?? 'Other') === cat).length;
            const chip = document.createElement('button');
            chip.className = `rs2b0t-chip${cat === this.category ? ' rs2b0t-chip-active' : ''}`;
            chip.textContent = `${cat} (${count})`;
            chip.addEventListener('click', () => {
                this.category = cat;
                this.render();
            });
            this.chipsEl.appendChild(chip);
        }
    }

    private matches(m: ScriptMeta): boolean {
        if (this.category !== 'All' && (m.category ?? 'Other') !== this.category) {
            return false;
        }
        if (!this.query) {
            return true;
        }
        const hay = `${m.name} ${m.description} ${(m.tags ?? []).join(' ')} ${m.category ?? ''}`.toLowerCase();
        return hay.includes(this.query);
    }

    private renderList(): void {
        this.listEl.replaceChildren();
        const items = ScriptRegistry.list().filter(m => this.matches(m));
        if (items.length === 0) {
            const none = el('div', 'rs2b0t-dim');
            none.textContent = 'no scripts match';
            this.listEl.appendChild(none);
            return;
        }

        for (const m of items) {
            const card = el('div', 'rs2b0t-library-card');
            card.addEventListener('click', () => {
                this.onSelect(m.name);
                this.close();
            });

            const top = el('div', 'rs2b0t-card-top');
            const name = el('span', 'rs2b0t-card-name');
            name.textContent = m.origin ? `${m.name} ⇪` : m.name;
            const badge = el('span', 'rs2b0t-card-cat');
            badge.textContent = m.category ?? 'Other';
            top.appendChild(name);
            top.appendChild(badge);
            card.appendChild(top);

            const desc = el('div', 'rs2b0t-card-desc');
            desc.textContent = m.description;
            card.appendChild(desc);

            if (m.tags && m.tags.length > 0) {
                const tags = el('div', 'rs2b0t-card-tags');
                tags.textContent = m.tags.map(t => `#${t}`).join(' ');
                card.appendChild(tags);
            }

            this.listEl.appendChild(card);
        }
    }
}
