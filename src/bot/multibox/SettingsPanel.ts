import { PROFILE_FILE_NAME, parseProfileFile, serializeProfileFile, type ConfirmLegacySetting, type ProfileSnapshot } from './ProfileTransfer.js';
import { desktopStorage } from '../runtime/desktopStorage.js';

export interface SettingsPanelHooks {
    ensureUnlocked: () => Promise<boolean>;
    snapshot: () => ProfileSnapshot | Promise<ProfileSnapshot>;
    confirmLegacy?: ConfirmLegacySetting;
    replaceAll: (data: ProfileSnapshot) => Promise<void>;
    download?: (filename: string, text: string) => void;
    onImported?: (data: ProfileSnapshot) => void;
    beforeExport?: () => Promise<void>;
}

async function withImportLock<T>(action: () => Promise<T>): Promise<T> {
    if (!desktopStorage && navigator.locks?.request) return await navigator.locks.request('rs2b0t:multibox:profile-import', action);
    return action();
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
    private importTail = Promise.resolve();

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
        try {
            await this.hooks.beforeExport?.();
            const text = await withImportLock(async () => serializeProfileFile(await this.hooks.snapshot()));
            (this.hooks.download ?? downloadTextFile)(PROFILE_FILE_NAME, text);
        } catch (e) {
            this.err.textContent = e instanceof Error ? e.message : String(e);
        }
    }

    async importText(text: string): Promise<void> {
        this.err.textContent = '';
        if (!(await this.hooks.ensureUnlocked())) {
            return;
        }
        const currentImport = this.importTail.then(async () => {
            const data = parseProfileFile(text, this.hooks.confirmLegacy);
            await withImportLock(() => this.hooks.replaceAll(data));
            this.hooks.onImported?.(data);
            if (this.importTail === currentImport) this.close();
        }).catch(e => {
            this.err.textContent = e instanceof Error ? e.message : String(e);
        });
        this.importTail = currentImport;
        return currentImport;
    }
}
