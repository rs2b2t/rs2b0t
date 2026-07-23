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

export default class TutorialBot extends TaskBot {
    override loopDelay = 600;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.log('TutorialBot start (state-driven; see ADR-0007)');

        this.add(new WelcomeScreen());
        this.add(new AdvanceDialog());
        this.add(new DesignAccept(this));
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
