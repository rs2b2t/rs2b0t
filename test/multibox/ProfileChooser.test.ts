import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ProfileChooser } from '#/bot/multibox/ProfileChooser.js';
import { vault, type Profile } from '#/bot/multibox/ProfileVault.js';

const clearAll = () => {
    sessionStorage.clear();
    localStorage.clear();
    document.body.innerHTML = '';
};
beforeEach(async () => {
    clearAll();
    vault.reset();
    await vault.setup('pw');
});
afterEach(() => {
    vault.reset();
    clearAll();
});

function make(): { chooser: ProfileChooser; loaded: Profile[] } {
    const loaded: Profile[] = [];
    const chooser = new ProfileChooser(p => loaded.push(p));
    document.body.appendChild(chooser.el);
    return { chooser, loaded };
}

describe('ProfileChooser', () => {
    test('starts hidden; open lists saved profiles', async () => {
        await vault.upsert({ username: 'alice', password: 'a' });
        await vault.upsert({ username: 'bob', password: 'b' });
        const { chooser } = make();
        expect(chooser.el.hidden).toBe(true);
        chooser.open();
        expect(chooser.el.hidden).toBe(false);
        const names = Array.from(chooser.el.querySelectorAll('.mbx-profile-name')).map(n => n.textContent);
        expect(names).toEqual(['alice', 'bob']);
    });

    test('lists profiles in the order saved from the bot rail', async () => {
        await vault.upsert({ username: 'alice', password: 'a' });
        await vault.upsert({ username: 'bob', password: 'b' });
        await vault.upsert({ username: 'carol', password: 'c' });
        await vault.reorder(['carol', 'alice', 'bob']);
        const { chooser } = make();

        chooser.open();
        const names = Array.from(chooser.el.querySelectorAll('.mbx-profile-name')).map(n => n.textContent);
        expect(names).toEqual(['carol', 'alice', 'bob']);
    });

    test('clicking a row loads that profile and closes', async () => {
        await vault.upsert({ username: 'alice', password: 'a' });
        const { chooser, loaded } = make();
        chooser.open();
        (chooser.el.querySelector('.mbx-profile-row') as HTMLElement).click();
        expect(loaded).toEqual([{ username: 'alice', password: 'a', tab: 'Main' }]);
        expect(chooser.el.hidden).toBe(true);
    });

    test('the delete button removes the profile without loading it', async () => {
        await vault.upsert({ username: 'alice', password: 'a' });
        const { chooser, loaded } = make();
        chooser.open();
        (chooser.el.querySelector('.mbx-profile-del') as HTMLElement).click();
        expect(vault.list()).toEqual([]);
        expect(loaded).toEqual([]);
        expect(chooser.el.hidden).toBe(false);
        expect(chooser.el.querySelector('.mbx-chooser-empty')).not.toBeNull();
    });

    test('create-new trims, saves and loads the profile', async () => {
        const { chooser, loaded } = make();
        chooser.open();
        (chooser.el.querySelector('#mbx-new-user') as HTMLInputElement).value = ' carol ';
        (chooser.el.querySelector('#mbx-new-pass') as HTMLInputElement).value = 'pw';
        (chooser.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
        expect(vault.list()).toEqual([{ username: 'carol', password: 'pw', tab: 'Main' }]);
        // a fresh create carries no tab: the wall files it into the active tab
        expect(loaded).toEqual([{ username: 'carol', password: 'pw' }]);
        expect(chooser.el.hidden).toBe(true);
    });

    test('load all loads every profile and closes', async () => {
        await vault.upsert({ username: 'alice', password: 'a' });
        await vault.upsert({ username: 'bob', password: 'b' });
        const { chooser, loaded } = make();
        chooser.open();
        (chooser.el.querySelector('#mbx-load-all') as HTMLElement).click();
        expect(loaded).toEqual([
            { username: 'alice', password: 'a', tab: 'Main' },
            { username: 'bob', password: 'b', tab: 'Main' }
        ]);
        expect(chooser.el.hidden).toBe(true);
    });

    test('load all is absent when no profiles are saved', async () => {
        const { chooser } = make();
        chooser.open();
        expect(chooser.el.querySelector('#mbx-load-all')).toBeNull();
    });

    test('create-new with an empty username does nothing', async () => {
        const { chooser, loaded } = make();
        chooser.open();
        (chooser.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
        expect(loaded).toEqual([]);
        expect(chooser.el.hidden).toBe(false);
    });
});
