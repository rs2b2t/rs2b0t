import { SettingsStore, type SettingsSchema } from '../runtime/Settings.js';
import { groupSchema, isVisible, renderControl, visibilityDeps } from './paramControls.js';
import { el } from './dom.js';

/**
 * Full-screen modal that edits the selected script's parameters, mirroring
 * ScriptLibrary. Live-saves each change through SettingsStore and calls
 * onChanged() so the panel summary refreshes. Controls are disabled while a
 * script is active (isActive()).
 *
 * Schemas can declare `group` (collapsible sections, remembered per script for
 * the session) and `showIf` (rows hidden until another setting matches — a
 * change to a depended-on key re-renders the body so dependent rows appear
 * in place; independent edits save without a re-render, keeping slider drags
 * and half-typed text alive).
 */
export default class ParamsModal {
    private backdrop: HTMLElement;
    private titleEl: HTMLElement;
    private bodyEl: HTMLElement;
    private scriptName = '';
    private schema: SettingsSchema = {};
    /** collapsed group names per script (session-scoped). */
    private collapsed = new Map<string, Set<string>>();

    constructor(private isActive: () => boolean, private onChanged: () => void) {
        this.backdrop = el('div', 'rs2b0t-modal-backdrop');
        this.backdrop.addEventListener('click', e => {
            if (e.target === this.backdrop) {
                this.close();
            }
        });

        const modal = el('div', 'rs2b0t-modal');
        const header = el('div', 'rs2b0t-modal-header');
        this.titleEl = el('div', 'rs2b0t-modal-title');
        const close = document.createElement('button');
        close.className = 'rs2b0t-button';
        close.textContent = '✕';
        close.style.flex = '0 0 auto';
        close.addEventListener('click', () => this.close());
        header.appendChild(this.titleEl);
        header.appendChild(close);
        modal.appendChild(header);

        this.bodyEl = el('div', 'rs2b0t-params-body');
        modal.appendChild(this.bodyEl);

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

    open(scriptName: string, schema: SettingsSchema): void {
        this.scriptName = scriptName;
        this.schema = schema;
        this.render();
        this.backdrop.style.display = 'flex';
    }

    close(): void {
        this.backdrop.style.display = 'none';
    }

    private render(): void {
        this.titleEl.textContent = `${this.scriptName} · parameters`;
        this.bodyEl.replaceChildren();
        const disabled = this.isActive();
        const deps = visibilityDeps(this.schema);
        const valueOf = (key: string): string => (this.schema[key] ? SettingsStore.displayString(this.scriptName, key, this.schema[key]) : '');
        const collapsed = this.collapsed.get(this.scriptName) ?? new Set<string>();
        this.collapsed.set(this.scriptName, collapsed);

        for (const group of groupSchema(this.schema)) {
            const visibleKeys = group.keys.filter(key => isVisible(this.schema[key], valueOf));
            if (visibleKeys.length === 0) {
                continue; // a group whose every row is hidden disappears whole
            }

            let host = this.bodyEl;
            if (group.name !== '') {
                const isCollapsed = collapsed.has(group.name);
                const header = el('button', 'rs2b0t-param-group');
                header.type = 'button';
                header.textContent = `${isCollapsed ? '▸' : '▾'} ${group.name}`;
                header.addEventListener('click', () => {
                    if (!collapsed.delete(group.name)) {
                        collapsed.add(group.name);
                    }
                    this.render();
                });
                this.bodyEl.appendChild(header);
                if (isCollapsed) {
                    continue;
                }
                host = el('div', 'rs2b0t-param-groupbody');
                this.bodyEl.appendChild(host);
            }

            for (const key of visibleKeys) {
                host.appendChild(this.renderRow(key, disabled, deps));
            }
        }
    }

    private renderRow(key: string, disabled: boolean, deps: Set<string>): HTMLElement {
        const def = this.schema[key];
        const row = el('div', 'rs2b0t-param-row');

        const label = el('div', 'rs2b0t-param-label');
        label.textContent = def.label ?? key;
        row.appendChild(label);

        if (def.help) {
            const help = el('div', 'rs2b0t-param-help');
            help.textContent = def.help;
            row.appendChild(help);
        }

        const current = SettingsStore.displayString(this.scriptName, key, def);
        const control = renderControl(def, current, raw => {
            SettingsStore.save(this.scriptName, key, raw);
            this.onChanged();
            if (deps.has(key)) {
                this.render(); // dependent rows appear/disappear in place
            }
        }, { disabled });
        control.classList.add('rs2b0t-param-control');
        row.appendChild(control);
        return row;
    }
}
