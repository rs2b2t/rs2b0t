import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Skills } from '../../../api/hud/Skills.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { reader } from '../../../adapter/ClientAdapter.js';
import type TutorialBot from '../../TutorialBot.js';
import { StageTask } from '../StageTask.js';

const GUIDE = 'RuneScape Guide';
const EXPERT = 'Survival Expert';

const INVENTORY_TAB = 3;
const STATS_TAB = 1;

const GUIDE_SIDE_MAX_X = 3097;

const noDialog = () => !ChatDialog.isOpen();
const inGuideRoom = () => Npcs.query().name(GUIDE).within(10).exists();
const expertInScene = () => Npcs.query().name(EXPERT).within(30).exists();
const onGuideSide = () => {
    const t = Game.tile();
    return t !== null && t.x <= GUIDE_SIDE_MAX_X;
};

class TalkToGuide extends StageTask {
    private talked = false;

    validate(): boolean {
        return !this.talked && noDialog() && inGuideRoom();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(GUIDE).nearest();
        if (!npc) {
            return;
        }

        await npc.interact('Talk-to');
        if (await Execution.delayUntil(() => ChatDialog.isOpen(), 8000)) {
            this.talked = true;
        }
    }
}

class OpenGuideDoor extends StageTask {
    validate(): boolean {
        return noDialog() && onGuideSide() && inGuideRoom() && Locs.query().name('Door').action('Open').within(10).exists();
    }

    async execute(): Promise<void> {
        const door = Locs.query().name('Door').action('Open').within(10).nearest();
        if (!door) {
            return;
        }

        await door.interact('Open');
        await Execution.delayTicks(3);
    }
}

class TalkSurvivalExpert extends StageTask {
    private talked = false;

    validate(): boolean {
        return !this.talked && noDialog() && !onGuideSide() && expertInScene();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(EXPERT).nearest();
        if (!npc) {
            return;
        }

        await npc.interact('Talk-to');
        if (await Execution.delayUntil(() => ChatDialog.isOpen(), 10000)) {
            this.talked = true;
        }
    }
}

class OpenInventoryTab extends StageTask {
    validate(): boolean {
        return noDialog() && reader.sideTabInterface(INVENTORY_TAB) !== -1 && !Inventory.contains('Bronze axe') && reader.activeSideTab() !== INVENTORY_TAB;
    }

    async execute(): Promise<void> {
        await Game.openSideTab(INVENTORY_TAB);
    }
}

class ChopTree extends StageTask {
    validate(): boolean {
        return noDialog() && Skills.xp('firemaking') === 0 && Inventory.contains('Bronze axe') && !Inventory.contains('Logs') && !Game.animating();
    }

    async execute(): Promise<void> {
        const tree = Locs.query().name('Tree').action('Chop down').within(15).nearest();
        if (!tree) {
            return;
        }

        await tree.interact('Chop down');
        await Execution.delayUntil(() => Game.animating() || Inventory.contains('Logs'), 8000);
        await Execution.delayUntil(() => Inventory.contains('Logs') || !Game.animating(), 15000);
    }
}

class LightFire extends StageTask {
    validate(): boolean {
        return noDialog() && Skills.xp('firemaking') === 0 && Inventory.contains('Logs') && Inventory.contains('Tinderbox') && !Game.animating();
    }

    async execute(): Promise<void> {
        const logs = Inventory.first('Logs');
        const box = Inventory.first('Tinderbox');
        if (!logs || !box) {
            return;
        }

        await logs.useOn(box);
        await Execution.delayUntil(() => !Inventory.contains('Logs'), 15000);
    }
}

class OpenStatsTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && Skills.xp('firemaking') > 0 && reader.sideTabInterface(STATS_TAB) !== -1 && reader.activeSideTab() !== STATS_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(STATS_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

class TalkSurvivalAgain extends StageTask {
    validate(): boolean {
        return noDialog() && Skills.xp('firemaking') > 0 && !Inventory.contains('Small fishing net') && expertInScene();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(EXPERT).nearest();
        if (!npc) {
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => ChatDialog.isOpen(), 10000);
    }
}

class NetShrimp extends StageTask {
    validate(): boolean {
        return noDialog() && Skills.xp('cooking') === 0 && Inventory.contains('Small fishing net') && !Inventory.contains('Raw shrimps') && !Game.animating();
    }

    async execute(): Promise<void> {
        const spot = Npcs.query().name('Fishing spot').action('Net').within(20).nearest();
        if (!spot) {
            return;
        }

        await spot.interact('Net');
        await Execution.delayUntil(() => Game.animating() || Inventory.contains('Raw shrimps'), 8000);
        await Execution.delayUntil(() => Inventory.contains('Raw shrimps') || !Game.animating(), 20000);
    }
}

class CookShrimp extends StageTask {
    validate(): boolean {
        return noDialog() && Skills.xp('cooking') === 0 && Inventory.contains('Raw shrimps');
    }

    async execute(): Promise<void> {
        const fire = Locs.query().name('Fire').within(10).nearest();
        if (!fire) {
            const logs = Inventory.first('Logs');
            if (!logs) {
                const tree = Locs.query().name('Tree').action('Chop down').within(15).nearest();
                if (tree) {
                    await tree.interact('Chop down');
                    await Execution.delayUntil(() => Inventory.contains('Logs'), 15000);
                }
                return;
            }

            const box = Inventory.first('Tinderbox');
            if (box) {
                await logs.useOn(box);
                await Execution.delayUntil(() => Locs.query().name('Fire').within(10).exists(), 15000);
            }
            return;
        }

        const raw = Inventory.first('Raw shrimps');
        if (!raw) {
            return;
        }

        const before = Inventory.items().filter(i => i.name === 'Raw shrimps').length;
        await raw.useOn(fire);
        await Execution.delayUntil(() => Inventory.items().filter(i => i.name === 'Raw shrimps').length < before, 15000);
    }
}

class OpenSurvivalGate extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && Skills.xp('cooking') > 0 && Locs.query().name('Gate').action('Open').within(20).exists();
    }

    async execute(): Promise<void> {
        const gate = Locs.query().name('Gate').action('Open').within(20).nearest();
        if (!gate) {
            return;
        }

        const dispatched = await gate.interact('Open');
        await Execution.delayTicks(3);
        if (dispatched) {
            this.opened = true;
        }
    }
}

export function survivalStages(bot: TutorialBot): Task[] {
    return [
        new TalkToGuide(bot),
        new OpenGuideDoor(bot),
        new TalkSurvivalExpert(bot),
        new OpenInventoryTab(bot),
        new ChopTree(bot),
        new LightFire(bot),
        new OpenStatsTab(bot),
        new TalkSurvivalAgain(bot),
        new NetShrimp(bot),
        new CookShrimp(bot),
        new OpenSurvivalGate(bot)
    ];
}
