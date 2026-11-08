import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { paintState, resolveDock, type Rect, type Region } from '#/bot/paint/paintLogic.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import JiveRC from '#/bot/scripts/JiveRC/JiveRC.js';

interface Drawn { text: string; x: number; y: number; color: string }

let now: number;
let xp: number;
let pack: InvItemSnapshot[];
let regions: Region[];
let bots: JiveRC[];

beforeEach(() => {
    now = 1_000_000;
    xp = 101_333;
    pack = [];
    regions = [];
    bots = [];
    paintState.reset();
    const publish = paintState.publishRegions.bind(paintState);
    spyOn(paintState, 'publishRegions').mockImplementation(value => { regions = value; publish(value); });
    spyOn(Date, 'now').mockImplementation(() => now);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue({ x: 2840, z: 3028, level: 0 });
    spyOn(Skills, 'xp').mockImplementation(() => xp);
    spyOn(Skills, 'level').mockReturnValue(50);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
});

afterEach(() => {
    for (const bot of bots) bot.disposeSubscriptions();
    mock.restore();
    paintState.reset();
});

async function start(settings: Record<string, unknown> = {}): Promise<JiveRC> {
    const bot = new JiveRC();
    bots.push(bot);
    bot.settings = new SettingsBag({ partner: 'alpha, beta', rune: 'Nature runes', ...settings });
    bot.bindLog(() => {});
    await bot.onStart();
    return bot;
}

function paint(bot: JiveRC): { drawn: Drawn[]; boxes: Rect[] } {
    const drawn: Drawn[] = [];
    const boxes: Rect[] = [];
    const ctx = {
        font: '', textBaseline: '', fillStyle: '', strokeStyle: '',
        measureText: (text: string) => ({ width: text.length * 7.2 }),
        fillText(text: string, x: number, y: number) { drawn.push({ text, x, y, color: this.fillStyle }); },
        fillRect(x: number, y: number, w: number, h: number) { boxes.push({ x, y, w, h }); },
        strokeRect(x: number, y: number, w: number, h: number) { boxes.push({ x, y, w, h }); }
    };
    bot.onPaint(ctx as unknown as CanvasRenderingContext2D);
    return { drawn, boxes };
}

function click(id: string): void {
    const region = regions.find(region => region.id === id);
    expect(region, id).toBeDefined();
    expect(paintState.pointerDown(region!.x + region!.w / 2, region!.y + region!.h / 2)).toBe(true);
}

test('master overview shows the Jive frame, run counters and RC progress since startup', async () => {
    const bot = await start();
    bot.countCraft(108);
    bot.countTrade(27);
    bot.countTrade(27);
    now += 120_000;
    xp += 1_000;
    const { drawn } = paint(bot);
    const texts = drawn.map(d => d.text);
    for (const text of ['Statistics', 'Options', 'Overview', 'Supplies', 'Jive scripts', 'Runtime: 0:02:00', 'Rune: Nature runes', 'Mode: Master', 'Crafted: 108', 'Trades: 2', 'Ess in: 54', 'RC 50', '30.0k/hr']) {
        expect(texts).toContain(text);
    }
    expect(drawn.find(d => d.text === 'JiveRC')?.color).toBe('#e05be0');
    expect(regions.some(r => r.id === 'btn:gobank')).toBe(false);
});

test('runner overview shows deliveries and essence sent without master XP stats', async () => {
    const bot = await start({ mode: 'Runner', rune: 'Air runes', partner: 'master' });
    bot.countDelivery(26);
    bot.countDelivery(27);
    const texts = paint(bot).drawn.map(d => d.text);
    for (const text of ['Rune: Air runes', 'Mode: Runner', 'Deliveries: 2', 'Ess sent: 53', 'To: master']) {
        expect(texts).toContain(text);
    }
    expect(texts.some(text => text.startsWith('RC '))).toBe(false);
});

