import { MiniMenuAction } from '#/client/MiniMenuAction.js';
import Skill from '#/client/Skill.js';
import { ButtonType, ComponentType } from '#/config/IfType.js';
import IfType from '#/config/IfType.js';
import LocType from '#/config/LocType.js';
import ObjType from '#/config/ObjType.js';
import CollisionMap from '#/dash3d/CollisionMap.js';
import Model from '#/dash3d/Model.js';
import Pix3D from '#/dash3d/Pix3D.js';
import { ClientProt } from '#/io/ClientProt.js';
import WordPack from '#/wordfilter/WordPack.js';

import { SELF_TEST, type RawClient } from './RawClient.js';

const SCENE_SIZE = 104;
/** Scratch minimenu slot for direct actions (arrays are length 500; the real
 *  menu builder never reaches this high). */
const SCRATCH_SLOT = 499;

// Fixed 765x503 layout facts (verified on 274):
// - 3D viewport PixMap is 512x334, blitted at (4,4); projection origin is its
//   center (Pix3D.originX/Y while the scene renders).
// - minimap click region: mouseClick - (575, 8), 146x151, centered at (73,75)
//   (minimapLoop, Client.ts ~2747).
// - sidebar interfaces are hit-tested at root offset (553,205), chat at
//   (17,357), main modal at (4,4) (buildMinimenu, Client.ts ~2526).
const VIEW_X = 4;
const VIEW_Y = 4;
const VIEW_W = 512;
const VIEW_H = 334;
const VIEW_ORIGIN_X = 256;
const VIEW_ORIGIN_Y = 167;
const MENU_AREA_OFFSETS: [number, number][] = [
    [4, 4],
    [553, 205],
    [17, 357]
];
// sidebar tab icon hit rects (iconLoop, Client.ts ~2792), indexed by tab
const SIDE_TAB_RECTS: [number, number, number, number][] = [
    [539, 169, 34, 36],
    [569, 168, 30, 37],
    [597, 168, 30, 37],
    [625, 168, 44, 35],
    [666, 168, 30, 37],
    [694, 168, 30, 37],
    [722, 169, 34, 36],
    [540, 466, 34, 36],
    [572, 466, 30, 37],
    [599, 466, 30, 37],
    [627, 467, 44, 35],
    [669, 466, 30, 37],
    [696, 466, 30, 37],
    [724, 466, 34, 36]
];

/**
 * THE ONLY file that reads or writes client internals. Everything else in
 * src/bot/ goes through `reader` (and, from Slice 3, `actions`). An upstream
 * rename is fixed here and in RawClient.ts — nowhere else.
 */

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
    /** Scene slot index — stable while the NPC stays in the scene. */
    index: number;
    /** NPC type (config) id from the NpcType — distinct from the scene slot `index`. */
    id: number;
    /** Active primary animation id (seq), or -1 when idle. */
    anim: number;
    name: string | null;
    /** Combat level shown in the minimenu (-1 if none). */
    level: number;
    tile: WorldTile;
    /** Chebyshev tile distance from the local player. */
    distance: number;
    /** Right-click ops from the npc type (interact by matching these). */
    ops: (string | null)[];
    /** In combat (health bar showing) right now. */
    inCombat: boolean;
    health: number;
    totalHealth: number;
}

export interface PlayerSnapshot {
    index: number;
    name: string | null;
    tile: WorldTile;
    distance: number;
    inCombat: boolean;
}

export interface LocSnapshot {
    /** Scene typecode — menuParamA for OPLOC*. */
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
    /**
     * Ops for this slot. For the backpack, these are the object's own
     * held ops (iop), e.g. Bury/Eat/Wield, dispatched OPHELD*. For a
     * container that defines its own button labels instead (equipment's
     * 'Remove', the bank's 'Withdraw-1'/'Deposit-1'), these are the
     * component's ops and dispatch INV_BUTTON* — see `reader.equipment()`'s
     * doc comment for why the two aren't interchangeable.
     */
    ops: (string | null)[];
    /** The TYPE_INV component this item sits on — menuParamC for both OPHELD* and INV_BUTTON*. */
    comId: number;
}

export interface ScreenPoint {
    x: number;
    y: number;
}

export interface ScreenRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface MenuEntrySnapshot {
    option: string;
    /** May carry the +2000 _PRIORITY offset (doAction strips it). */
    action: number;
    a: number;
    b: number;
    c: number;
}

export interface MenuSnapshot {
    open: boolean;
    /** 0 viewport / 1 sidebar / 2 chat (only meaningful while open). */
    area: number;
    /** Area-local geometry of the open menu (Client.menuX/Y/Width/Height). */
    x: number;
    y: number;
    width: number;
    height: number;
    /** Index order = menu order; entries[length-1] is the left-click default. */
    entries: MenuEntrySnapshot[];
}

/**
 * Bind the adapter to the live client and install the packet hook (H4).
 * Returns the list of expected internal names missing on the instance —
 * non-empty means an upstream merge moved something (shown as a red banner
 * in the panel; fix in adapter/).
 */
