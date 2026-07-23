import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Skills } from '../../../api/hud/Skills.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { reader } from '../../../adapter/ClientAdapter.js';
import type TutorialBot from '../../TutorialBot.js';
import { StageTask } from '../StageTask.js';
import { walkToward } from './helpers.js';

const TERROVA = 'Magic Instructor';
const CHICKEN = 'Chicken';

const MAGIC_TAB = 6;

const CHICKEN_PEN = { x: 3139, z: 3092 };

const noDialog = () => !ChatDialog.isOpen();

const inMagicArea = (): boolean => {
    const t = Game.tile();
    return t !== null && t.x >= 3118 && t.x <= 3155 && t.z >= 3076 && t.z <= 3102;
};

const hasRunes = () => Inventory.contains('Air rune') && Inventory.contains('Mind rune');

interface MagicProgress {
    casts: number;
}

class TalkTerrova extends StageTask {
    validate(): boolean {
        return noDialog() && inMagicArea() && reader.sideTabInterface(MAGIC_TAB) === -1;
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(TERROVA).within(40).nearest();
        if (!npc) {
            await walkToward({ x: 3141, z: 3089 });
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => reader.sideTabInterface(MAGIC_TAB) !== -1, 8000);
    }
}

class OpenMagicTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && inMagicArea() && reader.sideTabInterface(MAGIC_TAB) !== -1 && reader.activeSideTab() !== MAGIC_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(MAGIC_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

class TalkForRunes extends StageTask {
    constructor(
        bot: TutorialBot,
        private readonly progress: MagicProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return this.progress.casts < 2 && noDialog() && inMagicArea() && reader.sideTabInterface(MAGIC_TAB) !== -1 && !hasRunes();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(TERROVA).within(40).nearest();
        if (!npc) {
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => hasRunes(), 8000);
    }
}

class CastWindStrike extends StageTask {
    constructor(
        bot: TutorialBot,
        private readonly progress: MagicProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return this.progress.casts < 2 && noDialog() && inMagicArea() && hasRunes() && !Game.inCombat();
    }

    async execute(): Promise<void> {
        const chicken = Npcs.query().name(CHICKEN).within(20).nearest();
        if (!chicken) {
            await walkToward(CHICKEN_PEN);
            return;
        }

        if (chicken.distance() > 10) {
            await walkToward(chicken.tile());
            return;
        }

        const before = Skills.xp('magic');
        if (!(await Game.castOnNpc('Wind Strike', chicken))) {
            return;
        }

        const confirmed = await Execution.delayUntil(() => Skills.xp('magic') > before, 10000);
        if (confirmed) {
            this.progress.casts += 1;
        }
    }
}

class FinishTutorial extends StageTask {
    constructor(
        bot: TutorialBot,
        private readonly progress: MagicProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return this.progress.casts >= 2 && noDialog() && inMagicArea();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(TERROVA).within(40).nearest();
        if (!npc) {
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => ChatDialog.isOpen(), 8000);
    }
}

export function magicStages(bot: TutorialBot): Task[] {
    const progress: MagicProgress = { casts: 0 };
    return [new TalkTerrova(bot), new OpenMagicTab(bot), new TalkForRunes(bot, progress), new CastWindStrike(bot, progress), new FinishTutorial(bot, progress)];
}
