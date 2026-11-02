import Tile from '../../../../../geometry/Tile.js';
import { spotMatchesMethod } from '../../../../../data/fishingMethods.js';
import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Skills } from '../../../../skills/Skills.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { deposit, fromBank, held, type FcItem } from './supplies.js';
import { FC_BANK } from './areas.js';

const SHORE = new Tile(2845, 3431, 0);
const RIVER = new Tile(3104, 3424, 0);
const RANGE = new Tile(2817, 3443, 0);
const HARRY = { npc: 'Harry', anchor: new Tile(2831, 3446, 0) };
const GERRANT = { npc: 'Gerrant', anchor: new Tile(3013, 3225, 0) };

const FISH = [
    { id: 373, name: 'Swordfish', raw: 371, fishing: 50, cooking: 45, tool: 'Harpoon', op: 'Harpoon', pair: 'Cage', spot: SHORE },
    { id: 365, name: 'Bass', raw: 363, fishing: 46, cooking: 43, tool: 'Big fishing net', op: 'Net', pair: 'Harpoon', spot: SHORE },
    { id: 361, name: 'Tuna', raw: 359, fishing: 35, cooking: 30, tool: 'Harpoon', op: 'Harpoon', pair: 'Cage', spot: SHORE },
    { id: 329, name: 'Salmon', raw: 331, fishing: 30, cooking: 25, tool: 'Fly fishing rod', op: 'Lure', pair: 'Bait', spot: RIVER },
    { id: 315, name: 'Shrimps', raw: 317, fishing: 1, cooking: 1, tool: 'Small fishing net', op: 'Net', pair: 'Bait', spot: SHORE }
] as const;

export const CALEB_KEEP = ['Coins', ...FISH.map(f => f.tool), 'Feather', 'rune', 'Ring of dueling'];

type Fish = typeof FISH[number];

async function catchFish(fish: Fish, log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(fish.spot, { radius: 3, attempts: 3, timeoutMs: 300_000, log }))) return false;
    const spot = Npcs.query().name('Fishing spot').where(n => spotMatchesMethod(n.actions(), fish)).within(20).nearest();
    if (!spot) return false;
    const before = Inventory.items().length;
    if (!(await spot.interact(fish.op))) return false;
    return Execution.delayUntil(() => Inventory.items().length > before, 30_000);
}

async function cookFish(fish: Fish, log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(RANGE, { radius: 1, attempts: 3, timeoutMs: 300_000, log }))) return false;
    const raw = Inventory.items().find(i => i.id === fish.raw);
    const range = Locs.query().name('Range').within(6).nearest();
    if (!raw || !range) return false;
    const before = Inventory.countById(fish.raw);
    if (!(await raw.useOn(range))) return false;
    await Execution.delayUntil(() => Inventory.countById(fish.raw) < before || ChatDialog.isMakeMenu(), 6000);
    if (ChatDialog.isMakeMenu()) await ChatDialog.make(`Raw ${fish.name.toLowerCase()}`);
    return Execution.delayUntil(() => Inventory.countById(fish.raw) < before, 8000);
}

export function sourceCalebFish(
    snap: QuestSnapshot,
    missing: readonly FcItem[],
    fishing = Skills.level('fishing'),
    cooking = Skills.level('cooking')
): QuestStep {
    const fish = FISH.find(f => missing.some(m => m.id === f.id))!;
    const raw = { id: fish.raw, name: `Raw ${fish.name.toLowerCase()}` };
    const banked = fromBank(snap, raw, 1, FC_BANK.CATHERBY);
    if (held(snap, fish.raw) === 0 && banked) return banked;
    if (cooking < fish.cooking || (held(snap, fish.raw) === 0 && fishing < fish.fishing)) {
        return { kind: 'wait', reason: `Caleb needs cooked ${missing.map(f => f.name).join(', ')}; gathering ${fish.name} needs Fishing ${fish.fishing} and Cooking ${fish.cooking} (have ${fishing}/${cooking})` };
    }
    if (held(snap, fish.raw) > 0) return { kind: 'custom', name: `cook ${fish.name} for Caleb`, run: log => cookFish(fish, log) };
    if ((snap.freeSlots ?? 28) < 4) {
        return deposit(CALEB_KEEP, FC_BANK.CATHERBY);
    }
    for (const tool of [fish.tool, ...(fish.op === 'Lure' ? ['Feather'] : [])]) {
        if ((snap.inv.get(tool.toLowerCase()) ?? 0) > 0) continue;
        const available = snap.bank?.get(tool.toLowerCase()) ?? 0;
        const qty = tool === 'Feather' ? Math.min(20, available || 20) : 1;
        if (available > 0) return { kind: 'withdraw', items: [{ name: tool, qty }], bank: FC_BANK.CATHERBY };
        return { kind: 'buy', item: tool, qty, shop: fish.op === 'Lure' ? GERRANT : HARRY, estGp: 1000 };
    }
    return { kind: 'custom', name: `catch ${fish.name} for Caleb`, run: log => catchFish(fish, log) };
}
