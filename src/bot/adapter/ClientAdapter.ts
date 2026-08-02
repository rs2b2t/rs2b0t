// docs/ARCHITECTURE.md#layers
import { MiniMenuAction } from '#/client/MiniMenuAction.js';
import Skill from '#/client/Skill.js';
import { ButtonType, ComponentType } from '#/config/IfType.js';
import IfType from '#/config/IfType.js';
import LocType from '#/config/LocType.js';
import ObjType from '#/config/ObjType.js';
import CollisionMap from '#/dash3d/CollisionMap.js';
import { ClientProt } from '#/io/ClientProt.js';

import { SELF_TEST, type RawClient } from './RawClient.js';

const SCENE_SIZE = 104;
const SCRATCH_SLOT = 499;

let raw: RawClient | null = null;
let packetListener: ((ptype: number) => void) | null = null;

export interface WorldTile {
    x: number;
    z: number;
    level: number;
}

export interface ChatLine {
    type: number;
    username: string | null;
    text: string;
}

export interface StatSnapshot {
    name: string;
    effective: number;
    base: number;
    xp: number;
}

export interface NpcSnapshot {
    index: number;
    id: number;
    anim: number;
    name: string | null;
    level: number;
    tile: WorldTile;
    distance: number;
    ops: (string | null)[];
    inCombat: boolean;
    health: number;
    totalHealth: number;
    faceEntity: number;
}

export interface PlayerSnapshot {
    index: number;
    name: string | null;
    tile: WorldTile;
    distance: number;
    inCombat: boolean;
}

export interface LocSnapshot {
    typecode: number;
    id: number;
    name: string | null;
    ops: (string | null)[];
    tile: WorldTile;
    distance: number;
}

export interface GroundItemSnapshot {
    id: number;
    name: string | null;
    count: number;
    ops: (string | null)[];
    tile: WorldTile;
    distance: number;
}

export interface InvItemSnapshot {
    slot: number;
    id: number;
    name: string | null;
    count: number;
    ops: (string | null)[];
    comId: number;
}

export interface SelectButtonLabel {
    mode: number;
    label: string;
}

export function attach(client: unknown): string[] {
    const missing = SELF_TEST.filter(name => !(name in (client as Record<string, unknown>)));
    raw = client as RawClient;

    if (!missing.includes('tcpIn')) {
        const orig = raw.tcpIn;
        raw.tcpIn = async function (this: RawClient): Promise<boolean> {
            const processed = await orig.call(this);
            if (processed && packetListener) {
                try {
                    packetListener(this.ptype0);
                } catch (err) {
                    console.error('[rs2b0t] packet listener error', err);
                }
            }
            return processed;
        };
    }

    return missing;
}

export function setPacketListener(cb: ((ptype: number) => void) | null): void {
    packetListener = cb;
}