export function attach(client: unknown): string[] {
    const missing = SELF_TEST.filter(name => !(name in (client as Record<string, unknown>)));
    raw = client as RawClient;

    // H4: wrap tcpIn — one packet per `true` return; ptype0 holds the opcode.
    if (!missing.includes('tcpIn')) {
        const orig = raw.tcpIn;
        raw.tcpIn = async function (this: RawClient): Promise<boolean> {
            const processed = await orig.call(this);
            if (processed && packetListener) {
                try {
                    packetListener(this.ptype0);
                } catch (err) {
                    console.error('[lcbuddy] packet listener error', err);
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

    /**
     * The local player's active primary animation id, or -1 when idle. Skills
     * like mining/woodcutting/fishing keep this >= 0 while the action loops, so
     * it's a skill-agnostic "I'm making progress" signal even before the first
     * item drops.
     */
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
                totalHealth: npc.totalHealth
            });
        }

        return out;
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

    /** Local player in combat (health bar showing). */
    inCombat(): boolean {
        return raw?.localPlayer ? combatShowing(raw.localPlayer.combatCycle) : false;
    },

    /** Every loc in the scene at the current level (walls, scenery, ground decor). */
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
                // note decorType takes (level, z, x) — upstream quirk
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

    /** Inventory (backpack) contents, resolved from the live TYPE_INV component. */
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

    /**
     * Worn equipment (wornitems tab). Ops come from the `wear` CONTAINER
     * component's own `iop` (`option1=Remove`, content/scripts/player/
     * interfaces/wornitems.if), not the worn object's own type ops — unlike
     * the backpack, `[wear]` sets no `interactable=yes` (`objOps` is false),
     * so a worn item's object-level ops (e.g. a dagger's `iop2=Wield`) never
     * apply while worn; only the component-level 'Remove' button does
     * (dispatched as `INV_BUTTON1`, content/scripts/player/scripts/equip.rs2
     * `[inv_button1,wornitems:wear] ~unequip(last_slot)` — confirmed reading
     * both content configs). Same read shape as `bankItems()`.
     */
    equipment(): InvItemSnapshot[] {
        const comId = findTabInvComponent(4);
        if (comId === -1) {
            return [];
        }

        return readInvComponent(comId, () => IfType.list[comId].iop ?? []);
    },

    /**
     * The open bank's container component, or -1. The bank is a main modal
     * whose TYPE_INV child carries component iops like 'Withdraw-1'.
     */
    bankComId(): number {
        if (!raw || raw.mainModalId === -1) {
            return -1;
        }

        return findInvComponentIn(raw.mainModalId, com => (com.iop?.[0] ?? '').toLowerCase().includes('withdraw'));
    },

    /** Bank contents with the component's button ops (Withdraw-1/5/10/...). */
    bankItems(): InvItemSnapshot[] {
        const comId = reader.bankComId();
        if (comId === -1) {
            return [];
        }

        return readInvComponent(comId, () => IfType.list[comId].iop ?? []);
    },

    /**
     * The bank-mode backpack (side modal) with Deposit ops, or the regular
     * inventory when the bank is closed.
     */
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

    /** Component id of the active "Click here to continue" button, or -1. */
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

    /**
     * Selectable option lines in the open chat dialog ("Select an Option"
     * dialogs). Each is a BUTTON_OK child — clicking fires IF_BUTTON with the
     * child's component id (Client.ts ~9802). Used to answer event dialogs
     * (genie/old-man), tutorial choices, and skill choices.
     *
     * Reports the VISIBLE label (`com.text`), falling back to `com.buttonText`.
     * These differ: a confirm-style 2-option prompt (e.g. the tutorial guide's
     * dev-only "skip the tutorial?" — "Yes please." / "No, thank you.") carries
     * the real choice in `com.text` while `buttonText` is a generic "Ok" on
     * both, so a caller matching on the label can only discriminate them via
     * `text` (verified live, Task 4 probe).
     */
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

    /**
     * The products in an open "What would you like to make?" skill-multi menu.
     * Each product is a model component (if_setobject -> model1Type 4) paired,
     * positionally, with its run of Make X/10/5/1 resume buttons. Lets a script
     * pick a product by name and a quantity by value instead of guessing comIds.
     *
     * Root: prefer the CHAT modal (most skill-multi menus, e.g. cooking) but
     * fall back to the MAIN modal — Task 10 (tutorial mining/smithing) found
     * live that `smithing.rs2` opens its menu with `if_openmain(smithing)`,
     * not a chat interface (`raw.chatModalId` stays -1 throughout), so the
     * old chat-only scan silently saw an empty menu. The two roots are never
     * both in use for a make-menu at once, so this can't cross-contaminate.
     */
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
            // a product icon: if_setobject stamps model1Type=4 with the obj id
            if (com.model1Type === 4 && com.model1Id > 0) {
                objs.push(com.model1Id);
            }
            if (com.buttonType === ButtonType.BUTTON_OK && com.buttonText) {
                const m = /make\s+(x|\d+)/i.exec(com.buttonText);
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

        // buttons arrive in product order, 4 per product (X, 10, 5, 1)
        const products: { obj: number; name: string; buttons: { qty: number; comId: number }[] }[] = [];
        for (let i = 0; i < objs.length; i++) {
            products.push({ obj: objs[i], name: ObjType.list(objs[i]).name ?? '', buttons: buttons.slice(i * 4, i * 4 + 4) });
        }
        return products;
    },

    /**
     * The run on/off toggle buttons in the `controls` sidebar interface,
     * resolved at runtime. The controls root is found via its "Auto retaliate"
     * label (com_7); the run buttons are com_4 (off) / com_5 (on) — graphic
     * select buttons that pushvar option_run (verified in controls.if).
     * Returns null if the layout moved (self-test catches it).
     */
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
            // sanity: both should be graphic buttons (ComponentType.TYPE_GRAPHIC === 4)
            if (IfType.list[on]?.buttonType !== undefined && IfType.list[off] !== undefined) {
                cachedRunControls = { onComId: on, offComId: off };
            }
            break;
        }

        return cachedRunControls;
    },

    /** Scene-local -> world tile (current plane), or null when detached. */
    toWorld(lx: number, lz: number): WorldTile | null {
        if (!raw) {
            return null;
        }

        return { x: raw.mapBuildBaseX + lx, z: raw.mapBuildBaseZ + lz, level: raw.minusedlevel };
    },

    /** World tile -> scene-local, or null when outside the loaded scene. */
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

    /**
     * Live collision flags at a scene-local tile on the CURRENT level
     * (CollisionFlag bits — includes closed doors and dynamic blockers,
     * unlike the baked NavWorker pack). null when unattached, out of the
     * scene, or the level's collision map is absent.
     */
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

    /** Title-screen login status line, e.g. 'Login attempts exceeded.'. */
    loginMessage(): string {
        return raw?.loginMes1 ?? '';
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

    /**
     * Items on any TYPE_INV component that defines its own button ops, keyed
     * by the component's own `iop` labels (not the object's held ops) --
     * same read shape as `bankItems()`/`bankSideItems()`, generalized to a
     * caller-supplied component id. Used for the shop stock panel (Value/Buy
     * 1/5/10) and the shop-mode backpack panel (Value/Sell 1/5/10); see
     * docs/quest-campaign-map.md's "Shop interface ids" section for the
     * locked component ids.
     */
    shopInv(comId: number): InvItemSnapshot[] {
        if (comId === -1) {
            return [];
        }

        return readInvComponent(comId, () => IfType.list[comId].iop ?? []);
    },

    /**
     * Component id of the BUTTON_CLOSE control in `rootComId`'s subtree
     * (e.g. a main modal's "Close Window" text-button), or -1. Runtime
     * discovery, like `chatContinueComId()`/`runControls()` -- a content
     * rebuild renumbering it needs no code change. Note: unlike BUTTON_OK,
     * a close button isn't required to carry `buttonText` (the shop's
     * "Close Window" caption lives in `com.text` instead -- confirmed live,
     * Task 4 probe), so this matches on `buttonType` alone.
     */
    closeButtonComId(rootComId: number): number {
        if (!raw || rootComId === -1) {
            return -1;
        }

        return walkComponents(rootComId).find(com => com.buttonType === ButtonType.BUTTON_CLOSE)?.id ?? -1;
    },

    // ---- synthetic input readers (Slice 6) ----

    /** Live GameShell mouse state (screen coords, -1 when off-canvas). */
    mouse(): { x: number; y: number; button: number } {
        return { x: raw?.mouseX ?? -1, y: raw?.mouseY ?? -1, button: raw?.mouseButton ?? 0 };
    },

    /**
     * The minimenu as the client sees it right now: rebuilt from mouse hover
     * each redraw while closed (buildMinimenu), frozen while open. Entries
     * carry action+params so a wanted op can be matched exactly.
     */
    menu(): MenuSnapshot {
        const entries: MenuEntrySnapshot[] = [];
        if (raw) {
            for (let i = 0; i < raw.menuNumEntries; i++) {
                entries.push({ option: raw.menuOption[i], action: raw.menuAction[i], a: raw.menuParamA[i], b: raw.menuParamB[i], c: raw.menuParamC[i] });
            }
        }

        return {
            open: raw?.isMenuOpen ?? false,
            area: raw?.menuArea ?? 0,
            x: raw?.menuX ?? 0,
            y: raw?.menuY ?? 0,
            width: raw?.menuWidth ?? 0,
            height: raw?.menuHeight ?? 0,
            entries
        };
    },

    /**
     * Screen rect of row `index` of the OPEN minimenu — mirrors the hit test
     * in mouseLoop (row i: clickY in (optionY-13, optionY+3), clickX in
     * (menuX, menuX+menuWidth), plus the per-area offset).
     */
    menuRowRect(index: number): ScreenRect | null {
        if (!raw || !raw.isMenuOpen || index < 0 || index >= raw.menuNumEntries) {
            return null;
        }

        const [ox, oy] = MENU_AREA_OFFSETS[raw.menuArea] ?? MENU_AREA_OFFSETS[0];
        const optionY = raw.menuY + (raw.menuNumEntries - 1 - index) * 15 + 31;
        return {
            x: ox + raw.menuX + 1,
            y: oy + optionY - 12,
            w: raw.menuWidth - 2,
            h: 14
        };
    },

    /** Bounds the open menu auto-closes outside of (menu rect + 10px). */
    menuCloseBounds(): ScreenRect | null {
        if (!raw || !raw.isMenuOpen) {
            return null;
        }

        const [ox, oy] = MENU_AREA_OFFSETS[raw.menuArea] ?? MENU_AREA_OFFSETS[0];
        return { x: ox + raw.menuX - 10, y: oy + raw.menuY - 10, w: raw.menuWidth + 20, h: raw.menuHeight + 20 };
    },

    /** Selected sidebar tab (3 = backpack, 4 = worn equipment). */
    activeSideTab(): number {
        return raw?.activeIcon ?? -1;
    },

    /** Click rect of a sidebar tab icon (iconLoop hit boxes, inset 3px). */
    sideTabRect(tab: number): ScreenRect | null {
        const r = SIDE_TAB_RECTS[tab];
        if (!r || !raw || (raw.sideIcon[tab] ?? -1) === -1) {
            return null;
        }

        return { x: r[0] + 3, y: r[1] + 3, w: r[2] - 6, h: r[3] - 6 };
    },

    /**
     * World->screen projection of a point `height` units above the ground at
     * scene-fine coords — a faithful port of getOverlayPos (Client.ts ~5017)
     * reading the live render camera, with the viewport origin (256,167) and
     * blit offset (4,4) folded in. Null when behind the camera or the scene
     * isn't rendering.
     */
    projectFine(fineX: number, fineZ: number, height: number): ScreenPoint | null {
        if (!raw || raw.sceneState !== 2 || fineX < 128 || fineZ < 128 || fineX > 13056 || fineZ > 13056) {
            return null;
        }

        const p = projectWorld(fineX, raw.getAvH(fineX, fineZ, raw.minusedlevel) - height, fineZ);
        if (!p) {
            return null;
        }

        const sx = p.x - VIEW_X;
        const sy = p.y - VIEW_Y;
        if (sx < 0 || sx > VIEW_W || sy < 0 || sy > VIEW_H) {
            return null;
        }

        return p;
    },

    /**
     * On-screen clickable box for an npc by scene slot index: projected at
     * the entity's feet and head, then shrunk toward the body center. Null
     * when off-screen.
     */
    npcScreenBox(index: number): ScreenRect | null {
        const npc = raw?.npc[index];
        if (!npc) {
            return null;
        }

        // npc typecodes carry only the scene slot (no tile bits), so tracked
        // render bounds stay valid while the npc walks — exact aim on small
        // or wide models (chickens) where the feet-to-head column guesses
        const tracked = trackedScreenBox(((index << 14) + 0x20000000) | 0);
        if (tracked) {
            return tracked;
        }

        return entityScreenBox(npc.x, npc.z, npc.height);
    },

    /**
     * Clickable box around a loc: the rendered model's true screen extent
     * via per-typecode vertex tracking in the renderer — tall or offset
     * models (the gnome course tree branches draw ~85px from their anchor
     * tile) aim right where a tile-center guess misses entirely. Pass the
     * loc's typecode (from the snapshot) so tracking also works for locs the
     * scene stores off the player's level (bridge-shifted ground decor like
     * the gnome log balance); without it, falls back to the scene-sprite
     * lookup, then bounds estimates, then the tile-column heuristic.
     */
    locScreenBox(lx: number, lz: number, typecode?: number): ScreenRect | null {
        if (raw && raw.world && raw.sceneState === 2) {
            const sprite = raw.world.sceneSprite(raw.minusedlevel, lx, lz);
            const track = typecode ?? sprite?.typecode;

            if (track !== undefined) {
                const box = trackedScreenBox(track);
                if (box) {
                    return box;
                }
            }

            const m = sprite?.model as { minX?: number; maxX?: number; minY?: number; maxY?: number; minZ?: number; maxZ?: number; radius?: number } | null | undefined;
            if (sprite && m && typeof m.minY === 'number' && typeof m.maxY === 'number') {
                // sharelight models only compute the bounding CYLINDER
                // (radius + y extents) and leave the AABB fields at 0 — fall
                // back to a radius square so offset geometry (the gnome tree
                // branch trunk draws ~0.7 tile from its anchor) stays inside
                const hasAabb = typeof m.minX === 'number' && typeof m.maxX === 'number' && typeof m.minZ === 'number' && typeof m.maxZ === 'number' && (m.minX < m.maxX || m.minZ < m.maxZ);
                const radius = typeof m.radius === 'number' && m.radius > 0 ? m.radius : 64;
                const bx0 = hasAabb ? m.minX! : -radius;
                const bx1 = hasAabb ? m.maxX! : radius;
                const bz0 = hasAabb ? m.minZ! : -radius;
                const bz1 = hasAabb ? m.maxZ! : radius;

                let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, corners = 0;
                for (const cx of [sprite.x + bx0, sprite.x + bx1]) {
                    for (const cz of [sprite.z + bz0, sprite.z + bz1]) {
                        // model y is positive-down: minY is the up-extent (stored positive), maxY the below-origin extent
                        for (const cy of [sprite.y - m.minY, sprite.y + m.maxY]) {
                            const p = projectWorld(cx, cy, cz);
                            if (p) {
                                x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
                                x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
                                corners++;
                            }
                        }
                    }
                }
                if (corners >= 6) {
                    // shrink toward the middle: bound edges are mostly empty pixels
                    const w = x1 - x0, h = y1 - y0;
                    const box = clampToViewport({ x: x0 + w * 0.2, y: y0 + h * 0.15, w: w * 0.6, h: h * 0.7 });
                    if (box) {
                        return box;
                    }
                }
            }
        }

        const base = reader.projectFine((lx << 7) + 64, (lz << 7) + 64, 0);
        const mid = reader.projectFine((lx << 7) + 64, (lz << 7) + 64, 60);
        if (!base || !mid) {
            return null;
        }

        const h = Math.max(10, Math.abs(base.y - mid.y));
        return clampToViewport({ x: base.x - 12, y: Math.min(base.y, mid.y), w: 24, h });
    },

    /** Clickable box for a ground item stack on a tile — spans the model's
     *  rendered footprint (ground up to ~24 units) so render-picking lands
     *  even at a distance/oblique angle. */
    objScreenBox(lx: number, lz: number): ScreenRect | null {
        // ground stacks draw under a per-tile typecode (setObj) — use the
        // rendered bounds when available
        const tracked = trackedScreenBox((lx + (lz << 7) + 0x60000000) | 0);
        if (tracked) {
            return tracked;
        }

        const fineX = (lx << 7) + 64;
        const fineZ = (lz << 7) + 64;
        const ground = reader.projectFine(fineX, fineZ, 0);
        const top = reader.projectFine(fineX, fineZ, 24);
        if (!ground || !top) {
            return null;
        }

        const y0 = Math.min(ground.y, top.y) - 3;
        const h = Math.max(12, Math.abs(ground.y - top.y) + 6);
        return clampToViewport({ x: ((ground.x + top.x) / 2) - 11, y: y0, w: 22, h });
    },

    /**
     * Where to click on the minimap so minimapLoop resolves to `tile` —
     * inverse of its rotate+zoom transform, then forward-verified over a 3x3
     * pixel neighborhood to absorb rounding. Null when the tile falls
     * outside the minimap disc (caller should walk a nearer waypoint).
     */
    minimapPoint(tile: WorldTile): ScreenPoint | null {
        if (!raw || !raw.localPlayer || raw.minimapState !== 0) {
            return null;
        }

        const relX = ((tile.x - raw.mapBuildBaseX) << 7) + 64 - raw.localPlayer.x;
        const relY = raw.localPlayer.z - (((tile.z - raw.mapBuildBaseZ) << 7) + 64);

        const yaw = (raw.orbitCameraYaw + raw.macroMinimapAngle) & 0x7ff;
        const sin = (Pix3D.sinTable[yaw] * (raw.macroMinimapZoom + 256)) >> 8;
        const cos = (Pix3D.cosTable[yaw] * (raw.macroMinimapZoom + 256)) >> 8;

        // forward (minimapLoop): relX = (py*sin + px*cos)>>11; relY = (py*cos - px*sin)>>11
        // i.e. [relX, relY] = (1/2048) * [[cos, sin], [-sin, cos]] * [px, py]
        const det = cos * cos + sin * sin;
        if (det === 0) {
            return null;
        }

        const px = (2048 * (cos * relX - sin * relY)) / det;
        const py = (2048 * (sin * relX + cos * relY)) / det;

        // pick the candidate pixel whose forward transform lands on the tile
        let best: ScreenPoint | null = null;
        let bestErr = Infinity;
        for (let jx = -1; jx <= 1; jx++) {
            for (let jy = -1; jy <= 1; jy++) {
                const cx = Math.round(px) + jx;
                const cy = Math.round(py) + jy;
                if (cx * cx + cy * cy > 64 * 64) {
                    continue;
                }

                const fRelX = (cy * sin + cx * cos) >> 11;
                const fRelY = (cy * cos - cx * sin) >> 11;
                const tx = (raw.localPlayer.x + fRelX) >> 7;
                const tz = (raw.localPlayer.z - fRelY) >> 7;
                const err = Math.abs(tx - (tile.x - raw.mapBuildBaseX)) + Math.abs(tz - (tile.z - raw.mapBuildBaseZ));
                if (err < bestErr) {
                    bestErr = err;
                    best = { x: cx + 73 + 575, y: cy + 75 + 8 };
                }
            }
        }

        return bestErr <= 1 ? best : null;
    },

    /**
     * Screen rect of an interface component, walking the same offset math as
     * addComponentOptions from the three live roots (main modal at (4,4),
     * sidebar at (553,205), chat modal at (17,357)).
     */
    componentRect(comId: number): ScreenRect | null {
        return findComponentRect(comId)?.rect ?? null;
    },

    /** Screen rect of slot `slot` on a TYPE_INV component (32x32 cells). */
    invSlotRect(comId: number, slot: number): ScreenRect | null {
        const found = findComponentRect(comId);
        if (!found) {
            return null;
        }

        const com = IfType.list[comId];
        if (!com || com.type !== ComponentType.TYPE_INV || com.width <= 0) {
            return null;
        }

        const col = slot % com.width;
        const row = (slot / com.width) | 0;
        let x = found.rect.x + col * (com.marginX + 32);
        let y = found.rect.y + row * (com.marginY + 32);
        if (slot < 20 && com.invBackgroundX && com.invBackgroundY) {
            x += com.invBackgroundX[slot];
            y += com.invBackgroundY[slot];
        }

        return { x, y, w: 32, h: 32 };
    },

    /** Sidebar tab whose interface subtree contains `comId`, or -1. */
    sideTabOf(comId: number): number {
        if (!raw) {
            return -1;
        }

        for (let tab = 0; tab < raw.sideIcon.length; tab++) {
            const rootId = raw.sideIcon[tab];
            if (rootId !== undefined && rootId !== -1 && subtreeContains(rootId, comId)) {
                return tab;
            }
        }

        return -1;
    },

    /** Text of an interface component (IfType.list), or null. */
    ifText(comId: number): string | null {
        return IfType.list[comId]?.text ?? null;
    },

    /**
     * The obj id a component's model was set from (IF_SETOBJECT stores it:
     * model1Type=4, model1Id=objId — Client.ts:6112), or null when the com
     * has no obj-sourced model.
     */
    ifModelObjId(comId: number): number | null {
        const com = IfType.list[comId];
        return com && com.model1Type === 4 ? com.model1Id : null;
    },

    /** Current orbit camera yaw, 0..2047 (2048 = full turn). */
    orbitYaw(): number {
        return raw?.orbitCameraYaw ?? 0;
    },

    /**
     * Orbit yaw that would center the camera on a world tile (the yaw that
     * maximizes the target's render depth: atan2(-dx, dz) in table units).
     */
    yawTo(tile: WorldTile): number {
        if (!raw || !raw.localPlayer) {
            return 0;
        }

        const dx = ((tile.x - raw.mapBuildBaseX) << 7) + 64 - raw.localPlayer.x;
        const dz = ((tile.z - raw.mapBuildBaseZ) << 7) + 64 - raw.localPlayer.z;
        return Math.round((Math.atan2(-dx, dz) / (2 * Math.PI)) * 2048) & 0x7ff;
    },

    /**
     * Component id of the first button in `rootComId`'s subtree whose
     * `buttonText` equals `label` (case-insensitive), or -1. Runtime discovery
     * — like runControls()/makeProducts() — so a content rebuild that
     * renumbers components needs no code change. Clickable buttons carry their
     * caption in `buttonText`; a static text label with the same caption sits
     * in `text` instead, so matching `buttonText` selects the clickable one
     * (verified on the character-design "Accept" button, Task 4 probe).
     */
    buttonByText(rootComId: number, label: string): number {
        if (!raw) {
            return -1;
        }

        const want = label.toLowerCase();
        return walkComponents(rootComId).find(com => (com.buttonText ?? '').toLowerCase() === want)?.id ?? -1;
    },

    /**
     * Component id of a BUTTON_TARGET child under `rootComId` by its
     * `targetBase` caption — the spell buttons of the magic side tab (e.g.
     * 'Wind Strike', menu option "Cast @gre@Wind Strike"), or -1. Found at
     * runtime by caption like `buttonByText` (ids are pack-assigned); the
     * armed-cast dispatch is `driver.castOnNpc` (TGT_BUTTON + TGT_NPC).
     */
    targetButtonByBase(rootComId: number, base: string): number {
        if (!raw) {
            return -1;
        }

        const want = base.toLowerCase();
        return walkComponents(rootComId).find(com => com.buttonType === ButtonType.BUTTON_TARGET && (com.targetBase ?? '').toLowerCase() === want)?.id ?? -1;
    },

    /**
     * The BUTTON_SELECT component under `rootComId` whose selected-state
     * predicate is `varp == value` — the (varp, operand) pair the client's own
     * SELECT_BUTTON click handler reads (Client.ts ~9186). Style buttons is
     * the motivating case: each weapon's combat tab (combat_unarmed/_bow/
     * _stabsword/…) has its own pack-assigned button ids, but they all mark
     * "selected" by comparing com_mode, so this resolves the right button on
     * whatever tab is attached. -1 if no such button (e.g. a 3-style weapon
     * asked for style 3).
     */
    selectButtonByVarp(rootComId: number, varp: number, value: number): number {
        if (!raw) {
            return -1;
        }

        return walkComponents(rootComId).find(com => com.buttonType === ButtonType.BUTTON_SELECT && com.scripts?.[0]?.[0] === 5 && com.scripts[0][1] === varp && com.scriptOperand?.[0] === value)?.id ?? -1;
    },

    /**
     * Every product item across every TYPE_INV "column" of an open skill-multi
     * menu that lives in the MAIN modal — e.g. the tutorial's smithing anvil
     * interface (`content/scripts/skill_smithing/scripts/smithing/smithing.rs2`:
     * `if_openmain(smithing)`). Task 10 (tutorial mining/smithing) found this is
     * structurally different from `makeProducts()`'s CHAT-modal shape (one icon
     * + a separate run of "Make N" BUTTON_OK captions): here each column is its
     * OWN TYPE_INV component holding several product icons that all SHARE one
     * set of ops (`iop`: "Make"/"Make 5"/"Make 10", or "Make set"/... for
     * ammo/wire) — the same shape `bankItems()`/`equipment()` read, just with
     * several sibling components instead of one. Flattens every column's items
     * into one list; `comId` on each item disambiguates which column it came
     * from for the eventual `invButton` dispatch. The "Make" prefix filter
     * keeps other main-modal TYPE_INV screens (the bank's "Withdraw-*", the
     * shop's "Buy *") from ever reading as an open make-panel.
     */
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

    /** Root interface id currently attached to sidebar tab `tab` (client.sideIcon[tab]), or -1 if that tab has no interface yet. */
    sideTabInterface(tab: number): number {
        return raw?.sideIcon[tab] ?? -1;
    },

    /**
     * Questlist lines from the quest journal side tab: text + colour of every
     * TYPE_TEXT component under the quest tab's root interface
     * (sideTabInterface(2)). Colour is the server-set value from
     * `~update_questlist` (content/scripts/general/scripts/quests.rs2,
     * red/yellow/green per quest progress) — see docs/quest-campaign-map.md
     * for the locked constants. No manual tab-click is needed — the quest tab
     * attaches as a side effect of the login script's `initalltabs` proc
     * (content/scripts/login_logout/login.rs2: `if_settab(questlist,
     * ^tab_quest_journal); ~update_questlist;`), NOT of ever opening the tab
     * client-side. But `initalltabs` itself only runs once the account is off
     * Tutorial Island (login.rs2 gates it behind `~in_tutorial_island`, and an
     * on-island watchdog reverts `%tutorial` every tick) — empty (`[]`) for
     * every still-tutorial-locked account, confirmed live in Task 2 (see the
     * map doc's "Tab-attachment requirement" note for the exact repro).
     */
    questStatuses(): { name: string; colour: number }[] {
        const QUEST_TAB = 2; // ^tab_quest_journal (general/configs/tabs.constant)
        const root = reader.sideTabInterface(QUEST_TAB);
        if (root === -1) {
            return [];
        }

        const out: { name: string; colour: number }[] = [];
        for (const com of walkComponents(root)) {
            if (com.type === ComponentType.TYPE_TEXT && com.text) {
                out.push({ name: com.text, colour: com.colour });
            }
        }

        return out;
    }
};

