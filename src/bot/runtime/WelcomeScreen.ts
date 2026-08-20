import { actions, reader, WELCOME_SCREEN } from '../adapter/ClientAdapter.js';
import { BotHost } from './BotHost.js';

/** Why: LAST_LOGIN_INFO opens 5993 after login; a one-shot local hide leaves it up when the first close misses. */
export function welcomeNeedsDismiss(ingame: boolean, mainModal: number): boolean {
    return ingame && mainModal === WELCOME_SCREEN;
}

/**
 * Dismiss the post-login welcome modal while it is the open main modal.
 * Why: `closeMainModal` only clears local `mainModalId`. Close Window is a CLOSE_BUTTON click.
 */
class WelcomeDismisserImpl {
    private enabled = false;

    enable(): void {
        if (this.enabled) {
            return;
        }

        this.enabled = true;
        BotHost.addFrameListener(() => this.onFrame());
    }

    private onFrame(): void {
        if (!welcomeNeedsDismiss(reader.ingame(), reader.modals().main)) {
            return;
        }
        actions.closeModal();
    }
}

export const WelcomeDismisser = new WelcomeDismisserImpl();
