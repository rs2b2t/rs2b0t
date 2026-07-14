import { MiniMenuAction } from '#/client/MiniMenuAction.js';
import Skill from '#/client/Skill.js';
import { ButtonType, ComponentType } from '#/config/IfType.js';
import IfType from '#/config/IfType.js';
import LocType from '#/config/LocType.js';
import ObjType from '#/config/ObjType.js';
import CollisionMap from '#/dash3d/CollisionMap.js';
import { ClientProt } from '#/io/ClientProt.js';
import WordPack from '#/wordfilter/WordPack.js';

import { SELF_TEST, type RawClient } from './RawClient.js';

const SCENE_SIZE = 104;
/** Scratch minimenu slot for direct actions (arrays are length 500; the real
 *  menu builder never reaches this high). */
const SCRATCH_SLOT = 499;

/**
 * THE ONLY file that reads or writes client internals. Everything else in
 * src/bot/ goes through `reader` (and `actions`). An upstream
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

/**
 * Bind the adapter to the live client and install the packet hook.
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
                // Fletch/craft menus label their qty buttons "Make X"/"Make 10";
                // the furnace smelting interface uses "Smelt X"/"Smelt 10" (its
                // com_12..15 buttontype=normal buttons, option="Smelt X @lre@Bronze").
                // Match either verb so both drive the same product/qty grouping.
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

    /** True while a p_countdialog "Enter amount" input is open (Withdraw-X etc.). */
    countDialogOpen(): boolean {
        return raw?.dialogInputOpen === true;
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

    /** Selected sidebar tab (3 = backpack, 4 = worn equipment). */
    activeSideTab(): number {
        return raw?.activeIcon ?? -1;
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
 * Direct interaction surface. Only input drivers call these. Every
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
     * Answer an open "Enter amount" count dialog (Withdraw-X / Buy-X / make-X)
     * by writing the same RESUME_P_COUNTDIALOG the client sends when a human
     * types the number and presses Enter (Client.ts:3047 — byte-identical).
     * Returns false when no count dialog is open.
     */
    answerCountDialog(value: number): boolean {
        if (!raw || !raw.ingame || !raw.out || !raw.dialogInputOpen) {
            return false;
        }
        raw.out.p1Enc(ClientProt.RESUME_P_COUNTDIALOG);
        raw.out.p4(Math.max(0, Math.floor(value)));
        raw.dialogInputOpen = false;
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