/**
 * Direct interaction surface (Slice 3). Only input drivers call these. Every
 * op goes through the client's own doAction/tryMove so anticheat counters,
 * approach logic and packet bytes are exactly what a human click produces.
 */
export const actions = {
    /** Current title-screen/session credentials (empty after logout). */
    loginCredentials(): { username: string; password: string } {
        return { username: raw?.loginUser ?? '', password: raw?.loginPass ?? '' };
    },

    /** Drive the client's own login flow (auto-relogin path). */
    login(username: string, password: string): boolean {
        if (!raw || raw.ingame) {
            return false;
        }

        void raw.login(username, password, false);
        return true;
    },

    /**
     * Dispatch a minimenu action with explicit params through a scratch menu
     * slot. Returns false when the client isn't attached/ingame.
     */
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

    /**
     * Say something in public chat (MESSAGE_PUBLIC) — byte-identical to typing
     * in the chat box: colour + effect + WordPack-huffman'd text (capped at 80
     * chars). Lets bots talk to each other and the world. Returns false if not
     * ingame.
     */
    sendChat(text: string, colour = 0, effect = 0): boolean {
        if (!raw || !raw.ingame || !raw.out) {
            return false;
        }

        const msg = text.slice(0, 80);
        raw.out.p1Enc(ClientProt.MESSAGE_PUBLIC);
        raw.out.p1(0);
        const start = raw.out.pos;
        raw.out.p1(colour & 0xff);
        raw.out.p1(effect & 0xff);
        WordPack.pack(raw.out, msg);
        raw.out.psize1(raw.out.pos - start);
        return true;
    },

    /**
     * Walk toward a scene-local tile (MOVE_GAMECLICK, nearest-snap on
     * blocked). Returns false if no path was found.
     */
    walkTo(lx: number, lz: number): boolean {
        if (!raw || !raw.ingame || !raw.localPlayer) {
            return false;
        }

        return raw.tryMove(raw.localPlayer.routeX[0], raw.localPlayer.routeZ[0], lx, lz, true, 0, 0, 0, 0, 0, 0);
    },

    /** Press the active "Click here to continue" dialog button. */
    continueDialog(): boolean {
        const comId = reader.chatContinueComId();
        if (comId === -1) {
            return false;
        }

        return actions.menuAction(MiniMenuAction.PAUSE_BUTTON, 0, 0, comId);
    },

    /**
     * Click a dialog option / interface button by component id (IF_BUTTON).
     * Dispatched directly in both input modes — chat-option clicks are rare
     * event-recovery UI, not labeled grinding telemetry.
     */
    ifButton(comId: number): boolean {
        return actions.menuAction(MiniMenuAction.IF_BUTTON, 0, 0, comId);
    },

    /** Toggle run mode on/off via the controls interface (idempotent). */
    setRun(on: boolean): boolean {
        const controls = reader.runControls();
        if (!controls) {
            return false;
        }

        return actions.ifButton(on ? controls.onComId : controls.offComId);
    },

    /**
     * Switch the active sidebar tab — exactly what iconLoop's own mouse-click
     * hit test does on a real click (Client.ts ~2797-2858: flips `activeIcon`
     * + the two redraw flags; no packet). Used for the tutorial's
     * flashing-tab steps (the brief's "TutClickSide" step type): the client
     * sends `TUT_CLICKSIDE` purely as a side effect of `gameDraw()` noticing
     * `activeIcon === tutFlashIcon` on the next redraw (Client.ts
     * ~4013-4022), so reproducing iconLoop's state change here triggers it
     * exactly like a real click — no separate packet dispatch needed. There
     * is no `actions.clickRect`-style rect click in this adapter (sidebar
     * tabs aren't IF_BUTTON components; `runControls`'s buttons live INSIDE a
     * tab's interface and are clicked via `ifButton` once that tab is
     * showing — a different mechanism from selecting the tab itself). Returns
     * false if that tab has no interface loaded yet (mirrors iconLoop's own
     * per-icon `sideIcon[tab] !== -1` guard).
     */
    clickSideTab(tab: number): boolean {
        if (!raw || (raw.sideIcon[tab] ?? -1) === -1) {
            return false;
        }

        raw.activeIcon = tab;
        raw.redrawSide = true;
        raw.redrawIcons = true;
        return true;
    },

    /**
     * Close the given main modal client-side (mainModalId -> -1). Used to
     * dismiss the rs2b2t login `welcome_screen` (interface WELCOME_SCREEN),
     * which is opened purely client-side on login and blocks all 3D-scene
     * interaction (render-picking sees only the modal) — so closing it
     * client-side is safe and un-freezes every bot. Returns false if that
     * modal isn't the one open. Re-verify the id after a Content upgrade.
     */
    closeMainModal(comId: number): boolean {
        if (!raw || raw.mainModalId !== comId) {
            return false;
        }

        raw.mainModalId = -1;
        return true;
    },

    /**
     * Click the open main modal's own BUTTON_CLOSE control (e.g. a shop's
     * "Close Window" button) via the same scratch-slot `doAction` dispatch
     * every other direct action uses (`CLOSE_BUTTON` -> the client's own
     * `closeModal()`, which sends the real `CLOSE_MODAL` packet so the
     * server's `[if_close,X]` trigger runs). Unlike `closeMainModal()` above
     * (a client-only reset for the packetless rs2b2t welcome screen), this is
     * for real server-driven modals -- closing a shop without it leaves the
     * server still transmitting stock updates to a client that thinks it
     * moved on. Returns false if no main modal is open or it has no close
     * button. Dispatched directly in both input modes, like `ifButton()`.
     */
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

/** rs2b2t opens this "message of the day" interface as a main modal on login. */
export const WELCOME_SCREEN = 5993;

/**
 * Synthetic input injection (Slice 6). ONLY VirtualInput calls these. Each
 * call invokes the same protected GameShell handler the real DOM listener
 * dispatches to, so downstream state (mouseX/Y, nextMouseClick*, idleTimer,
 * keyHeld, MouseTracking sampling) is byte-identical to a real device.
 */
export const inject = {
    /** pointermove path: GameShell.pointerMove (sets mouseX/Y + idleTimer). */
    mouseMove(x: number, y: number): void {
        raw?.pointerMove(x | 0, y | 0, {} as PointerEvent);
    },

    /** mousedown path: GameShell.mouseDown reads only e.button (2 = right). */
    mouseDown(x: number, y: number, right: boolean): void {
        raw?.mouseDown(x | 0, y | 0, { button: right ? 2 : 0 } as MouseEvent);
    },

    /** mouseup path: GameShell.mouseUp (clears mouseButton + idleTimer). */
    mouseUp(x: number, y: number): void {
        raw?.mouseUp(x | 0, y | 0, {} as MouseEvent);
    },

    /**
     * key down/up for a client key char, mirroring GameShell.onkeydown/up:
     * touch idleTimer, set keyHeld, and (down only, ch>4) push the ring
     * queue. Arrows are ch 1-4: left/right/up/down -> keyHeld-only, which is
     * exactly what camera rotation reads (Client.ts ~3243).
     */
    key(ch: number, down: boolean): void {
        if (!raw || ch <= 0 || ch >= 128) {
            return;
        }

        raw.idleTimer = performance.now();
        raw.keyHeld[ch] = down ? 1 : 0;
        if (down && ch > 4) {
            raw.keyQueue[raw.keyQueueWritePos] = ch;
            raw.keyQueueWritePos = (raw.keyQueueWritePos + 1) & 0x7f;
        }
    }
};

/**
 * World-space point -> screen pixel through the live render camera (the same
 * transform as getOverlayPos). Unclamped — callers projecting box corners
 * clamp the resulting box, so partially off-screen shapes still aim right.
 * Null only when behind the near plane. `y` is the raw world height
 * (positive down), NOT a height-above-ground.
 */
function projectWorld(fineX: number, y: number, fineZ: number): ScreenPoint | null {
    if (!raw) {
        return null;
    }

    let dx = fineX - raw.camX;
    let dy = y - raw.camY;
    let dz = fineZ - raw.camZ;

    const sinPitch = Pix3D.sinTable[raw.camPitch];
    const cosPitch = Pix3D.cosTable[raw.camPitch];
    const sinYaw = Pix3D.sinTable[raw.camYaw];
    const cosYaw = Pix3D.cosTable[raw.camYaw];

    let tmp = (dz * sinYaw + dx * cosYaw) >> 16;
    dz = (dz * cosYaw - dx * sinYaw) >> 16;
    dx = tmp;

    tmp = (dy * cosPitch - dz * sinPitch) >> 16;
    dz = (dy * sinPitch + dz * cosPitch) >> 16;
    dy = tmp;

    if (dz < 50) {
        return null;
    }

    return { x: VIEW_ORIGIN_X + (((dx << 9) / dz) | 0) + VIEW_X, y: VIEW_ORIGIN_Y + (((dy << 9) / dz) | 0) + VIEW_Y };
}

/**
 * Rendered screen bounds of a typecode via the renderer's vertex tracking:
 * arms tracking on first call (returns null — caller uses its estimate);
 * from the next drawn frame returns the model's true extent, shrunk toward
 * the middle (bound edges are mostly empty pixels). One typecode at a time —
 * gestures are serialized, and per-attempt re-aims re-arm as needed.
 */
function trackedScreenBox(typecode: number): ScreenRect | null {
    if (!typecode) {
        return null;
    }

    if (Model.trackTypecode !== typecode) {
        Model.trackTypecode = typecode;
        return null;
    }

    if (Model.trackStamp !== Model.frameStamp || Model.trackMaxX <= Model.trackMinX + 2) {
        return null;
    }

    const w = Model.trackMaxX - Model.trackMinX;
    const h = Model.trackMaxY - Model.trackMinY;
    return clampToViewport({ x: Model.trackMinX + VIEW_X + w * 0.15, y: Model.trackMinY + VIEW_Y + h * 0.15, w: w * 0.7, h: h * 0.7 });
}

/** Project an entity column (feet to head) into a clickable screen box. */
function entityScreenBox(fineX: number, fineZ: number, height: number): ScreenRect | null {
    const feet = reader.projectFine(fineX, fineZ, 0);
    const head = reader.projectFine(fineX, fineZ, Math.max(height, 20));
    if (!feet || !head) {
        return null;
    }

    const top = Math.min(feet.y, head.y);
    const h = Math.max(8, Math.abs(feet.y - head.y));
    const w = Math.max(10, Math.min(40, h * 0.6));
    // shrink vertically toward the torso — edge pixels often miss the model
    return clampToViewport({ x: feet.x - w / 2, y: top + h * 0.15, w, h: h * 0.7 });
}

/** Clamp a box into the 3D viewport; null when too little remains visible. */
function clampToViewport(rect: ScreenRect): ScreenRect | null {
    const minX = 8;
    const minY = 8;
    const maxX = 512;
    const maxY = 330;
    const x0 = Math.max(rect.x, minX);
    const y0 = Math.max(rect.y, minY);
    const x1 = Math.min(rect.x + rect.w, maxX);
    const y1 = Math.min(rect.y + rect.h, maxY);
    if (x1 - x0 < 4 || y1 - y0 < 4) {
        return null;
    }

    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Locate a component on screen by walking the live interface roots with the
 * exact offset math of addComponentOptions (childX/childY + child.x/y -
 * scrollPos), so rects match the client's own hit testing.
 */
function findComponentRect(comId: number): { rect: ScreenRect; rootKind: 'main' | 'side' | 'chat' } | null {
    if (!raw) {
        return null;
    }

    const roots: { id: number; x: number; y: number; kind: 'main' | 'side' | 'chat' }[] = [];
    if (raw.mainModalId !== -1) {
        roots.push({ id: raw.mainModalId, x: 4, y: 4, kind: 'main' });
    }
    if (raw.sideModalId !== -1) {
        roots.push({ id: raw.sideModalId, x: 553, y: 205, kind: 'side' });
    } else if ((raw.sideIcon[raw.activeIcon] ?? -1) !== -1) {
        roots.push({ id: raw.sideIcon[raw.activeIcon], x: 553, y: 205, kind: 'side' });
    }
    if (raw.chatModalId !== -1) {
        roots.push({ id: raw.chatModalId, x: 17, y: 357, kind: 'chat' });
    }

    for (const root of roots) {
        if (root.id === comId) {
            const com = IfType.list[comId];
            return { rect: { x: root.x, y: root.y, w: com?.width ?? 0, h: com?.height ?? 0 }, rootKind: root.kind };
        }

        const rect = searchComponentRect(IfType.list[root.id], comId, root.x, root.y);
        if (rect) {
            return { rect, rootKind: root.kind };
        }
    }

    return null;
}

function searchComponentRect(com: IfType | undefined, comId: number, x: number, y: number): ScreenRect | null {
    // a container's child-position arrays are all we need to locate a child;
    // don't gate on TYPE_LAYER (some dialog roots aren't, yet still position
    // their children) and tolerate a frame where the arrays aren't populated
    if (!com || !com.children || !com.childX || !com.childY) {
        return null;
    }

    for (let i = 0; i < com.children.length; i++) {
        const child = IfType.list[com.children[i]];
        if (!child) {
            continue;
        }

        const childX = com.childX[i] + x + child.x;
        const childY = com.childY[i] + y + child.y - com.scrollPos;

        if (child.id === comId) {
            return { x: childX, y: childY, w: child.width, h: child.height };
        }

        const nested = searchComponentRect(child, comId, childX, childY);
        if (nested) {
            return nested;
        }
    }

    return null;
}

/**
 * Breadth-first walk of a component subtree from `rootComId` (inclusive),
 * following `children` (populated on TYPE_LAYER components only). Shared by
 * every reader that scans a whole interface tree (buttonByText,
 * questStatuses) instead of each re-deriving its own queue loop.
 */
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

function subtreeContains(rootId: number, comId: number): boolean {
    if (rootId === comId) {
        return true;
    }

    const queue = [rootId];
    while (queue.length > 0) {
        const com = IfType.list[queue.shift()!];
        if (!com) {
            continue;
        }

        if (com.id === comId) {
            return true;
        }

        if (com.children) {
            queue.push(...com.children);
        }
    }

    return false;
}

/** Ground-item ops with the client's synthesized default 'Take' at op 3
 *  (Client.ts ~9437: added whenever op[2] is unset). */
function groundOps(op: (string | null)[] | null): (string | null)[] {
    const ops = [...(op ?? [null, null, null, null, null])];
    if (!ops[2]) {
        ops[2] = 'Take';
    }

    return ops;
}

/** Held ops with the client's synthesized default 'Drop' at op 5
 *  (Client.ts ~9718: added whenever iop[4] is unset). */
function heldOps(iop: (string | null)[] | null): (string | null)[] {
    const ops = [...(iop ?? [null, null, null, null, null])];
    if (!ops[4]) {
        ops[4] = 'Drop';
    }

    return ops;
}

/** Mirrors the client's own health-bar condition (Client.ts ~4659). */
function combatShowing(combatCycle: number): boolean {
    return combatCycle > loopCycleNow() + 100;
}

function loopCycleNow(): number {
    // Client.loopCycle is static; read it off the attached instance's
    // constructor to keep this file free of a direct Client import
    return raw ? ((raw as unknown as { constructor: { loopCycle: number } }).constructor.loopCycle ?? 0) : 0;
}

const cachedTabInvComId = new Map<number, number>();
// undefined = not yet resolved; null = resolved-but-absent (don't rescan every frame)
let cachedRunControls: { onComId: number; offComId: number } | null | undefined = undefined;

/**
 * A tab's item container: a TYPE_INV child of the sidebar interface at
 * `tabIndex` (3 = backpack, 4 = worn equipment). Cache ids differ per
 * revision, so resolve at runtime and cache.
 */
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

/** Breadth-first search of an interface subtree for a TYPE_INV component. */
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

/** Items off a TYPE_INV component's live linkObj arrays (ids stored +1). */
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
