import { readProfileScript, writeProfileScript, readScriptSettings, replaceScriptSettings } from '../../src/bot/multibox/RosterStorage.js';
import type { RosterClient } from '../../src/bot/multibox/RosterTypes.js';
import type { LoginCoordination } from '../../src/bot/runtime/LoginCoordination.js';

const params = new URLSearchParams(location.search);
const username = params.get('box')!;
const world = Number(params.get('world') ?? 1);
let ingame = params.get('autologin') !== '0';
let coordination: LoginCoordination | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const runner = { state: username.endsWith('_busy') ? 'running' : 'idle', meta: { name: 'Miner' } };
const control: { holdTravel: boolean; releaseTravel?: () => void } = { holdTravel: false };
Reflect.set(globalThis, 'rosterFixture', control);
if (!readProfileScript(username)) writeProfileScript(username, 'Miner');
const title = document.createElement('h2');
title.textContent = username;
document.body.append(title);
const canvas = document.createElement('canvas');
canvas.id = 'canvas';
canvas.width = 765;
canvas.height = 503;
const ctx = canvas.getContext('2d')!;
ctx.fillStyle = '#203324';
ctx.fillRect(0, 0, 765, 503);
ctx.font = '20px monospace';
ctx.fillStyle = '#9bd49b';
ctx.fillText(`${username} · World ${world}`, 28, 40);
ctx.fillText('Fixture client', 28, 75);
document.body.append(canvas);
const roster: RosterClient = {
    scripts: () => ['Miner', 'JiveRC', 'WalkTo'],
    selectedScript: () => readProfileScript(username),
    readSettings: script => ({ ...(script === 'Miner' ? { rock: 'iron' } : {}), ...readScriptSettings(username, script) }),
    assignScript: script => writeProfileScript(username, script),
    copySettings(script, values) {
        if (username.endsWith('_fail')) throw new Error('Fixture copy failure');
        replaceScriptSettings(username, script, values);
    },
    async configureScript(script, values, start) {
        await stopForChange();
        if (values) this.copySettings(script, values);
        if (!values || start) this.assignScript(script);
        if (start) this.startScript();
    },
    startScript() { runner.meta = { name: readProfileScript(username) }; runner.state = 'running'; },
    stopScript() { runner.state = 'stopped'; },
    async travelTo(destination) {
        if (control.holdTravel) await new Promise<void>(resolve => { control.releaseTravel = resolve; });
        runner.state = 'stopped';
        writeProfileScript(username, 'WalkTo');
        replaceScriptSettings(username, 'WalkTo', { destination, customTile: '0,0,0' });
        this.startScript();
    },
    async editSettings() {
        await stopForChange();
        const input = document.createElement('input');
        input.id = 'fixture-parameter';
        input.value = readScriptSettings(username, 'Miner').rock ?? 'iron';
        const save = document.createElement('button');
        save.textContent = 'Save fixture parameter';
        save.onclick = () => replaceScriptSettings(username, 'Miner', { rock: input.value });
        const start = document.createElement('button');
        start.textContent = 'Start script';
        start.onclick = () => { roster.startScript(); input.remove(); save.remove(); start.remove(); };
        document.body.prepend(input, save, start);
        input.focus();
    }
};
async function stopForChange(): Promise<void> {
    if (['running', 'paused', 'stopping'].includes(runner.state)) {
        runner.state = 'stopping';
        await new Promise(resolve => setTimeout(resolve, 40));
        runner.state = 'stopped';
    }
}

Reflect.set(globalThis, 'rs2b0t', {
    world, roster, runner,
    reader: { ingame: () => ingame, localPlayerName: () => ingame ? username : null },
    client: { constructor: { loopCycle: 1 } }, renderGate: { drawn: 1 },
    setRenderMode() {}, setCredentials() {}, setRendererEnabled() {},
    setLoginCoordination(value: LoginCoordination | null) { coordination = value; },
    setAutoLogin(on: boolean) {
        clearInterval(timer);
        if (!on) return;
        timer = setInterval(() => { if (!coordination || coordination.requestPermit()) { ingame = true; clearInterval(timer); } }, 20);
    },
    prepareWorldSwitch() { roster.stopScript(); ingame = false; return true; },
    cancelWorldSwitch() {},
    startSelectedScript: () => roster.startScript(), stopScript: () => roster.stopScript()
});
