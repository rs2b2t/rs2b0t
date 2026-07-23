import type { ChatLine } from '../adapter/ClientAdapter.js';

interface SkillXpEvent {
    skill: number;
    name: string;
    xp: number;
    delta: number;
}

interface SkillLevelEvent {
    skill: number;
    name: string;
    level: number;
    previous: number;
}

interface InventoryChangedEvent {
    slot: number;
    id: number;
    name: string | null;
    count: number;
    previousId: number;
    previousCount: number;
}

interface VarpChangedEvent {
    index: number;
    value: number;
    previous: number;
}

interface TickEvent {
    tick: number;
}

export interface EventMap {
    tick: TickEvent;
    'chat.message': ChatLine;
    'skill.xp': SkillXpEvent;
    'skill.level': SkillLevelEvent;
    'inventory.changed': InventoryChangedEvent;
    'varp.changed': VarpChangedEvent;
}

type Listener<K extends keyof EventMap> = (payload: EventMap[K]) => void;

class EventBusImpl {
    private listeners = new Map<keyof EventMap, Set<Listener<keyof EventMap>>>();

    off<K extends keyof EventMap>(event: K, cb: Listener<K>): void {
        this.listeners.get(event)?.delete(cb as Listener<keyof EventMap>);
    }

    on<K extends keyof EventMap>(event: K, cb: Listener<K>): () => void {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }

        set.add(cb as Listener<keyof EventMap>);
        return () => set.delete(cb as Listener<keyof EventMap>);
    }

    emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
        const set = this.listeners.get(event);
        if (!set) {
            return;
        }

        for (const cb of set) {
            try {
                cb(payload);
            } catch (err) {
                console.error(`[rs2b0t] '${event}' listener error`, err);
            }
        }
    }
}

export const bus = new EventBusImpl();
