import { actions, reader, WELCOME_SCREEN } from '../adapter/ClientAdapter.js';
import { BotHost } from '../BotHost.js';

/**
 * Auto-dismiss rs2b2t's login `welcome_screen`. It's a main modal opened
 * purely client-side on every login (and relogin) — a "message of the day" /
 * "you have unread messages" panel — that blocks ALL 3D-scene interaction:
 * render-picking sees only the modal, so the minimenu never offers game
 * options and every bot freezes at spawn on the live server. It never appears
 * on a stock dev engine, which is why bots run there but not on rs2b2t.
 *
 * Runs each frame while ingame and closes the modal client-side (safe — see
 * ClientAdapter.closeMainModal). One comparison per frame; a no-op whenever the
 * welcome screen isn't the open main modal.
 */
class WelcomeDismisserImpl {
    private enabled = false;

    enable(): void {
        if (this.enabled) {
            return;
        }

        this.enabled = true;
        BotHost.addFrameListener(() => {
            if (reader.ingame()) {
                actions.closeMainModal(WELCOME_SCREEN);
            }
        });
    }
}

export const WelcomeDismisser = new WelcomeDismisserImpl();
