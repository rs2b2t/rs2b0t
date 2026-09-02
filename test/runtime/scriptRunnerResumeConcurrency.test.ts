import { afterEach, expect, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { LoopingBot } from '#/bot/api/bot/Bot.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { BotHost } from '#/bot/runtime/BotHost.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';

/** Counts how many loop bodies are inside the parked await at once. */
class ParkedLoopBot extends LoopingBot {
    inFlight = 0;
    maxInFlight = 0;
    entries = 0;
    released = false;

    override async loop(): Promise<void> {
        this.entries++;
        this.inFlight++;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        await Execution.delayUntil(() => this.released, 60_000);
        this.inFlight--;
    }
}

const original = {
    attached: reader.attached,
    ingame: reader.ingame,
    sceneState: reader.sceneState,
    worldTile: reader.worldTile,
    statsReady: reader.statsReady
};

function stubIngame(): void {
    reader.attached = () => true;
    reader.ingame = () => true;
    reader.sceneState = () => 2;
    reader.worldTile = () => ({ x: 3200, z: 3200, level: 0 });
    reader.statsReady = () => true;
}

async function settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

async function frame(): Promise<void> {
    BotHost.onFrame();
    await settle();
}

afterEach(async () => {
    ScriptRunner.stop('test teardown');
    wedged?.release?.();
    wedged = null;
    for (let i = 0; i < 10 && ScriptRunner.state === 'stopping'; i++) {
        await settle();
    }
    reader.attached = original.attached;
    reader.ingame = original.ingame;
    reader.sceneState = original.sceneState;
    reader.worldTile = original.worldTile;
    reader.statsReady = original.statsReady;
});

// Why: AutoRelogin pauses on a disconnect and resumes on reconnect, so this is the
// path a run takes without anyone touching the Pause button.
test('a resume does not start a second loop on top of the one still parked', async () => {
    stubIngame();
    const bot = new ParkedLoopBot();
    ScriptRunner.start({
        name: 'Parked loop probe',
        description: 'resume concurrency regression fixture',
        create: () => bot
    });
    await settle();
    await frame();

    expect(bot.entries).toBe(1);
    expect(bot.inFlight).toBe(1);

    ScriptRunner.pause();
    ScriptRunner.resume();
    await frame();
    await frame();

    expect(bot.maxInFlight).toBe(1);
    expect(bot.entries).toBe(1);
});

/** Parks on a promise the scheduler does not own, so no waiter is registered (#580). */
class WedgedLoopBot extends LoopingBot {
    entries = 0;
    release: (() => void) | null = null;

    override async loop(): Promise<void> {
        this.entries++;
        await new Promise<void>(resolve => {
            this.release = resolve;
        });
    }
}

let wedged: WedgedLoopBot | null = null;

// Why: #580, nothing wakes a loop the scheduler has no waiter for, so a resume has to
// abandon it or the pump never launches another iteration again.
test('a resume still frees a loop wedged on a promise the scheduler does not own', async () => {
    stubIngame();
    const bot = new WedgedLoopBot();
    wedged = bot;
    ScriptRunner.start({
        name: 'Wedged loop probe',
        description: 'resume deadlock regression fixture',
        create: () => bot
    });
    await settle();
    await frame();

    expect(bot.entries).toBe(1);

    ScriptRunner.pause();
    ScriptRunner.resume();
    await frame();

    expect(bot.entries).toBe(2);
});
