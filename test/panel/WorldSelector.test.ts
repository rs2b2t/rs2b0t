import { expect, test } from 'bun:test';
import { worldSelector } from '#/bot/panel/WorldSelector.js';

test('world switch waits for clean logout and keeps the whole wall in wall mode', () => {
    let ready = false;
    let preparations = 0;
    const navigations: string[] = [];
    const root = worldSelector({
        mode: 'wall',
        location: new URL('https://w1.rs2b2t.com/rs2b0t/wall?lowmem=0&autologin=1'),
        prepare: () => { preparations++; return ready; },
        cancel: () => {},
        navigate: url => navigations.push(url)
    });
    expect(root.textContent).toContain('World 1');
    const select = root.querySelector('select')!;
    select.value = '2';
    root.querySelector('button')!.click();
    expect(navigations).toEqual([]);
    expect(preparations).toBe(1);
    expect(root.textContent).toContain('Log out');
    ready = true;
    root.querySelector('button')!.click();
    expect(navigations).toEqual(['https://w2.rs2b2t.com/rs2b0t/wall?lowmem=0']);
});

test('a single client selector stays in single mode and never navigates to an unlisted world', () => {
    const navigations: string[] = [];
    const root = worldSelector({ mode: 'single', location: new URL('https://w2.rs2b2t.com/rs2b0t/'), prepare: () => true, cancel: () => {}, navigate: url => navigations.push(url) });
    const select = root.querySelector('select')!;
    select.value = '1';
    root.querySelector('button')!.click();
    expect(navigations).toEqual(['https://w1.rs2b2t.com/rs2b0t/']);
    select.value = '999';
    root.querySelector('button')!.click();
    expect(navigations).toHaveLength(1);
});


test('an explicit Cancel restores the current world without reloading or navigating', () => {
    let cancelled = 0;
    const navigations: string[] = [];
    const root = worldSelector({ mode: 'wall', location: new URL('https://w1.rs2b2t.com/rs2b0t/wall'), prepare: () => false, cancel: () => { cancelled++; }, navigate: url => navigations.push(url) });
    root.querySelector('select')!.value = '2';
    root.querySelector('button')!.click();
    const cancel = Array.from(root.querySelectorAll('button')).find(button => button.textContent === 'Cancel')!;
    expect(cancel.hidden).toBe(false);
    cancel.click();
    expect(cancelled).toBe(1);
    expect(cancel.hidden).toBe(true);
    expect(root.querySelector('select')!.value).toBe('1');
    expect(navigations).toEqual([]);
});
