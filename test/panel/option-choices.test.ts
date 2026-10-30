import { afterEach, expect, test } from 'bun:test';
import { renderControl, summarize } from '#/bot/panel/paramControls.js';
import { SettingsStore, type SettingDef } from '#/bot/runtime/Settings.js';

const setting: SettingDef = {
    type: 'string[]',
    default: [],
    options: ['cook', 'sheep'],
    optionLabels: { cook: "Cook's Assistant", sheep: 'Sheep Shearer' },
    selectionMode: 'includeExclude'
};

afterEach(() => {
    document.body.replaceChildren();
    sessionStorage.clear();
    localStorage.clear();
});

function button(host: HTMLElement, label: string): HTMLButtonElement {
    const result = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(result).not.toBeNull();
    return result!;
}

test('legacy empty selects all, and minus persists an explicit skip through reload', () => {
    let saved = '';
    const host = renderControl(setting, '', raw => {
        saved = raw;
        SettingsStore.save('Choices', 'quests', raw);
    }, { disabled: false });
    document.body.appendChild(host);
    expect(button(host, "Do Cook's Assistant").getAttribute('aria-pressed')).toBe('true');
    button(host, "Skip Cook's Assistant").click();
    expect(saved).toBe('-cook, +sheep');
    sessionStorage.clear();
    const reloaded = SettingsStore.resolve('Choices', { quests: setting }).quests;
    expect(reloaded).toEqual(['-cook', '+sheep']);
    const restored = renderControl(setting, SettingsStore.displayString('Choices', 'quests', setting), () => {}, { disabled: false });
    expect(button(restored, "Skip Cook's Assistant").getAttribute('aria-pressed')).toBe('true');
    expect(button(restored, 'Do Sheep Shearer').getAttribute('aria-pressed')).toBe('true');
});

test('legacy positive lists preserve skipped choices and allow selecting them', () => {
    let saved = '';
    const host = renderControl(setting, 'cook', raw => saved = raw, { disabled: false });
    expect(button(host, 'Skip Sheep Shearer').getAttribute('aria-pressed')).toBe('true');
    button(host, 'Do Sheep Shearer').click();
    expect(saved).toBe('+cook, +sheep');
});

test('all and skip-all persist explicit choices without a fallback to all', () => {
    let saved = '';
    const host = renderControl(setting, '', raw => saved = raw, { disabled: false });
    button(host, 'Skip all').click();
    expect(saved).toBe('-cook, -sheep');
    expect(summarize(setting, saved)).toBe('0 do, 2 skip');
    button(host, 'Do all').click();
    expect(saved).toBe('+cook, +sheep');
    expect(summarize(setting, '')).toBe('2 do, 0 skip');
});

test('signed settings validate IDs, normalize case and keep unknown-only choices empty', () => {
    SettingsStore.save('Choices', 'quests', '+COOK, -sheep, +missing');
    expect(SettingsStore.resolve('Choices', { quests: setting }).quests).toEqual(['+cook', '-sheep']);
    SettingsStore.save('Choices', 'quests', '-removed');
    expect(SettingsStore.resolve('Choices', { quests: setting }).quests).toEqual(['-cook', '-sheep']);
});

test('completion updates independently of choices and leaves unknown rows unmarked', () => {
    let statuses: Record<string, 'complete' | 'incomplete' | 'unknown'> = { cook: 'complete', sheep: 'unknown' };
    const refreshers: Array<() => void> = [];
    const host = renderControl({ ...setting, optionStatuses: () => statuses }, '-cook, +sheep', () => {}, {
        disabled: false,
        registerRefresh: refresh => refreshers.push(refresh)
    });
    const rows = host.querySelectorAll('.rs2b0t-param-choice');
    expect(rows[0].classList.contains('is-complete')).toBe(true);
    expect(rows[0].textContent).toContain('✓ Complete');
    expect(rows[1].classList.contains('is-complete')).toBe(false);
    expect(rows[1].textContent).toContain('Status unknown');
    expect(button(host, "Skip Cook's Assistant").getAttribute('aria-pressed')).toBe('true');
    statuses = { cook: 'unknown', sheep: 'complete' };
    refreshers.forEach(refresh => refresh());
    expect(rows[0].classList.contains('is-complete')).toBe(false);
    expect(rows[1].classList.contains('is-complete')).toBe(true);
    expect(button(host, 'Do Sheep Shearer').getAttribute('aria-pressed')).toBe('true');
});

test('a running script disables every choice and bulk button', () => {
    let saves = 0;
    const host = renderControl(setting, '', () => saves++, { disabled: true });
    const buttons = Array.from(host.querySelectorAll('button'));
    expect(buttons.length).toBe(6);
    buttons.forEach(control => {
        expect(control.type).toBe('button');
        expect(control.disabled).toBe(true);
        control.click();
    });
    expect(saves).toBe(0);
});
