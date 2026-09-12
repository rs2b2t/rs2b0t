import { assessReward, type RewardCapture } from './jive-reward-contract.js';
import { privateHardCapture } from './jive-private-hard.js';
import { privateScenario, type PrivateScenario } from './jive-private-config.js';
import type { PrivateEvent, PrivateFrame } from './jive-private-types.js';

export function privateReport(input: { readonly scenario: PrivateScenario; readonly user: string;
    readonly events: readonly PrivateEvent[]; readonly frames: readonly PrivateFrame[] }) {
    const { scenario, user } = input;
    const fixture = privateScenario(scenario);
    const events = [...input.events].sort((a, b) => a.at - b.at);
    const first = events[0], last = events.at(-1);
    const frames = input.frames.filter(f => first && last && f.at >= first.at - 500 && f.at <= last.at + 500);
    const violations: string[] = [];
    if (!first || !last || frames.length < 2 || frames[0].at > first.at || frames.at(-1)?.at === undefined
        || frames[frames.length - 1].at < last.at || frames.some((f, i) => i > 0 && f.at - frames[i - 1].at > 500)) violations.push('authoritative-stream-gap');
    if (frames.some(f => f.players.some(p => p.username !== user))) violations.push('private-account-isolation');
    if (!frames.some(f => f.players.some(p => p.username === user))) violations.push('account-not-observed');
    const hard = scenario === 'reward' ? null : privateHardCapture(events, frames, user, fixture.clueId);
    if (scenario !== 'guardian' && scenario !== 'reward' && frames.some(f => f.guardians.some(n => n.active))) violations.push('guardian-in-blocked-scenario');
    const open = events.find(e => e.kind === 'inventory-action' && e.action === 'Open' && e.itemId === fixture.casketId);
    const rewardEvents = open ? events.filter(e => e.at >= open.at) : [];
    const manifest = rewardEvents.find(e => e.modalId === 6960 && e.manifest.length > 0);
    const rewardCapture: RewardCapture = {
        before: open ? [...open.inventory, ...open.bank] : [], requireFullHpSpace: scenario === 'reward',
        manifest: manifest ? { interfaceId: 6963, modalId: manifest.modalId, items: manifest.manifest } : null,
        samples: rewardEvents.map(e => ({ at: e.at, holdings: [...e.inventory, ...e.bank], consumed: e.consumed,
            hp: e.hp, maxHp: e.maxHp, sharks: e.sharks, used: e.used,
            left: e.kind === 'departure' || e.kind === 'host-resume' || ['Rub', 'Break', 'Teleport'].includes(e.action) || (open?.tile !== null && e.tile !== null
                && (e.tile.x !== open?.tile.x || e.tile.z !== open?.tile.z || e.tile.level !== open?.tile.level)),
            solved: e.kind === 'solved', action: e.kind === 'eat-confirmed' ? 'Eat Shark' : e.action }))
    };
    const reward = scenario === 'reward' || scenario === 'guardian' ? assessReward(rewardCapture) : null;
    if (reward) {
        if (!open?.bankConfirmed || !events.some(e => e.kind === 'solved')) violations.push('reward-completion-unobserved');
        if (scenario === 'reward' && (manifest?.manifest.filter(i => [145, 157, 163].includes(i.id)).reduce((n, i) => n + i.count, 0) ?? 0) < 9) violations.push('nine-potion-units-required');
        if (rewardEvents.some(e => e.kind === 'inventory-action' && e.action === 'Drop')) violations.push('dropped-for-reward-space');
        for (const e of rewardEvents.filter(e => e.kind === 'ground-action' && e.action === 'Take')) {
            const p = frames.findLast(f => f.at <= e.at)?.players.find(p => p.username === user);
            if (!p?.ground.some(i => i.id === e.itemId && i.owned)) violations.push('overflow-ownership-unconfirmed');
        }
        const solved = rewardEvents.find(e => e.kind === 'solved');
        const p = solved && frames.findLast(f => f.at <= solved.at)?.players.find(p => p.username === user);
        if (p && solved) {
            const authoritative = assessReward({ ...rewardCapture, requireFullHpSpace: false, samples: [{
                at: solved.at, holdings: [...p.inventory, ...p.bank], hp: p.hp, maxHp: solved.maxHp, sharks: solved.sharks,
                used: solved.used, left: false, solved: true, consumed: solved.consumed }] });
            if (!authoritative.passed) violations.push('server-reward-quantities-outstanding');
        } else violations.push('server-completion-unobserved');
    }
    return { passed: violations.length === 0 && (hard?.passed ?? true) && (reward?.passed ?? true), violations, hard, reward, rewardCapture };
}
