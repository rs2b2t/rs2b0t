import assert from 'node:assert/strict';
import { assessBlackRange } from './jivedragons-black-contract.js';
import { lootEvidence } from './jivedragons-loot-evidence.js';
import { assessLootSequence } from './jivedragons-loot-sequence.js';
import { candidateRuntimeEvidence } from './jivedragons-runtime-evidence.js';
import { assessCandidatePolicy } from './jivedragons-black-policy.js';
import { assessAlternateFights } from './jivedragons-black-adaptive.js';

export async function confirmBlackDisconnect(directory: string, serverPath: string) {
    const closed: unknown = await Bun.file(`${directory}/closed.json`).json();
    assert(typeof closed === 'object' && closed !== null && 'user' in closed && typeof closed.user === 'string');
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        const line = (await Bun.file(serverPath).text()).trim().split('\n').at(-1);
        assert(line);
        const last: unknown = JSON.parse(line);
        assert(typeof last === 'object' && last !== null && 'at' in last && typeof last.at === 'number' && 'players' in last && Array.isArray(last.players));
        const present = last.players.some((p: unknown) => typeof p === 'object' && p !== null && 'username' in p && p.username === closed.user);
        if (!present && Date.now() - last.at < 1000) {
            await Bun.write(`${directory}/disconnect.json`, JSON.stringify({ user: closed.user, serverAt: last.at, present }));
            return;
        }
        await Bun.sleep(200);
    }
    assert.fail('private observer did not confirm player removal within 30s');
}

export async function blackReport(directory: string, serverPath: string, mode: 'baseline' | 'candidate' = 'baseline') {
    const events: unknown[] = [];
    for await (const file of new Bun.Glob('events-*.json').scan(directory)) {
        const chunk: unknown = await Bun.file(`${directory}/${file}`).json();
        assert(Array.isArray(chunk));
        events.push(...chunk);
    }
    const frames: unknown[] = (await Bun.file(serverPath).text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const combat = assessBlackRange(events, frames, mode);
    const sequence = mode === 'candidate' ? lootEvidence(events, frames) : [];
    const loot = { ...assessLootSequence(sequence), foodDrops: sequence.filter(e => e.action === 'Drop' && e.item === 'Shark').length,
        foodReclaims: sequence.filter(e => e.action === 'Take' && e.item === 'Shark').length };
    const runtime = candidateRuntimeEvidence(events, frames);
    const policy = assessCandidatePolicy(events, runtime.capacity);
    const black = sequence.some(e => e.anchor.z === 9817);
    const adaptive = { ...assessAlternateFights(runtime.fights), selections: runtime.selections, required: black };
    const safetyPassed = combat.prekillTakes.length === 0 && combat.fightPreemptions.length === 0 && combat.unsafeAttacks.length === 0 && combat.ownedChanges.length === 0
        && combat.smallArrowTakes.length === 0 && combat.unsafeLeashes.length === 0
        && combat.walkouts.length === 0 && combat.friendlySteals.length === 0 && combat.readinessDelays.length === 0 && combat.unjoinedActions === 0
        && loot.violations.length === 0 && runtime.violations.length === 0 && policy.violations.length === 0;
    const corePassed = combat.passed && loot.completed > 0 && runtime.networkObserved && runtime.movingReadyAttacks > 0 && safetyPassed;
    const result = { ...combat, loot, runtime, policy, adaptive, safetyPassed, corePassed,
        passed: mode === 'candidate' && corePassed && policy.passed && (!black || (adaptive.passed && adaptive.selections > 0)) };
    await Bun.write(`${directory}/loot-sequence.json`, JSON.stringify(sequence.filter(e => e.action !== 'tick'), null, 2));
    const actions = events.filter((event): event is Record<string, unknown> => typeof event === 'object' && event !== null && 'kind' in event &&
        (event.kind === 'npc-action' || event.kind === 'ground-action' || event.kind === 'inventory-action' || event.kind === 'decision'));
    actions.sort((a, b) => Number('at' in a && a.at) - Number('at' in b && b.at));
    await Bun.write(`${directory}/actions.json`, JSON.stringify(actions, null, 2));
    const attackReadiness = actions.filter(a => a.kind === 'npc-action' && a.action === 'Attack').map(a => {
        assert(Array.isArray(a.npcs));
        return { at: a.at, index: a.index, engaged: a.engaged, lootTarget: a.lootTarget, tile: a.tile,
            target: a.npcs.find((n: unknown) => typeof n === 'object' && n !== null && 'index' in n && n.index === a.index) };
    });
    await Bun.write(`${directory}/attack-readiness.json`, JSON.stringify(attackReadiness, null, 2));
    const keys = new Set(['kind', 'at', 'index', 'action', 'item', 'itemTile', 'tile', 'target', 'engaged', 'status', 'hp']);
    await Bun.write(`${directory}/action-timeline.json`, JSON.stringify(actions.filter(a => a.kind !== 'decision')
        .map(a => Object.fromEntries(Object.entries(a).filter(([key]) => keys.has(key)))), null, 2));
    await Bun.write(`${directory}/contract.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, idleEvidence: Object.fromEntries(Object.entries(result.idleEvidence).map(([key, values]) => [key, { count: values.length, examples: values.slice(0, 1) }])), prekillTakes: result.prekillTakes.slice(0, 3), readinessDelays: result.readinessDelays.slice(0, 3),
        walkouts: result.walkouts.slice(0, 3) }, null, 2));
    return result;
}

if (import.meta.main) {
    const [directory, serverPath, mode] = process.argv.slice(2);
    assert(directory && serverPath, 'run directory and authoritative server trace required');
    if (await Bun.file(`${directory}/closed.json`).exists() && !(await Bun.file(`${directory}/disconnect.json`).exists())) await confirmBlackDisconnect(directory, serverPath);
    const result = await blackReport(directory, serverPath, mode === 'candidate' ? 'candidate' : 'baseline');
    process.exitCode = result.passed ? 0 : 1;
}
