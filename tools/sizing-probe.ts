// Quick visual check that the desktop window scales the game to fill the
// space. Run with Node/tsx: npx tsx tools/sizing-probe.ts
import { _electron as electron } from 'playwright-core';

const app = await electron.launch({
    args: ['desktop/main.cjs', '--server=http://localhost:8888'],
    executablePath: 'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
});
try {
    const page = await app.firstWindow();
    type Lcb = { lcbuddy: { client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; constructor: { loopCycle: number }; login(u: string, p: string, r: boolean): Promise<void> } } };
    await page.waitForFunction(() => ((globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    await page.evaluate(() => { const c = (globalThis as never as Lcb).lcbuddy.client; c.loginUser = 'sizing'; c.loginPass = 'test'; void c.login('sizing', 'test', false); });
    await page.waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame, undefined, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const dims = await page.evaluate(() => ({
        win: { w: window.innerWidth, h: window.innerHeight },
        wrap: { w: Math.round(document.getElementById('game-wrap')!.getBoundingClientRect().width), h: Math.round(document.getElementById('game-wrap')!.getBoundingClientRect().height) },
        stage: { w: Math.round(document.getElementById('game-stage')!.getBoundingClientRect().width), h: Math.round(document.getElementById('game-stage')!.getBoundingClientRect().height) },
        panel: { w: Math.round(document.getElementById('bot-panel')!.getBoundingClientRect().width), h: Math.round(document.getElementById('bot-panel')!.getBoundingClientRect().height) }
    }));
    console.log('window:', dims.win, 'game-wrap:', dims.wrap, 'game-stage:', dims.stage, 'panel:', dims.panel);
    const fillH = (dims.stage.h / dims.win.h * 100).toFixed(0);
    console.log(`game scaled to ${(dims.stage.w / 765).toFixed(2)}x — fills ${fillH}% of window height (was 503px / fixed)`);
    await page.screenshot({ path: 'out/desktop-sizing.png' });
    console.log('screenshot: out/desktop-sizing.png');
} finally {
    await app.close();
}