export const reader = {
    attached(): boolean {
        return raw !== null;
    },

    ingame(): boolean {
        return raw?.ingame ?? false;
    },

    sceneState(): number {
        return raw?.sceneState ?? 0;
    },

    worldTile(): WorldTile | null {
        if (!raw || !raw.localPlayer) {
            return null;
        }

        return {
            x: raw.mapBuildBaseX + (raw.localPlayer.x >> 7),
            z: raw.mapBuildBaseZ + (raw.localPlayer.z >> 7),
            level: raw.minusedlevel
        };
    },

    /** Current map-build origin (world tile of local scene 0,0). */
    mapBuildBase(): { x: number; z: number } | null {
        if (!raw) {
            return null;
        }
        return { x: raw.mapBuildBaseX, z: raw.mapBuildBaseZ };
    },

    /**
     * Project a point on a world tile onto the bot overlay canvas (pixels).
     * `u`/`v` are fractional offsets within the tile (0 = west/south edge, 1 = east/north),
     * clamped to the tile interior so edge-of-scene tiles still project. Default 0.5,0.5 = centre.
     * Same projection as npcBox / Client.overlayPos.
     */
    overlayPosWorld(x: number, z: number, height = 0, u = 0.5, v = 0.5): { x: number; y: number } | null {
        if (!raw) {
            return null;
        }
        const lx = x - raw.mapBuildBaseX;
        const lz = z - raw.mapBuildBaseZ;
        if (lx < 0 || lz < 0 || lx >= SCENE_SIZE || lz >= SCENE_SIZE) {
            return null;
        }
        // Stay inside this tile's 128 scene units (u/v=1 → 127) so map-edge tiles work.
        const uu = Math.max(0, Math.min(1, u));
        const vv = Math.max(0, Math.min(1, v));
        const sceneX = (lx << 7) + Math.min(127, Math.floor(uu * 128));
        const sceneZ = (lz << 7) + Math.min(127, Math.floor(vv * 128));
        return raw.overlayPos(sceneX, sceneZ, height);
    },

    selfAnim(): number {
        return raw?.localPlayer?.primaryAnim ?? -1;
    },

    energy(): number {
        return raw?.runenergy ?? 0;
    },

    weight(): number {
        return raw?.runweight ?? 0;
    },

    skillCount(): number {
        return Skill.count;
    },

    skillUsed(index: number): boolean {
        return Skill.used[index] ?? false;
    },

    stat(index: number): StatSnapshot {
        return {
            name: Skill.names[index] ?? `#${index}`,
            effective: raw?.statEffectiveLevel[index] ?? 0,
            base: raw?.statBaseLevel[index] ?? 0,
            xp: raw?.statXP[index] ?? 0
        };
    },

    varp(index: number): number {
        return raw?.var[index] ?? 0;
    },

    chat(count: number): ChatLine[] {
        const lines: ChatLine[] = [];
        if (!raw) {
            return lines;
        }

        for (let i = 0; i < count && i < 100; i++) {
            const text = raw.chatText[i];
            if (text === null) {
                break;
            }

            lines.push({ type: raw.chatType[i], username: raw.chatUsername[i], text });
        }

        return lines;
    },

    playerCount(): number {
        return raw?.playerCount ?? 0;
    },

    npcCount(): number {
        return raw?.npcCount ?? 0;
    },

    /**
     * The eight corners of an NPC's bounding box in overlay-canvas pixels, ground
     * ring first then the top ring in the same winding, so edges are 0-1-2-3-0,
     * 4-5-6-7-4 and 0-4, 1-5, 2-6, 3-7. Null when the NPC is gone or off-screen.
     */
    npcBox(index: number): { x: number; y: number }[] | null {
        const npc = raw?.npc[index];
        if (!raw || !npc) {
            return null;
        }
        const half = npc.size * 64; // scene units are 128 per tile
        const corners: [number, number][] = [[-half, -half], [half, -half], [half, half], [-half, half]];
        const out: { x: number; y: number }[] = [];
        for (const height of [0, npc.height]) {
            for (const [dx, dz] of corners) {
                const p = raw.overlayPos(npc.x + dx, npc.z + dz, height);
                if (!p) {
                    return null;
                }
                out.push(p);
            }
        }
        return out;
    },

    npcs(): NpcSnapshot[] {
        const out: NpcSnapshot[] = [];
        if (!raw || !raw.localPlayer) {
            return out;
        }

        const px = raw.mapBuildBaseX + (raw.localPlayer.x >> 7);
        const pz = raw.mapBuildBaseZ + (raw.localPlayer.z >> 7);

        for (let i = 0; i < raw.npcCount; i++) {
            const npc = raw.npc[raw.npcIds[i]];
            if (!npc) {
                continue;
            }

            const x = raw.mapBuildBaseX + (npc.x >> 7);
            const z = raw.mapBuildBaseZ + (npc.z >> 7);
            out.push({
                index: raw.npcIds[i],
                id: npc.type?.id ?? -1,
                anim: npc.primaryAnim,
                name: npc.type?.name ?? null,
                level: npc.type?.vislevel ?? -1,
                tile: { x, z, level: raw.minusedlevel },
                distance: Math.max(Math.abs(x - px), Math.abs(z - pz)),
                ops: npc.type?.op ?? [],
                inCombat: combatShowing(npc.combatCycle),
                health: npc.health,
                totalHealth: npc.totalHealth,
                faceEntity: npc.faceEntity
            });
        }

        return out;
    },

    selfSlot(): number {
        return raw?.selfSlot ?? -1;
    },

    players(): PlayerSnapshot[] {
        const out: PlayerSnapshot[] = [];
        if (!raw || !raw.localPlayer) {
            return out;
        }

        const px = raw.mapBuildBaseX + (raw.localPlayer.x >> 7);
        const pz = raw.mapBuildBaseZ + (raw.localPlayer.z >> 7);

        for (let i = 0; i < raw.playerCount; i++) {
            const player = raw.players[raw.playerIds[i]];
            if (!player) {
                continue;
            }

            const x = raw.mapBuildBaseX + (player.x >> 7);
            const z = raw.mapBuildBaseZ + (player.z >> 7);
            out.push({
                index: raw.playerIds[i],
                name: player.name,
                tile: { x, z, level: raw.minusedlevel },
                distance: Math.max(Math.abs(x - px), Math.abs(z - pz)),
                inCombat: combatShowing(player.combatCycle)
            });
        }

        return out;
    },

    inCombat(): boolean {
        return raw?.localPlayer ? combatShowing(raw.localPlayer.combatCycle) : false;
    },

    locs(): LocSnapshot[] {
        const out: LocSnapshot[] = [];
        if (!raw || !raw.world || !raw.localPlayer) {
            return out;
        }

        const level = raw.minusedlevel;
        const px = raw.mapBuildBaseX + (raw.localPlayer.x >> 7);
        const pz = raw.mapBuildBaseZ + (raw.localPlayer.z >> 7);

        for (let lx = 0; lx < SCENE_SIZE; lx++) {
            for (let lz = 0; lz < SCENE_SIZE; lz++) {
                const typecodes = [raw.world.wallType(level, lx, lz), raw.world.sceneType(level, lx, lz), raw.world.gdType(level, lx, lz), raw.world.decorType(level, lz, lx)];

                for (const typecode of typecodes) {
                    if (typecode === 0) {
                        continue;
                    }

                    const id = (typecode >> 14) & 0x7fff;
                    const loc = LocType.list(id);
                    const x = raw.mapBuildBaseX + lx;
                    const z = raw.mapBuildBaseZ + lz;

                    out.push({
                        typecode,
                        id,
                        name: loc.name,
                        ops: loc.op ?? [],
                        tile: { x, z, level },
                        distance: Math.max(Math.abs(x - px), Math.abs(z - pz))
                    });
                }
            }
        }

        return out;
    },

    groundItems(): GroundItemSnapshot[] {
        const out: GroundItemSnapshot[] = [];
        if (!raw || !raw.localPlayer) {
            return out;
        }

        const level = raw.minusedlevel;
        const px = raw.mapBuildBaseX + (raw.localPlayer.x >> 7);
        const pz = raw.mapBuildBaseZ + (raw.localPlayer.z >> 7);

        for (let lx = 0; lx < SCENE_SIZE; lx++) {
            for (let lz = 0; lz < SCENE_SIZE; lz++) {
                const stack = raw.groundObj[level][lx][lz];
                if (!stack) {
                    continue;
                }

                const x = raw.mapBuildBaseX + lx;
                const z = raw.mapBuildBaseZ + lz;
                const distance = Math.max(Math.abs(x - px), Math.abs(z - pz));

                for (let obj = stack.head(); obj; obj = stack.next()) {
                    const type = ObjType.list(obj.id);
                    out.push({
                        id: obj.id,
                        name: type.name,
                        count: obj.count,
                        ops: groundOps(type.op),
                        tile: { x, z, level },
                        distance
                    });
                }
            }
        }

        return out;
    },

    inventory(): InvItemSnapshot[] {
        return readInvComponent(findTabInvComponent(3), type => heldOps(type.iop));
    },

    inventorySize(): number {
        const comId = findTabInvComponent(3);
        if (comId === -1) {
            return 0;
        }

        return IfType.list[comId].linkObjType?.length ?? 0;
    },

    equipment(): InvItemSnapshot[] {
        const comId = findTabInvComponent(4);
        if (comId === -1) {
            return [];
        }

        return readInvComponent(comId, () => IfType.list[comId].iop ?? []);
    },

    bankComId(): number {
        if (!raw || raw.mainModalId === -1) {
            return -1;
        }

        return findInvComponentIn(raw.mainModalId, com => (com.iop?.[0] ?? '').toLowerCase().includes('withdraw'));
    },

    bankItems(): InvItemSnapshot[] {
        const comId = reader.bankComId();
        if (comId === -1) {
            return [];
        }

        return readInvComponent(comId, () => IfType.list[comId].iop ?? []);
    },

    bankSideItems(): InvItemSnapshot[] {
        if (!raw || raw.sideModalId === -1) {
            return [];
        }

        const comId = findInvComponentIn(raw.sideModalId, com => (com.iop?.[0] ?? '').toLowerCase().includes('deposit'));
        if (comId === -1) {
            return [];
        }

        return readInvComponent(comId, () => IfType.list[comId].iop ?? []);
    },

    chatContinueComId(): number {
        if (!raw || raw.chatModalId === -1 || raw.resumedPauseButton) {
            return -1;
        }

        const modal = IfType.list[raw.chatModalId];
        if (!modal?.children) {
            return -1;
        }

        for (const childId of modal.children) {
            const child = IfType.list[childId];
            if (child && child.buttonType === ButtonType.BUTTON_CONTINUE) {
                return childId;
            }
        }

        return -1;
    },

    chatOptions(): { comId: number; text: string }[] {
        const out: { comId: number; text: string }[] = [];
        if (!raw || raw.chatModalId === -1) {
            return out;
        }

        const visit = (comId: number): void => {
            const com = IfType.list[comId];
            if (!com) {
                return;
            }
            if (com.buttonType === ButtonType.BUTTON_OK) {
                const label = com.text ?? com.buttonText;
                if (label) {
                    out.push({ comId, text: label });
                }
            }
            if (com.children) {
                for (const child of com.children) {
                    visit(child);
                }
            }
        };

        visit(raw.chatModalId);
        return out;
    },

    makeProducts(): { obj: number; name: string; buttons: { qty: number; comId: number }[] }[] {
        const root = raw?.chatModalId !== -1 ? (raw?.chatModalId ?? -1) : (raw?.mainModalId ?? -1);
        if (!raw || root === -1) {
            return [];
        }

        const objs: number[] = [];
        const buttons: { qty: number; comId: number }[] = [];
        const visit = (comId: number): void => {
            const com = IfType.list[comId];
            if (!com) {
                return;
            }
            if (com.model1Type === 4 && com.model1Id > 0) {
                objs.push(com.model1Id);
            }
            if (com.buttonType === ButtonType.BUTTON_OK && com.buttonText) {
                const m = /(?:make|smelt)\s+(x|\d+)/i.exec(com.buttonText);
                if (m) {
                    buttons.push({ qty: m[1].toLowerCase() === 'x' ? -1 : parseInt(m[1], 10), comId });
                }
            }
            if (com.children) {
                for (const child of com.children) {
                    visit(child);
                }
            }
        };
        visit(root);

        const products: { obj: number; name: string; buttons: { qty: number; comId: number }[] }[] = [];
        for (let i = 0; i < objs.length; i++) {
            products.push({ obj: objs[i], name: ObjType.list(objs[i]).name ?? '', buttons: buttons.slice(i * 4, i * 4 + 4) });
        }
        return products;
    },

    runControls(): { onComId: number; offComId: number } | null {
        if (cachedRunControls !== undefined) {
            return cachedRunControls;
        }

        cachedRunControls = null;
        for (const root of IfType.list) {
            if (!root?.children) {
                continue;
            }
            const hasRetaliate = root.children.some(c => IfType.list[c]?.text === 'Auto retaliate');
            if (!hasRetaliate || root.children.length <= 5) {
                continue;
            }

            const off = root.children[4];
            const on = root.children[5];
            if (IfType.list[on]?.buttonType !== undefined && IfType.list[off] !== undefined) {
                cachedRunControls = { onComId: on, offComId: off };
            }
            break;
        }

        return cachedRunControls;
    },

    retaliateControls(): { onComId: number; offComId: number } | null {
        if (cachedRetaliateControls !== null && cachedRetaliateControls !== undefined) {
            return cachedRetaliateControls;
        }

        for (const root of IfType.list) {
            if (!root?.children) {
                continue;
            }
            const hasRetaliate = root.children.some(c => IfType.list[c]?.text === 'Auto retaliate');
            if (!hasRetaliate || root.children.length <= 7) {
                continue;
            }

            const off = root.children[6];
            const on = root.children[7];
            if (IfType.list[on]?.buttonType !== undefined && IfType.list[off] !== undefined) {
                cachedRetaliateControls = { onComId: on, offComId: off };
                return cachedRetaliateControls;
            }
            break;
        }

        return null;
    },

    toWorld(lx: number, lz: number): WorldTile | null {
        if (!raw) {
            return null;
        }

        return { x: raw.mapBuildBaseX + lx, z: raw.mapBuildBaseZ + lz, level: raw.minusedlevel };
    },

    toLocal(x: number, z: number): { lx: number; lz: number } | null {
        if (!raw) {
            return null;
        }

        const lx = x - raw.mapBuildBaseX;
        const lz = z - raw.mapBuildBaseZ;
        if (lx < 0 || lz < 0 || lx >= SCENE_SIZE || lz >= SCENE_SIZE) {
            return null;
        }

        return { lx, lz };
    },

    collisionFlags(lx: number, lz: number): number | null {
        if (!raw || lx < 0 || lz < 0 || lx >= SCENE_SIZE || lz >= SCENE_SIZE) {
            return null;
        }
        const map = raw.collision[raw.minusedlevel];
        if (!map) {
            return null;
        }
        return map.flags[CollisionMap.index(lx, lz)];
    },

    localPlayerName(): string | null {
        return raw?.localPlayer?.name ?? null;
    },

    loginMessage(): string {
        if (!raw) {
            return '';
        }
        return [raw.loginMes1, raw.loginMes2].filter(Boolean).join('\n');
    },

    menuEntries(): string[] {
        if (!raw) {
            return [];
        }

        return raw.menuOption.slice(0, raw.menuNumEntries);
    },

    modals(): { main: number; side: number; chat: number } {
        return {
            main: raw?.mainModalId ?? -1,
            side: raw?.sideModalId ?? -1,
            chat: raw?.chatModalId ?? -1
        };
    },

    countDialogOpen(): boolean {
        return raw?.dialogInputOpen === true;
    },

    shopInv(comId: number): InvItemSnapshot[] {
        if (comId === -1) {
            return [];
        }

        return readInvComponent(comId, () => IfType.list[comId].iop ?? []);
    },

    // offer screen = main modal 3323 (pack in side 3321); confirm screen = main modal 3443
    tradeOfferOpen(): boolean {
        return raw?.mainModalId === 3323;
    },

    tradeConfirmOpen(): boolean {
        return raw?.mainModalId === 3443;
    },

    tradeMyOffer(): InvItemSnapshot[] {
        return readInvComponent(3415, () => IfType.list[3415]?.iop ?? []); // trademain:inv
    },

    tradeTheirOffer(): InvItemSnapshot[] {
        return readInvComponent(3416, () => IfType.list[3416]?.iop ?? []); // trademain:otherinv
    },

    tradeSidePack(): InvItemSnapshot[] {
        return readInvComponent(3322, () => IfType.list[3322]?.iop ?? []); // tradeside:inv — your pack while trading
    },

    tradePartner(): string | null {
        return IfType.list[3417]?.text ?? null; // trademain:otherplayer — "Trading With: <name>"
    },

    closeButtonComId(rootComId: number): number {
        if (!raw || rootComId === -1) {
            return -1;
        }

        return walkComponents(rootComId).find(com => com.buttonType === ButtonType.BUTTON_CLOSE)?.id ?? -1;
    },

    activeSideTab(): number {
        return raw?.activeIcon ?? -1;
    },

    ifText(comId: number): string | null {
        return IfType.list[comId]?.text ?? null;
    },

    mainModalTexts(): string[] {
        if (!raw || raw.mainModalId === -1) {
            return [];
        }

        return walkComponents(raw.mainModalId)
            .filter(com => com.type === ComponentType.TYPE_TEXT && com.text)
            .map(com => com.text!);
    },

    chatModalTexts(): string[] {
        if (!raw || raw.chatModalId === -1) {
            return [];
        }

        return walkComponents(raw.chatModalId)
            .filter(com => com.type === ComponentType.TYPE_TEXT && com.text)
            .map(com => com.text!);
    },

    ifModelObjId(comId: number): number | null {
        const com = IfType.list[comId];
        return com && com.model1Type === 4 ? com.model1Id : null;
    },

    buttonByText(rootComId: number, label: string): number {
        if (!raw) {
            return -1;
        }

        const want = label.toLowerCase();
        return walkComponents(rootComId).find(com => (com.buttonText ?? '').toLowerCase() === want)?.id ?? -1;
    },

    targetButtonByBase(rootComId: number, base: string): number {
        if (!raw) {
            return -1;
        }

        const want = base.toLowerCase();
        return walkComponents(rootComId).find(com => com.buttonType === ButtonType.BUTTON_TARGET && (com.targetBase ?? '').toLowerCase() === want)?.id ?? -1;
    },

    selectButtonByVarp(rootComId: number, varp: number, value: number): number {
        if (!raw) {
            return -1;
        }

        return walkComponents(rootComId).find(com => com.buttonType === ButtonType.BUTTON_SELECT && com.scripts?.[0]?.[0] === 5 && com.scripts[0][1] === varp && com.scriptOperand?.[0] === value)?.id ?? -1;
    },

    selectButtonLabelsByVarp(rootComId: number, varp: number): SelectButtonLabel[] {
        if (!raw) {
            return [];
        }
        return readSelectButtonLabelsByVarp(rootComId, varp);
    },

    mainSkillMultiItems(): InvItemSnapshot[] {
        if (!raw || raw.mainModalId === -1) {
            return [];
        }

        const out: InvItemSnapshot[] = [];
        for (const com of walkComponents(raw.mainModalId)) {
            if (com.type === ComponentType.TYPE_INV && com.iop?.some(op => op !== null && op.toLowerCase().startsWith('make'))) {
                out.push(...readInvComponent(com.id, () => com.iop ?? []));
            }
        }

        return out;
    },

    sideTabInterface(tab: number): number {
        return raw?.sideIcon[tab] ?? -1;
    },

    questStatuses(): { comId: number; name: string; colour: number }[] {
        const QUEST_TAB = 2;
        const root = reader.sideTabInterface(QUEST_TAB);
        if (root === -1) {
            return [];
        }

        const out: { comId: number; name: string; colour: number }[] = [];
        for (const com of walkComponents(root)) {
            if (com.type === ComponentType.TYPE_TEXT && com.text) {
                out.push({ comId: com.id, name: com.text, colour: com.colour });
            }
        }

        return out;
    }
};

