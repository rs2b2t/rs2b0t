import type { Task } from '../bot/Bot.js';
import { ChatDialog } from '../ui/dialogue/ChatDialog.js';

export class ContinueDialog implements Task {
    constructor(private readonly onContinue?: () => void) {}

    validate(): boolean {
        return ChatDialog.canContinue();
    }

    async execute(): Promise<void> {
        this.onContinue?.();
        await ChatDialog.continue();
    }
}
