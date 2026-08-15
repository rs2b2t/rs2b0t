import { describe, expect, test } from 'bun:test';
import {
    classifyWebSlashChat,
    isContentKnifeName,
    isSlashWeaponName,
    isSlashWebTransport,
    recordsHaveSlashTool,
    WEB_SLASH_FAIL,
    WEB_SLASH_KNIFE_NAME,
    WEB_SLASH_NO_BLADE,
    WEB_SLASH_SUCCESS
} from '#/bot/event/webwalk/slashTool.js';
import { meetsRequires } from '#/bot/event/webwalk/requires.js';
import { itemsRequiredByWaypoints, missingItemsForPath } from '#/bot/event/webwalk/bankPlan.js';
import { virtualizeWithItems } from '#/bot/event/webwalk/virtualState.js';
import { emptyWorldStateData, worldStateFromData } from '#/bot/event/webwalk/worldStateData.js';
import type { Waypoint } from '#/bot/event/webwalk/PathFinder.js';
import { agilityShortcutEdges } from '#/bot/event/webwalk/travelCatalog.js';

describe('slashTool', () => {
    test('plain Knife is content knife; metal knives are not', () => {
        expect(isContentKnifeName('Knife')).toBe(true);
        expect(isContentKnifeName('knife')).toBe(true);
        expect(isContentKnifeName('Bronze knife')).toBe(false);
        expect(isSlashWeaponName('Bronze knife')).toBe(false);
        expect(isSlashWeaponName('Bronze scimitar')).toBe(true);
        expect(isSlashWeaponName('Rune longsword')).toBe(true);
    });

    test('recordsHaveSlashTool sees inv knife or worn scimitar', () => {
        expect(recordsHaveSlashTool({ Knife: 1 }, {})).toBe(true);
        expect(recordsHaveSlashTool({}, { 'Bronze scimitar': 1 })).toBe(true);
        expect(recordsHaveSlashTool({ 'Bronze knife': 5 }, {})).toBe(false);
        expect(recordsHaveSlashTool({}, {})).toBe(false);
    });

    test('isSlashWebTransport matches bigweb rows', () => {
        expect(isSlashWebTransport('Web', 'Slash')).toBe(true);
        expect(isSlashWebTransport('Door', 'Open')).toBe(false);
    });

    test('web.rs2 chat strings classify success / fail / no blade', () => {
        expect(WEB_SLASH_SUCCESS.test('You slash the web apart.')).toBe(true);
        expect(WEB_SLASH_FAIL.test('You fail to cut through it.')).toBe(true);
        expect(WEB_SLASH_NO_BLADE.test('Only a sharp blade can cut through this sticky web.')).toBe(
            true
        );
        expect(classifyWebSlashChat('You slash the web apart.')).toBe('success');
        expect(classifyWebSlashChat('You fail to cut through it.')).toBe('fail');
        expect(classifyWebSlashChat('Only a sharp blade can cut through this sticky web.')).toBe(
            'no_blade'
        );
        expect(classifyWebSlashChat('I can\'t reach that!')).toBe(null);
    });
});

describe('slashTool requires + bank plan', () => {
    test('meetsRequires slashTool fails only when canSlashWeb is false', () => {
        const req = { slashTool: true as const };
        const no = worldStateFromData({ ...emptyWorldStateData(), canSlashWeb: false });
        expect(meetsRequires(req, no).ok).toBe(false);

        const yes = worldStateFromData({ ...emptyWorldStateData(), canSlashWeb: true });
        expect(meetsRequires(req, yes).ok).toBe(true);

        // Offline / unknown — fail open
        const unknown = worldStateFromData(emptyWorldStateData());
        expect(meetsRequires(req, unknown).ok).toBe(true);
    });

    test('web hop on path needs Knife when canSlashWeb is false', () => {
        const path: Waypoint[] = [
            { x: 2569, z: 3117, level: 0 },
            {
                x: 2569,
                z: 3119,
                level: 0,
                transport: {
                    locName: 'Web',
                    action: 'Slash',
                    locX: 2569,
                    locZ: 3118,
                    kind: 'door'
                }
            }
        ];
        expect(itemsRequiredByWaypoints(path)[WEB_SLASH_KNIFE_NAME]).toBe(1);

        const empty = emptyWorldStateData();
        empty.canSlashWeb = false;
        expect(missingItemsForPath(path, empty)).toEqual([{ name: 'Knife', count: 1 }]);

        empty.canSlashWeb = true;
        empty.items = { Knife: 1 };
        expect(missingItemsForPath(path, empty)).toEqual([]);

        // Blade counts as canSlashWeb — no Knife withdraw
        const blade = emptyWorldStateData();
        blade.canSlashWeb = true;
        blade.worn = { 'Iron scimitar': 1 };
        expect(missingItemsForPath(path, blade)).toEqual([]);
    });

    test('virtualizeWithItems sets canSlashWeb when bank has Knife', () => {
        const base = emptyWorldStateData();
        base.canSlashWeb = false;
        const v = virtualizeWithItems(base, { Knife: 1 });
        expect(v.canSlashWeb).toBe(true);
        expect(v.items.Knife).toBe(1);
    });
});

describe('yanille balancing ledge catalog', () => {
    test('agility shortcuts include dual Yanille dungeon ledge edges', () => {
        const edges = agilityShortcutEdges();
        const ledge = edges.filter(e => /yanille_balancing_ledge/i.test(e.debugName ?? ''));
        expect(ledge).toHaveLength(2);
        expect(ledge.every(e => e.locName === 'Balancing ledge' && e.action === 'Walk-across')).toBe(true);
        expect(ledge.every(e => e.requires?.skills?.some(s => s.name === 'agility' && s.level === 40))).toBe(
            true
        );
    });
});

describe('elkoy maze catalog', () => {
    test('dual Elkoy portal edges require Tree Gnome Village started', async () => {
        const { elkoyMazeEdges } = await import('#/bot/event/webwalk/travelCatalog.js');
        const edges = elkoyMazeEdges();
        expect(edges).toHaveLength(2);
        expect(edges.every(e => e.locName === 'Elkoy' && e.action === 'Talk-to')).toBe(true);
        expect(
            edges.every(e =>
                e.requires?.quests?.some(
                    q => q.quest === 'Tree Gnome Village' && q.minStatus === 'started'
                )
            )
        ).toBe(true);
        // Content lands: entrance 2504,3192 ↔ maze 2515,3159
        const outs = edges.find(e => e.debugName === 'elkoy_outside_to_village');
        expect(outs?.from).toEqual({ x: 2504, z: 3192, level: 0 });
        expect(outs?.to).toEqual({ x: 2515, z: 3159, level: 0 });
    });
});
