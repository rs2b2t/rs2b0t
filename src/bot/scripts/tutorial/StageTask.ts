import type { Task } from '../../api/Bot.js';
import type TutorialBot from '../TutorialBot.js';

/**
 * Base for every Tutorial Island stage. Each stage is a `Task` bound to the
 * `TutorialBot`, gated on OBSERVABLE client state — an open modal, a nearby
 * NPC, inventory contents, position — rather than the tutorial-progress varp.
 *
 * Why not the varp: `tutorial` (varp 281) is server-only (`scope=perm`, no
 * `transmit=yes`), so the client's local varp mirror never receives it and
 * `reader.varp(281)` can't observe real advancement (confirmed empirically,
 * Task 3). The whole tutorial arc is therefore driven off what's on screen —
 * see ADR-0007 (`docs/adr/0007-state-driven-tutorial-progress.md`).
 *
 * Concrete stages implement `validate()` (does this stage apply right now?)
 * and `execute()` (the interaction that advances it). `TutorialBot` (a
 * `TaskBot`) runs the first stage whose `validate()` is true each loop, so a
 * stage's `validate()` doubles as its "am I done?" guard — it must go false
 * once the stage's on-screen precondition clears.
 */
export abstract class StageTask implements Task {
    constructor(protected bot: TutorialBot) {}

    abstract validate(): boolean;
    abstract execute(): Promise<void>;
}
