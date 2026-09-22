import type { ProfileVault } from './ProfileVault.js';

function div(className: string, text: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = className;
    d.textContent = text;
    return d;
}

function passInput(id: string, placeholder: string): HTMLInputElement {
    const i = document.createElement('input');
    i.id = id;
    i.type = 'password';
    i.placeholder = placeholder;
    return i;
}

export class VaultPrompt {
    readonly el: HTMLDivElement;

    private box: HTMLDivElement;
    private resolvePending: ((ok: boolean) => void) | null = null;
    private pendingPromise: Promise<boolean> | null = null;

    constructor(private vault: ProfileVault) {
        this.el = document.createElement('div');
        this.el.id = 'mbx-vault';
        this.el.className = 'mbx-chooser-overlay';
        this.el.hidden = true;
        this.el.addEventListener('click', ev => {
            if (ev.target === this.el) {
                this.finish(false);
            }
        });
        this.box = document.createElement('div');
        this.box.className = 'mbx-chooser';
        this.el.appendChild(this.box);
    }

    ensureUnlocked(): Promise<boolean> {
        if (this.vault.status() === 'unlocked') {
            return Promise.resolve(true);
        }
        if (this.pendingPromise) {
            return this.pendingPromise;
        }
        this.pendingPromise = new Promise<boolean>(resolve => {
            this.resolvePending = resolve;
        });
        this.render();
        this.el.hidden = false;
        return this.pendingPromise;
    }

    private finish(ok: boolean): void {
        this.el.hidden = true;
        const resolve = this.resolvePending;
        this.resolvePending = null;
        this.pendingPromise = null;
        resolve?.(ok);
    }

    private render(): void {
        this.box.textContent = '';
        if (this.vault.status() === 'locked') {
            this.renderUnlock();
        } else {
            this.renderSet();
        }
    }

    private renderSet(): void {
        const legacy = this.vault.status() === 'plaintext-legacy';
        const title = div('mbx-chooser-title', legacy ? 'set a passphrase to encrypt your saved profiles' : 'set a profiles passphrase');
        const form = document.createElement('form');
        form.className = 'mbx-chooser-form';
        const pass = passInput('mbx-vault-pass', 'passphrase');
        const confirm = passInput('mbx-vault-confirm', 'confirm passphrase');
        const go = document.createElement('button');
        go.id = 'mbx-vault-go';
        go.type = 'submit';
        go.textContent = 'encrypt';
        form.append(pass, confirm, go);
        const err = div('mbx-vault-error', '');
        form.addEventListener('submit', ev => {
            ev.preventDefault();
            if (pass.value.length === 0) {
                err.textContent = 'passphrase required';
                return;
            }
            if (pass.value !== confirm.value) {
                err.textContent = 'passphrases do not match';
                return;
            }
            go.disabled = true;
            void this.vault
                .setup(pass.value)
                .then(() => this.finish(true))
                .catch(error => {
                    this.render();
                    const message = this.box.querySelector('.mbx-vault-error');
                    if (message) message.textContent = error instanceof Error ? error.message : String(error);
                });
        });
        this.box.append(title, form, err);
        pass.focus();
    }

    private renderUnlock(): void {
        const title = div('mbx-chooser-title', 'unlock saved profiles');
        const form = document.createElement('form');
        form.className = 'mbx-chooser-form';
        const pass = passInput('mbx-vault-pass', 'passphrase');
        const go = document.createElement('button');
        go.id = 'mbx-vault-go';
        go.type = 'submit';
        go.textContent = 'unlock';
        form.append(pass, go);
        const err = div('mbx-vault-error', '');
        form.addEventListener('submit', ev => {
            ev.preventDefault();
            void this.vault.unlock(pass.value).then(ok => {
                if (ok) {
                    this.finish(true);
                } else {
                    err.textContent = 'wrong passphrase';
                    pass.value = '';
                    pass.focus();
                }
            });
        });
        const reset = div('mbx-vault-reset', 'forgot? start over');
        reset.id = 'mbx-vault-reset';
        let armed = false;
        reset.addEventListener('click', () => {
            if (!armed) {
                armed = true;
                reset.textContent = 'really wipe all saved profiles?';
                return;
            }
            this.vault.reset();
            this.render();
        });
        this.box.append(title, form, err, reset);
        pass.focus();
    }
}
