import { reader } from '../../adapter/ClientAdapter.js';
import { SM_ID, SM_LOC_ID, SM_NPC, SM_TILE, isTempleWall } from '../../api/ai/quests/defs/mortton/areas.js';
import { permSerumVialId, serumVialId } from '../../api/ai/quests/defs/mortton/supplies.js';
import { altarLit, lightAltar, materialSets, sanctifySerum, templeRepaired, templeResources, templeSanctity } from '../../api/ai/quests/defs/mortton/temple.js';
import { buildersOrder, driveOnce, shopAtRazmire, talkVillager, type ShopOrder } from '../../api/ai/quests/defs/mortton/town.js';
import { Bank } from '../../api/bank/Bank.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { BATCH, COIN_TARGET, OIL, OLIVE, oilDoses, shouldStartWall } from './policy.js';
import { counts, held, Supplies } from './supply.js';
import { prepareSerum } from './serum.js';

export class Temple {
    private cured = false;

    constructor(private supply: Supplies) {}

    private async build(target: number): Promise<boolean> {
        if (!(await this.supply.walk(SM_TILE.TEMPLE_INSIDE, 0))) return false;
        let idle = 0;
        let current: string | null = null;
        for (let tick = 0; tick < 4000; tick++) {
            if (EventSignal.pending() || !(await this.supply.combatReady())) return false;
            if (templeRepaired() >= 100 && templeSanctity() >= target) return true;
            if (ChatDialog.canContinue()) await ChatDialog.continue();
            if (templeResources() < 4 && materialSets() === 0) return false;
            const wall = Locs.query().where(loc => isTempleWall(loc.id)).action('Repair').within(8).nearest()
                ?? Locs.query().where(loc => isTempleWall(loc.id)).action('Reinforce').within(8).nearest();
            if (!wall) return false;
            const op = wall.actions().includes('Repair') ? 'Repair' : 'Reinforce';
            const next = `${wall.tile().x},${wall.tile().z}:${op}`;
            if (shouldStartWall(current, next, Game.animating(), Game.inCombat(), ++idle)) {
                if (!(await wall.interact(op))) return false;
                current = next;
                idle = 0;
            }
            if (tick % 100 === 0) this.supply.log(`Temple ${templeRepaired()}%, sanctity ${templeSanctity()}%, resources ${templeResources()}%`);
            await Execution.delayTicks(1);
        }
        return false;
    }

    private async materials(): Promise<boolean> {
        const sets = Math.min(6, Math.floor((Inventory.free() - (held(SM_ID.SWAMP_PASTE) ? 0 : 1)) / 2));
        if (sets <= 0) return false;
        return this.shop(buildersOrder(sets));
    }

    ensureAccess(): Promise<boolean> { return this.wake(); }

    private async wake(): Promise<boolean> {
        const s = this.supply;
        if (!(await s.walk(SM_TILE.RAZMIRE))) return false;
        const afflicted = Npcs.query().name(SM_NPC.RAZMIRE_AFFLICTED).within(12).nearest();
        if (afflicted) {
            const op = afflicted.actions().find(op => /talk/i.test(op));
            if (!op || !(await afflicted.interact(op))) return false;
            if (!(await Execution.delayUntil(() => ChatDialog.canContinue() || ChatDialog.isOpen(), 5000))) return false;
            await driveOnce(['Ok'], s.log);
        }
        if (Npcs.query().name(SM_NPC.RAZMIRE).within(12).nearest()) return true;
        if (permSerumVialId() !== null) return this.applyPermanent();
        if (serumVialId() === null) return false;
        return talkVillager(SM_NPC.RAZMIRE, SM_NPC.RAZMIRE_AFFLICTED, SM_TILE.RAZMIRE, ['Ok'], s.log);
    }

    private async shop(order: ShopOrder): Promise<boolean> {
        return await this.wake() && shopAtRazmire(order)(this.supply.log);
    }