test('Supplies separates noted essence and shows the selected product and pack fill', async () => {
    pack = [
        ...Array.from({ length: 9 }, (_, slot) => ({ id: 1436, name: 'Rune essence', count: 1, slot, comId: 3214, ops: [] })),
        { id: 1437, name: 'Rune essence', count: 400, slot: 9, comId: 3214, ops: [] },
        { id: 995, name: 'Coins', count: 8_765, slot: 10, comId: 3214, ops: [] },
        { id: 561, name: 'Nature rune', count: 42, slot: 11, comId: 3214, ops: [] },
        { id: 556, name: 'Air rune', count: 99, slot: 12, comId: 3214, ops: [] },
        { id: 564, name: 'Cosmic rune', count: 17, slot: 13, comId: 3214, ops: [] }
    ];
    spyOn(Game, 'tile').mockReturnValue({ x: 3152, z: 9575, level: 0 });
    for (const [rune, product] of [['Nature runes', 'Nature rune: 42'], ['Air runes', 'Air rune: 99'], ['Cosmic runes', 'Cosmic rune: 17']]) {
        const bot = await start({ rune });
        paint(bot);
        click('rail:jive:JiveRC:Supplies');
        const texts = paint(bot).drawn.map(d => d.text);
        for (const text of ['Unnoted: 9', 'Noted: 400', 'Coins: 8765', product, 'Pack', '50%']) {
            expect(texts).toContain(text);
        }
        expect(texts.some(text => text.startsWith('Crafted:'))).toBe(false);
    }
});

const optionCases: [boolean, number, string, string][] = [[true, 15, 'inside', '15m'], [false, 0, 'outside', 'never']];

test.each(optionCases)('Options reports trading and banking settings (%s)', async (stayInAltar, bankEvery, location, interval) => {
    const bot = await start({ stayInAltar, bankEvery });
    paint(bot);
    click('strip:jive:JiveRC:Options');
    const texts = paint(bot).drawn.map(d => d.text);
    for (const text of ['Rune: Nature runes', 'Mode: Master', 'Partners: alpha, beta', `Trading: ${location}`, `Bank: ${interval}`]) {
        expect(texts).toContain(text);
    }
    expect(texts.some(text => text.startsWith('Runtime:'))).toBe(false);
});

const pageCases: [string, string][] = [['Statistics', 'Overview'], ['Statistics', 'Supplies'], ['Options', '']];

test.each(pageCases)('runner can bank and resume from %s/%s', async (page, section) => {
    const bot = await start({ mode: 'Runner', partner: 'master' });
    paintState.set('strip:jive:JiveRC', page);
    paintState.set('rail:jive:JiveRC', section);
    paint(bot);
    click('btn:gobank');
    paint(bot);
    expect(bot.goBankActive()).toBe(true);
    expect(paint(bot).drawn.map(d => d.text)).toContain('Resume');
    click('btn:gobank');
    paint(bot);
    expect(bot.goBankActive()).toBe(false);
    expect(paint(bot).drawn.map(d => d.text)).toContain('Go bank');
});

test.each(['Master', 'Runner'])('%s pages keep text and controls clear of panel edges and footer', async mode => {
    const bot = await start({ mode, partner: 'abcdefghijkl, mnopqrstuvwx, yzabcdefghij, klmnopqrstuv, wxyzabcdefgh' });
    bot.setStatus('waiting for the runner to deliver another inventory of essence');
    const panel = resolveDock('chatbox');
    for (const [page, section] of [['Statistics', 'Overview'], ['Statistics', 'Supplies'], ['Options', '']]) {
        paintState.set('strip:jive:JiveRC', page);
        paintState.set('rail:jive:JiveRC', section);
        const { drawn, boxes } = paint(bot);
        expect(boxes.filter(b => b.x < panel.x || b.y < panel.y || b.x + b.w > panel.x + panel.w || b.y + b.h > panel.y + panel.h)).toEqual([]);
        expect(drawn.filter(d => d.x < panel.x || d.x + d.text.length * 7.2 > panel.x + panel.w || d.y - 6 < panel.y || d.y + 6 > panel.y + panel.h)).toEqual([]);
        const footer = drawn.find(d => d.text === 'Jive scripts');
        expect(footer).toBeDefined();
        for (const id of ['pause', 'stop', ...(mode === 'Runner' ? ['gobank'] : [])]) {
            const button = regions.find(r => r.id === `btn:${id}`);
            expect(button, `${page}/${section}/${id}`).toBeDefined();
            expect(button!.y + button!.h).toBeLessThan(footer!.y - 6);
        }
    }
});
