import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Duel } from '#/bot/scripts/DuelArena/DuelInterface.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { paintState } from '#/bot/paint/paintLogic.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import DuelArena, { DUEL_ARENA_SETTINGS } from '#/bot/scripts/DuelArena/DuelArena.js';
import { DUEL_CHALLENGE_ANCHOR } from '#/bot/scripts/DuelArena/DuelArenaLogic.js';

const NOW = 1_800_000_000_000;
const original = {
    now: Date.now,
    delayUntil: Execution.delayUntil,
    sceneReady: Game.sceneReady,
    tile: Game.tile,
    combatStyleResolution: Game.combatStyleResolution,
    combatMode: Game.combatMode,
    setCombatStyle: Game.setCombatStyle,
    canContinue: ChatDialog.canContinue,
    duelWinOpen: Duel.winOpen,
    duelActive: Duel.active,
    level: Skills.level,
    xp: Skills.xp,
    modals: reader.modals,
    stop: ScriptRunner.stop
};

let levels: Record<string, number>;
let combatMode: number;
let selectedStyles: (string | number)[];
let stopReasons: string[];

function stubContext(text: string[]): CanvasRenderingContext2D {
    return {
        font: '',
        textBaseline: '',
        fillStyle: '',
        strokeStyle: '',
        fillRect: () => {},
        strokeRect: () => {},
        fillText: (value: string) => text.push(value),
        measureText: (value: string) => ({ width: value.length * 7.2 })
    } as never as CanvasRenderingContext2D;
}

function paintAt(runtimeMs: number): string[] {
    const text: string[] = [];
    const bot = new DuelArena();
    Object.assign(bot as unknown as { startedAt: number; xpAtStart: number }, {
        startedAt: NOW - runtimeMs,
        xpAtStart: 4_000
    });
    bot.onPaint(stubContext(text));
    return text;
}

beforeEach(() => {
    paintState.reset();
    levels = { attack: 50, strength: 50, defence: 50 };
    combatMode = 0;
    selectedStyles = [];
    stopReasons = [];

    Date.now = () => NOW;
    Execution.delayUntil = async condition => condition();
    Game.sceneReady = () => true;
    Game.tile = () => DUEL_CHALLENGE_ANCHOR;
    Game.combatStyleResolution = style => ({
        requested: style,
        effective: style,
        mode: { attack: 0, strength: 1, controlled: 2, defence: 3 }[style]
    });
    Game.combatMode = () => combatMode;
    Game.setCombatStyle = style => {
        selectedStyles.push(style);
        if (typeof style === 'string') {
            combatMode = { attack: 0, strength: 1, controlled: 2, defence: 3 }[style];
        }
        return true;
    };
    ChatDialog.canContinue = () => false;
    Duel.winOpen = () => false;
    Duel.active = () => false;
    Skills.level = skill => levels[skill] ?? 1;
    Skills.xp = skill =>
        ({
            attack: 1_200,
            strength: 1_250,
            hitpoints: 1_150,
            defence: 1_400,
            magic: 1_000_000
        })[skill] ?? 0;
    reader.modals = () => ({ main: -1, side: -1, chat: -1 });
    ScriptRunner.stop = reason => {
        stopReasons.push(reason);
    };
});

afterEach(() => {
    Date.now = original.now;
    Execution.delayUntil = original.delayUntil;
    Game.sceneReady = original.sceneReady;
    Game.tile = original.tile;
    Game.combatStyleResolution = original.combatStyleResolution;
    Game.combatMode = original.combatMode;
    Game.setCombatStyle = original.setCombatStyle;
    ChatDialog.canContinue = original.canContinue;
    Duel.winOpen = original.duelWinOpen;
    Duel.active = original.duelActive;
    Skills.level = original.level;
    Skills.xp = original.xp;
    reader.modals = original.modals;
    ScriptRunner.stop = original.stop;
    paintState.reset();
});

describe('Duel Arena paint', () => {
    test('shows combined Attack, Strength, Defence, and Hitpoints XP per hour', () => {
        expect(paintAt(60 * 60_000)).toContain('XP/hr: 1.0k');
    });

    test('shows Defence as opt-in at its default level-one target', () => {
        expect(paintAt(60 * 60_000)).toContain('Defence 50/1');
    });

    test('keeps the warm-up placeholder through the first thirty seconds', () => {
        expect(paintAt(30_000)).toContain('XP/hr: —');
    });
});

describe('Duel Arena settings', () => {
    test('requires an explicit Defence goal above level one', () => {
        expect(DUEL_ARENA_SETTINGS.targetDefence).toMatchObject({
            type: 'number',
            default: 1,
            min: 1,
            max: 99
        });
    });
});

describe('Duel Arena task integration', () => {
    test('omitted Defence target remains complete at level one and stops before selecting a style', async () => {
        levels = { attack: 5, strength: 5, defence: 1 };
        const bot = new DuelArena();
        bot.settings = new SettingsBag({ targetAttack: 5, targetStrength: 5 });
        bot.bindLog(() => {});

        try {
            await bot.onStart();
            await bot.loop();

            expect(bot.defenceTarget()).toBe(1);
            expect(stopReasons).toEqual(['Duel Arena targets reached']);
            expect(selectedStyles).toEqual([]);
        } finally {
            bot.onStop();
            bot.disposeSubscriptions();
        }
    });

    test('an explicit outstanding Defence target selects exact Defensive style', async () => {
        levels = { attack: 5, strength: 5, defence: 1 };
        const bot = new DuelArena();
        bot.settings = new SettingsBag({ targetAttack: 5, targetStrength: 5, targetDefence: 2 });
        bot.bindLog(() => {});

        try {
            await bot.onStart();
            await bot.loop();

            expect(bot.desiredStyle()).toBe('defence');
            expect(selectedStyles).toEqual(['defence']);
            expect(combatMode).toBe(3);
            expect(stopReasons).toEqual([]);
        } finally {
            bot.onStop();
            bot.disposeSubscriptions();
        }
    });
});
