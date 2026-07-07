import type { Task } from '../../api/Bot.js';
import { actions, reader, WELCOME_SCREEN } from '../../adapter/ClientAdapter.js';

/**
 * Dismiss the rs2b2t login `welcome_screen` (main modal id `WELCOME_SCREEN`,
 * 5993 — exported from ClientAdapter, reused here rather than re-hardcoded)
 * by clicking its own "Click here to play" button, found at runtime by
 * caption like `DesignAccept`'s Accept button. NEVER appears on stock dev
 * content — a structural no-op on this task's engine; the real click path is
 * verified against a prod canary later. Validates strictly on
 * `modals().main === WELCOME_SCREEN`, so it can't misfire on dev's
 * `player_kit` design modal (3559) or any other screen.
 *
 * Belt-and-suspenders alongside the existing global `WelcomeDismisser`
 * (`src/bot/runtime/WelcomeScreen.ts`, enabled for every script in
 * `main.ts`): that one force-closes the same modal client-side
 * (`actions.closeMainModal`) on every frame and will usually win the race on
 * prod, but this task-level version drives a real button click (an actual
 * `IF_BUTTON` dispatch, not just a local `mainModalId` reset), so it still
 * has a genuine effect on the rare frame it gets there first.
 */
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
