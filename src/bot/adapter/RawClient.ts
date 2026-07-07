import type ClientNpc from '#/dash3d/ClientNpc.js';
import type ClientObj from '#/dash3d/ClientObj.js';
import type ClientPlayer from '#/dash3d/ClientPlayer.js';
import type CollisionMap from '#/dash3d/CollisionMap.js';
import type World from '#/dash3d/World.js';
import type LinkList from '#/datastruct/LinkList.js';
import type Packet from '#/io/Packet.js';

/**
 * Structural type of every Client internal the bot touches, verified against
 * Client-TS@274. The adapter casts the live client instance to this shape —
 * `private` is compile-time-only, and the bot bundle never mangles property
 * names, so dot-access through this type is stable at runtime.
 *
 * This file and ClientAdapter.ts are the ONLY places allowed to name client
 * internals. When an upstream merge renames something, the self-test banner
 * lists it and the fix happens here.
 */
export interface RawClient {
    // state
    ingame: boolean;
    sceneState: number;

    // scene base (world tile = mapBuildBase + (entity.x >> 7), plane = minusedlevel)
    mapBuildBaseX: number;
    mapBuildBaseZ: number;
    minusedlevel: number;

    // entities
    localPlayer: ClientPlayer | null;
    players: (ClientPlayer | null)[];
    playerIds: Int32Array;
    playerCount: number;
    npc: (ClientNpc | null)[];
    npcIds: Int32Array;
    npcCount: number;

    // stats (Int32Array[Skill.count])
    statBaseLevel: Int32Array;
    statEffectiveLevel: Int32Array;
    statXP: Int32Array;
    runenergy: number; // 0-100
    runweight: number; // kg

    // varps
    var: number[];

    // chat ring, newest at 0, capacity 100
    chatType: Int32Array;
    chatUsername: (string | null)[];
    chatText: (string | null)[];

    // minimenu
    menuNumEntries: number;
    menuOption: string[];
    menuAction: Int32Array;
    menuParamA: Int32Array;
    menuParamB: Int32Array;
    menuParamC: Int32Array;

    // modals
    chatModalId: number;
    mainModalId: number;
    sideModalId: number;

    // scene (loc + ground item enumeration)
    world: World | null;
    groundObj: (LinkList<ClientObj> | null)[][][];

    // live per-level collision (rebuilt each scene load; includes door state
    // and dynamic blockers — Client.ts:224, private is compile-time-only)
    collision: (CollisionMap | null)[];

    // sidebar tabs (sideIcon[3] = backpack interface id)
    sideIcon: number[];

    // dialog state
    resumedPauseButton: boolean;

    // interaction primitives (Slice 3): doAction dispatches a menu slot to
    // the byte-identical OP packet a human click produces; tryMove runs the
    // local BFS and writes MOVE_GAMECLICK(0)/MINIMAPCLICK(1)/OPCLICK(2)
    doAction(optionId: number): void;
    tryMove(srcX: number, srcZ: number, dx: number, dz: number, tryNearest: boolean, locWidth: number, locLength: number, locAngle: number, locShape: number, forceapproach: number, type: number): boolean;

    // outbound packet stream — for writing raw client packets the doAction/
    // tryMove path doesn't cover (public chat: MESSAGE_PUBLIC + WordPack text).
    out: Packet;

    // packet pump (H4): tcpIn processes ONE packet per `true` return and
    // records its opcode in ptype0 just before dispatch (Client.ts ~5923)
    ptype0: number;
    tcpIn(): Promise<boolean>;

    // login state for auto-relogin (Slice 7). NOTE: Client.logout() clears
    // loginUser/loginPass, so credentials are captured while still ingame.
    loginUser: string;
    loginPass: string;
    // title-screen status line — login() clears it synchronously at the start
    // of each fresh attempt, so it always reflects the LAST attempt's response
    loginMes1: string;
    login(username: string, password: string, reconnect: boolean): Promise<void>;

    // ---- synthetic input (Slice 6) ----

    // GameShell mouse state + the protected handlers the DOM listeners call.
    // VirtualInput invokes these (never DOM events): mouseDown reads only
    // e.button, mouseUp/pointerMove ignore the event arg; all three touch
    // idleTimer themselves (GameShell.ts ~317-418).
    idleTimer: number;
    mouseX: number;
    mouseY: number;
    mouseButton: number;
    mouseClickX: number;
    mouseClickY: number;
    mouseClickButton: number;
    mouseDown(x: number, y: number, e: MouseEvent): void;
    mouseUp(x: number, y: number, e: MouseEvent): void;
    pointerMove(x: number, y: number, e: PointerEvent): void;

