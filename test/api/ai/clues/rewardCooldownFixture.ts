import type { InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Input } from '#/bot/input/Input.js';
import { stubProps } from '../../../lib/stubSingletons.js';
import { fixture, item, pile } from './rewardFixture.test.js';

export function rewardCooldownFixture() {
    const env = fixture();
    const { f } = env;
    f.tick = 127;
    f.inv.push(...Array.from({ length: 27 }, () => item(385)));
    f.onOpen = () => {
        f.modal = 6960;
        f.manifest = [item(145, 3), item(157, 3), item(163, 3)];
        f.add(145, 1);
        f.ground = [pile(145), pile(145), ...Array.from({ length: 3 }, () => pile(157)),
            ...Array.from({ length: 3 }, () => pile(163))];
    };
    const heldOp = Input.heldOp;
    const takeObj = Input.takeObj;
    const inputs: (() => void)[] = [];
    const updates: { readonly tick: number; readonly inv: InvItemSnapshot[] }[] = [];
    const bites: { readonly tick: number; readonly consumed: boolean }[] = [];
    const server = {
        tick: 375, eatDelay: 0, inventory: f.inv.map(i => ({ ...i })),
        inventoryLag: 0, refill: false, bites,
        step() {
            const observed = f.inv;
            f.inv = server.inventory;
            server.tick++;
            for (const input of inputs.splice(0)) input();
            if (server.refill && f.inv.length < 28) {
                const reward = f.ground.shift();
                if (reward) f.add(reward.id, reward.count);
            }
            server.inventory = f.inv;
            updates.push({ tick: server.tick + server.inventoryLag, inv: f.inv.map(i => ({ ...i })) });
            f.inv = observed;
            f.tick++;
            while (updates[0] && updates[0].tick <= server.tick) {
                const update = updates.shift();
                if (update) f.inv = update.inv;
            }
            f.onTick();
        }
    };
    const restores = [
        stubProps(Execution, { delayTicks: async () => { server.step(); } }),
        stubProps(Input, {
            heldOp: (id, slot, com, op) => {
                inputs.push(() => {
                    if (op === 1) { heldOp(id, slot, com, op); return; }
                    const consumed = server.eatDelay < server.tick && f.eatWorks && f.inv[slot]?.id === id;
                    bites.push({ tick: server.tick, consumed });
                    if (consumed) {
                        server.eatDelay = server.tick + 2;
                        heldOp(id, slot, com, op);
                    }
                });
                return true;
            },
            takeObj: (x, z, id, op) => { inputs.push(() => { takeObj(x, z, id, op); }); return true; }
        })
    ];
    return { f, server, restore: () => { restores.reverse().forEach(restore => restore()); env.restore(); } };
}
