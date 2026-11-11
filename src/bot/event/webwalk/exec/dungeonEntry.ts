import { reader } from '../../../adapter/ClientAdapter.js';
import { Execution } from '../../../api/execution/Execution.js';
import { EventSignal } from '../../../api/execution/EventSignal.js';
import { Inventory } from '../../../api/inventory/Inventory.js';
import { Npcs } from '../../../api/npcs/Npcs.js';
import { Locs } from '../../../api/locs/Locs.js';
import { ChatDialog } from '../../../api/ui/dialogue/ChatDialog.js';
import { Modals } from '../../../api/ui/widgets/Modals.js';
import { GameMessages } from '../../../api/chatbox/gameMessages.js';
import type { TransportInfo } from '../PathFinder.js';
import type { NavPoint } from '../types.js';
import { awaitTransportLoc } from './transportLoc.js';

export async function handleDungeonEntry(transport: TransportInfo, approach: NavPoint, step: NavPoint, log: (message: string) => void): Promise<boolean | null> {
    const brimhaven = transport.locId === 5083 && transport.locX === 2743 && transport.locZ === 3153 && approach.level === 0;
    const kalphite = transport.locId === 3827 && transport.locX === 3227 && transport.locZ === 3108 && approach.level === 0;
    if (!brimhaven && !kalphite) return null;
    const arrived = () => {
        const here = reader.worldTile();
        return here !== null && here.level === step.level && Math.max(Math.abs(here.x - step.x), Math.abs(here.z - step.z)) <= 2;
    };
    if (arrived()) return true;
    if (brimhaven) {
        const npc = Npcs.query().name('Saniboch').action('Pay').withinOf(approach, 10).nearest();
        if (!npc) return false;
        const mark = GameMessages.mark();
        const before = Inventory.count('Coins');
        if (!(await npc.interact('Pay'))) return false;
        let quiet = 0, paid = false;
        for (let ticks = 0; ticks < 40 && quiet < 3 && !EventSignal.pending(); ticks++) {
            paid ||= Inventory.count('Coins') < before
                || GameMessages.sawSince(mark, /you pay saniboch 875 coins/i)
                || ChatDialog.texts().some(text => /already given me lots of nice coins/i.test(text));
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
                quiet = 0;
            } else if (reader.modals().main !== -1) {
                await Modals.close();
                quiet = 0;
            } else if (ChatDialog.isOpen() || !paid) {
                quiet = 0;
            } else {
                quiet++;
            }
            await Execution.delayTicks(1);
        }
        if (!paid || quiet < 3 || EventSignal.pending()) return false;
    }
    const find = () => Locs.query().where(loc => {
        const tile = loc.tile();
        return (loc.id === transport.locId || loc.id === transport.openLocId)
            && tile.x === transport.locX && tile.z === transport.locZ && tile.level === approach.level;
    }).nearest();
    let loc = await awaitTransportLoc(transport, 3000, Execution.delayUntil.bind(Execution), find);
    if (!loc) return false;
    if (kalphite && loc.id === 3827) {
        const rope = Inventory.first('Rope');
        if (!rope || !(await rope.useOn(loc))) return false;
        if (!(await Execution.delayUntil(() => find()?.id === 3828, 4000))) return false;
        loc = find();
    }
    if (EventSignal.pending() || !loc || !(await loc.interact(transport.action))) return false;
    if (!(await Execution.delayUntil(arrived, 10_000))) return false;
    await Execution.delayTicks(2);
    log(`${brimhaven ? 'Brimhaven Dungeon' : 'Kalphite burrow'}: entered`);
    return true;
}
