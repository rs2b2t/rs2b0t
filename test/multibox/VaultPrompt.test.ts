import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ProfileVault } from '#/bot/multibox/ProfileVault.js';
import { VaultPrompt } from '#/bot/multibox/VaultPrompt.js';

const clearAll = () => {
    sessionStorage.clear();
    localStorage.clear();
    document.body.innerHTML = '';
};
beforeEach(clearAll);
afterEach(clearAll);

function make(): { vault: ProfileVault; prompt: VaultPrompt } {
    const vault = new ProfileVault();
    const prompt = new VaultPrompt(vault);
    document.body.appendChild(prompt.el);
    return { vault, prompt };
}

const q = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const submit = () => q<HTMLFormElement>('#mbx-vault form').dispatchEvent(new Event('submit', { cancelable: true }));

async function until(cond: () => boolean, ms = 3000): Promise<void> {
    const t0 = Date.now();
    while (!cond()) {
        if (Date.now() - t0 > ms) {
            throw new Error('condition timeout');
        }
        await new Promise(r => setTimeout(r, 10));
    }
}

describe('VaultPrompt', () => {
    test('already unlocked resolves true without showing', async () => {
        const { vault, prompt } = make();
        await vault.setup('pw');
        expect(await prompt.ensureUnlocked()).toBe(true);
        expect(prompt.el.hidden).toBe(true);
    });

    test('set face: mismatch errors, match encrypts and resolves true', async () => {
        const { vault, prompt } = make();
        const p = prompt.ensureUnlocked();
        expect(prompt.el.hidden).toBe(false);
        expect(q('#mbx-vault-confirm')).not.toBeNull();
        q<HTMLInputElement>('#mbx-vault-pass').value = 'pw';
        q<HTMLInputElement>('#mbx-vault-confirm').value = 'other';
        submit();
        expect(q('.mbx-vault-error').textContent).toBe('passphrases do not match');
        q<HTMLInputElement>('#mbx-vault-confirm').value = 'pw';
        submit();
        expect(await p).toBe(true);
        expect(vault.status()).toBe('unlocked');
        expect(prompt.el.hidden).toBe(true);
    });

    test('unlock face: wrong passphrase errors, right one resolves true', async () => {
        const seed = new ProfileVault();
        await seed.setup('pw');
        await seed.upsert({ username: 'alice', password: 'a' });
        const { vault, prompt } = make();
        const p = prompt.ensureUnlocked();
        expect(q('#mbx-vault-confirm')).toBeNull();
        q<HTMLInputElement>('#mbx-vault-pass').value = 'nope';
        submit();
        await until(() => q('.mbx-vault-error').textContent === 'wrong passphrase');
        q<HTMLInputElement>('#mbx-vault-pass').value = 'pw';
        submit();
        expect(await p).toBe(true);
        expect(vault.list()).toEqual([{ username: 'alice', password: 'a', tab: 'Main' }]);
    });

    test('dismissing the overlay resolves false', async () => {
        const { prompt } = make();
        const p = prompt.ensureUnlocked();
        prompt.el.click();
        expect(await p).toBe(false);
        expect(prompt.el.hidden).toBe(true);
    });

    test('concurrent calls share one prompt', () => {
        const { prompt } = make();
        const a = prompt.ensureUnlocked();
        const b = prompt.ensureUnlocked();
        expect(a).toBe(b);
        prompt.el.click();
    });

    test('start over is two-step, wipes, and lands on the set face', async () => {
        const seed = new ProfileVault();
        await seed.setup('pw');
        const { vault, prompt } = make();
        const p = prompt.ensureUnlocked();
        q('#mbx-vault-reset').click();
        expect(vault.status()).toBe('locked');
        q('#mbx-vault-reset').click();
        expect(vault.status()).toBe('empty');
        expect(q('#mbx-vault-confirm')).not.toBeNull();
        prompt.el.click();
        await p;
    });
});
