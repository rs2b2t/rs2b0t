import type { Page } from 'playwright-core';

import type { WorldTile } from '../../src/bot/adapter/ClientAdapter.js';
import type { ScriptContext } from '../../src/bot/runtime/ScriptContext.js';
import { cheatQuiet, clearChatDialogs, teleTo } from '../tutorial/harness.js';
import { fail } from './harness.js';

const STATS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
];

export async function setQuestStats(page: Page, level: number): Promise<void> {
    for (const skill of STATS) {
        await cheatQuiet(page, `setstat ${skill} ${level}`);
    }
    await clearChatDialogs(page, 'level-up dialog(s)');
    await page.waitForTimeout(1500);
    await clearChatDialogs(page, 'straggler dialog(s)');
}

interface QuestPage {
    __rs2b0t: {
        reader: { worldTile(): WorldTile | null };
        Quests: { status(name: string): string; points(): number };
    };
    rs2b0t: { runner: { state: string; ctx?: Pick<ScriptContext, 'log'> } };
}

export function questSnapshot(page: Page, quest: string) {
    return page.evaluate(name => {
        const { __rs2b0t, rs2b0t } = globalThis as typeof globalThis & QuestPage;
        const ring = rs2b0t.runner.ctx?.log ?? [];
        return {
            pos: __rs2b0t.reader.worldTile(),
            status: __rs2b0t.Quests.status(name),
            qp: __rs2b0t.Quests.points(),
            runner: rs2b0t.runner.state,
            logs: ring.slice(-80).map(({ time, level, msg }) => ({ time, level, msg }))
        };
    }, quest);
}

interface QuestLogLine {
    time: number;
    level: string;
    msg: string;
}

export function printQuestLogs(lines: readonly QuestLogLine[], lastLogTime: number, startTime?: number): number {
    let latest = lastLogTime;
    for (const line of lines) {
        if (line.time > lastLogTime) {
            const elapsed = startTime === undefined ? '' : `${((line.time - startTime) / 1000).toFixed(1).padStart(6)}s`;
            console.log(`      ·${elapsed} [${line.level}] ${line.msg}`);
        }
        latest = Math.max(latest, line.time);
    }
    return latest;
}

export async function teleportToQuestStart(page: Page, tile: WorldTile): Promise<void> {
    if (await teleTo(page, tile, 10, 25_000)) return;
    await clearChatDialogs(page, 'pre-tele dialog(s)');
    if (!(await teleTo(page, tile, 10, 25_000))) {
        fail(`tele to ${tile.x},${tile.z} did not arrive`);
    }
}
