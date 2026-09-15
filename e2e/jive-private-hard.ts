import { assessHardClue, type HardClueSample } from './jive-hard-clue-contract.js';
import type { PrivateEvent, PrivateFrame } from './jive-private-types.js';

export function privateHardCapture(events: readonly PrivateEvent[], frames: readonly PrivateFrame[], user: string, clueId = 3544) {
    const first = events.find(e => e.kind === 'solver-start') ?? events[0];
    const all = first ? [...first.inventory, ...first.bank] : [];
    const prep = { bankConfirmed: first?.bankConfirmed ?? false, attack: first?.attack ?? 0, lostCity: first?.lostCity ?? false,
        daggerId: all.find(i => [1215, 1231].includes(i.id))?.id ?? null,
        antipoisonId: all.find(i => [2448, 181, 183, 185].includes(i.id))?.id ?? null,
        sharksAvailable: all.filter(i => i.id === 385).reduce((n, i) => n + i.count, 0), hostWeaponId: first?.weaponId ?? -1 };
    const samples: HardClueSample[] = [];
    const lives = frames.flatMap(f => f.guardians.filter(n => n.owner === user).map(n => ({ ...n, at: f.at })));
    const spawn = lives.find(n => n.active && n.hp > 0);
    const kill = spawn && lives.find(n => n.life === spawn.life && n.hp === 0);
    const orderedFrames = [...frames].sort((a, b) => a.at - b.at);
    const retainedIn = (frame: PrivateFrame) => {
        const player = frame.players.find(p => p.username === user);
        return frame.players.length === 1 && player !== undefined
            && [...player.inventory, ...player.bank].filter(i => i.id === clueId).reduce((n, i) => n + i.count, 0) === 1;
    };
    const retainedAt = (at: number) => {
        const frame = orderedFrames.findLast(f => f.at <= at);
        return frame !== undefined && at - frame.at < 500 && retainedIn(frame);
    };
    const sample = (e: PrivateEvent, phase: HardClueSample['phase'], life: string | null = null): HardClueSample => ({
        at: e.at, phase, guardianLife: life, clueHeld: spawn ? e.clueHeld : retainedAt(e.at), hp: e.hp, sharks: e.sharks, weaponId: e.weaponId,
        special: e.special, antipoisonDoses: e.antipoisonDoses });
    const prepared = events.find(e => e.kind === 'inventory-action' && e.action === 'Drink' && [2448, 181, 183, 185].includes(e.itemId));
    if (prepared) samples.push(sample(prepared, 'prepared'));
    for (const e of events) {
        if (e.kind === 'inventory-action' && e.action === 'Dig') samples.push(sample(e, kill && e.at > kill.at ? 'post-kill-dig' : 'dig', spawn?.life));
        if (e.kind === 'solver-end' && /^(hard kit: |hard kit blocked)/.test(e.status)) samples.push(sample(e, 'blocked'));
        if (!spawn && e.kind === 'tick') samples.push(sample(e, 'prepared'));
        if (spawn && e.at >= spawn.at && (!kill || e.at < kill.at)) samples.push(sample(e, 'fight', spawn.life));
    }
    for (const [phase, npc] of [['spawn', spawn], ['kill', kill]] as const) {
        if (!npc) continue;
        const e = events.findLast(e => e.at <= npc.at);
        if (e && npc.at - e.at < 500) samples.push({ ...sample(e, phase, npc.life), at: npc.at });
    }
    const post = samples.find(s => s.phase === 'post-kill-dig');
    const restored = post && events.find(e => e.at > post.at && e.weaponId === prep.hostWeaponId);
    if (restored) samples.push(sample(restored, 'restored'));
    const capture = { guardianName: spawn?.name ?? '', prep, samples };
    const report = assessHardClue(capture);
    const violations = [...report.violations];
    if (new Set(lives.map(n => n.life)).size > 1) violations.push('multiple-guardian-lifetimes');
    if (events.some(e => e.hp <= 0) || frames.some(f => f.players.some(p => p.username === user && p.hp <= 0))) violations.push('player-death');
    const resume = events.find(e => e.kind === 'host-resume');
    if (spawn && (!resume || !restored || restored.at > resume.at || resume.weaponId !== prep.hostWeaponId)) violations.push('restoration-before-host-resume');
    const observedFrames = orderedFrames.filter(f => f.at >= (events[0]?.at ?? Infinity) && f.at <= (events.at(-1)?.at ?? -Infinity));
    if (!spawn && (events.some(e => !retainedAt(e.at) || (e.kind === 'inventory-action' && e.action === 'Drop' && e.itemId === clueId))
        || observedFrames.some(f => !retainedIn(f)))) violations.push('blocked-clue-disposal');
    return { capture, ...report, violations, passed: report.passed && violations.length === 0 };
}
