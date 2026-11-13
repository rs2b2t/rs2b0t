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

export async function prepareSerum(s: Supplies): Promise<boolean> {
    if (!(await s.bank()) || !(await s.loadTools()) || !(await s.loadFood())) return false;
    for (const id of [SM_ID.TARROMIN_UNF, SM_ID.TARROMIN, SM_ID.UNID_TARROMIN, SM_ID.ASHES, SM_ID.VIAL_WATER, SM_ID.VIAL_EMPTY]) {
        await s.take(id, 1, true);
    }
    await Bank.close();
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
    if (!held(SM_ID.ASHES) && !(await makeAshes({ ashes: 1, logs: 0 })(s.log))) return false;
    if (!held(SM_ID.TARROMIN_UNF)) {
        if (!held(SM_ID.VIAL_WATER)) {
            if (!held(SM_ID.VIAL_EMPTY) && !(await takeVial(s.log))) return false;
            if (!(await fillVial(s.log))) return false;
        }
        if (!(await mixUnfinished(s.log))) return false;
    }
    return await mixSerum(s.log) && Inventory.countById(SM_ID.SERUM3) > 0;
}
