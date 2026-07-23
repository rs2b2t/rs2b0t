import type { Task } from '../../api/Bot.js';
import type TutorialBot from '../TutorialBot.js';

export abstract class StageTask implements Task {
    constructor(protected bot: TutorialBot) {}

    abstract validate(): boolean;
    abstract execute(): Promise<void>;
}
