import { SM_ID, SM_TILE } from '../../api/ai/quests/defs/mortton/areas.js';
import { fillVial, makeAshes } from '../../api/ai/quests/defs/mortton/supplies.js';
import { identifyTarromin, mixSerum, mixUnfinished, takeVial } from '../../api/ai/quests/defs/mortton/town.js';
import { Bank } from '../../api/bank/Bank.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { held, type Supplies } from './supply.js';

const fires = new WeakSet<Supplies>();

async function localAshes(s: Supplies): Promise<boolean> {
    const nearby = () => GroundItems.query().where(item => item.id === SM_ID.ASHES).within(12).nearest();
    if (!nearby()) {
        if (!(await s.walk(SM_TILE.TOWN))) return false;
        if (!fires.has(s)) {
            const tinder = Inventory.items().find(item => item.id === SM_ID.TINDERBOX);
            const logs = Inventory.items().find(item => [1511, 1521, 1519, 1517, 1515, 1513].includes(item.id));
            if (!tinder || !logs) {
                s.log('Local serum needs ashes or one loose log and a tinderbox');
                return false;
            }
            if (!(await tinder.useOn(logs))) return false;
            fires.add(s);
        }
        for (let tick = 0; tick < 300 && !nearby(); tick++) {
            if (EventSignal.pending() || !(await s.combatReady())) return false;
            await Execution.delayTicks(1);
        }
    }
    if (EventSignal.pending()) return false;
    fires.delete(s);
    const ashes = nearby();
    return !!ashes && await ashes.interact('Take') && await Execution.delayUntil(() => held(SM_ID.ASHES) > 0, 5000);
}

export async function prepareSerum(s: Supplies, banked = true): Promise<boolean> {
    if (EventSignal.pending()) return false;
    if (banked) {
        if (!(await s.bank()) || !(await s.loadTools()) || !(await s.loadFood())) return false;
        for (const id of [SM_ID.TARROMIN_UNF, SM_ID.TARROMIN, SM_ID.UNID_TARROMIN, SM_ID.ASHES, SM_ID.VIAL_WATER, SM_ID.VIAL_EMPTY]) {
            await s.take(id, 1, true);
        }
        await Bank.close();
    } else if (Inventory.free() < 4) {
        s.log('Need four free slots to make serum in Mortton');
        return false;
    }
    const herb = () => held(SM_ID.TARROMIN_UNF) + held(SM_ID.TARROMIN) + held(SM_ID.UNID_TARROMIN);
    if (!herb()) {
        if (!(await s.walk(SM_TILE.TOWN))) return false;
        s.log('Obtaining tarromin from afflicted villagers for permanent shop access');
        Game.setAutoRetaliate(true);
        for (let tick = 0; tick < 6000 && !herb(); tick++) {
            if (EventSignal.pending() || !(await s.combatReady())) return false;
            const drop = GroundItems.query().where(item => item.id === SM_ID.UNID_TARROMIN || item.id === SM_ID.TARROMIN).within(15).nearest();
            if (drop) {
                await drop.interact('Take');
                await Execution.delayUntil(() => herb() > 0, 5000);
            } else if (!Game.inCombat() && tick % 5 === 0) {
                const npc = Npcs.query().name('Afflicted').action('Attack').where(npc => !npc.targetsAnotherPlayer()).within(18).nearest();
                if (npc) await npc.interact('Attack');
            }
            await Execution.delayTicks(1);
        }
        if (!herb()) return false;
    }
    if (held(SM_ID.UNID_TARROMIN) && !(await identifyTarromin(s.log))) return false;
    if (!held(SM_ID.ASHES) && !(await (banked ? makeAshes({ ashes: 1, logs: 0 })(s.log) : localAshes(s)))) return false;
    if (!held(SM_ID.TARROMIN_UNF)) {
        if (!held(SM_ID.VIAL_WATER)) {
            if (!held(SM_ID.VIAL_EMPTY) && !(await takeVial(s.log))) return false;
            if (!(await fillVial(s.log))) return false;
        }
        if (!(await mixUnfinished(s.log))) return false;
    }
    return await mixSerum(s.log) && Inventory.countById(SM_ID.SERUM3) > 0;
}