export const actions = {
    loginCredentials(): { username: string; password: string } {
        return { username: raw?.loginUser ?? '', password: raw?.loginPass ?? '' };
    },

    login(username: string, password: string): boolean {
        if (!raw || raw.ingame) {
            return false;
        }

        return raw.startLogin(username, password);
    },

    menuAction(action: number, a: number, b: number, c: number): boolean {
        if (!raw || !raw.ingame) {
            return false;
        }

        raw.menuAction[SCRATCH_SLOT] = action;
        raw.menuParamA[SCRATCH_SLOT] = a;
        raw.menuParamB[SCRATCH_SLOT] = b;
        raw.menuParamC[SCRATCH_SLOT] = c;
        raw.doAction(SCRATCH_SLOT);
        return true;
    },

    answerCountDialog(value: number): boolean {
        if (!raw || !raw.ingame || !raw.out || !raw.dialogInputOpen) {
            return false;
        }
        raw.out.p1Enc(ClientProt.RESUME_P_COUNTDIALOG);
        raw.out.p4(Math.max(0, Math.floor(value)));
        raw.dialogInputOpen = false;
        return true;
    },

    walkTo(lx: number, lz: number): boolean {
        if (!raw || !raw.ingame || !raw.localPlayer) {
            return false;
        }

        return raw.tryMove(raw.localPlayer.routeX[0], raw.localPlayer.routeZ[0], lx, lz, true, 0, 0, 0, 0, 0, 0);
    },

    continueDialog(): boolean {
        const comId = reader.chatContinueComId();
        if (comId === -1) {
            return false;
        }

        return actions.menuAction(MiniMenuAction.PAUSE_BUTTON, 0, 0, comId);
    },

    ifButton(comId: number): boolean {
        return actions.menuAction(MiniMenuAction.IF_BUTTON, 0, 0, comId);
    },

    setRun(on: boolean): boolean {
        const controls = reader.runControls();
        if (!controls) {
            return false;
        }

        return actions.ifButton(on ? controls.onComId : controls.offComId);
    },

    /** Toggle Auto Retaliate on the combat tab (same panel as run). */
    setRetaliate(on: boolean): boolean {
        const controls = reader.retaliateControls();
        if (!controls) {
            return false;
        }

        return actions.ifButton(on ? controls.onComId : controls.offComId);
    },

    clickSideTab(tab: number): boolean {
        if (!raw || (raw.sideIcon[tab] ?? -1) === -1) {
            return false;
        }

        raw.activeIcon = tab;
        raw.redrawSide = true;
        raw.redrawIcons = true;
        return true;
    },

    closeMainModal(comId: number): boolean {
        if (!raw || raw.mainModalId !== comId) {
            return false;
        }

        raw.mainModalId = -1;
        return true;
    },

    closeModal(): boolean {
        if (!raw || raw.mainModalId === -1) {
            return false;
        }

        const comId = reader.closeButtonComId(raw.mainModalId);
        if (comId === -1) {
            return false;
        }

        return actions.menuAction(MiniMenuAction.CLOSE_BUTTON, 0, 0, comId);
    }
};

