import { reader } from '../../adapter/ClientAdapter.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { DROP_DB } from '../../data/dropdb.js';
import { FOOD } from './loadout.js';
import type { Party } from './party.js';
import { inLair, near, type Point } from './policy.js';

export interface LootClaim { id: number; name: string; tile: Point; collecting: boolean }
export interface LootResult { busy: boolean; collected?: { id: number; name: string; count: number } }
const DROPS = new Set(DROP_DB['Kalphite Queen']);
const EQUIPMENT = new Set(['Dragon chainbody', 'Dragon spear', 'Shield left half', 'Rune chainbody', 'Lava battlestaff', 'Rune warhammer', 'Rune spear', 'Rune axe', 'Amulet of power', 'Adamant spear']);
export const lootPriority = (name: string): number => EQUIPMENT.has(name) ? 0 : 1;
export const eligibleLoot = (name: string): boolean => DROPS.has(name) && !/arrow/i.test(name);
const key = (drop: { id: number; tile: Point }): string => `${drop.id}:${drop.tile.x}:${drop.tile.z}:${drop.tile.level}`;
const stacks = (id: number): boolean => Inventory.countById(id) > 0 && reader.objCatalog().some(item => item.id === id && item.stackable);
const room = (id: number, name: string): boolean => !Inventory.isFull() || stacks(id) || !!Inventory.first('Vial') || lootPriority(name) === 0 && Inventory.countById(FOOD) > 2;

export class LootCollector {
    private target: { claim: LootClaim; offered: number; started: number; progress: number; position: Point; before: number | null; attempt: number; attempts: number; missing: number | null; usedFood: boolean; room: { id: number; count: number; tick: number } | null } | null = null;
    private backoff = new Map<string, number>();
    get claim(): LootClaim | null { return this.target?.claim ?? null; }

    clear(): void { this.target = null; this.backoff.clear(); }

    private release(tick: number): LootResult {
        if (this.target) this.backoff.set(key(this.target.claim), tick + 20);
        this.target = null;
        return { busy: false };
    }

    step(party: Party, trip: number, excluded: Point[], ready: () => boolean, eatForSpace?: () => Promise<boolean>): LootResult {
        const tick = Game.tick();
        try { return this.advance(party, trip, excluded, ready, tick, eatForSpace); }
        catch { return this.release(tick); }
    }

    private advance(party: Party, trip: number, excluded: Point[], ready: () => boolean, tick: number, eatForSpace?: () => Promise<boolean>): LootResult {
        const here = reader.serverTile() ?? Game.tile();
        if (!here || !inLair(here)) { this.clear(); return { busy: false }; }
        for (const [id, until] of this.backoff) if (tick >= until) this.backoff.delete(id);
        const drops = GroundItems.query().where(g => eligibleLoot(g.name ?? '') && inLair(g.tile()) && !excluded.some(p => near(g.tile(), p, 0))).results();
        const target = this.target;
        if (target?.before !== null && target?.before !== undefined) {
            const count = Inventory.countById(target.claim.id) - target.before;
            if (count > 0) {
                const collected = { id: target.claim.id, name: target.claim.name, count };
                this.release(tick);
                return { busy: false, collected };
            }
        }
        if (!target) {
            const drop = drops.filter(g => !this.backoff.has(key({ id: g.id, tile: g.tile() })) && room(g.id, g.name!))
                .sort((a, b) => lootPriority(a.name!) - lootPriority(b.name!) || a.distance() - b.distance())[0];
            if (!drop) return { busy: false };
            this.target = { claim: { id: drop.id, name: drop.name!, tile: { ...drop.snap.tile }, collecting: false }, offered: tick, started: tick, progress: tick, position: { ...here }, before: null, attempt: -1, attempts: 0, missing: null, usedFood: false, room: null };
            return { busy: false };
        }
        const drop = drops.find(g => g.id === target.claim.id && near(g.tile(), target!.claim.tile, 0));
        if (!drop) {
            target.missing ??= tick;
            return tick - target.missing >= 3 ? this.release(tick) : { busy: target.claim.collecting };
        }
        target.missing = null;
        if (tick === target.offered) return { busy: false };
        if (party.lootCollector(trip, Date.now())?.name !== party.self) {
            if (target.claim.collecting) target.claim = { ...target.claim, collecting: false };
            target.started = tick; target.progress = tick;
            return { busy: false };
        }
        if (!room(drop.id, drop.name!)) return this.release(tick);
        if (!target.claim.collecting) target.claim = { ...target.claim, collecting: true };
        if (tick - target.started >= 60 || target.attempts >= 4 && tick - target.attempt >= 4) return this.release(tick);
        const allowed = ready();
        if (this.target !== target) return { busy: false };
        if (!allowed) return { busy: true };
        if (target.room) {
            if (Inventory.countById(target.room.id) >= target.room.count) return tick - target.room.tick >= 6 ? this.release(tick) : { busy: true };
            target.room = null;
        }
        if (Inventory.isFull() && !stacks(drop.id)) {
            const vial = Inventory.first('Vial');
            if (vial) {
                target.room = { id: vial.id, count: Inventory.countById(vial.id), tick };
                void Promise.resolve(vial.interact('Drop')).catch(() => {});
            } else {
                if (!eatForSpace || lootPriority(drop.name!) !== 0 || target.usedFood || Inventory.countById(FOOD) <= 2) return this.release(tick);
                const pending = { id: FOOD, count: Inventory.countById(FOOD), tick };
                target.room = pending; target.usedFood = true;
                const completed = (sent: boolean) => {
                    if (!sent && this.target === target && target.room === pending) { target.room = null; target.usedFood = false; }
                };
                void eatForSpace().then(completed, () => completed(false));
            }
            return { busy: true };
        }
        if (!near(here, target.position, 0)) { target.position = { ...here }; target.progress = tick; }
        if (target.attempt >= 0 && (tick - target.attempt < 4 || !near(here, target.claim.tile, 1) && tick - target.progress < 6)) return { busy: true };
        target.before ??= Inventory.countById(drop.id);
        target.attempt = tick; target.attempts++;
        void Promise.resolve(drop.interact('Take')).catch(() => {});
        return { busy: true };
    }
}
