import { expect, test } from 'bun:test';
import { actions, reader, type InvItemSnapshot, type GroundItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Input } from '#/bot/input/Input.js';
import { Game } from '#/bot/api/game/Game.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { stubProps } from '../../../lib/stubSingletons.js';

export const tile = { x: 3200, z: 3200, level: 0 };
export function item(id: number, count = 1): InvItemSnapshot {
    return { id, count, slot: 0, comId: 3214, name: id === 385 ? 'Shark' : `Item ${id}`, ops: ['Open', 'Eat'] };
}
export function pile(id: number, count = 1): GroundItemSnapshot {
    return { id, count, name: `Item ${id}`, ops: ['Take'], tile: { ...tile }, distance: 0 };
}
export function fixture() {
    const ground: GroundItemSnapshot[] = [];
    const manifest: InvItemSnapshot[] = [];
    const takes: number[] = [];
    const eats: number[] = [];
    const f = {
        inv: [item(2724)], ground, manifest,
        tick: 0, modal: -1, event: false, pos: { ...tile }, stackable: new Set([995]),
        takes, eats, opens: 0, pickupWorks: true, eatWorks: true,
        onOpen: () => {}, onTick: () => {},
        add(id: number, count: number) {
            const held = f.inv.find(i => i.id === id);
            if (held && f.stackable.has(id)) held.count += count;
            else if (f.stackable.has(id)) f.inv.push(item(id, count));
            else for (let n = 0; n < count; n++) f.inv.push(item(id));
        }
    };
    const restores = [
        stubProps(reader, {
            inventory: () => f.inv.map((i, slot) => ({ ...i, slot })), inventorySize: () => 28,
            bankComId: () => -1, groundItems: () => f.ground,
            worldTile: () => ({ ...f.pos }), toLocal: (x, z) => ({ lx: x, lz: z }),
            modals: () => ({ main: f.modal, chat: -1, side: -1 }),
            shopInv: id => id === 6963 ? f.manifest.map(i => ({ ...i })) : [],
            objCatalog: () => [...new Set([...f.inv, ...f.manifest].map(i => i.id))].map(id => ({
                id, name: `Item ${id}`, stackable: f.stackable.has(id), cost: 1,
                members: true, equippable: false, certlink: -1, certtemplate: -1, stackVariant: false
            }))
        }),
        stubProps(actions, { closeModal: () => { f.modal = -1; return true; } }),
        stubProps(Game, { tick: () => f.tick }),
        stubProps(EventSignal, { pending: () => f.event }),
        stubProps(Execution, { delayTicks: async () => { f.tick++; f.onTick(); } }),
        stubProps(Input, {
            heldOp: (id, slot, _com, op) => {
                if (op === 1) { f.opens++; f.inv.splice(slot, 1); f.onOpen(); }
                else { f.eats.push(id); if (f.eatWorks) f.inv.splice(slot, 1); }
                return true;
            },
            takeObj: (x, z, id) => {
                f.takes.push(id);
                const index = f.ground.findIndex(g => g.id === id && g.tile.x === x && g.tile.z === z);
                const g = f.ground[index];
                if (f.pickupWorks && g && (f.inv.length < 28 || (f.stackable.has(id) && f.inv.some(i => i.id === id)))) {
                    f.add(id, g.count);
                    f.ground.splice(index, 1);
                }
                return true;
            }
        })
    ];
    return { f, restore: () => restores.reverse().forEach(restore => restore()) };
}

test('fixture exposes real inventory count changes when a stack merges', () => {
    const { f, restore } = fixture();
    try {
        f.inv = [item(995, 20)];
        f.add(995, 5);
        expect(Inventory.items().map(i => i.count)).toEqual([25]);
    } finally { restore(); }
});
