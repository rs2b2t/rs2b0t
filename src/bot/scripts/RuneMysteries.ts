import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Quests, type QuestStatus } from '../api/hud/Quests.js';
import { gotoNpc, talkThrough, type LadderHop, type NpcStop } from '../quests/exec/primitives.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';

// Quest items, exact display names from the quest configs
// (quest_runemysteries.obj). 'Notes' is deliberately matched as a FULL name:
// it is far too generic for substring matching.
const TALISMAN = 'air talisman';
const PACKAGE = 'research package';
const NOTES = 'notes';

export type Held = 'talisman' | 'package' | 'notes' | null;
export type StepId = 'DUKE' | 'SEDRIDOR' | 'AUBURY' | 'RECOVER' | 'DONE' | 'WAIT';

/** Which quest item the pack holds — most-advanced wins (can't co-occur
 *  server-side, but stay deterministic). Exact CI full-name equality. Pure. */
export function heldQuestItem(names: (string | null)[]): Held {
    const lower = names.filter((n): n is string => n !== null).map(n => n.toLowerCase());
    if (lower.includes(NOTES)) {
        return 'notes';
    }
    if (lower.includes(PACKAGE)) {
        return 'package';
    }
    if (lower.includes(TALISMAN)) {
        return 'talisman';
    }
    return null;
}

/**
 * The whole quest as one decision: journal colour (the only client-visible
 * quest progress — the varp is never transmitted, ADR-0007) + held item.
 * inProgress with empty hands is deliberately RECOVER: the fixed
 * Aubury → Sedridor → Duke probe order both performs the quest's natural
 * "talk to Aubury again" step and re-collects any lost item (each NPC's
 * dialogue re-gives its own — see the design spec). Pure.
 */
export function nextStep(journal: QuestStatus, held: Held): StepId {
    if (journal === 'complete') {
        return 'DONE';
    }
    if (journal === 'unknown') {
        return 'WAIT';
    }
    if (journal === 'notStarted') {
        return 'DUKE';
    }
    if (held === 'talisman' || held === 'notes') {
        return 'SEDRIDOR';
    }
    if (held === 'package') {
        return 'AUBURY';
    }
    return 'RECOVER';
}

// Route/dialogue data — every tile probe-verified against the collision pack
// (docs/superpowers/plans/2026-07-12-rune-mysteries-quest-bot.md, "Verified
// geometry"); dialogue strings verbatim from the quest .rs2 sources.
const QUEST_NAME = 'Rune Mysteries Quest';

const DEFAULT_DUKE = new Tile(3212, 3220, 1); // castle 1st floor; stairs are baked transports
const DEFAULT_SEDRIDOR = new Tile(3103, 9572, 0); // tower basement, beside his spawn
const DEFAULT_AUBURY = new Tile(3253, 3402, 0); // Varrock rune shop
const DEFAULT_LEASH = 8;

// The basement is a horseshoe: the ladder alcove is walled off from Sedridor's
// chamber, and the only route runs east → south corridor → WEST through the
// Door at (3108,9570). Walking straight at the anchor from the landing freezes
// the client (its ground-click fallback can't improve distance on a horseshoe
// — probe-verified 2026-07-12), so stage the approach at the corridor mouth.
const SEDRIDOR_APPROACH = [new Tile(3108, 9572, 0)];

const DUKE_PREFER = ['Have you any quests for me?', 'Sure, no problem.'];
const SEDRIDOR_PREFER = ["I'm looking for the head wizard.", 'Ok, here you are.', 'Yes, certainly.'];
const AUBURY_PREFER = ['I have been sent here with a package for you.'];

// The tower ladder is not a nav edge (underground is z+6400 on level 0 — the
// 2D A* can't span it), so it's a scripted hop. Arrival tiles are the
// engine's own scripted landings (ladders.rs2).
const HOPS: LadderHop[] = [
    { stand: new Tile(3105, 3162, 0), locName: 'Ladder', op: 'Climb-down', arrive: new Tile(3104, 9576, 0) },
    { stand: new Tile(3104, 9576, 0), locName: 'Ladder', op: 'Climb-up', arrive: new Tile(3105, 3162, 0) }
];

const NO_PROGRESS_WARN = 3;

export const SETTINGS: SettingsSchema = {
    questName: { type: 'string', default: QUEST_NAME, label: 'Quest journal name', help: 'matched case-insensitively against the quest side-tab' },
    dukeTile: { type: 'tile', default: DEFAULT_DUKE, label: 'Duke anchor (x,z,level)', help: 'Lumbridge castle 1st floor beside Duke Horacio' },
    sedridorTile: { type: 'tile', default: DEFAULT_SEDRIDOR, label: 'Sedridor anchor (x,z)', help: 'wizard-tower basement beside Sedridor' },
    auburyTile: { type: 'tile', default: DEFAULT_AUBURY, label: 'Aubury anchor (x,z)', help: 'Varrock rune shop' },
    leashRadius: { type: 'number', default: DEFAULT_LEASH, min: 3, max: 15, label: 'NPC search radius (tiles)' }
};

