[Manual](../README.md) › [Scripting API](../API.md) › Write a bot

# Write a bot

Copy [`docs/script-template/`](../script-template/) or author
in-tree under `src/bot/scripts/`. A script's entry module default-exports
`defineBot({...})`:

```ts
import { defineBot, Execution, Game, LoopingBot } from '@rs2b0t/api';

class MyBot extends LoopingBot {
    override async onStart() {
        await Execution.delayUntil(() => Game.ingame(), 0);
        this.log('hello');
    }
    async loop() {
        // one iteration of work
        await Execution.delayTicks(1);
    }
}

export default defineBot({ name: 'MyBot', create: () => new MyBot() });
```

Load an out-of-tree build via the panel's **Load URL**, or register in-tree
scripts from `src/bot/scripts/index.ts`.

---

## Full example

The out-of-tree template ([`docs/script-template/src/ExampleBot.ts`](../script-template/src/ExampleBot.ts)):
loots and buries bones, tracks prayer xp via events, and draws a HUD.

```ts
import { defineBot, Execution, Game, GroundItems, Inventory, LoopingBot } from '@rs2b0t/api';

class BoneBurier extends LoopingBot {
    private buried = 0;
    private xpGained = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame(), 0);
        this.log('BoneBurier started');
        this.on('skill.xp', e => { if (e.name === 'prayer') this.xpGained += e.delta; });
        // an emptied slot reports id -1 with the previous item id — a completed burial
        this.on('inventory.changed', e => {
            if (e.id === -1 && e.previousId !== -1) {
                this.buried++;
                this.log(`buried bones (#${this.buried})`);
            }
        });
    }

    async loop(): Promise<void> {
        const bones = Inventory.first('Bones');
        if (bones) {
            const before = Inventory.used();
            await bones.interact('Bury');
            await Execution.delayUntil(() => Inventory.used() < before, 3000);
            return;
        }
        const ground = GroundItems.query().name('Bones').within(10).nearest();
        if (ground && !Inventory.isFull()) {
            const before = Inventory.used();
            await ground.interact('Take');
            await Execution.delayUntil(() => Inventory.used() > before, 5000);
            return;
        }
        await Execution.delayTicks(2);
    }

    override onStop(): void {
        this.log(`stopped — ${this.buried} buried, +${this.xpGained} prayer xp`);
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        ctx.font = '12px monospace';
        ctx.fillStyle = '#ffb15b';
        ctx.fillText(`BoneBurier  buried ${this.buried}`, 12, 22);
    }
}

export default defineBot({
    name: 'BoneBurier',
    version: '0.1.0',
    description: 'External example: loots and buries nearby bones',
    create: () => new BoneBurier(),
});
```

---

## See also

- [Bot base classes](../reference/api-bots.md)
- [Scripting API index](../API.md)
