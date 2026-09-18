import type { LocSnapshot, NpcSnapshot, WorldTile } from '../../src/bot/adapter/ClientAdapter.js';
import type { Loc } from '../../src/bot/api/model/Loc.js';
import type { BuildInfo } from '../../src/bot/runtime/buildInfo.js';

export interface Sample {
    at: number;
    tick: number;
    tile: WorldTile | null;
    anim: number;
    combat: boolean;
    skeletons: number;
    retaliate: boolean;
    hp: number;
    xp: number;
    coal: number;
    full: boolean;
    state: string;
}

interface Choice {
    at: number;
    tick: number;
    tile: WorldTile;
    distance: number;
    nearest: number;
    candidates: number;
    rolls: number[];
}

interface Depletion extends Sample {
    rock: WorldTile;
    nearby: boolean;
    available: number;
    selectionTicks?: number;
    selectionMs?: number;
    nextDistance?: number;
    clickTicks?: number;
    clickMs?: number;
}

export interface MiningProof {
    build: BuildInfo;
    startedAt: string;
    samples: Sample[];
    choices: Choice[];
    clicks: (Sample & { rock: WorldTile })[];
    depletions: Depletion[];
    stop(): void;
}

interface GatherProbe {
    activeMineTile: WorldTile | null;
    pickRock(): Loc | null;
    rockQuery(): { results(): Loc[] };
}

export interface MiningGlobal {
    rs2b0t: {
        build: BuildInfo;
        host: { tickCount: number; addFrameListener(callback: () => void): () => void };
        runner: {
            state: string;
            bot: { tasks: GatherProbe[]; status: string } | null;
            ctx: { log: { time: number; level: string; msg: string }[] } | null;
            start(meta: unknown): void;
            stop(reason: string): void;
        };
        registry: { get(name: string): unknown };
        reader: {
            worldTile(): WorldTile | null;
            selfSlot(): number;
            selfAnim(): number;
            inCombat(): boolean;
            locs(): LocSnapshot[];
            npcs(): NpcSnapshot[];
            toLocal(x: number, z: number): { lx: number; lz: number } | null;
        };
        input: { interactLoc(x: number, z: number, type: number, op: number): boolean };
    };
    __rs2b0t: {
        Game: { autoRetaliateOn(): boolean };
        Skills: { xp(name: string): number; effective(name: string): number };
        Inventory: { count(name: string): number; isFull(): boolean };
    };
    __miningProof?: MiningProof;
}

export function installMiningProbe(): void {
    const g = globalThis as never as MiningGlobal;
    const { reader, host, input, runner } = g.rs2b0t;
    const { Game, Skills, Inventory } = g.__rs2b0t;
    const gather = runner.bot?.tasks.find(task => typeof task.pickRock === 'function');
    if (!gather) throw new Error('Miner Gather task unavailable');
    const proof: MiningProof = {
        build: g.rs2b0t.build, startedAt: new Date().toISOString(),
        samples: [], choices: [], clicks: [], depletions: [], stop: () => {}
    };
    g.__miningProof = proof;
    const point = (tile: WorldTile): WorldTile => ({ x: tile.x, z: tile.z, level: tile.level });
    const same = (a: WorldTile, b: WorldTile) => a.x === b.x && a.z === b.z && a.level === b.level;
    const distance = (a: WorldTile, b: WorldTile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
    const snapshot = (): Sample => ({
        at: Date.now(), tick: host.tickCount, tile: reader.worldTile(), anim: reader.selfAnim(),
        combat: reader.inCombat(), retaliate: Game.autoRetaliateOn(),
        skeletons: reader.npcs().filter(n => n.name === 'Skeleton' && n.faceEntity === reader.selfSlot() + 32768).length,
        hp: Skills.effective('hitpoints'), xp: Skills.xp('mining'), coal: Inventory.count('Coal'),
        full: Inventory.isFull(), state: runner.state
    });
    let active = gather.activeMineTile ? point(gather.activeMineTile) : null;
    let lastSample = -1;
    const observe = () => {
        const sample = snapshot();
        if (sample.tick !== lastSample) {
            proof.samples.push(sample);
            lastSample = sample.tick;
        }
        if (!active) return;
        const loc = reader.locs().find(l => same(l.tile, active!));
        if (loc && (loc.id === 450 || loc.id === 452)) {
            proof.depletions.push({
                ...sample, rock: active, nearby: sample.tile !== null && distance(sample.tile, active) <= 2,
                available: gather.rockQuery().results().length
            });
            active = null;
        }
    };
    const pick = gather.pickRock;
    gather.pickRock = function () {
        observe();
        const candidates = this.rockQuery().results();
        const random = Math.random;
        const rolls: number[] = [];
        Math.random = () => {
            const value = random();
            rolls.push(value);
            return value;
        };
        let target: Loc | null;
        try {
            target = pick.call(this);
        } finally {
            Math.random = random;
        }
        if (target) {
            proof.choices.push({
                at: Date.now(), tick: host.tickCount, tile: point(target.tile()),
                distance: target.distance(), nearest: Math.min(...candidates.map(l => l.distance())),
                candidates: candidates.length, rolls
            });
            for (const depletion of proof.depletions.filter(d => d.selectionTicks === undefined)) {
                depletion.selectionTicks = host.tickCount - depletion.tick;
                depletion.selectionMs = Date.now() - depletion.at;
                depletion.nextDistance = target.distance();
            }
        }
        return target;
    };
    const interact = input.interactLoc;
    input.interactLoc = function (x, z, type, op) {
        observe();
        const rock = reader.locs().find(loc => {
            const local = reader.toLocal(loc.tile.x, loc.tile.z);
            return local?.lx === x && local.lz === z && loc.typecode === type && [2096, 2097].includes(loc.id);
        });
        const result = interact.call(this, x, z, type, op);
        if (result && rock) {
            proof.clicks.push({ ...snapshot(), rock: point(rock.tile) });
            active = point(rock.tile);
            for (const depletion of proof.depletions.filter(d => d.clickTicks === undefined)) {
                depletion.clickTicks = host.tickCount - depletion.tick;
                depletion.clickMs = Date.now() - depletion.at;
            }
        }
        return result;
    };
    const unsubscribe = host.addFrameListener(observe);
    proof.stop = () => {
        unsubscribe();
        gather.pickRock = pick;
        input.interactLoc = interact;
    };
    observe();
}