export const WELCOME_SCREEN = 5993;

function walkComponents(rootComId: number): IfType[] {
    const out: IfType[] = [];
    const queue: number[] = [rootComId];
    while (queue.length > 0) {
        const com = IfType.list[queue.shift()!];
        if (!com) {
            continue;
        }

        out.push(com);
        if (com.children) {
            queue.push(...com.children);
        }
    }

    return out;
}

/** Read each select button together with the style text rendered beside it. */
export function readSelectButtonLabelsByVarp(rootComId: number, varp: number): SelectButtonLabel[] {
    const components = walkPositionedComponents(rootComId);
    const styleLabels = components.filter(({ com }) => com.type === ComponentType.TYPE_TEXT && isCombatStyleLabel(com.text));
    const buttons = components
        .filter(({ com }) => com.buttonType === ButtonType.BUTTON_SELECT && com.scripts?.[0]?.[0] === 5 && com.scripts[0][1] === varp && com.scriptOperand?.[0] !== undefined)
        .sort((a, b) => a.y - b.y || a.x - b.x || a.com.id - b.com.id);

    const options: SelectButtonLabel[] = [];
    for (const button of buttons) {
        const label = styleLabels
            .filter(candidate => candidate.parentId === button.parentId && verticalCentre(candidate) >= button.y && verticalCentre(candidate) <= button.y + button.com.height)
            .sort((a, b) => Math.abs(verticalCentre(a) - verticalCentre(button)) - Math.abs(verticalCentre(b) - verticalCentre(button)))[0]?.com.text;
        if (label !== null && label !== undefined) {
            options.push({ mode: button.com.scriptOperand![0], label });
        }
    }
    return options;
}