    // GameShell keyboard state: keyHeld[1..4] = arrows (camera), chars >4 go
    // through the ring queue (GameShell.onkeydown ~426). Injection mirrors
    // onkeydown/onkeyup including the idleTimer touch.
    keyHeld: number[];
    keyQueue: number[];
    keyQueueWritePos: number;

    // open minimenu geometry (Client.ts ~427, row layout in mouseLoop ~8290:
    // row i spans y in (menuY + (n-1-i)*15 + 31 - 13, ... + 3), area offsets
    // 0=(4,4) viewport / 1=(553,205) sidebar / 2=(17,357) chat)
    isMenuOpen: boolean;
    menuArea: number;
    menuX: number;
    menuY: number;
    menuWidth: number;
    menuHeight: number;

    // render camera + ground height, for world->screen projection
    // (getOverlayPos, Client.ts ~5017; viewport origin = (256,167) blitted
    // at (4,4))
    camX: number;
    camY: number;
    camZ: number;
    camPitch: number;
    camYaw: number;
    getAvH(sceneX: number, sceneZ: number, level: number): number;

    // minimap click math (minimapLoop, Client.ts ~2742): yaw/zoom inputs of
    // the screen->tile transform we invert for synthetic walk clicks
    orbitCameraYaw: number;
    macroMinimapAngle: number;
    macroMinimapZoom: number;
    minimapState: number;

    // selected sidebar tab (iconLoop ~2787 sets it from the icon strip)
    activeIcon: number;

    // redraw flags iconLoop sets on a real tab click (Client.ts ~2802-2857);
    // gameDraw's redrawIcons branch (~4017) sends TUT_CLICKSIDE the next
    // frame activeIcon matches a server-flashed tab, so setting these
    // reproduces a real click for the tutorial's flashing-tab steps
    redrawSide: boolean;
    redrawIcons: boolean;
}

/**
 * Runtime manifest for the adapter self-test: every name above, checked with
 * `in` against the live instance at attach(). The satisfies clause plus the
 * exhaustiveness alias below make it a compile error for this list to drift
 * from the interface.
 */
export const SELF_TEST = [
    'ingame',
    'sceneState',
    'mapBuildBaseX',
    'mapBuildBaseZ',
    'minusedlevel',
    'localPlayer',
    'players',
    'playerIds',
    'playerCount',
    'npc',
    'npcIds',
    'npcCount',
    'statBaseLevel',
    'statEffectiveLevel',
    'statXP',
    'runenergy',
    'runweight',
    'var',
    'chatType',
    'chatUsername',
    'chatText',
    'menuNumEntries',
    'menuOption',
    'menuAction',
    'menuParamA',
    'menuParamB',
    'menuParamC',
    'chatModalId',
    'mainModalId',
    'sideModalId',
    'world',
    'groundObj',
    'collision',
    'sideIcon',
    'resumedPauseButton',
    'doAction',
    'tryMove',
    'out',
    'ptype0',
    'tcpIn',
    'loginUser',
    'loginPass',
    'loginMes1',
    'login',
    'idleTimer',
    'mouseX',
    'mouseY',
    'mouseButton',
    'mouseClickX',
    'mouseClickY',
    'mouseClickButton',
    'mouseDown',
    'mouseUp',
    'pointerMove',
    'keyHeld',
    'keyQueue',
    'keyQueueWritePos',
    'isMenuOpen',
    'menuArea',
    'menuX',
    'menuY',
    'menuWidth',
    'menuHeight',
    'camX',
    'camY',
    'camZ',
    'camPitch',
    'camYaw',
    'getAvH',
    'orbitCameraYaw',
    'macroMinimapAngle',
    'macroMinimapZoom',
    'minimapState',
    'activeIcon',
    'redrawSide',
    'redrawIcons'
] as const satisfies readonly (keyof RawClient)[];

type AssertNever<T extends never> = T;
// Errors here if a RawClient member is missing from SELF_TEST:
type _ManifestComplete = AssertNever<Exclude<keyof RawClient, (typeof SELF_TEST)[number]>>;
