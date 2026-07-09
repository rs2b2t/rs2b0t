import { SettingsStore, type SettingsSchema } from '../runtime/Settings.js';
import { renderControl } from './paramControls.js';

/**
 * Full-screen modal that edits the selected script's parameters, mirroring
 * ScriptLibrary. Live-saves each change through SettingsStore and calls
 * onChanged() so the panel summary refreshes. Controls are disabled while a
 * script is active (isActive()).
 */
export default class ParamsModal {
    private backdrop: HTMLElement;
    private titleEl: HTMLElement;
    private bodyEl: HTMLElement;
    private scriptName = '';
    private schema: SettingsSchema = {};

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

        for (const [key, def] of Object.entries(this.schema)) {
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
            }, { disabled });
            control.classList.add('rs2b0t-param-control');
            row.appendChild(control);

            this.bodyEl.appendChild(row);
        }
    }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = cls;
    return node;
}
