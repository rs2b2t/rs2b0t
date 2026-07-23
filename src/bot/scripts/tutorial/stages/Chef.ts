import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Skills } from '../../../api/hud/Skills.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { actions, reader } from '../../../adapter/ClientAdapter.js';
import type TutorialBot from '../../TutorialBot.js';
import { StageTask } from '../StageTask.js';
import { doorAt, QUEST_GUIDE_DOOR, walkToward } from './helpers.js';

const CHEF = 'Master Chef';
const MUSIC_TAB = 13;
const CONTROLS_TAB = 12;

const CHEF_DOOR_IN = { x: 3079, z: 3084 };
const CHEF_DOOR_OUT = { x: 3072, z: 3090 };

const CHEF_HOUSE = { minX: 3073, maxX: 3078, minZ: 3081, maxZ: 3091 };

const GATE_LINE_X = 3089;

const noDialog = () => !ChatDialog.isOpen();
const nearChef = () => Npcs.query().name(CHEF).within(8).exists();

const insideChefHouse = () => {
    const t = Game.tile();
    return t !== null && t.x >= CHEF_HOUSE.minX && t.x <= CHEF_HOUSE.maxX && t.z >= CHEF_HOUSE.minZ && t.z <= CHEF_HOUSE.maxZ;
};

const onChefSide = () => {
    const t = Game.tile();
    return t !== null && t.x <= GATE_LINE_X;
};

const breadChainNotStarted = () => !Inventory.contains('Pot of flour') && !Inventory.contains('Bread dough') && !Inventory.contains('Bread');

class OpenChefDoor extends StageTask {
    validate(): boolean {
        return noDialog() && Skills.xp('cooking') > 0 && onChefSide() && !insideChefHouse() && breadChainNotStarted();
    }

    async execute(): Promise<void> {
        const door = doorAt(CHEF_DOOR_IN).nearest();
        if (!door || door.distance() > 5) {
            await walkToward(CHEF_DOOR_IN);
            return;
        }

        await door.interact('Open');
        await Execution.delayUntil(() => insideChefHouse(), 5000);
    }
}

class TalkChef extends StageTask {
    private talked = false;

    validate(): boolean {
        return !this.talked && noDialog() && insideChefHouse() && nearChef();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(CHEF).nearest();
        if (!npc) {
            return;
        }

        await npc.interact('Talk-to');
        if (await Execution.delayUntil(() => ChatDialog.isOpen(), 8000)) {
            this.talked = true;
        }
    }
}

class MakeDough extends StageTask {
    validate(): boolean {
        return noDialog() && Inventory.contains('Pot of flour') && Inventory.contains('Bucket of water');
    }

    async execute(): Promise<void> {
        const flour = Inventory.first('Pot of flour');
        const water = Inventory.first('Bucket of water');
        if (!flour || !water) {
            return;
        }

        await flour.useOn(water);
        await Execution.delayUntil(() => Inventory.contains('Bread dough'), 5000);
    }
}

class BakeBread extends StageTask {
    validate(): boolean {
        return noDialog() && Inventory.contains('Bread dough');
    }

    async execute(): Promise<void> {
        const dough = Inventory.first('Bread dough');
        const range = Locs.query().name('Range').within(8).nearest();
        if (!dough || !range) {
            return;
        }

        await dough.useOn(range);
        await Execution.delayUntil(() => !Inventory.contains('Bread dough'), 15000);
    }
}

class OpenMusicTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && reader.sideTabInterface(MUSIC_TAB) !== -1 && reader.activeSideTab() !== MUSIC_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(MUSIC_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

class ExitChefHouse extends StageTask {
    validate(): boolean {
        return noDialog() && insideChefHouse() && Inventory.contains('Bread');
    }

    async execute(): Promise<void> {
        const door = doorAt(CHEF_DOOR_OUT).nearest();
        if (!door || door.distance() > 5) {
            await walkToward(CHEF_DOOR_OUT);
            return;
        }

        await door.interact('Open');
        await Execution.delayUntil(() => !insideChefHouse(), 5000);
    }
}

class OpenControlsTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && reader.sideTabInterface(CONTROLS_TAB) !== -1 && reader.activeSideTab() !== CONTROLS_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(CONTROLS_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

class ToggleRunOn extends StageTask {
    private done = false;

    validate(): boolean {
        return !this.done && noDialog() && reader.activeSideTab() === CONTROLS_TAB && !Game.runEnabled() && Game.energy() >= 100;
    }

    async execute(): Promise<void> {
        await actions.setRun(true);
        const enabled = await Execution.delayUntil(() => Game.runEnabled(), 3000);
        if (enabled) {
            this.done = true;
        }
    }
}

class OpenQuestGuideDoor extends StageTask {
    private done = false;

    validate(): boolean {
        const t = Game.tile();
        return !this.done && noDialog() && Game.runEnabled() && Skills.xp('mining') === 0 && t !== null && t.z < QUEST_GUIDE_DOOR.z;
    }

    async execute(): Promise<void> {
        const door = doorAt(QUEST_GUIDE_DOOR).nearest();
        if (!door || door.distance() > 5) {
            await walkToward(QUEST_GUIDE_DOOR);
            return;
        }

        await door.interact('Open');
        const crossed = await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && t.z >= QUEST_GUIDE_DOOR.z;
        }, 5000);
        if (crossed) {
            this.done = true;
        }
    }
}

export function chefStages(bot: TutorialBot): Task[] {
    return [
        new OpenChefDoor(bot),
        new TalkChef(bot),
        new MakeDough(bot),
        new BakeBread(bot),
        new OpenMusicTab(bot),
        new ExitChefHouse(bot),
        new OpenControlsTab(bot),
        new ToggleRunOn(bot),
        new OpenQuestGuideDoor(bot)
    ];
}
