import type ClientNpc from '#/dash3d/ClientNpc.js';
import type ClientObj from '#/dash3d/ClientObj.js';
import type ClientPlayer from '#/dash3d/ClientPlayer.js';
import type CollisionMap from '#/dash3d/CollisionMap.js';
import type World from '#/dash3d/World.js';
import type LinkList from '#/datastruct/LinkList.js';
import type Packet from '#/io/Packet.js';

export interface RawClient {
    ingame: boolean;
    sceneState: number;

    mapBuildBaseX: number;
    mapBuildBaseZ: number;
    minusedlevel: number;

    localPlayer: ClientPlayer | null;
    players: (ClientPlayer | null)[];
    playerIds: Int32Array;
    playerCount: number;
    npc: (ClientNpc | null)[];
    npcIds: Int32Array;
    npcCount: number;
    selfSlot: number;

    statBaseLevel: Int32Array;
    statEffectiveLevel: Int32Array;
    statXP: Int32Array;
    runenergy: number;
    runweight: number;

    var: number[];

    chatType: Int32Array;
    chatUsername: (string | null)[];
    chatText: (string | null)[];

    menuNumEntries: number;
    menuOption: string[];
    menuAction: Int32Array;
    menuParamA: Int32Array;
    menuParamB: Int32Array;
    menuParamC: Int32Array;

    chatModalId: number;
    mainModalId: number;
    sideModalId: number;

    world: World | null;
    groundObj: (LinkList<ClientObj> | null)[][][];

    collision: (CollisionMap | null)[];

    sideIcon: number[];

    resumedPauseButton: boolean;
    dialogInputOpen: boolean;

    doAction(optionId: number): void;
    tryMove(srcX: number, srcZ: number, dx: number, dz: number, tryNearest: boolean, locWidth: number, locLength: number, locAngle: number, locShape: number, forceapproach: number, type: number): boolean;

    out: Packet;

    ptype0: number;
    tcpIn(): Promise<boolean>;

    loginUser: string;
    loginPass: string;
    loginMes1: string;
    login(username: string, password: string, reconnect: boolean): Promise<void>;

    activeIcon: number;

    redrawSide: boolean;
    redrawIcons: boolean;
}

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
    'selfSlot',
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
    'dialogInputOpen',
    'doAction',
    'tryMove',
    'out',
    'ptype0',
    'tcpIn',
    'loginUser',
    'loginPass',
    'loginMes1',
    'login',
    'activeIcon',
    'redrawSide',
    'redrawIcons'
] as const satisfies readonly (keyof RawClient)[];

type AssertNever<T extends never> = T;
type _ManifestComplete = AssertNever<Exclude<keyof RawClient, (typeof SELF_TEST)[number]>>;
