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

function make(options: ConstructorParameters<typeof ProfileChooser>[1] = { defaultWorld: 1 }): { chooser: ProfileChooser; loaded: Profile[] } {
    const loaded: Profile[] = [];
    const chooser = new ProfileChooser(p => loaded.push(p), { worldRouting: true, ...options });
    document.body.appendChild(chooser.el);
    return { chooser, loaded };
}

async function waitFor(done: () => boolean): Promise<void> {
    for (let i = 0; i < 100; i++) {
        if (done()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('chooser did not finish');
}

function changeWorld(chooser: ProfileChooser, world: number): HTMLSelectElement {
    const select = chooser.el.querySelector('.mbx-profile-world') as HTMLSelectElement;
    select.value = String(world);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select;
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
        expect(loaded).toEqual([{ username: 'alice', password: 'a', tab: 'Main', world: 1 }]);
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
        await waitFor(() => loaded.length > 0);
        expect(vault.list()).toEqual([{ username: 'carol', password: 'pw', tab: 'Main', world: 1 }]);
        // a fresh create carries no tab: the wall files it into the active tab
        expect(loaded).toEqual([{ username: 'carol', password: 'pw', world: 1 }]);
        expect(chooser.el.hidden).toBe(true);
    });

    test('load all loads every profile and closes', async () => {
        await vault.upsert({ username: 'alice', password: 'a' });
        await vault.upsert({ username: 'bob', password: 'b' });
        const { chooser, loaded } = make();
        chooser.open();
        (chooser.el.querySelector('#mbx-load-all') as HTMLElement).click();
        expect(loaded).toEqual([
            { username: 'alice', password: 'a', tab: 'Main', world: 1 },
            { username: 'bob', password: 'b', tab: 'Main', world: 1 }
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

    test('Escape closes the chooser and consumes the key only while open', () => {
        const { chooser } = make();
        chooser.open();
        const input = chooser.el.querySelector('#mbx-new-user') as HTMLInputElement;
        expect(document.activeElement).toBe(input);

        const close = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        expect(input.dispatchEvent(close)).toBe(false);
        expect(chooser.el.hidden).toBe(true);

        const alreadyClosed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        expect(input.dispatchEvent(alreadyClosed)).toBe(true);
    });

    test('a detached chooser neither consumes Escape nor closes', () => {
        const { chooser } = make();
        chooser.open();
        const input = chooser.el.querySelector('#mbx-new-user') as HTMLInputElement;
        chooser.el.remove();

        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        expect(input.dispatchEvent(escape)).toBe(true);
        expect(chooser.el.hidden).toBe(false);
    });

    test('load all uses each saved world and the wall default for legacy profiles', async () => {
        await vault.upsert({ username: 'alice', password: 'a', world: 1 });
        await vault.upsert({ username: 'bob', password: 'b', world: 2 });
        await vault.upsert({ username: 'legacy', password: 'c' });
        const { chooser, loaded } = make({ defaultWorld: 2 });
        chooser.open();
        expect(Array.from(chooser.el.querySelectorAll<HTMLSelectElement>('.mbx-profile-world')).map(el => el.value)).toEqual(['1', '2', '2']);
        (chooser.el.querySelector('#mbx-load-all') as HTMLElement).click();
        expect(loaded.map(p => p.world)).toEqual([1, 2, 2]);
        expect(vault.list()[2].world).toBeUndefined();
    });

    test('saved assignment controls require the wall callback and never load on click', async () => {
        await vault.upsert({ username: 'alice', password: 'a', world: 1 });
        const { chooser, loaded } = make();
        chooser.open();
        const select = chooser.el.querySelector('.mbx-profile-world') as HTMLSelectElement;
        expect(select.disabled).toBe(true);
        select.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        changeWorld(chooser, 2);
        expect(loaded).toEqual([]);
        expect(vault.list()[0].world).toBe(1);
    });

    test('pending switches block loads and manual-logout refusals can be retried', async () => {
        await vault.upsert({ username: 'alice', password: 'a', world: 1 });
        let finish!: (ok: boolean) => void;
        let calls = 0;
        const { chooser, loaded } = make({ defaultWorld: 1, onWorldChange: async (p, world) => {
            expect(p.username).toBe('alice');
            expect(world).toBe(2);
            calls++;
            if (calls === 1) return new Promise<boolean>(resolve => { finish = resolve; });
            await vault.setWorld(p.username, world);
            return true;
        } });
        chooser.open();
        const select = changeWorld(chooser, 2);
        expect(select.disabled).toBe(true);
        expect(chooser.el.textContent).toContain('Switching');
        (chooser.el.querySelector('.mbx-profile-row') as HTMLElement).click();
        (chooser.el.querySelector('#mbx-load-all') as HTMLElement).click();
        (chooser.el.querySelector('#mbx-new-user') as HTMLInputElement).value = 'bob';
        (chooser.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
        expect(loaded).toEqual([]);
        expect(vault.list().map(p => p.username)).toEqual(['alice']);
        finish(false);
        await waitFor(() => !chooser.el.querySelector<HTMLSelectElement>('.mbx-profile-world')!.disabled);
        expect(chooser.el.textContent).toContain('Log out in-game, then choose the world again');
        expect(chooser.el.querySelector<HTMLSelectElement>('.mbx-profile-world')!.value).toBe('1');
        expect(vault.list()[0].world).toBe(1);

        changeWorld(chooser, 2);
        await waitFor(() => !chooser.el.querySelector<HTMLSelectElement>('.mbx-profile-world')!.disabled);
        expect(vault.list()[0].world).toBe(2);
        (chooser.el.querySelector('.mbx-profile-row') as HTMLElement).click();
        expect(loaded[0].world).toBe(2);
    });

    test('a failed switch restores its displayed choice and reports the error', async () => {
        await vault.upsert({ username: 'alice', password: 'a', world: 1 });
        const { chooser } = make({ defaultWorld: 1, onWorldChange: async () => { throw new Error('storage full'); } });
        chooser.open();
        changeWorld(chooser, 2);
        await waitFor(() => !chooser.el.querySelector<HTMLSelectElement>('.mbx-profile-world')!.disabled);
        expect(chooser.el.textContent).toContain('storage full');
        expect(chooser.el.querySelector<HTMLSelectElement>('.mbx-profile-world')!.value).toBe('1');
    });

    test('new profiles default to the wall world and can explicitly choose the other world', async () => {
        const { chooser, loaded } = make({ defaultWorld: 2 });
        chooser.open();
        const select = chooser.el.querySelector('#mbx-new-world') as HTMLSelectElement;
        expect(select.value).toBe('2');
        select.value = '1';
        (chooser.el.querySelector('#mbx-new-user') as HTMLInputElement).value = 'alice';
        (chooser.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
        expect(loaded).toEqual([]);
        await waitFor(() => loaded.length > 0);
        expect(loaded[0].world).toBe(1);
        expect(vault.list()[0].world).toBe(1);
    });

    test('re-saving an existing password cannot change its selected world', async () => {
        await vault.upsert({ username: 'alice', password: 'old', world: 1 });
        const { chooser, loaded } = make({ defaultWorld: 2 });
        chooser.open();
        (chooser.el.querySelector('#mbx-new-user') as HTMLInputElement).value = 'alice';
        (chooser.el.querySelector('#mbx-new-pass') as HTMLInputElement).value = 'new';
        (chooser.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
        await waitFor(() => loaded.length > 0);
        expect(loaded[0]).toEqual({ username: 'alice', password: 'new', tab: 'Main', world: 1 });
        expect(vault.list()[0].world).toBe(1);
    });

    test('failed encrypted creation keeps the form open and does not expose an unsaved profile', async () => {
        const { chooser, loaded } = make({ defaultWorld: 2 });
        chooser.open();
        const user = chooser.el.querySelector('#mbx-new-user') as HTMLInputElement;
        user.value = 'alice';
        const write = localStorage.setItem;
        Object.defineProperty(localStorage, 'setItem', { configurable: true, value: () => { throw new Error('storage full'); } });
        try {
            (chooser.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
            await waitFor(() => chooser.el.textContent!.includes('storage full'));
            expect(loaded).toEqual([]);
            expect(chooser.el.hidden).toBe(false);
            expect(user.value).toBe('alice');
            expect(vault.list()).toEqual([]);
        } finally {
            Object.defineProperty(localStorage, 'setItem', { configurable: true, value: write });
        }
    });
});


test('local chooser hides assignments and preserves saved worlds for later live use', async () => {
    await vault.upsert({ username: 'alice', password: 'a', world: 2 });
    await vault.upsert({ username: 'legacy', password: 'b' });
    let changes = 0;
    const { chooser, loaded } = make({ worldRouting: false, onWorldChange: async () => { changes++; return true; } });
    chooser.open();
    expect(chooser.el.querySelector('select')).toBeNull();
    (chooser.el.querySelector('#mbx-load-all') as HTMLElement).click();
    expect(loaded.map(p => p.world)).toEqual([2, undefined]);
    expect(vault.list().map(p => p.world)).toEqual([2, undefined]);
    expect(changes).toBe(0);
});

test('local profile creation does not assign a public world or overwrite an existing assignment', async () => {
    await vault.upsert({ username: 'alice', password: 'a', world: 2 });
    const { chooser, loaded } = make({ worldRouting: false });
    for (const username of ['alice', 'newlocal']) {
        chooser.open();
        (chooser.el.querySelector('#mbx-new-user') as HTMLInputElement).value = username;
        (chooser.el.querySelector('#mbx-new-pass') as HTMLInputElement).value = 'changed';
        (chooser.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
        await waitFor(() => loaded.some(p => p.username === username));
    }
    expect(vault.list().map(p => [p.username, p.password, p.world])).toEqual([['alice', 'changed', 2], ['newlocal', 'changed', undefined]]);
    expect(loaded.map(p => p.world)).toEqual([2, undefined]);
});
