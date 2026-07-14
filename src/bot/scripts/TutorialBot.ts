import { TaskBot } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { AdvanceDialog } from './tutorial/Dialog.js';
import { DesignAccept } from './tutorial/DesignAccept.js';
import { bankChapelStages } from './tutorial/stages/BankChapel.js';
import { chefStages } from './tutorial/stages/Chef.js';
import { combatStages } from './tutorial/stages/Combat.js';
import { magicStages } from './tutorial/stages/Magic.js';
import { miningStages } from './tutorial/stages/Mining.js';
import { questGuideStages } from './tutorial/stages/QuestGuide.js';
import { survivalStages } from './tutorial/stages/Survival.js';
import { WelcomeScreen } from './tutorial/WelcomeScreen.js';

/**
 * Completes Tutorial Island unassisted (no cheats).
 *
 * Progress is inferred from OBSERVABLE client state — open modals, nearby
 * NPCs, inventory, position — not the tutorial-progress varp (281). That varp
 * is server-only (`scope=perm`, no `transmit=yes`), so the client's local varp
 * mirror never receives it and `reader.varp(281)` can't see it advance
 * (confirmed Task 3). Rationale + the rejected "patch content to transmit it"
 * alternative: ADR-0007 (`docs/adr/0007-state-driven-tutorial-progress.md`).
 *
 * Each stage is a `StageTask` (`tutorial/StageTask.ts`) gated on what's on
 * screen. As a `TaskBot`, TutorialBot runs the first stage whose `validate()`
 * is true each loop. `WelcomeScreen` is added FIRST (a prod-only modal that
 * would otherwise block everything — harmless no-op on this dev engine),
 * then `AdvanceDialog` so any open dialogue is cleared — and the dev-only
 * skip-tutorial prompt declined — before a stage acts. `survivalStages`
 * (0 -> 130) run first, then `chefStages` (130 -> 220), then
 * `questGuideStages` (220 -> 260), then `miningStages` (260 -> 360), then
 * `combatStages` (360 -> 500), then `bankChapelStages` (500 -> 610), then
 * `magicStages` (610 -> 1000 — the mainland teleport). The full varp
 * ladder is mapped in `the tutorial varp ladder`.
 */
export default class TutorialBot extends TaskBot {
    override loopDelay = 600;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.log('TutorialBot start (state-driven; see ADR-0007)');

        this.add(new WelcomeScreen());
        this.add(new AdvanceDialog());
        this.add(new DesignAccept(this)); // stage 0 -> 1
        for (const t of survivalStages(this)) {
            this.add(t);
        }
        for (const t of chefStages(this)) {
            this.add(t);
        }
        for (const t of questGuideStages(this)) {
            this.add(t);
        }
        for (const t of miningStages(this)) {
            this.add(t);
        }
        for (const t of combatStages(this)) {
            this.add(t);
        }
        for (const t of bankChapelStages(this)) {
            this.add(t);
        }
        for (const t of magicStages(this)) {
            this.add(t);
        }
    }
}
