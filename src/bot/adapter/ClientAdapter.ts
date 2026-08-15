// docs/decisions/architecture.md#layers
import { MiniMenuAction } from '#/client/shell/MiniMenuAction.js';
import Skill from '#/client/shell/Skill.js';
import { ButtonType, ComponentType } from '#/client/config/IfType.js';
import IfType from '#/client/config/IfType.js';
import LocType from '#/client/config/LocType.js';
import ObjType from '#/client/config/ObjType.js';
import CollisionMap from '#/client/dash3d/CollisionMap.js';
import Model from '#/client/dash3d/Model.js';
import type ModelSource from '#/client/dash3d/ModelSource.js';
import { ClientProt } from '#/client/io/ClientProt.js';

import { SELF_TEST, type RawClient } from './RawClient.js';

const SCENE_SIZE = 104;

// Why: locs() sweeps 104x104 tiles x 4 typecodes at a measured 1.4-1.7ms and 586-2289
// objects per call, and frame-rate script waiters would rebuild the unchanged scene ~24x/sec per bot.
let locCache: LocSnapshot[] | null = null;
let locCacheKey = '';

/** Called when a zone packet lands; the next locs() rebuilds from the live scene. */
export function invalidateLocSnapshots(): void {
    locCache = null;
}

/** Releases the attached client; later reads degrade to empty rather than dereferencing a half-dead client. */
export function detach(): void {
    raw = null;
    invalidateLocSnapshots();
}
const SCRATCH_SLOT = 499;

let raw: RawClient | null = null;
let packetListener: ((ptype: number) => void) | null = null;

/** Whether the login snapshot has populated every skill exposed by this client. */
export function activeStatsReady(baseLevels: ArrayLike<number>): boolean {
    for (let i = 0; i < Skill.count; i++) {
        if (Skill.used[i] && (baseLevels[i] ?? 0) <= 0) {
            return false;
        }
    }
    return true;
}

/** Whether every active stat was received during this exact login session. */
export function currentLoginStatsReady(
    baseLevels: ArrayLike<number>,
    seenGenerations: ArrayLike<number>,
    sessionGeneration: number
): boolean {
    if (sessionGeneration <= 0) {
        return false;
    }
    for (let i = 0; i < Skill.count; i++) {
        if (
            Skill.used[i] &&
            ((baseLevels[i] ?? 0) <= 0 || seenGenerations[i] !== sessionGeneration)
        ) {
            return false;
        }
    }
    return true;
}

/**
 * Object/NPC vertical extent for hulls. RS model space: minY = max(-vertexY)
 * (height above origin) — same as ClientNpc.height. maxY is below-origin only.
 */
export function locHullHeight(
    model: { minY: number; maxY: number } | null | undefined,
    fallback = 128
): number {
    if (model && model.minY > 0) {
        return model.minY;
    }
    if (model && model.maxY > 0) {
        return model.maxY;
    }
    return fallback;
}

/**
 * Walls/scenery often store a static `Model` as ModelSource, and Model returns null from getTempModel().
 * Why: bare ModelSource.minY defaults to 1000, so never read extents off the source itself.
 */
export function resolveLocModelExtents(
    src: ModelSource | null | undefined
): { minY: number; maxY: number; radius: number } | null {
    if (!src) {
        return null;
    }
    const temp = src.getTempModel();
    if (temp) {
        return temp;
    }
    if (src instanceof Model) {
        return src;
    }
    return null;
}

function worldTileToScene(
    x: number,
    z: number,
    u: number,
    v: number
): { sceneX: number; sceneZ: number } | null {
    if (!raw) {
        return null;
    }
    const lx = x - raw.mapBuildBaseX;
    const lz = z - raw.mapBuildBaseZ;
    if (lx < 0 || lz < 0 || lx >= SCENE_SIZE || lz >= SCENE_SIZE) {
        return null;
    }
    const uu = Math.max(0, Math.min(1, u));
    const vv = Math.max(0, Math.min(1, v));
    return {
        sceneX: (lx << 7) + Math.min(127, Math.floor(uu * 128)),
        sceneZ: (lz << 7) + Math.min(127, Math.floor(vv * 128))
    };
}

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

