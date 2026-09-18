import { assessAdaptiveStand, type AlternateFight } from './jivedragons-black-adaptive.js';
import type { CapacityEpisode } from './jivedragons-black-policy.js';
import { evidenceRow as row, evidenceRows as rows, evidenceNumber as num, evidencePoint as point } from './jivedragons-evidence-values.js';

export function candidateRuntimeEvidence(rawEvents: readonly unknown[], rawFrames: readonly unknown[]) {
    const events = rawEvents.map(row).sort((a, b) => num(a.at) - num(b.at));
    const frames = rawFrames.map(row).sort((a, b) => num(a.at) - num(b.at));
    const capacity: CapacityEpisode[] = [], fights: AlternateFight[] = [];
    const violations = new Set<string>();
    let selections = 0, networkAttacks = 0, attacks = 0, movingReadyAttacks = 0;
    for (const [i, event] of events.entries()) {
        const freeFood = event.kind === 'inventory-action' && event.item === 'Shark' && (event.action === 'Drop' || event.action === 'Eat');
        const capacityDecision = freeFood || (event.kind === 'decision' && (event.task === 'BankRun' || event.task === 'PanicBank'));
        const lastFoodDrop = event.kind === 'inventory-action' && event.action === 'Drop' && event.item === 'Shark' && event.sharks === 1;
        const rest = capacityDecision || lastFoodDrop ? events.slice(i + 1) : [];
        if (capacityDecision && point(event.tile).z >= 9000 && typeof event.hpFraction === 'number' && typeof event.panicHp === 'number' && typeof event.foodReserve === 'number') {
            const outcome = rest.find(e => num(e.at) - num(event.at) <= 20000 && ((freeFood && num(e.used) < 28) || point(e.tile).z < 9000));
            if (outcome) capacity.push({ hp: event.hpFraction, panicHp: event.panicHp, food: num(event.sharks), reserve: event.foodReserve,
                retreatHp: num(event.retreatHp),
                full: event.used === 28, requiredSupplies: event.requiredSupplies === true, escaped: point(outcome.tile).z < 9000,
                roomConfirmed: freeFood && num(outcome.used) < 28 && num(outcome.sharks) < num(event.sharks) && point(outcome.tile).z >= 9000 });
        }
        if (lastFoodDrop) {
            const empty = rest.findIndex(e => num(e.sharks) === 0);
            const stop = empty < 0 ? undefined : rest.slice(empty).find(e => num(e.sharks) > 0 || point(e.tile).z < 9000 || (e.kind === 'decision' && e.task === 'BankRun'));
            if (stop && num(stop.sharks) === 0 && num(stop.hpFraction) > Math.max(num(stop.panicHp), num(stop.retreatHp)) && stop.requiredSupplies === true) violations.add('last-food-exit-before-recovery');
        }
        if (event.kind === 'anchor-selection' && point(event.anchor).z === 9817 && event.selected !== event.anchorIndex) {
            selections++;
            const eligible = rows(event.npcs).filter(n => n.other !== true && (n.combat !== true || n.me === true) && num(n.skipRemaining) === 0);
            const readyAt = (n: Record<string, unknown>, index: number) => rows(n.stands)[index];
            const selected = num(event.selected), current = num(event.anchorIndex);
            const candidate = eligible.find(n => { const s = readyAt(n, selected); return s?.los === true && num(s.gap) <= 6; });
            if (!candidate) violations.add('alternate-not-observed-ready');
            if (eligible.some(n => { const s = readyAt(n, current); return s?.los === true && num(s.gap) <= 6; })) violations.add('ready-anchor-changed');
            if (candidate) for (const failure of assessAdaptiveStand({ anchor: current, owned: event.engaged !== null || event.lootTarget !== null,
                moving: point(event.tile).x !== point(event.anchor).x || point(event.tile).z !== point(event.anchor).z,
                stands: rows(candidate.stands).map(s => ({ ...point(s), gap: num(s.gap), los: s.los === true })) }, selected)) violations.add(failure);
        }
        if (event.kind !== 'npc-action' || event.action !== 'Attack') continue;
        attacks++;
        const npc = rows(event.npcs).find(n => n.index === event.index);
        if (npc?.networkOrigin && npc.networkTile && typeof npc.networkGap === 'number' && typeof npc.networkLos === 'boolean') {
            const origin = point(npc.networkOrigin), center = point(npc.networkTile), offset = Math.floor(num(npc.size) / 2);
            if (center.x - offset === origin.x && center.z - offset === origin.z) networkAttacks++;
            else violations.add('network-center-body-mismatch');
            if (typeof npc.routeLength === 'number' && npc.routeLength > 0 && npc.networkGap <= 6 && npc.networkLos && npc.other === false && npc.combat === false) movingReadyAttacks++;
        }
        const before = frames.findLast(f => num(f.at) <= num(event.at));
        if (!before || num(event.at) - num(before.at) > 300) continue;
        const dragon = rows(before.dragons).find(n => n.nid === event.index && num(n.hp) > 0 && n.active === true);
        if (!dragon || ![2835, 2834].includes(point(event.anchor).x) || point(event.anchor).z !== 9817) continue;
        const death = frames.find(f => num(f.at) > num(event.at) && rows(f.dragons).some(n => n.nid === dragon.nid && n.life === dragon.life && n.hp === 0));
        if (!death || num(death.at) > num(events.at(-1)?.at)) continue;
        const run = events.filter(e => num(e.at) >= num(event.at) && num(e.at) <= num(death.at));
        const observed = frames.filter(f => num(f.at) >= num(before.at) && num(f.at) <= num(death.at));
        const continuous = observed.every((f, j) => j === 0 || num(f.at) - num(observed[j - 1].at) <= 300);
        if (!continuous || run.length < 2) continue;
        const anchor = point(event.anchor);
        const players = observed.map(f => rows(f.players).find(p => typeof p.username === 'string' && typeof event.playerName === 'string' && p.username.toLowerCase() === event.playerName.toLowerCase()));
        if (players.some(p => !p)) continue;
        const walkouts = run.filter(e => point(e.tile).x !== anchor.x || point(e.tile).z !== anchor.z).length;
        const serverWalkouts = players.filter(p => p && (p.x !== anchor.x || p.z !== anchor.z)).length;
        const damage = players.some((p, j) => p && j > 0 && num(p.hp) < num(players[j - 1]?.hp));
        const contact = observed.some(f => rows(f.dragons).some(n => n.nid === dragon.nid && n.life === dragon.life
            && rows(n.stands).some(s => s.x === anchor.x && s.z === anchor.z && num(s.gap) <= 1)));
        if (damage || contact) { violations.add('alternate-damage-or-melee-contact'); continue; }
        fights.push({ nid: num(dragon.nid), life: num(dragon.life), anchorX: anchor.x, anchorZ: anchor.z, authoritativeDeath: true,
            attackWalkouts: walkouts + serverWalkouts, meleeHits: 0 });
    }
    return { capacity, fights, selections, movingReadyAttacks, networkObserved: attacks > 0 && attacks === networkAttacks, violations: [...violations] };
}
