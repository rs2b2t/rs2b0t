import type { Task } from '../Bot.js';
import { ChatDialog } from '../hud/ChatDialog.js';

/** Advance any blocking chat dialog — the task every TaskBot script carries. */
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
