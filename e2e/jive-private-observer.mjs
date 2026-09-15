import assert from 'node:assert/strict';
import process from 'node:process';
import { appendFileSync } from 'node:fs';
import { realpath, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertEngineCwd, validatePrivateEngine, openPrivateTrace, candidateRoot } from './jive-private-boundary.mjs';

assert.equal(process.env.RUNTIME_AUTHORIZED, '1');
assert.equal(process.env.TARGET, 'local');
assert.equal(process.env.BASE, 'http://localhost:8891');
const engine = await realpath(process.env.ENGINE_DIR ?? '');
assert.equal(engine, await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../../shilo-private/engine')));
assertEngineCwd(engine, process.cwd());
validatePrivateEngine(engine);
assert(process.env.JIVE_REWARD_FIXTURE_SHA256);
const rewardFile = resolve(engine, '../content/scripts/minigames/game_trail/scripts/hard/trail_clue_hard_reward.rs2');
const fixture = createHash('sha256').update(await readFile(rewardFile)).digest('hex');
assert.equal(fixture, process.env.JIVE_REWARD_FIXTURE_SHA256);
const output = openPrivateTrace(candidateRoot, process.env.BLACK_SERVER_TRACE);
const load = path => import(pathToFileURL(resolve(engine, path)).href);
const { default: World } = await load('src/engine/World.ts');
const { default: InvType } = await load('src/cache/config/InvType.ts');
const { default: NpcType } = await load('src/cache/config/NpcType.ts');
const { default: VarPlayerType } = await load('src/cache/config/VarPlayerType.ts');
const { default: VarNpcType } = await load('src/cache/config/VarNpcType.ts');
await load('src/app.ts');
const lives = new Map();
let previous = -1;
const items = (player, name) => (player.invs.get(InvType.getId(name))?.items ?? []).flatMap(item => item ? [{ id: item.id, count: item.count }] : []);
setInterval(() => {
    if (World.currentTick < 1 || previous === World.currentTick) return;
    previous = World.currentTick;
    const players = [...World.players].filter(Boolean);
    const guardians = [...World.npcs].filter(n => n.type === NpcType.getId('trail_hard2')).map(n => {
        const old = lives.get(n.nid);
        const fresh = !old || old.uid !== n.uid || (!old.active && n.isActive) || (old.hp === 0 && n.levels[3] > 0);
        const ownerUid = n.vars[VarNpcType.getId('npc_aggressive_player')];
        const owner = players.find(p => p.uid === ownerUid || (n.target && n.target === p))?.username ?? (fresh ? null : old?.owner) ?? null;
        const life = fresh ? `${n.nid}:${previous}` : old.life;
        lives.set(n.nid, { uid: n.uid, active: n.isActive, hp: n.levels[3], owner, life });
        return { nid: n.nid, life, name: NpcType.get(n.type).name, hp: n.levels[3], active: n.isActive, owner };
    });
    appendFileSync(output, JSON.stringify({ at: Date.now(), engine, candidate: candidateRoot, tick: previous, fixture, guardians, players: players.map(p => ({
        username: p.username, hp: p.levels[3], inventory: items(p, 'inv'), bank: items(p, 'bank'),
        trailStatus: p.vars[VarPlayerType.getId('trail_status')],
        ground: [...World.gameMap.getZone(p.x, p.z, p.level).getAllObjsUnsafe()].filter(o => o.isActive).map(o => ({
            id: o.type, count: o.count, x: o.x, z: o.z, owned: o.receiver64 === p.hash64 }))
    })) }) + '\n');
}, 40);
