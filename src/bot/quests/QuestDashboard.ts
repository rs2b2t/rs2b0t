import { LoopingBot } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Bank } from '../api/hud/Bank.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Quests } from '../api/hud/Quests.js';
import { Skills } from '../api/hud/Skills.js';
import { evaluateAll } from './EligibilityEvaluator.js';
import { loadQuestRecords } from './data/index.js';
import type { BankInventorySnapshot, PlayerState, QuestEligibility } from './types.js';

/**
 * Reads live state (skills, quest journal, quest points, bank+inventory) and
 * reports DONE/READY/BLOCKED for all 63 quests on the overlay + log. The
 * decision half of the quest system — no execution. Later becomes the executor
 * orchestrator (hand each READY quest to its solver).
 */
export default class QuestDashboard extends LoopingBot {
    override loopDelay = 5000;

    private records = loadQuestRecords();
    private results: QuestEligibility[] = [];
    private banner = '';
    private lastBankCounts: Map<string, number> = new Map();

    override async onStart(): Promise<void> {
        this.log('QuestDashboard — waiting until ingame');
        await Execution.delayUntil(() => Game.ingame(), 0);
        this.log(`Loaded ${this.records.length} quest records`);
    }

    async loop(): Promise<void> {
        const journal = Quests.all();
        if (journal.length === 0) {
            this.banner = 'Quest journal not loaded (on Tutorial Island?) — finish the tutorial first; eligibility unavailable';
            this.results = [];
            this.log(this.banner);
            return;
        }
        this.banner = '';

        const player = this.readPlayerState();
        const snapshot = this.readItemSnapshot();
        this.results = evaluateAll(this.records, player, snapshot, name => Quests.status(name));

        this.report();
    }

    /** Build a plain PlayerState from live readers (the only client contact for requirements). */
    private readPlayerState(): PlayerState {
        const skillNames = new Set<string>();
        for (const r of this.records) {
            for (const s of r.requirements.skills ?? []) {
                skillNames.add(s.skill);
            }
        }
        const skillLevels = new Map<string, number>();
        for (const name of skillNames) {
            skillLevels.set(name, Skills.level(name));
        }
        const completedQuests = new Set<string>();
        for (const r of this.records) {
            if (Quests.status(r.name) === 'complete') {
                completedQuests.add(r.id);
            }
        }
        return { questPoints: Quests.points(), skillLevels, completedQuests };
    }

    /** Bank+inventory item counts. Bank is only readable when open; otherwise reuse the last seen. */
    private readItemSnapshot(): BankInventorySnapshot {
        const counts = new Map<string, number>();
        const wanted = new Set<string>();
        for (const r of this.records) {
            for (const it of r.items) {
                wanted.add(it.name);
            }
        }
        const bankOpen = Bank.isOpen();
        for (const name of wanted) {
            const inv = Inventory.count(name);
            const bank = bankOpen ? Bank.count(name) : (this.lastBankCounts.get(name) ?? 0);
            counts.set(name, inv + bank);
        }
        if (bankOpen) {
            this.lastBankCounts = new Map([...wanted].map(n => [n, Bank.count(n)]));
        }
        return { counts };
    }

    private counts(): { ready: number; blocked: number; done: number } {
        let ready = 0, blocked = 0, done = 0;
        for (const r of this.results) {
            if (r.status === 'READY') ready++;
            else if (r.status === 'BLOCKED') blocked++;
            else done++;
        }
        return { ready, blocked, done };
    }

    private report(): void {
        const { ready, blocked, done } = this.counts();
        this.log(`Quests — READY ${ready} | BLOCKED ${blocked} | DONE ${done}`);
        const readyList = this.results.filter(r => r.status === 'READY');
        for (const r of readyList) {
            this.log(`  READY: ${r.name}${this.tag(r)}`);
        }
    }

    private tag(r: QuestEligibility): string {
        return r.members ? ' [M]' : '';
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const { ready, blocked, done } = this.counts();
        const lines: string[] = this.banner
            ? ['QuestDashboard', this.banner]
            : [
                `QuestDashboard — READY ${ready}  BLOCKED ${blocked}  DONE ${done}`,
                ...this.results.filter(r => r.status === 'READY').slice(0, 12).map(r => `READY  ${r.name}${this.tag(r)}`)
            ];

        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width), 160) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#7ad0ff';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }
}