interface StatSnapshot {
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
    faceEntity: number;
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

interface SelectButtonLabel {
    mode: number;
    label: string;
}

export function attach(client: unknown): string[] {
    const missing = SELF_TEST.filter(name => !(name in (client as Record<string, unknown>)));
    raw = client as RawClient;
    // Why: a memo that outlived its client would make a relogin read the previous session's locs.
    invalidateLocSnapshots();

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
     * Hint-arrow tile (type 2–6), or null when no tile hint is active.
     * Used by Brimhaven Agility Arena for the active ticket pillar.
     */
    hintTile(): WorldTile | null {
        if (!raw) {
            return null;
        }
        const c = raw as RawClient & {
            hintType?: number;
            hintTileX?: number;
            hintTileZ?: number;
        };
        const t = c.hintType ?? 0;
        // Client normalises types 2–6 to type 2 after reading the tile coords.
        if (t !== 2) {
            return null;
        }
        const x = c.hintTileX ?? 0;
        const z = c.hintTileZ ?? 0;
        if (x <= 0 || z <= 0) {
            return null;
        }
        return { x, z, level: raw.minusedlevel };
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
     * `u`/`v` are fractional offsets within the tile (0 = west/south edge, 1 = east/north), clamped to the tile interior.
     */
    overlayPosWorld(x: number, z: number, height = 0, u = 0.5, v = 0.5): { x: number; y: number } | null {
        if (!raw) {
            return null;
        }
        const scene = worldTileToScene(x, z, u, v);
        if (!scene) {
            return null;
        }
        return raw.overlayPos(scene.sceneX, scene.sceneZ, height);
    },

    /**
     * Project a world tile corner into **areaGame** pixels (512×334, no canvas +4).
     * Call only while the client has bound Pix2D to areaGame (onAfterWorldRender).
     */
    projectAreaGameWorld(x: number, z: number, height = 0, u = 0.5, v = 0.5): { x: number; y: number } | null {
        if (!raw) {
            return null;
        }
        const scene = worldTileToScene(x, z, u, v);
        if (!scene) {
            return null;
        }
        if (typeof raw.projectAreaGame === 'function') {
            return raw.projectAreaGame(scene.sceneX, scene.sceneZ, height);
        }
        // Fallback: strip canvas offset from overlayPos.
        const p = raw.overlayPos(scene.sceneX, scene.sceneZ, height);
        return p ? { x: p.x - 4, y: p.y - 4 } : null;
    },

    selfAnim(): number {
        return raw?.localPlayer?.primaryAnim ?? -1;
    },

    selfChat(): string | null {
        return raw?.localPlayer?.chatMessage ?? null;
    },

    energy(): number {
        return raw?.runenergy ?? 0;
    },

    /**
     * Orbit camera yaw 0–2047 (client-only; TS-private on Client, plain property at runtime).
     * Used by optional nav path-facing — no server/LC dependency.
     */
    cameraYaw(): number {
        const c = raw as (RawClient & { orbitCameraYaw?: number }) | null;
        return (c?.orbitCameraYaw ?? 0) & 0x7ff;
    },

    /** Orbit camera pitch 128–383. */
    cameraPitch(): number {
        const c = raw as (RawClient & { orbitCameraPitch?: number }) | null;
        return c?.orbitCameraPitch ?? 128;
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

    /** True once this login's stat snapshot is safe for script baselines. */
    statsReady(): boolean {
        return raw !== null && currentLoginStatsReady(
            raw.statBaseLevel,
            raw.statSeenGeneration,
            raw.statSessionGeneration
        );
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
     * The eight corners of an NPC's bounding box in overlay-canvas pixels, ground ring first then the top ring in the same winding.
     * Edges are 0-1-2-3-0, 4-5-6-7-4 and 0-4, 1-5, 2-6, 3-7. Null when the NPC is gone or off-screen.
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

    /**
     * Loc object hull: eight corners of the object AABB in overlay pixels, or areaGame pixels when `areaGame`.
     * Centre comes from live scene placement; size from LocType, multi-tile footprint or model minY. Null when off-scene.
     */
    locBox(
        opts: { id?: number; x: number; z: number; level?: number; name?: string },
        areaGame = false
    ): { x: number; y: number }[] | null {
        if (!raw || !raw.world) {
            return null;
        }
        const level = opts.level ?? raw.minusedlevel;
        const lx = opts.x - raw.mapBuildBaseX;
        const lz = opts.z - raw.mapBuildBaseZ;
        if (lx < 0 || lz < 0 || lx >= SCENE_SIZE || lz >= SCENE_SIZE) {
            return null;
        }

        const wantName = opts.name?.trim().toLowerCase() || null;
        const matchTc = (tc: number): boolean => {
            if (tc === 0) {
                return false;
            }
            const id = (tc >> 14) & 0x7fff;
            if (opts.id !== undefined) {
                return id === opts.id;
            }
            if (wantName) {
                try {
                    const n = LocType.list(id).name;
                    return n !== null && n.toLowerCase() === wantName;
                } catch {
                    return false;
                }
            }
            // No id/name: accept any loc on the exact tile only (see search).
            return true;
        };

        type Hit = {
            sceneX: number;
            sceneZ: number;
            halfW: number;
            halfL: number;
            resolvedId: number | undefined;
            modelSrc: ModelSource | null;
            usedSceneFootprint: boolean;
            /** Prefer exact-tile / wall over distant scenery. */
            rank: number;
            dist: number;
            /** Wall orientation for thin AABB (scene units). */
            wallAngle1?: number;
        };

        const hits: Hit[] = [];

        const pushWall = (tx: number, tz: number): void => {
            const wall = raw!.world!.getWall(level, tx, tz);
            if (!wall || !matchTc(wall.typecode)) {
                return;
            }
            const id = (wall.typecode >> 14) & 0x7fff;
            hits.push({
                sceneX: wall.x,
                sceneZ: wall.z,
                halfW: 64,
                halfL: 64,
                resolvedId: id,
                modelSrc: wall.model1 ?? wall.model2,
                usedSceneFootprint: false,
                rank: 0,
                dist: Math.abs(tx - lx) + Math.abs(tz - lz),
                wallAngle1: wall.angle1
            });
        };

        const pushDecor = (tx: number, tz: number): void => {
            const decor = raw!.world!.getDecor(level, tz, tx);
            if (!decor || !matchTc(decor.typecode)) {
                return;
            }
            const id = (decor.typecode >> 14) & 0x7fff;
            hits.push({
                sceneX: decor.x,
                sceneZ: decor.z,
                halfW: 64,
                halfL: 64,
                resolvedId: id,
                modelSrc: decor.model,
                usedSceneFootprint: false,
                rank: 2,
                dist: Math.abs(tx - lx) + Math.abs(tz - lz)
            });
        };

        const pushGd = (tx: number, tz: number): void => {
            const gd = raw!.world!.getGd(level, tx, tz);
            if (!gd || !matchTc(gd.typecode)) {
                return;
            }
            const id = (gd.typecode >> 14) & 0x7fff;
            hits.push({
                sceneX: gd.x,
                sceneZ: gd.z,
                halfW: 64,
                halfL: 64,
                resolvedId: id,
                modelSrc: gd.model,
                usedSceneFootprint: false,
                rank: 3,
                dist: Math.abs(tx - lx) + Math.abs(tz - lz)
            });
        };

        // getScene only returns when (tx,tz) is the SW (min) corner of the sprite.
        // Scan a neighbourhood so multi-tile locs still resolve when locX/Z is not SW.
        const SEARCH = opts.id !== undefined || wantName ? 2 : 0;
        for (let ox = Math.max(0, lx - SEARCH); ox <= Math.min(SCENE_SIZE - 1, lx + SEARCH); ox++) {
            for (let oz = Math.max(0, lz - SEARCH); oz <= Math.min(SCENE_SIZE - 1, lz + SEARCH); oz++) {
                if (SEARCH === 0 && (ox !== lx || oz !== lz)) {
                    continue;
                }
                // Without id/name, only the exact tile (avoid random nearby locs).
                if (opts.id === undefined && !wantName && (ox !== lx || oz !== lz)) {
                    continue;
                }

                pushWall(ox, oz);
                pushDecor(ox, oz);
                pushGd(ox, oz);

                const scene = raw.world.getScene(level, ox, oz);
                if (!scene || !matchTc(scene.typecode)) {
                    continue;
                }
                // Require the published tile to sit inside the footprint when found off-min.
                if (lx < scene.minTileX || lx > scene.maxTileX || lz < scene.minTileZ || lz > scene.maxTileZ) {
                    continue;
                }
                const id = (scene.typecode >> 14) & 0x7fff;
                const tilesX = scene.maxTileX - scene.minTileX + 1;
                const tilesZ = scene.maxTileZ - scene.minTileZ + 1;
                hits.push({
                    sceneX: scene.x,
                    sceneZ: scene.z,
                    halfW: (tilesX * 128) / 2,
                    halfL: (tilesZ * 128) / 2,
                    resolvedId: id,
                    modelSrc: scene.model,
                    usedSceneFootprint: true,
                    rank: 1,
                    dist: Math.abs(ox - lx) + Math.abs(oz - lz)
                });
            }
        }

        hits.sort((a, b) => a.rank - b.rank || a.dist - b.dist);

        // Why: a tile-centre fallback at locX/locZ (often the approach tile) draws a cube
        // around the player whenever the hop is active and the loc was missed.
        if (hits.length === 0) {
            return null;
        }

        const h0 = hits[0]!;
        const sceneX = h0.sceneX;
        const sceneZ = h0.sceneZ;
        let halfW = h0.halfW;
        let halfL = h0.halfL;
        let topH = 128;
        const resolvedId = h0.resolvedId ?? opts.id;
        const modelSrc = h0.modelSrc;
        const usedSceneFootprint = h0.usedSceneFootprint;
        const wallAngle1 = h0.wallAngle1;

        try {
            if (resolvedId !== undefined) {
                const lt = LocType.list(resolvedId);
                if (!usedSceneFootprint) {
                    halfW = Math.max(32, (lt.width * 128) / 2);
                    halfL = Math.max(32, (lt.length * 128) / 2);
                    // Doors / walls: thin AABB on the wall-facing axis (wallwidth ≈ 16).
                    if (wallAngle1 !== undefined) {
                        const thin = Math.max(8, Math.min(40, lt.wallwidth || 16));
                        const a = ((wallAngle1 % 2048) + 2048) % 2048;
                        // 0/1024 → extends along X (thin in Z); 512/1536 → along Z (thin in X).
                        if (a < 256 || (a >= 896 && a < 1152) || a >= 1792) {
                            halfL = thin;
                        } else {
                            halfW = thin;
                        }
                    }
                }
                const model = resolveLocModelExtents(modelSrc);
                // resizey is a % scale (128 = 100%), not a height — never use it as topH.
                topH = locHullHeight(model, 128);
                if (
                    !usedSceneFootprint &&
                    model &&
                    model.radius > 0 &&
                    lt.width <= 1 &&
                    lt.length <= 1 &&
                    wallAngle1 === undefined
                ) {
                    // Single-tile scenery (trees, etc.): inflate to model radius, capped.
                    const r = Math.min(model.radius, 192);
                    halfW = Math.max(halfW, r);
                    halfL = Math.max(halfL, r);
                }
            } else {
                topH = locHullHeight(resolveLocModelExtents(modelSrc), 128);
            }
        } catch {
            // LocType may not be ready during boot
        }

        const project = (sx: number, sz: number, h: number): { x: number; y: number } | null => {
            if (areaGame && typeof raw!.projectAreaGame === 'function') {
                return raw!.projectAreaGame!(sx, sz, h);
            }
            return raw!.overlayPos(sx, sz, h);
        };

        // Ground ring then top ring (same winding as npcBox).
        const offsets: [number, number][] = [
            [-halfW, -halfL],
            [halfW, -halfL],
            [halfW, halfL],
            [-halfW, halfL]
        ];
        const tryHeights = [Math.max(16, topH), Math.max(16, Math.min(topH, 96)), 48];
        for (const top of tryHeights) {
            const out: { x: number; y: number }[] = [];
            let ok = true;
            for (const h of [4, top]) {
                for (const [dx, dz] of offsets) {
                    const p = project(sceneX + dx, sceneZ + dz, h);
                    if (!p) {
                        ok = false;
                        break;
                    }
                    out.push(p);
                }
                if (!ok) {
                    break;
                }
            }
            if (ok && out.length === 8) {
                return out;
            }
        }
        return null;
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

    selfFaceEntity(): number {
        return raw?.localPlayer?.faceEntity ?? -1;
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
                inCombat: combatShowing(player.combatCycle),
                faceEntity: player.faceEntity
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

        // Distance is baked into each snapshot, so the player tile is part of the key
        // rather than a reason to skip caching: a standing bot hits the memo every frame.
        const key = `${level}:${px}:${pz}:${raw.mapBuildBaseX}:${raw.mapBuildBaseZ}`;
        if (locCache !== null && locCacheKey === key) {
            return locCache;
        }

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

        locCache = out;
        locCacheKey = key;
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

        cachedRetaliateControls = readRetaliateControls();
        return cachedRetaliateControls;
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

    /**
     * World tiles for the last successful walkTo/tryMove (src→dest inclusive).
     * Empty when the last walk failed or the client has no path buffer.
     */
    lastWalkPathWorld(): { x: number; z: number; level: number }[] {
        if (!raw || !raw.lastWalkPathLocal || raw.lastWalkPathLocal.length === 0) {
            return [];
        }
        const baseX = raw.mapBuildBaseX;
        const baseZ = raw.mapBuildBaseZ;
        const level = raw.minusedlevel;
        return raw.lastWalkPathLocal.map(p => ({
            x: baseX + p.x,
            z: baseZ + p.z,
            level
        }));
    },

    localPlayerName(): string | null {
        return raw?.localPlayer?.name ?? null;
    },

    combatLevel(): number {
        return raw?.localPlayer?.combatLevel ?? 0;
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

    // The sliding-puzzle board is the interactable inv in the open main modal.
    // The hint panel beside it is the same 5x5 shape but is not interactable.
    puzzleBoardComId(): number {
        if (!raw || raw.mainModalId === -1) {
            return -1;
        }

        return findInvComponentIn(raw.mainModalId, com => com.objOps === true);
    },

    puzzleBoard(): InvItemSnapshot[] {
        const comId = reader.puzzleBoardComId();
        if (comId === -1) {
            return [];
        }

        return readInvComponent(comId, type => heldOps(type.iop));
    },

    puzzleBoardSize(): number {
        const comId = reader.puzzleBoardComId();
        return comId === -1 ? 0 : (IfType.list[comId].linkObjType?.length ?? 0);
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

    /**
     * Find a clickable main-modal button nearest a text label (substring match).
     * Why: glidermap-style destination buttons carry no buttonText and only sit beside a text component (e.g. "Gandius", "Ta Quir Priw").
     */
    mainModalButtonNearText(label: string): number {
        if (!raw || raw.mainModalId === -1) {
            return -1;
        }
        const want = label.toLowerCase();
        const positioned = walkPositionedComponents(raw.mainModalId);
        const texts = positioned.filter(
            p =>
                p.com.type === ComponentType.TYPE_TEXT
                && p.com.text
                && p.com.text.toLowerCase().includes(want)
        );
        if (texts.length === 0) {
            return -1;
        }
        const labelPos = texts[0]!;
        const buttons = positioned.filter(
            p =>
                p.com.buttonType === ButtonType.BUTTON_OK
                || p.com.buttonType === ButtonType.BUTTON_TARGET
                || p.com.buttonType === ButtonType.BUTTON_SELECT
        );
        if (buttons.length === 0) {
            return -1;
        }
        const dist = (a: PositionedComponent, b: PositionedComponent): number => {
            const ax = a.x + (a.com.width ?? 0) / 2;
            const ay = a.y + (a.com.height ?? 0) / 2;
            const bx = b.x + (b.com.width ?? 0) / 2;
            const by = b.y + (b.com.height ?? 0) / 2;
            return Math.hypot(ax - bx, ay - by);
        };
        buttons.sort((a, b) => dist(a, labelPos) - dist(b, labelPos));
        return buttons[0]!.com.id;
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
    },

    /**
     * Raw item icon pixels for the loadout picker. Null whenever the cache is not loaded or the id has no sprite.
     * Why: DOM belongs to src/bot/panel/, so canvas and data-URL conversion lives there rather than here.
     */
    itemIconPixels(id: number): { width: number; height: number; data: Int32Array } | null {
        try {
            const sprite = ObjType.getSprite(id, 1, 0);
            return sprite ? { width: sprite.wi, height: sprite.hi, data: sprite.data } : null;
        } catch {
            return null;
        }
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

    /**
     * Set orbit camera yaw (0–2047). Client-side only — flags the periodic
     * camera report packet when available. Does not touch LC/engine code.
     */
    setCameraYaw(yaw: number): boolean {
        if (!raw || !raw.ingame) {
            return false;
        }
        const c = raw as RawClient & { orbitCameraYaw?: number; sendCamera?: boolean };
        if (typeof c.orbitCameraYaw !== 'number') {
            return false;
        }
        c.orbitCameraYaw = yaw & 0x7ff;
        if ('sendCamera' in c) {
            c.sendCamera = true;
        }
        return true;
    },

    /**
     * Smoothly step orbit yaw toward a target (maxStep units per call, default ~32).
     * Returns the yaw after the step, or -1 if camera is unavailable.
     */
    stepCameraYaw(target: number, maxStep = 32): number {
        if (!raw || !raw.ingame) {
            return -1;
        }
        const c = raw as RawClient & { orbitCameraYaw?: number; sendCamera?: boolean };
        if (typeof c.orbitCameraYaw !== 'number') {
            return -1;
        }
        let d = ((target & 0x7ff) - (c.orbitCameraYaw & 0x7ff)) & 0x7ff;
        if (d > 1024) {
            d -= 2048;
        }
        if (d > maxStep) {
            d = maxStep;
        } else if (d < -maxStep) {
            d = -maxStep;
        }
        c.orbitCameraYaw = (c.orbitCameraYaw + d) & 0x7ff;
        if ('sendCamera' in c) {
            c.sendCamera = true;
        }
        return c.orbitCameraYaw;
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

// player_controls.rs2: controls:com_2 toggles retaliate on, com_3 off. com_6/com_7
// have no if_button handler, so the server discards presses sent to those indices.
export function readRetaliateControls(): { onComId: number; offComId: number } | null {
    for (const root of IfType.list) {
        if (!root?.children) {
            continue;
        }

        const hasRetaliate = root.children.some(c => IfType.list[c]?.text === 'Auto retaliate');
        if (!hasRetaliate || root.children.length <= 3) {
            continue;
        }

        const on = root.children[2];
        const off = root.children[3];
        if (IfType.list[on]?.buttonType !== undefined && IfType.list[off] !== undefined) {
            return { onComId: on, offComId: off };
        }
        break;
    }

    return null;
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

// Client stamps combatCycle at loopCycle + 400 and treats a target as fighting until 100 cycles remain: a 300-cycle window, 6s at the era client's 20ms tick.
// Why: both ends are loop cycles, so a bot client running that loop slower would stretch the window and see every target as still in combat.
const COMBAT_STAMP_CYCLES = 400;
const COMBAT_WINDOW_MS = 6000;

/**
 * Cycles-remaining threshold that keeps the combat window at {@link COMBAT_WINDOW_MS}.
 * Why: deltime can be zero during random-event teleports and scene rebuilds, and dividing by it would NaN the window and crash handlers.
 */
export function combatShowingThreshold(deltimeMs: number): number {
    const d = deltimeMs > 0 ? deltimeMs : 20;
    return COMBAT_STAMP_CYCLES - COMBAT_WINDOW_MS / d;
}

function combatShowing(combatCycle: number): boolean {
    return combatCycle > loopCycleNow() + combatShowingThreshold(deltimeNow());
}

/**
 * Client ms/tick for cycle-stamped combat windows, soft-defaulting to a nominal 20ms.
 * Why: random-event teleports (maze) and scene rebuilds leave deltime at 0 for a tick, and throwing here crashed AIOQuester mid-maze.
 */
function deltimeNow(): number {
    const deltime = raw?.deltime ?? 0;
    return deltime > 0 ? deltime : 20;
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
