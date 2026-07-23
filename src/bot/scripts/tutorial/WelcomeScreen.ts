import type { Task } from '../../api/Bot.js';
import { actions, reader, WELCOME_SCREEN } from '../../adapter/ClientAdapter.js';

export class WelcomeScreen implements Task {
    validate(): boolean {
        return reader.modals().main === WELCOME_SCREEN;
    }

    async execute(): Promise<void> {
        const btn = reader.buttonByText(WELCOME_SCREEN, 'Click here to play');
        if (btn !== -1) {
            actions.ifButton(btn);
        }
    }
}
