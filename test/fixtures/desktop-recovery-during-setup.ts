import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { sharedStorage } = createRequire(import.meta.url)('../../desktop/shared-storage.cjs');
const [directory, accounts] = process.argv.slice(2);
const store = sharedStorage(directory);
Object.defineProperty(globalThis, 'localStorage', { value: store });
Object.defineProperty(globalThis, 'rs2b0tDesktopStorage', { value: store });
const { ProfileVault } = await import('#/bot/multibox/ProfileVault.js');

const vault = new ProfileVault();
const setup = vault.setup('fixture');
store.seed({ 'rs2b0t:multibox:accounts': accounts }, { recover: true });
try {
    await setup;
} catch (error) {
    assert.match(String(error), /Saved accounts changed/);
    await vault.setup('fixture');
}