interface PositionedComponent {
    com: IfType;
    parentId: number;
    x: number;
    y: number;
}

function walkPositionedComponents(rootComId: number): PositionedComponent[] {
    const out: PositionedComponent[] = [];
    const queue: { id: number; parentId: number; x: number; y: number }[] = [{ id: rootComId, parentId: -1, x: 0, y: 0 }];
    while (queue.length > 0) {
        const current = queue.shift()!;
        const com = IfType.list[current.id];
        if (!com) {
            continue;
        }

        out.push({ com, parentId: current.parentId, x: current.x, y: current.y });
        if (com.children) {
            for (let i = 0; i < com.children.length; i++) {
                queue.push({
                    id: com.children[i],
                    parentId: com.id,
                    x: current.x + (com.childX?.[i] ?? 0),
                    y: current.y + (com.childY?.[i] ?? 0)
                });
            }
        }
    }

    return out;
}

function verticalCentre(component: PositionedComponent): number {
    return component.y + component.com.height / 2;
}

function isCombatStyleLabel(text: string | null): boolean {
    return /^\s*\((?:accurate|aggressive|controlled|defensive)\)\s*$/i.test(text ?? '');
}

function groundOps(op: (string | null)[] | null): (string | null)[] {
    const ops = [...(op ?? [null, null, null, null, null])];
    if (!ops[2]) {
        ops[2] = 'Take';
    }

    return ops;
}

