import assert from 'node:assert/strict';

function row(value: unknown): Record<string, unknown> {
    assert(typeof value === 'object' && value !== null && !Array.isArray(value), 'expected evidence object');
    return Object.fromEntries(Object.entries(value));
}
function num(value: unknown): number { assert(typeof value === 'number' && Number.isFinite(value)); return value; }
function rows(value: unknown): Record<string, unknown>[] { assert(Array.isArray(value)); return value.map(row); }
const point = (value: unknown) => { const p = row(value); return { x: num(p.x), z: num(p.z) }; };

export function assessBlackRange(events: readonly unknown[], frames: readonly unknown[], mode: 'baseline' | 'candidate' = 'baseline') {
    const safeRange = mode === 'candidate' ? 6 : 7;
    const server = frames.map(value => { const r = row(value); return { at: num(r.at), dragons: rows(r.dragons) }; }).sort((a, b) => a.at - b.at);
    const timeline = events.map(row).sort((a, b) => num(a.at) - num(b.at));
    const prekillTakes: object[] = [], readinessDelays: object[] = [], friendlySteals: object[] = [], walkouts: object[] = [], lootOrder: object[] = [];
    const unsafeAttacks: object[] = [], ownedChanges: object[] = [], fightPreemptions: object[] = [];
    const smallArrowTakes: object[] = [], unsafeLeashes: object[] = [];
    const attacked = new Map<string, { nid: number; life: number }>();
    const readyCounts = new Map<string, number>();
    const dead = new Set<string>();
    const idleEvidence: Record<string, object[]> = { settle: [], gap7: [], skipped: [], losMismatch: [], alternate: [] };
    let cursor = 0, attacks = 0, takes = 0, unjoinedActions = 0, arrowAlive = 0, postdeathTakes = 0, friendlyOpportunities = 0;
    const ownership: { current: { nid: number; life: number } | null } = { current: null };
    let pendingLoot = false;
    for (const event of timeline) {
        let owned = ownership.current;
        const at = num(event.at);
        while (cursor + 1 < server.length && (server[cursor + 1]?.at ?? Infinity) <= at) cursor++;
        const before = server[cursor], after = server[cursor + 1];
        const action = event.kind === 'npc-action' || event.kind === 'ground-action' || event.kind === 'leash-start';
        if (!before || before.at > at || at - before.at > 300 || !after || after.at - at > 300) {
            if (action) unjoinedActions++;
            continue;
        }
        const mine: Record<string, unknown> | null | undefined = owned && before.dragons.find(n => n.nid === owned?.nid && n.life === owned?.life);
        const alive = mine !== null && mine !== undefined && num(mine.hp) > 0 && mine.active === true;
        if (owned && mine && num(mine.hp) === 0) { dead.add(`${owned.nid}:${owned.life}`); owned = null; pendingLoot = true; }
        const ground = rows(event.ground);
        const hasArrows = ground.some(item => item.name === 'Rune arrow');
        if (alive && hasArrows) arrowAlive++;
        const tile = point(event.tile), anchor = point(event.anchor);
        if (alive && (tile.x !== anchor.x || tile.z !== anchor.z)) walkouts.push({ at, tile, owned, status: event.status, engaged: event.engaged, lootTarget: event.lootTarget });
        const npcs = rows(event.npcs);
        if (mode === 'candidate' && event.kind === 'leash-start' && !(alive && owned?.nid === event.index)) {
            const client = npcs.find(n => n.index === event.index);
            const target = before.dragons.find(n => n.nid === event.index && n.active === true && num(n.hp) > 0);
            const stand = target && rows(target.stands).find(s => s.x === anchor.x && s.z === anchor.z);
            if (!stand || stand.los !== true || num(stand.gap) > safeRange || client?.networkLos !== true
                || typeof client.networkGap !== 'number' || !Number.isFinite(client.networkGap) || client.networkGap > safeRange
                || client.other === true || (client.combat === true && client.me !== true)) unsafeLeashes.push({ at, client, stand });
        }
        if (event.kind === 'idle' && event.engaged === null) {
            for (const npc of npcs) {
                const n = before.dragons.find(n => n.nid === npc.index);
                if (!n || num(n.hp) <= 0 || npc.other === true || (npc.combat === true && npc.me !== true)) continue;
                const stands = rows(n.stands);
                const stand = stands.find(s => s.x === anchor.x && s.z === anchor.z);
                if (!stand) continue;
                const origin = point(npc.origin);
                const next = after.dragons.find(next => next.nid === n.nid && next.life === n.life);
                if (n.x !== origin.x || n.z !== origin.z || next?.x !== origin.x || next?.z !== origin.z) continue;
                const detail = { at, npc, stand, dragon: n, status: event.status, task: event.task, anchor };
                if (stand.los === true && num(stand.gap) <= 7) {
                    if (num(npc.settledAge) < 1200) idleEvidence.settle.push(detail);
                    if (num(stand.gap) === 7) idleEvidence.gap7.push(detail);
                    if (num(npc.skipRemaining) > 0) idleEvidence.skipped.push(detail);
                }
                if (npc.los !== stand.los) idleEvidence.losMismatch.push(detail);
                if (stands.some(s => s.los === true && num(s.gap) <= safeRange && (stand.los !== true || num(stand.gap) > safeRange))) idleEvidence.alternate.push(detail);
            }
        }
        if (event.kind === 'npc-action' && event.action === 'Attack') {
            attacks++;
            const nid = num(event.index);
            const target = before.dragons.find(n => n.nid === nid && n.active === true && num(n.hp) > 0)
                ?? after.dragons.find(n => n.nid === nid && n.active === true && num(n.hp) > 0);
            const client = npcs.find(n => n.index === nid);
            const stand = target && rows(target.stands).find(s => s.x === tile.x && s.z === tile.z);
            if (!stand || stand.los !== true || num(stand.gap) > safeRange || client?.networkLos === false
                || (typeof client?.networkGap === 'number' && client.networkGap > safeRange)
                || (mode === 'candidate' && (client?.networkLos !== true || typeof client.networkGap !== 'number' || !Number.isFinite(client.networkGap)))) unsafeAttacks.push({ at, nid, stand, client });
            if (alive && owned && owned.nid !== nid) ownedChanges.push({ at, owned, nid });
            if (client && (client.other === true || (client.combat === true && client.me !== true && mine?.nid !== nid))) friendlySteals.push({ at, nid });
            if (pendingLoot && ground.some(item => item.name === 'Dragon bones' || item.name === 'Dragonhide')) lootOrder.push({ at, nid });
            if (target && num(target.hp) > 0) {
                owned = { nid, life: num(target.life) };
                attacked.set(`${nid}:${owned.life}`, owned);
            }
            readyCounts.clear();
        }
        if (event.kind === 'ground-action' && event.action === 'Take') {
            takes++;
            if (mode === 'candidate' && event.site === 'blue' && event.item === 'Rune arrow'
                && (typeof event.itemCount !== 'number' || !Number.isInteger(event.itemCount) || event.itemCount < 4)) smallArrowTakes.push({ at, count: event.itemCount });
            const next = owned && after.dragons.find(n => n.nid === owned?.nid && n.life === owned?.life);
            if (alive && next && num(next.hp) > 0) prekillTakes.push({ at, item: event.item, owned, hpBefore: mine?.hp, hpAfter: next.hp, tile });
            if (pendingLoot) { postdeathTakes++; pendingLoot = false; }
        }
        if (alive && event.kind === 'inventory-action' && event.action === 'Drop' && event.item === 'Shark') fightPreemptions.push({ at, item: event.item, action: 'Drop', owned });
        if (event.kind === 'idle' && !alive && event.engaged === null && (event.lootTarget ?? null) === null && tile.x === anchor.x && tile.z === anchor.z) {
            const eligible = new Set<string>();
            for (const npc of npcs) {
                if (npc.other === true) { friendlyOpportunities++; continue; }
                if (npc.combat === true && npc.me !== true) continue;
                if (mode === 'candidate' && (npc.networkLos !== true || typeof npc.networkGap !== 'number' || !Number.isFinite(npc.networkGap))) continue;
                const n = before.dragons.find(n => n.nid === npc.index);
                if (!n || num(n.hp) <= 0 || n.active !== true) continue;
                const stand = rows(n.stands).find(s => s.x === anchor.x && s.z === anchor.z);
                if (!stand || stand.los !== true || num(stand.gap) > safeRange || (npc.networkLos ?? npc.los) !== true || num(npc.networkGap ?? npc.gap) > safeRange || num(npc.skipRemaining) > 0) continue;
                const key = `${n.nid}:${n.life}`;
                eligible.add(key);
                const count = (readyCounts.get(key) ?? 0) + 1;
                readyCounts.set(key, count);
                if (count === 3) readinessDelays.push({ at, key, npc, stand, status: event.status, task: event.task, engaged: event.engaged, lootTarget: event.lootTarget, target: event.target });
            }
            for (const key of readyCounts.keys()) if (!eligible.has(key)) readyCounts.delete(key);
        }
        ownership.current = owned;
    }
    const lastEvent = timeline.at(-1);
    const endedAt = lastEvent ? num(lastEvent.at) : 0;
    for (const frame of server.filter(frame => frame.at <= endedAt)) for (const n of frame.dragons) {
        const key = `${n.nid}:${n.life}`;
        if (num(n.hp) === 0 && attacked.has(key)) dead.add(key);
    }
    const gaps = [
        ...(attacks === 0 ? ['actual Attack'] : []), ...(arrowAlive === 0 ? ['Rune arrow observed while owned victim alive'] : []),
        ...(dead.size < 3 ? ['three authoritative natural kills'] : []), ...(postdeathTakes === 0 ? ['post-death Take'] : []),
        ...(mode === 'baseline' ? ['baseline diagnostic only'] : [])
    ];
    const passed = gaps.length === 0 && prekillTakes.length === 0 && readinessDelays.length === 0 && friendlySteals.length === 0
        && walkouts.length === 0 && lootOrder.length === 0 && unjoinedActions === 0 && unsafeAttacks.length === 0 && ownedChanges.length === 0 && fightPreemptions.length === 0
        && smallArrowTakes.length === 0 && unsafeLeashes.length === 0;
    return { passed, attacks, takes, kills: dead.size, arrowAlive, postdeathTakes, friendlyOpportunities,
        prekillTakes, readinessDelays, friendlySteals, walkouts, lootOrder, unsafeAttacks, ownedChanges, fightPreemptions, smallArrowTakes, unsafeLeashes, unjoinedActions, gaps, idleEvidence };
}
