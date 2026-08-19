import { afterEach, describe, expect, test } from 'bun:test';

import { serializeProfileFile, type ProfileSnapshot } from '#/bot/multibox/ProfileTransfer.js';
import { SettingsPanel } from '#/bot/multibox/SettingsPanel.js';

const snap: ProfileSnapshot = {
    profiles: [{ username: 'alice', password: 'secret', tab: 'miners' }],
    tabs: ['miners'],
    activeTab: 'miners',
    storage: { alice: { selectedScript: 'Miner', 'set:Miner:rock': 'iron' } }
};

const empty: ProfileSnapshot = { profiles: [], tabs: [], activeTab: 'Main', storage: {} };

afterEach(() => {
    document.body.innerHTML = '';
});

describe('SettingsPanel', () => {
    test('the settings button sits under turn-all-renderers-on', async () => {
        const html = await Bun.file('public-bot/multibox.html').text();
        const off = html.indexOf('id="mbx-renderers-off"');
        const on = html.indexOf('id="mbx-renderers-on"');
        const settings = html.indexOf('id="mbx-settings"');
        expect(off).toBeGreaterThan(0);
        expect(on).toBeGreaterThan(off);
        expect(settings).toBeGreaterThan(on);
        expect(html).toContain('>settings<');
        expect(html).toContain('turn all renderers off');
    });

    test('export writes the unlocked snapshot and import replaces it', async () => {
        let current = structuredClone(snap);
        const downloads: Array<{ name: string; text: string }> = [];
        const panel = new SettingsPanel({
            ensureUnlocked: async () => true,
            snapshot: () => current,
            replaceAll: async data => {
                current = data;
            },
            download: (name, text) => downloads.push({ name, text })
        });
        document.body.appendChild(panel.el);

        expect(panel.el.hidden).toBe(true);
        panel.open();
        expect(panel.el.hidden).toBe(false);
        expect(panel.el.querySelector('#mbx-export-profile')?.textContent).toBe('export profile');
        expect(panel.el.querySelector('#mbx-import-profile')?.textContent).toBe('import profile');

        await panel.exportProfile();
        expect(downloads).toHaveLength(1);
        expect(downloads[0].name).toBe('rs2b0t-profiles.json');
        expect(parseable(downloads[0].text).profiles[0].username).toBe('alice');
        expect(parseable(downloads[0].text).storage.alice.selectedScript).toBe('Miner');

        await panel.importText(serializeProfileFile(empty));
        expect(current).toEqual(empty);
        expect(panel.el.hidden).toBe(true);
    });

    test('a bad import stays open and shows the error', async () => {
        const panel = new SettingsPanel({
            ensureUnlocked: async () => true,
            snapshot: () => empty,
            replaceAll: async () => {
                throw new Error('should not replace');
            }
        });
        document.body.appendChild(panel.el);
        panel.open();
        await panel.importText('{');
        expect(panel.el.hidden).toBe(false);
        expect(document.getElementById('mbx-settings-error')?.textContent).toMatch(/not JSON/);
    });

    test('cancelling unlock does not export or import', async () => {
        const downloads: string[] = [];
        let replaced = false;
        const panel = new SettingsPanel({
            ensureUnlocked: async () => false,
            snapshot: () => empty,
            replaceAll: async () => {
                replaced = true;
            },
            download: name => downloads.push(name)
        });
        await panel.exportProfile();
        await panel.importText(serializeProfileFile(snap));
        expect(downloads).toEqual([]);
        expect(replaced).toBe(false);
    });
});

function parseable(text: string): ProfileSnapshot {
    return JSON.parse(text) as ProfileSnapshot;
}