/**
 * Completes Rune Mysteries: Duke Horacio → Sedridor (wizard-tower basement)
 * → Aubury (Varrock) → Aubury again → Sedridor. Start anywhere, any quest
 * state — progress is read from the quest journal colour + held quest item
 * every loop (the varp is never transmitted; ADR-0007), so the bot is
 * restart-, relog- and random-event-safe by construction. No cheats.
 */
export default class RuneMysteries extends TaskBot {
    override loopDelay = 600;

    private questName = QUEST_NAME;
    private status = 'starting';
    private step: StepId = 'WAIT';
    private recoverIdx = 0;
    private lastSignature = '';
    private noProgress = 0;
    private duke!: NpcStop;
    private sedridor!: NpcStop;
    private aubury!: NpcStop;
    private recoverOrder!: NpcStop[];

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.questName = this.settings.str('questName', QUEST_NAME);
        const leash = this.settings.num('leashRadius', DEFAULT_LEASH);
        this.duke = { npc: 'Duke Horacio', anchor: this.settings.tile('dukeTile', DEFAULT_DUKE), leash: Math.min(leash, 6), prefer: DUKE_PREFER };
        this.sedridor = { npc: 'Sedridor', anchor: this.settings.tile('sedridorTile', DEFAULT_SEDRIDOR), leash, prefer: SEDRIDOR_PREFER, approach: SEDRIDOR_APPROACH };
        this.aubury = { npc: 'Aubury', anchor: this.settings.tile('auburyTile', DEFAULT_AUBURY), leash, prefer: AUBURY_PREFER };
        // Empty-handed mid-quest probes, fixed order: Aubury first is also the
        // quest's REQUIRED second talk after handing him the package.
        this.recoverOrder = [this.aubury, this.sedridor, this.duke];
        this.log(`RuneMysteries — off to earn ${this.questName}`);
        this.add(new ContinueDialog(), new QuestStep(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [
            `RuneMysteries — ${this.status}`,
            `journal ${Quests.status(this.questName)}  held ${heldQuestItem(Inventory.items().map(i => i.name)) ?? '—'}`,
            `step ${this.step}  QP ${Quests.points()}  tick ${Game.tick()}`
        ];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#b8ffb8';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void { this.status = s; }
    journalName(): string { return this.questName; }

    /** Resolve the concrete stop for a step; RECOVER rotates its probe. */
    stopFor(step: StepId): NpcStop {
        if (step === 'DUKE') { return this.duke; }
        if (step === 'SEDRIDOR') { return this.sedridor; }
        if (step === 'AUBURY') { return this.aubury; }
        return this.recoverOrder[this.recoverIdx % this.recoverOrder.length];
    }

    /** Track (journal, held) between talks: progress resets the probe/warn
     *  counters; a completed talk with no change bumps them. */
    noteTalked(step: StepId, signature: string): void {
        if (signature !== this.lastSignature) {
            this.lastSignature = signature;
            this.recoverIdx = 0;
            this.noProgress = 0;
            return;
        }
        this.noProgress++;
        if (step === 'RECOVER') {
            this.recoverIdx++;
        }
        if (this.noProgress >= NO_PROGRESS_WARN) {
            this.log(`WARN: ${this.noProgress} talks with no progress at ${signature} — check the dialogue prefer lists`);
        }
    }

    noteStep(step: StepId): void { this.step = step; }
}

class ContinueDialog implements Task {
    validate(): boolean { return ChatDialog.canContinue(); }
    async execute(): Promise<void> { await ChatDialog.continue(); }
}

/** One decision + one leg per pass: read (journal, held), walk to the right
 *  NPC, run the conversation, note whether it moved the quest forward. */
class QuestStep implements Task {
    constructor(private bot: RuneMysteries) {}
    validate(): boolean { return !ChatDialog.canContinue() && Game.tile() !== null; }
    async execute(): Promise<void> {
        const journal = Quests.status(this.bot.journalName());
        const held = heldQuestItem(Inventory.items().map(i => i.name));
        const step = nextStep(journal, held);
        this.bot.noteStep(step);

        if (step === 'WAIT') {
            this.bot.setStatus('waiting for the quest journal');
            await Execution.delayTicks(2);
            return;
        }
        if (step === 'DONE') {
            this.bot.log(`${this.bot.journalName()} COMPLETE — ${Quests.points()} QP. Stopping.`);
            this.bot.setStatus('quest complete');
            ScriptRunner.stop();
            return;
        }

        const stop = this.bot.stopFor(step);
        this.bot.setStatus(`${step}: heading to ${stop.npc}`);
        if (!(await gotoNpc(stop, HOPS, m => this.bot.log(`  ${m}`)))) {
            await Execution.delayTicks(3); // walk failed/interrupted — re-decide next loop
            return;
        }
        this.bot.setStatus(`${step}: talking to ${stop.npc}`);
        if (await talkThrough(stop.npc, stop.prefer, m => this.bot.log(`  ${m}`))) {
            const after = `${Quests.status(this.bot.journalName())}|${heldQuestItem(Inventory.items().map(i => i.name)) ?? '-'}`;
            this.bot.noteTalked(step, after);
        }
        await Execution.delayTicks(2);
    }
}
