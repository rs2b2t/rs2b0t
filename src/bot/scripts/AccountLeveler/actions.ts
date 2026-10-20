import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { supplyOffer } from './offers.js';
import { requirementKey, stockOf, type ActivityPlan, type LevelerSnapshot } from './types.js';

export interface QueuedAction {
    id: string;
    label: string;
    detail: string;
    destination?: WorldTile;
    state?: 'pending' | 'running' | 'done' | 'failed';
}

export interface ActionEvent {
    id: string;
    message: string;
    destination?: WorldTile;
    state: 'running' | 'done';
}

export function describeActivity(plan: ActivityPlan): string {
    if (plan.output) return `Collect ${plan.output.count} ${plan.output.item} for ${plan.objective}`;
    if (plan.quest) return `Complete ${plan.quest} to unlock ${plan.objective}`;
    if (plan.prerequisiteLevels) return `Reach ${Object.entries(plan.prerequisiteLevels).map(([skill, level]) => `${skill} ${level}`).join(', ')} for ${plan.objective}`;
    return `Train ${plan.objective}${plan.settings.target ? ` against ${plan.settings.target}` : ''}`;
}

export function activityActions(plan: ActivityPlan, s: LevelerSnapshot, later: ActivityPlan[] = [], shoppingOnly = false): QueuedAction[] {
    const actions: QueuedAction[] = [{ id: 'bank:start', label: 'Prepare at bank', detail: 'Deposit inventory and check equipment' }];
    const shops = new Map<string, QueuedAction>();
    for (const need of plan.needs) {
        const missing = need.count - stockOf(s, requirementKey(need));
        const offer = supplyOffer(need.item);
        if (missing <= 0 || !offer) continue;
        const shop = shops.get(offer.keeper) ?? { id: `shop:${offer.keeper}`, label: `Shop at ${offer.keeper}`, detail: '', destination: offer.tile };
        shop.detail += `${shop.detail ? ', ' : ''}${missing} ${need.item}`;
        shops.set(offer.keeper, shop);
    }
    actions.push(...shops.values());
    if (shoppingOnly) return actions;
    actions.push({ id: 'loadout', label: 'Withdraw activity supplies', detail: plan.needs.map(n => `${n.carry ?? n.count} ${n.item}${n.carry ? '' : ' in bank'}`).join(', ') });
    if (plan.needs.some(n => n.equip)) actions.push({ id: 'equip', label: 'Equip training gear', detail: plan.needs.filter(n => n.equip).map(n => n.item).join(', ') });
    if (plan.travel) actions.push({ id: 'travel', label: `Travel to ${plan.settings.location ?? plan.label}`, detail: `Destination ${plan.travel.x}, ${plan.travel.z}, ${plan.travel.level}`, destination: plan.travel });
    actions.push({ id: 'train', label: plan.label, detail: describeActivity(plan), destination: plan.travel });
    actions.push(...later.map(p => ({ id: `later:${p.id}`, label: p.label, detail: `${describeActivity(p)}; recheck supplies at bank`, destination: p.travel })));
    return actions;
}

export class ActionQueue {
    items: QueuedAction[] = [];
    history: { at: number; message: string }[] = [];
    current = '';
    destination: WorldTile | undefined;
    changedAt = 0;

    reset(items: QueuedAction[]): void {
        this.items = items.map(item => ({ ...item, state: 'pending' }));
        this.current = '';
        this.destination = undefined;
    }

    update(event: ActionEvent, now = Date.now()): void {
        const item = this.items.find(item => item.id === event.id);
        if (item) item.state = event.state;
        if (event.message !== this.current) this.changedAt = now;
        this.current = event.message;
        this.destination = event.destination;
        this.note(event.message, now);
    }

    fail(reason: string, now = Date.now()): void {
        for (const item of this.items) if (item.state === 'running') item.state = 'failed';
        this.current = reason;
        this.destination = undefined;
        this.changedAt = now;
        this.note(reason, now);
    }

    note(message: string, now = Date.now()): void {
        if (this.history.at(-1)?.message === message) return;
        this.history = [...this.history, { at: now, message }].slice(-40);
    }
}
