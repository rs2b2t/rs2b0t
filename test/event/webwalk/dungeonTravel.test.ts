import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { reader, type InvItemSnapshot, type LocSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Npc } from '#/bot/api/npcs/Npcs.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { Input } from '#/bot/input/Input.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import type { NavPoint } from '#/bot/event/webwalk/types.js';
import { WalkExecutor } from '#/bot/event/webwalk/WalkExecutor.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import { stubProps } from '../../lib/stubSingletons.js';

const bank = { x: 3092, z: 3243, level: 0 };
const brim = { x: 2747, z: 3152, level: 0 };
const landing = { x: 2713, z: 9564, level: 0 };
const surface = { x: 3226, z: 3108, level: 0 };
const nest = { x: 3483, z: 9510, level: 2 };
const moss = { x: 2680, z: 9593, level: 0 };
const fire = { x: 2659, z: 9483, level: 0 };
const worker = { x: 3503, z: 9524, level: 2 };
const packPath = 'out/collision.lcnav.gz';
const supplies = () => ({ ...emptyWorldStateData(), skills: { agility: 12, woodcutting: 27 }, items: { Coins: 1000, 'Bronze axe': 1, Rope: 1, 'Shantay pass': 1 } });

describe.skipIf(!existsSync(packPath))('dungeon collision routes', () => {
    const finder = existsSync(packPath) ? new PathFinder(gunzipSync(readFileSync(packPath))) : undefined;
    if (finder) loadDefaultNavEdges(finder);
    test.each([moss, fire, worker])('routes from a mainland bank to %j and back', camp => {
        const out = finder!.findPath(bank, camp, { state: supplies(), useTeleportCatalog: false });
        expect(out.ok).toBe(true);
        const back = finder!.findPath(camp, bank, { state: { ...supplies(), items: { Coins: 40 } }, useTeleportCatalog: false });
        expect(back.ok).toBe(true);
    }, 30_000);
    test.each<{ camp: NavPoint; items: Record<string, number>; skills: Record<string, number> }>([
        { camp: moss, items: { Coins: 1000 }, skills: { woodcutting: 27, agility: 12 } },
        { camp: moss, items: { Coins: 1000, 'Bronze axe': 1 }, skills: { woodcutting: 26, agility: 12 } },
        { camp: fire, items: { Coins: 1000, 'Bronze axe': 1 }, skills: { woodcutting: 10, agility: 11 } },
        { camp: fire, items: { Coins: 874, 'Bronze axe': 1 }, skills: { woodcutting: 10, agility: 12 } },
        { camp: worker, items: {}, skills: {} }
    ])('blocks an entry missing its actual requirement: %j', ({ camp, items, skills }) => {
        expect(finder!.findPath(camp.level === 2 ? surface : brim, camp, {
            state: { ...emptyWorldStateData(), items, skills }, useTeleportCatalog: false
        }).ok).toBe(false);
    }, 30_000);
    test('a worn Black axe satisfies the vine tool check at Woodcutting 10', () => {
        expect(finder!.findPath(brim, fire, { state: {
            ...emptyWorldStateData(), items: { Coins: 875 }, worn: { 'Black axe': 1 }, skills: { agility: 12, woodcutting: 10 }
        }, useTeleportCatalog: false }).ok).toBe(true);
    }, 30_000);
});

