import { actions, reader, WELCOME_SCREEN } from '../adapter/ClientAdapter.js';
import { BotHost } from '../BotHost.js';

/**
 * Dismiss the post-login welcome modal once it appears.
 *
 * Previously called `closeMainModal(WELCOME_SCREEN)` on **every** client frame
 * while ingame — even long after the screen was gone. That is pure wasted work
 * on multi-bot walls (N iframes × 20–50 Hz).
 */
class WelcomeDismisserImpl {
    private enabled = false;
    /** True after we have seen and dismissed the welcome once this login. */
    private dismissedThisSession = false;

    enable(): void {
        if (this.enabled) {
            return;
        }

        this.enabled = true;
        BotHost.addFrameListener(() => this.onFrame());
    }

    private onFrame(): void {
        if (!reader.ingame()) {
            // Logout / title — allow a future login's welcome to be dismissed again.
            this.dismissedThisSession = false;
            return;
        }
        if (this.dismissedThisSession) {
            return;
        }
        if (reader.modals().main !== WELCOME_SCREEN) {
            return;
        }
        actions.closeMainModal(WELCOME_SCREEN);
        this.dismissedThisSession = true;
    }
}

export const WelcomeDismisser = new WelcomeDismisserImpl();
