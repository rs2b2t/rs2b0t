import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { Paint } from '../../paint/Paint.js';
import { paintState, wrapText } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { describeActivity, type ActionQueue } from './actions.js';
import { requirementKey, type ActivityPlan } from './types.js';
import { trainingPriority } from './priority.js';

export interface LevelerPaintView {
    target: number;
    levels: Record<string, number>;
    completed: number;
    total: number;
    objective: string | null;
    plan: ActivityPlan | null;
    status: string;
    detail: string;
    queue: ActionQueue;
    remainingMs: number;
    deaths: number;
    wilderness: boolean;
    bankReady: boolean;
    stock: Record<string, number>;
    heldCoins: number;
    tile: WorldTile | null;
    waitingUntil: number;
    now: number;
    startedAt: number;
    shoppingBudget: number;
}

const tileText = (tile: WorldTile | null | undefined) => tile ? `${tile.x}, ${tile.z}, ${tile.level}` : 'not selected';
const duration = (ms: number) => `${Math.floor(Math.max(0, ms) / 60000)}m ${Math.floor(Math.max(0, ms) / 1000) % 60}s`;
const COLORS = { running: '#9be05b', done: '#8a919a', pending: '#cdd3da', failed: '#ff8989' };

export function levelerLines(v: LevelerPaintView, page: string, cols: number): { lines: { text: string; color?: string }[]; focus: number } {
    const lines: { text: string; color?: string }[] = [];
    let focus = -1;
    const add = (text: string, color?: string) => lines.push(...wrapText(text, cols, 2).map(text => ({ text, color })));
    if (page === 'Queue') {
        for (const [i, action] of v.queue.items.entries()) {
            if (action.state === 'running') focus = lines.length;
            const state = action.state ?? 'pending';
            add(`${i + 1}. [${state}] ${action.label}`, COLORS[state]);
            add(`   ${action.detail}`, COLORS[state]);
            if (action.destination) add(`   Destination: ${tileText(action.destination)}`, COLORS[state]);
        }
        if (!lines.length) add('Read the bank, audit supplies, then choose an unfinished skill.');
    } else if (page === 'Supplies') {
        add(`Coins carried: ${v.heldCoins.toLocaleString()}gp`);
        add(`Available bank + carried: ${(v.stock.coins ?? 0).toLocaleString()}gp${v.bankReady ? '' : ' (bank refresh pending)'}`);
        if (v.shoppingBudget) add(`Shopping budget: ${v.shoppingBudget.toLocaleString()}gp + travel reserve`);
        for (const need of v.plan?.needs ?? []) {
            const held = v.stock[requirementKey(need).toLowerCase()] ?? 0;
            add(`${need.item}: ${held}/${need.count} available; ${need.equip ? 'equip' : need.carry ? `carry ${need.carry}` : 'keep in bank'}`, held >= need.count ? COLORS.running : '#ffd17a');
        }
        if (!v.plan) add('Supply list appears after the bank audit.');
    } else if (page === 'Skills') {
        for (const [skill, level] of Object.entries(v.levels)) add(`${level >= v.target ? 'DONE' : 'TODO'} ${skill}: ${level}/${v.target}${skill === v.objective ? ' - current goal' : ''}`, level >= v.target ? COLORS.done : COLORS.pending);
    } else if (page === 'History') {
        for (const event of [...v.queue.history].reverse()) add(`${new Date(event.at).toLocaleTimeString()} ${event.message}`);
        if (!lines.length) add('No actions recorded yet.');
    } else {
        add(`Now: ${v.status}`, COLORS.running);
        add(`Phase: ${trainingPriority(v.levels, v.target).label}`);
        if (v.queue.current && v.queue.current !== v.status) add(`Action: ${v.queue.current}`, COLORS.running);
        add(`Goal: ${v.objective ?? 'audit supplies'}${v.objective && v.levels[v.objective] ? ` ${v.levels[v.objective]} -> ${v.target}` : ''}`);
        if (v.plan) add(`Plan: ${describeActivity(v.plan)}`);
        add(`Position: ${tileText(v.tile)}`);
        if (v.queue.destination) add(`Destination: ${tileText(v.queue.destination)}`);
        if (v.detail) add(`Detail: ${v.detail}`);
        const next = v.queue.items.find(item => item.state === 'pending');
        if (next) add(`Next: ${next.label} - ${next.detail}`);
        if (v.waitingUntil > v.now) add(`Retry in ${duration(v.waitingUntil - v.now)}`, '#ffd17a');
        add(`Action elapsed: ${duration(v.now - (v.queue.changedAt || v.startedAt))}; training left: ${duration(v.remainingMs)}`);
        add(`Runtime: ${duration(v.now - v.startedAt)}; deaths: ${v.deaths}; Wilderness: ${v.wilderness ? 'on' : 'off'}`);
    }
    return { lines, focus };
}

export function paintLeveler(ctx: CanvasRenderingContext2D, v: LevelerPaintView): void {
    const expanded = paintState.get('leveler:expanded', '1') === '1';
    const p = Paint.begin(ctx, { dock: expanded ? { x: 8, y: 249, w: 506, h: 246 } : 'chatbox', accent: COLORS.running });
    const page = p.strip('account-leveler', ['Now', 'Queue', 'Supplies', 'Skills', 'History'], `${v.completed}/${v.total}`, 'Leveler');
    p.row(`${v.objective ?? 'Supplies'} -> ${v.target}`, `${v.completed}/${v.total} skills done`);
    const content = levelerLines(v, page, p.cols() - 1);
    p.fill(`leveler:${page}`, content.lines, { reserve: 24, focus: content.focus });
    const click = p.buttons([
        { id: 'pause', label: ScriptRunner.state === 'paused' ? 'Resume' : 'Pause' },
        { id: 'stop', label: 'Stop' },
        { id: 'size', label: expanded ? 'Compact' : 'Expand' }
    ]);
    if (click === 'pause') {
        if (ScriptRunner.state === 'paused') ScriptRunner.resume();
        else ScriptRunner.pause();
    } else if (click === 'stop') ScriptRunner.stop('Stop button (AccountLeveler)');
    else if (click === 'size') paintState.set('leveler:expanded', expanded ? '0' : '1');
    p.end();
}
