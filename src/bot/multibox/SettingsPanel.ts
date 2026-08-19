import { PROFILE_FILE_NAME, parseProfileFile, serializeProfileFile, type ProfileSnapshot } from './ProfileTransfer.js';

export interface SettingsPanelHooks {
    ensureUnlocked: () => Promise<boolean>;
    snapshot: () => ProfileSnapshot;
    replaceAll: (data: ProfileSnapshot) => Promise<void>;
    download?: (filename: string, text: string) => void;
    onImported?: (data: ProfileSnapshot) => void;
}

function downloadTextFile(filename: string, text: string): void {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

export class SettingsPanel {
    readonly el: HTMLDivElement;
    readonly fileInput: HTMLInputElement;

    private err: HTMLDivElement;

    constructor(private hooks: SettingsPanelHooks) {
        this.el = document.createElement('div');
        this.el.id = 'mbx-settings-overlay';
        this.el.className = 'mbx-chooser-overlay';
        this.el.hidden = true;
        this.el.addEventListener('click', ev => {
            if (ev.target === this.el) {
                this.close();
            }
        });
        this.el.addEventListener('keydown', ev => {
            if (ev.key !== 'Escape' || this.el.hidden || !this.el.isConnected) {
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            this.close();
        });

        const box = document.createElement('div');
        box.className = 'mbx-chooser';

        const title = document.createElement('div');
        title.className = 'mbx-chooser-title';
        title.textContent = 'settings';

        const actions = document.createElement('div');
        actions.className = 'mbx-chooser-form';

        const exp = document.createElement('button');
        exp.id = 'mbx-export-profile';
        exp.type = 'button';
        exp.textContent = 'export profile';
        exp.addEventListener('click', () => {
            void this.exportProfile();
        });

        const imp = document.createElement('button');
        imp.id = 'mbx-import-profile';
        imp.type = 'button';
        imp.textContent = 'import profile';
        imp.addEventListener('click', () => this.fileInput.click());

        this.fileInput = document.createElement('input');
        this.fileInput.id = 'mbx-import-file';
        this.fileInput.type = 'file';
        this.fileInput.accept = 'application/json,.json';
        this.fileInput.hidden = true;
        this.fileInput.addEventListener('change', () => {
            const file = this.fileInput.files?.[0];
            this.fileInput.value = '';
            if (!file) {
                return;
            }
            void file.text().then(text => this.importText(text));
        });

        this.err = document.createElement('div');
        this.err.className = 'mbx-vault-error';
        this.err.id = 'mbx-settings-error';

        actions.append(exp, imp, this.fileInput);
        box.append(title, actions, this.err);
        this.el.appendChild(box);
    }

    open(): void {
        this.err.textContent = '';
        this.el.hidden = false;
    }

    close(): void {
        this.el.hidden = true;
    }

    async exportProfile(): Promise<void> {
        this.err.textContent = '';
        if (!(await this.hooks.ensureUnlocked())) {
            return;
        }
        const text = serializeProfileFile(this.hooks.snapshot());
        (this.hooks.download ?? downloadTextFile)(PROFILE_FILE_NAME, text);
    }

    async importText(text: string): Promise<void> {
        this.err.textContent = '';
        if (!(await this.hooks.ensureUnlocked())) {
            return;
        }
        try {
            const data = parseProfileFile(text);
            await this.hooks.replaceAll(data);
            this.hooks.onImported?.(data);
            this.close();
        } catch (e) {
            this.err.textContent = e instanceof Error ? e.message : String(e);
        }
    }
}
