import { beforeEach, describe, expect, test } from 'bun:test';
import { showConfirmDialog } from '#/bot/panel/confirmDialog.js';

beforeEach(() => {
    document.body.replaceChildren();
});

describe('showConfirmDialog', () => {
    test('Yes resolves confirmed with checkbox state', async () => {
        const p = showConfirmDialog({
            title: 'Rebuild basemap?',
            body: 'Tab may freeze.',
            dontAskAgainLabel: "Don't ask again",
            confirmLabel: 'Yes, rebuild',
            cancelLabel: 'No'
        });
        const backdrop = document.querySelector('.rs2b0t-confirm-backdrop');
        expect(backdrop).not.toBeNull();
        expect(document.querySelector('.rs2b0t-modal-title')?.textContent).toBe('Rebuild basemap?');

        const check = document.querySelector('.rs2b0t-confirm-dont-ask-check') as HTMLInputElement;
        expect(check).not.toBeNull();
        check.checked = true;

        (document.querySelector('.rs2b0t-confirm-yes') as HTMLButtonElement).click();
        const result = await p;
        expect(result).toEqual({ confirmed: true, dontAskAgain: true });
        expect(document.querySelector('.rs2b0t-confirm-backdrop')).toBeNull();
    });

    test('No resolves unconfirmed without dontAskAgain', async () => {
        const p = showConfirmDialog({
            title: 't',
            body: 'b',
            dontAskAgainLabel: "Don't ask again"
        });
        (document.querySelector('.rs2b0t-confirm-no') as HTMLButtonElement).click();
        await expect(p).resolves.toEqual({ confirmed: false, dontAskAgain: false });
    });

    test('Escape is No and stops bubbling to outer handlers', async () => {
        let outerEscapes = 0;
        const onOuter = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                outerEscapes += 1;
            }
        };
        window.addEventListener('keydown', onOuter);

        const p = showConfirmDialog({ title: 't', body: 'b', dontAskAgainLabel: 'skip' });
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await expect(p).resolves.toEqual({ confirmed: false, dontAskAgain: false });

        // Capture handler on the dialog should prevent the outer bubble listener.
        expect(outerEscapes).toBe(0);
        window.removeEventListener('keydown', onOuter);
    });

    test('omitting dontAskAgainLabel hides the checkbox', async () => {
        const p = showConfirmDialog({ title: 't', body: 'b' });
        expect(document.querySelector('.rs2b0t-confirm-dont-ask')).toBeNull();
        (document.querySelector('.rs2b0t-confirm-yes') as HTMLButtonElement).click();
        await p;
    });
});
