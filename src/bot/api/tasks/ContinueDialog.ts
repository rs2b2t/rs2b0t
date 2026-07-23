import type { Task } from '../Bot.js';
import { ChatDialog } from '../hud/ChatDialog.js';

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
