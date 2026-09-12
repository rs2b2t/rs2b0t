import { actions, reader, WELCOME_SCREEN } from '../adapter/ClientAdapter.js';
import { BotHost } from './BotHost.js';

/** LAST_LOGIN_INFO retry count; the modal can arrive after the first close. */
export function welcomeNeedsDismiss(ingame: boolean, mainModal: number): boolean {
    return ingame && mainModal === WELCOME_SCREEN;
}

/** Dismiss the post-login modal with its CLOSE_BUTTON rather than clearing local state. */
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