describe('dungeon entry dispatch', () => {
    let restores: (() => void)[], tile = surface, locs: LocSnapshot[], inv: InvItemSnapshot[], modal: number, chat: boolean, paid: boolean, entered: number;
    const run = (kalphite: boolean) => WalkExecutor['handleTransport'](kalphite ? surface : brim, {
        ...(kalphite ? nest : landing), transport: {
            locId: kalphite ? 3827 : 5083, openLocId: kalphite ? 3828 : undefined,
            locName: kalphite ? 'Tunnel entrance' : 'Dungeon entrance', action: kalphite ? 'Climb-down' : 'Enter',
            locX: kalphite ? 3227 : 2743, locZ: kalphite ? 3108 : 3153,
            toTile: kalphite ? nest : landing, toLevel: kalphite ? 2 : undefined
        }
    }, () => {});
    beforeEach(() => {
        tile = surface; modal = -1; chat = false; paid = false; entered = 0;
        locs = [{ id: 3827, typecode: 10, name: 'Tunnel entrance', ops: [], tile: { x: 3227, z: 3108, level: 0 }, distance: 1 }];
        inv = [{ id: 954, slot: 0, name: 'Rope', count: 1, ops: [], comId: 3214 }];
        restores = [
            stubProps(reader, { worldTile: () => tile, locs: () => locs, inventory: () => inv, bankComId: () => -1, toLocal: (x, z) => ({ lx: x, lz: z }), modals: () => ({ main: modal, side: -1, chat: -1, viewport: -1 }) }),
            stubProps(EventSignal, { pending: () => false }),
            stubProps(Execution, { delayTicks: async () => {}, delayUntil: async check => check() }),
            stubProps(Input, {
                useItemOnLoc: (id, _slot, _com, x, z) => {
                    if (id !== 954 || x !== 3227 || z !== 3108) return false;
                    inv = [];locs = locs.map(l => ({ ...l, id: 3828, ops: ['Climb-down'] }));return true;
                },
                interactLoc: (x, z) => {
                    if (modal !== -1 || chat || (x === 2743 && !paid)) return false;
                    entered++;tile = x === 3227 && z === 3108 ? nest : landing;return true;
                }
            }),
            stubProps(ChatDialog, { isOpen: () => chat, canContinue: () => chat, continue: async () => { chat = false;modal = 100;return true; } }),
            stubProps(Modals, { close: async () => { modal = -1;return true; } }),
            stubProps(GameMessages, { mark: () => 0, sawSince: (_mark, pattern) => paid && pattern.test('You pay Saniboch 875 coins.') })
        ];
    });
    afterEach(() => { for (const restore of restores.reverse()) restore(); });
    test('attaches the rope then climbs the transformed entrance', async () => {
        expect(await run(true)).toBe(true);expect(tile).toEqual(nest);expect(inv).toEqual([]);expect(entered).toBe(1);
    });
    test('climbs an already roped entrance without consuming a spare', async () => {
        locs[0] = { ...locs[0]!, id: 3828, ops: ['Climb-down'] };
        expect(await run(true)).toBe(true);expect(tile).toEqual(nest);expect(inv).toHaveLength(1);
    });
    test('refuses an unroped entrance without a rope', async () => {
        inv = [];expect(await run(true)).toBe(false);expect(tile).toEqual(surface);expect(entered).toBe(0);
    });
    test('pays Saniboch and finishes both dialogue and the object box before entering', async () => {
        tile = brim;
        locs = [{ id: 5083, typecode: 10, name: 'Dungeon entrance', ops: ['Enter'], tile: { x: 2743, z: 3153, level: 0 }, distance: 4 }];
        restores.push(stubProps(Npc.prototype, { interact: async function(action) {
            if (this.id !== 1595 || action !== 'Pay') return false;
            paid = true;chat = true;return true;
        } }));
        restores.push(stubProps(reader, { npcs: () => [{ index: 1, id: 1595, anim: -1, name: 'Saniboch', level: 0, size: 1, tile: brim, distance: 1, ops: ['Talk-to', null, 'Pay'], inCombat: false, health: 1, totalHealth: 1, faceEntity: -1 }] }));
        expect(await run(false)).toBe(true);expect(tile).toEqual(landing);expect(entered).toBe(1);expect(modal).toBe(-1);
    });
    test('retries a prepaid entry using Saniboch dialogue without another coin decrease or game message', async () => {
        tile = brim;
        paid = true;
        inv = [{ id: 995, slot: 0, name: 'Coins', count: 125, ops: [], comId: 3214 }];
        locs = [{ id: 5083, typecode: 10, name: 'Dungeon entrance', ops: ['Enter'], tile: { x: 2743, z: 3153, level: 0 }, distance: 4 }];
        restores.push(stubProps(Npc.prototype, { interact: async function(action) {
            if (this.id !== 1595 || action !== 'Pay') return false;
            chat = true;
            return true;
        } }));
        restores.push(stubProps(reader, { npcs: () => [{ index: 1, id: 1595, anim: -1, name: 'Saniboch', level: 0, size: 1, tile: brim, distance: 1, ops: ['Talk-to', null, 'Pay'], inCombat: false, health: 1, totalHealth: 1, faceEntity: -1 }] }));
        restores.push(stubProps(ChatDialog, { texts: () => chat ? ['You have already given me lots of nice coins, you may go in.'] : [] }));
        restores.push(stubProps(GameMessages, { sawSince: () => false }));
        expect(await run(false)).toBe(true);
        expect(tile).toEqual(landing);
        expect(entered).toBe(1);
        expect(inv[0]?.count).toBe(125);
    });
});
