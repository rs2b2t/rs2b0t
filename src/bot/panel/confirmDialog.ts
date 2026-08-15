/**
 * In-app confirm dialog (replaces window.confirm for bot UI).
 * Optional “don’t ask again” checkbox above Yes / No.
 */
import { el } from './dom.js';

type ConfirmDialogOptions = {
    title: string;
    body: string;
    /** Checkbox label; omit for no checkbox. */
    dontAskAgainLabel?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    zIndex?: number;
};

type ConfirmDialogResult = {
    confirmed: boolean;
    dontAskAgain: boolean;
};

/**
 * Show a modal confirm. Resolves when the user chooses Yes or No
 * (or Escape / backdrop click → No).
 */
export function showConfirmDialog(opts: ConfirmDialogOptions): Promise<ConfirmDialogResult> {
    const confirmLabel = opts.confirmLabel ?? 'Yes';
    const cancelLabel = opts.cancelLabel ?? 'No';
    const zIndex = opts.zIndex ?? 1300;

    return new Promise(resolve => {
        const backdrop = el('div', 'rs2b0t-modal-backdrop rs2b0t-confirm-backdrop');
        Object.assign(backdrop.style, {
            display: 'flex',
            zIndex: String(zIndex)
        });

        const modal = el('div', 'rs2b0t-modal rs2b0t-confirm-modal');
        Object.assign(modal.style, {
            width: 'min(420px, 90vw)',
            maxHeight: 'none'
        });

        const header = el('div', 'rs2b0t-modal-header');
        const titleEl = el('div', 'rs2b0t-modal-title');
        titleEl.textContent = opts.title;
        header.appendChild(titleEl);
        modal.appendChild(header);

        const body = el('div', 'rs2b0t-confirm-body');
        Object.assign(body.style, {
            color: '#ccc',
            fontSize: '13px',
            lineHeight: '1.45',
            margin: '4px 0 12px',
            whiteSpace: 'pre-wrap'
        });
        body.textContent = opts.body;
        modal.appendChild(body);

        let dontAsk: HTMLInputElement | null = null;
        if (opts.dontAskAgainLabel) {
            const row = el('label', 'rs2b0t-confirm-dont-ask');
            Object.assign(row.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: '#bbb',
                fontSize: '12px',
                marginBottom: '14px',
                cursor: 'pointer',
                userSelect: 'none'
            });
            dontAsk = document.createElement('input');
            dontAsk.type = 'checkbox';
            dontAsk.className = 'rs2b0t-confirm-dont-ask-check';
            row.appendChild(dontAsk);
            row.appendChild(document.createTextNode(opts.dontAskAgainLabel));
            modal.appendChild(row);
        }

        const actions = el('div', 'rs2b0t-confirm-actions');
        Object.assign(actions.style, {
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px'
        });

        const noBtn = document.createElement('button');
        noBtn.type = 'button';
        noBtn.className = 'rs2b0t-button rs2b0t-confirm-no';
        noBtn.textContent = cancelLabel;

        const yesBtn = document.createElement('button');
        yesBtn.type = 'button';
        yesBtn.className = 'rs2b0t-button rs2b0t-confirm-yes';
        yesBtn.textContent = confirmLabel;
        Object.assign(yesBtn.style, {
            borderColor: '#a65c00',
            color: '#ffb74d'
        });

        actions.appendChild(noBtn);
        actions.appendChild(yesBtn);
        modal.appendChild(actions);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        let settled = false;
        const finish = (confirmed: boolean): void => {
            if (settled) {
                return;
            }
            settled = true;
            window.removeEventListener('keydown', onKey, true);
            backdrop.remove();
            resolve({
                confirmed,
                dontAskAgain: Boolean(dontAsk?.checked)
            });
        };

        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                finish(false);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                finish(true);
            }
        };
        // Capture so map-picker Escape does not also close the picker first.
        window.addEventListener('keydown', onKey, true);

        backdrop.addEventListener('click', e => {
            if (e.target === backdrop) {
                finish(false);
            }
        });
        noBtn.addEventListener('click', () => finish(false));
        yesBtn.addEventListener('click', () => finish(true));
        yesBtn.focus();
    });
}