function heldOps(iop: (string | null)[] | null): (string | null)[] {
    const ops = [...(iop ?? [null, null, null, null, null])];
    if (!ops[4]) {
        ops[4] = 'Drop';
    }

    return ops;
}

function combatShowing(combatCycle: number): boolean {
    return combatCycle > loopCycleNow() + 100;
}

function loopCycleNow(): number {
    return raw ? ((raw as unknown as { constructor: { loopCycle: number } }).constructor.loopCycle ?? 0) : 0;
}

const cachedTabInvComId = new Map<number, number>();
let cachedRunControls: { onComId: number; offComId: number } | null | undefined = undefined;
let cachedRetaliateControls: { onComId: number; offComId: number } | null | undefined = undefined;

function findTabInvComponent(tabIndex: number): number {
    if (!raw) {
        return -1;
    }

    const cached = cachedTabInvComId.get(tabIndex);
    if (cached !== undefined) {
        return cached;
    }

    const tabInterfaceId = raw.sideIcon[tabIndex];
    if (tabInterfaceId === undefined || tabInterfaceId === -1) {
        return -1;
    }

    const comId = findInvComponentIn(tabInterfaceId, com => com.objOps === true || tabIndex === 4);
    if (comId !== -1) {
        cachedTabInvComId.set(tabIndex, comId);
    }

    return comId;
}

function findInvComponentIn(rootComId: number, accept: (com: IfType) => boolean): number {
    const queue: number[] = [rootComId];
    while (queue.length > 0) {
        const com = IfType.list[queue.shift()!];
        if (!com) {
            continue;
        }

        if (com.type === ComponentType.TYPE_INV && accept(com)) {
            return com.id;
        }

        if (com.children) {
            queue.push(...com.children);
        }
    }

    return -1;
}

function readInvComponent(comId: number, opsOf: (type: ObjType) => (string | null)[]): InvItemSnapshot[] {
    const out: InvItemSnapshot[] = [];
    if (comId === -1) {
        return out;
    }

    const com = IfType.list[comId];
    if (!com.linkObjType || !com.linkObjNumber) {
        return out;
    }

    for (let slot = 0; slot < com.linkObjType.length; slot++) {
        const idPlusOne = com.linkObjType[slot];
        if (idPlusOne <= 0) {
            continue;
        }

        const id = idPlusOne - 1;
        const type = ObjType.list(id);
        out.push({
            slot,
            id,
            name: type.name,
            count: com.linkObjNumber[slot],
            ops: opsOf(type),
            comId
        });
    }

    return out;
}
