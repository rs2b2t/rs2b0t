import assert from 'node:assert/strict';
import { errors, type Page } from 'playwright-core';
import { logout } from '../lib/harness.js';
import { teleTo } from '../tutorial/harness.js';
import './trace.js';

export function isConfirmedLogout(state: { ingame: boolean; loginUser: string; loginscreen: number } = globalThis.rs2b0t.client): boolean {
    return !state.ingame && state.loginUser === '' && state.loginscreen === 0;
}

type LogoutActions = {
    readonly inCombat: () => Promise<boolean>;
    readonly leaveCombat: () => Promise<void>;
    readonly logout: () => Promise<boolean>;
};

export async function logoutAfterCombat(actions: LogoutActions): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
        if (await actions.inCombat()) await actions.leaveCombat();
        if (await actions.logout()) return true;
    }
    return false;
}

export async function cleanLogout(page: Page) {
    let escaped = false;
    let attempts = 0;
    const loggedOut = await logoutAfterCombat({
        inCombat: () => page.evaluate(() => globalThis.rs2b0t?.client.ingame && globalThis.rs2b0t.reader.inCombat()),
        leaveCombat: async () => {
            assert(await teleTo(page, { x: 3222, z: 3218, level: 0 }, 3, 15000), 'cleanup combat escape failed');
            escaped = true;
        },
        logout: async () => {
            attempts++;
            const ingame = await page.evaluate(() => globalThis.rs2b0t?.client.ingame ?? false);
            if (ingame) await logout(page, 8000);
            try {
                await page.waitForFunction(isConfirmedLogout, undefined, { timeout: 8000 });
                return true;
            } catch (error) {
                if (error instanceof errors.TimeoutError) return false;
                throw error;
            }
        }
    });
    const chat = await page.evaluate(() => globalThis.rs2b0t?.reader.chat(8) ?? []);
    console.log('account cleanup', { loggedOut, escaped, attempts });
    const loginState = await page.evaluate(() => ({ ingame: globalThis.rs2b0t.client.ingame,
        loginUser: globalThis.rs2b0t.client.loginUser, loginscreen: globalThis.rs2b0t.client.loginscreen }));
    return { loggedOut, escaped, attempts, chat, loginState };
}
