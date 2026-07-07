// Out-of-tree example bot, authored ONLY against @lcbuddy/api (the Slice 7
// exit criterion). Picks up bones near where it starts and buries them.
// Try it: stand anywhere, ::give bones 25, Start.
import { defineBot, Execution, Game, GroundItems, Inventory, LoopingBot } from '@lcbuddy/api';

class BoneBurier extends LoopingBot {
    private buried = 0;
    private xpGained = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame(), 0);
        this.log('BoneBurier (external) started');

        this.on('skill.xp', e => {
            if (e.name === 'prayer') {
                this.xpGained += e.delta;
            }
        });
        // inventory.changed carries the slot's NEW state: an emptied slot is
        // id -1 (previousId was the bones) — that's a completed burial here
        this.on('inventory.changed', e => {
            if (e.id === -1 && e.previousId !== -1) {
                this.buried++;
                this.log(`buried bones (#${this.buried}, +${this.xpGained} prayer xp total)`);
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
        this.log(`BoneBurier stopped — ${this.buried} buried, +${this.xpGained} prayer xp`);
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        ctx.font = '12px monospace';
        const text = `BoneBurier (external)  buried ${this.buried}`;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, ctx.measureText(text).width + 12, 24);
        ctx.fillStyle = '#ffb15b';
        ctx.fillText(text, 12, 22);
    }
}

export default defineBot({
    name: 'BoneBurier',
    version: '0.1.0',
    description: 'External example: loots and buries nearby bones',
    create: () => new BoneBurier()
});
