import { actions, reader, WELCOME_SCREEN } from '../adapter/ClientAdapter.js';
import { BotHost } from '../BotHost.js';

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
