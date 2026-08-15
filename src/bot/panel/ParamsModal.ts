import { SettingsStore, type SettingsSchema } from '../runtime/Settings.js';
import { groupSchema, isVisible, renderControl, visibilityDeps } from './paramControls.js';
import { el } from './dom.js';
import { Loadouts } from '../api/loadout/loadoutStore.js';

export default class ParamsModal {
    private backdrop: HTMLElement;
    private titleEl: HTMLElement;
    private bodyEl: HTMLElement;
    private scriptName = '';
    private schema: SettingsSchema = {};
    private openTitle: string | null = null;
    private openIntro: string | null = null;
    private onCloseCb: (() => void) | null = null;
    private globalExtra: HTMLElement | null = null;
    /** When false, skip credentials strip even if scriptName is Global (Nav settings). */
    private showGlobalExtra = true;
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
                // Why: nested hosts (map picker window keydown) would otherwise treat this Escape as "close the outer modal" too.
                e.preventDefault();
                e.stopPropagation();
                this.close();
            }
        });
    }

    isOpen(): boolean {
        return this.backdrop.style.display === 'flex';
    }

    open(
        scriptName: string,
        schema: SettingsSchema,
        opts?: {
            title?: string;
            zIndex?: number;
            onClose?: () => void;
            intro?: string;
            /** Default true when scriptName is Global. Set false for Nav settings. */
            showGlobalExtra?: boolean;
        }
    ): void {
        // Loadout names are player data, not a schema constant.
        for (const def of Object.values(schema)) {
            if (def.optionsFrom === 'loadouts') {
                def.options = Loadouts.names();
            }
        }
        this.scriptName = scriptName;
        this.schema = schema;
        this.openTitle = opts?.title ?? null;
        this.openIntro = opts?.intro ?? null;
        this.onCloseCb = opts?.onClose ?? null;
        this.showGlobalExtra = opts?.showGlobalExtra ?? scriptName === 'Global';
        this.backdrop.style.zIndex = opts?.zIndex !== undefined ? String(opts.zIndex) : '';
        this.render();
        this.backdrop.style.display = 'flex';
    }

    close(): void {
        if (!this.isOpen()) {
            return;
        }
        this.backdrop.style.display = 'none';
        this.backdrop.style.zIndex = '';
        this.openIntro = null;
        const cb = this.onCloseCb;
        this.onCloseCb = null;
        cb?.();
    }

    // extra DOM shown atop the Global popup only (account/login controls)
    setGlobalExtra(extra: HTMLElement): void {
        this.globalExtra = extra;
    }

    private render(): void {
        this.titleEl.textContent = this.openTitle ?? `${this.scriptName} · parameters`;
        this.bodyEl.replaceChildren();
        if (this.openIntro) {
            const intro = el('div', 'rs2b0t-param-intro');
            Object.assign(intro.style, {
                margin: '0 0 10px',
                padding: '8px 10px',
                borderRadius: '4px',
                border: '1px solid #333',
                background: '#141414',
                color: '#aaa',
                fontSize: '12px',
                lineHeight: '1.45'
            });
            intro.textContent = this.openIntro;
            this.bodyEl.appendChild(intro);
        }
        if (this.scriptName === 'Global' && this.showGlobalExtra && this.globalExtra) {
            this.bodyEl.appendChild(this.globalExtra);
        }
        // Why: mid-run schema changes desync the bot, so script params lock while a script runs.
        // Global / Nav (same storage ns) stay live — lamp skill, run, bank junk and path paint are meant to be tweakable mid-session.
        const lockScriptParams = this.scriptName !== 'Global' && this.isActive();
        const disabled = lockScriptParams;
        if (lockScriptParams) {
            const note = el('div', 'rs2b0t-param-intro');
            Object.assign(note.style, {
                margin: '0 0 10px',
                padding: '8px 10px',
                borderRadius: '4px',
                border: '1px solid #664',
                background: '#1a1810',
                color: '#dbb',
                fontSize: '12px',
                lineHeight: '1.45'
            });
            note.textContent =
                'Script is running — these parameters are locked. Stop the script to edit them. '
                + 'Global settings (lamp skill, auto-login, …) stay editable while a script runs.';
            this.bodyEl.appendChild(note);
        }
        const deps = visibilityDeps(this.schema);
        const valueOf = (key: string): string => (this.schema[key] ? SettingsStore.displayString(this.scriptName, key, this.schema[key]) : '');
        const collapsed = this.collapsed.get(this.scriptName) ?? new Set<string>();
        this.collapsed.set(this.scriptName, collapsed);

        for (const group of groupSchema(this.schema)) {
            const visibleKeys = group.keys.filter(key => isVisible(this.schema[key], valueOf));
            if (visibleKeys.length === 0) {
                continue;
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
                this.render();
            }
        }, { disabled });
        control.classList.add('rs2b0t-param-control');
        row.appendChild(control);
        return row;
    }
}
