import { reader } from '../../../adapter/ClientAdapter.js';
import type { PaintCell, PaintFrame } from '../../../paint/Paint.js';
import { COMBAT_SKILLS, XpTracker, paintLevels } from '../../../paint/jive.js';
import { wrapText } from '../../../paint/paintLogic.js';
import { TaskBot, type Task } from '../../bot/Bot.js';
import { Execution } from '../../execution/Execution.js';
import { Skills } from '../../skills/Skills.js';

const PARK_TICKS = 10;
const LOOT_SHOWN = 6;
const PARK_ROWS = 2;
const CONTROL_ROWS = 2;
const PARK_FG = '#e0705a';

export class Parked implements Task {
    constructor(private readonly bot: HuntingBot) {}

    validate(): boolean {
        return this.bot.parked;
    }

    async execute(): Promise<void> {
        await Execution.delayTicks(PARK_TICKS);
    }
}

export abstract class HuntingBot extends TaskBot {
    status = 'starting';
    startedAt = Date.now();
    xp = new XpTracker(COMBAT_SKILLS, Skills);
    killsTotal = 0;
    bankTrips = 0;
    looted = 0;
    readonly lootCounts = new Map<string, number>();
    safespotIdx = 0;
    parked = false;
    parkReason = '';
    died = false;
    targetIdx: number | null = null;

    private bankEmpty = false;
    private supplyEmpty = false;

    protected beginHunt(): void {
        this.startedAt = Date.now();
        this.xp.begin();
        this.safespotIdx = 0;
    }

    setStatus(s: string): void {
        this.status = s;
    }

    parkFor(reason: string): void {
        if (this.parked) {
            return;
        }
        this.parked = true;
        this.parkReason = reason;
        this.setStatus('parked');
        this.log(`PARKED: ${reason}`);
    }

    safespotIndex(): number {
        return this.safespotIdx;
    }

    setSafespotIndex(n: number): void {
        this.safespotIdx = n;
    }

    countKill(): void {
        this.killsTotal++;
    }

    countBankTrip(): void {
        this.bankTrips++;
    }

    countLoot(name?: string | null): void {
        this.looted++;
        if (name) {
            this.lootCounts.set(name, (this.lootCounts.get(name) ?? 0) + 1);
        }
    }

    protected recordTrip(food: boolean, supplies: boolean, foodName: string, route: string): void {
        this.bankEmpty = !food;
        this.supplyEmpty = !supplies;
        if (!food) {
            this.parkFor(`no '${foodName}' left in the bank after a full trip. The run stopped at the booth rather than ${route} with no way to heal. Deposit food, or point the loadout at food the bank has, and restart.`);
        }
    }

    bankKnownEmpty(): boolean {
        return this.bankEmpty;
    }

    supplyKnownEmpty(): boolean {
        return this.supplyEmpty;
    }

    outlineTarget(ctx: CanvasRenderingContext2D): void {
        if (this.targetIdx === null) {
            return;
        }
        const box = reader.npcBox(this.targetIdx);
        if (!box) {
            return;
        }
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 224, 64, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        const edge = (a: number, b: number): void => {
            ctx.beginPath();
            ctx.moveTo(box[a].x, box[a].y);
            ctx.lineTo(box[b].x, box[b].y);
            ctx.stroke();
        };
        for (let i = 0; i < 4; i++) {
            edge(i, (i + 1) % 4);
            edge(4 + i, 4 + ((i + 1) % 4));
            edge(i, 4 + i);
        }
        ctx.restore();
    }

    protected paintLevels(p: PaintFrame, mins: number): void {
        paintLevels(p, this.xp.gains(), mins, CONTROL_ROWS);
    }

    protected paintLoot(p: PaintFrame, ...extra: PaintCell[]): void {
        const top = [...this.lootCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, LOOT_SHOWN)
            .map(([name, n]) => ({ text: `${n}x ${name}` }));
        const rows = [[{ text: `Looted: ${this.looted}` }, ...extra]];
        for (let i = 0; i < top.length; i += 2) {
            rows.push(top.slice(i, i + 2));
        }
        p.statGrid(rows);
    }

    protected paintParkReason(p: PaintFrame, extraRows = 0): void {
        if (!this.parked) return;
        const room = Math.max(0, Math.min(PARK_ROWS, p.rowsLeft() - CONTROL_ROWS - extraRows));
        const lines = wrapText(this.parkReason, p.cols(), 2);
        for (const [i, line] of lines.slice(0, room).entries()) {
            p.text(i === room - 1 && lines.length > room ? `${line}…` : line, PARK_FG);
        }
    }
}