    private async applyPermanent(): Promise<boolean> {
        const s = this.supply;
        if (!(await s.walk(SM_TILE.RAZMIRE))) return false;
        const id = permSerumVialId();
        const vial = Inventory.items().find(item => item.id === id);
        const npc = Npcs.query().name(SM_NPC.RAZMIRE, SM_NPC.RAZMIRE_AFFLICTED).within(12).nearest();
        if (!vial || !npc || id === null) return false;
        const before = held(id);
        if (!(await vial.useOn(npc))) return false;
        if (!(await Execution.delayUntil(() => ChatDialog.canContinue() || ChatDialog.isOpen(), 5000))) return false;
        const already = reader.chatModalTexts().some(text => /already used the permanent serum/i.test(text));
        if (!(await driveOnce(['Ok'], s.log))) return false;
        this.cured = already || held(id) < before;
        return this.cured;
    }

    async oil(): Promise<boolean> {
        const s = this.supply;
        if (!(await s.bank()) || !(await s.loadTools()) || !(await s.loadFood(4))) return false;
        if (!(await s.take(995, Math.min(COIN_TARGET, Bank.countById(995))))) return false;
        for (const id of [SM_ID.PLANK, SM_ID.LIMESTONE_BRICK]) await s.take(id, Math.min(4, Bank.countById(id)), true);
        await s.take(SM_ID.SWAMP_PASTE, Math.min(100, Bank.countById(SM_ID.SWAMP_PASTE)), true);
        const serum = [3416, 3417, 3418, 3419, 3408, 3410, 3412].find(id => Bank.countById(id) > 0);
        if (serum !== undefined) await s.take(serum, 1);
        let oliveSlots = Math.min(8, Math.max(0, Inventory.free() - 4));
        for (const id of OLIVE) {
            const qty = Math.min(oliveSlots, Bank.countById(id));
            if (qty && !(await s.take(id, qty))) return false;
            oliveSlots -= qty;
        }
        await Bank.close();
        if (!(await s.walk(SM_TILE.RAZMIRE))) return false;
        if (!(await this.wake())) {
            if (permSerumVialId() === null && serumVialId() === null) return prepareSerum(s);
            return false;
        }
        const before = oilDoses(counts());
        for (let trip = 0; trip < 16; trip++) {
            if (EventSignal.pending() || !(await s.combatReady())) return false;
            if (!(await this.build(55))) {
                if (EventSignal.pending() || !(await s.combatReady())) return false;
                if (!(await this.materials())) return oilDoses(counts()) > before;
                continue;
            }
            if (!(await lightAltar(s.log))) return false;
            if (!this.cured && serumVialId() !== null) {
                if (!(await sanctifySerum(s.log))) return false;
                if (!(await this.applyPermanent())) return false;
            }
            if (oilDoses(counts(), OLIVE) === 0) {
                const qty = Math.min(11, Inventory.free());
                if (qty <= 0) return oilDoses(counts()) > before;
                if (!(await this.shop({ op: 'Trade-General-Store', asks: ['general store'], items: [{ id: 3424, name: 'Olive oil(3)', qty }] }))) return oilDoses(counts()) > before;
                if (!(await s.combine(OLIVE))) return false;
            }
            if (!(await s.walk(SM_TILE.TEMPLE_INSIDE, 0))) return false;
            for (let vial = 0; vial < 28; vial++) {
                if (EventSignal.pending()) return false;
                const oil = Inventory.items().find(item => OLIVE.some(id => id === item.id));
                if (!oil || templeSanctity() < 10) break;
                if (!altarLit() && !(await lightAltar(s.log))) break;
                const fire = Locs.query().where(loc => loc.id === SM_LOC_ID.ALTAR_LIT).within(8).nearest();
                const prev = oilDoses(counts());
                if (!fire || !(await oil.useOn(fire))) return false;
                if (!(await Execution.delayUntil(() => oilDoses(counts()) > prev, 6000))) break;
            }
            if (oilDoses(counts()) - before >= BATCH * 4 || (oilDoses(counts(), OLIVE) === 0 && oilDoses(counts()) > before)) {
                await s.combine(OIL);
                return true;
            }
        }
        return oilDoses(counts()) > before;
    }
}
