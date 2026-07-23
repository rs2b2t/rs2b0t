import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Locs, type Loc } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import type TutorialBot from '../../TutorialBot.js';
import { StageTask } from '../StageTask.js';
import { MINE_Z, walkToward } from './helpers.js';

const DEZZICK = 'Mining Instructor';

const COPPER_ROCK_ID = 3042;
const TIN_ROCK_ID = 3043;

const USE_ON_RANGE = 12;

const EXIT_GATE_X = 3094;
const EXIT_GATE_BOX = { minX: EXIT_GATE_X - 3, maxX: EXIT_GATE_X + 3, minZ: 9498, maxZ: 9507 };

const noDialog = () => !ChatDialog.isOpen();
const inMine = () => {
    const t = Game.tile();
    return t !== null && t.z >= MINE_Z;
};

function rockQuery(id: number) {
    return Locs.query()
        .name('Rocks')
        .where((l: Loc) => l.id === id);
}

interface MiningProgress {
    prospectedCopper: boolean;
    prospectedTin: boolean;
}

class TalkMiningInstructor extends StageTask {
    private talked = false;

    validate(): boolean {
        return !this.talked && inMine() && noDialog();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(DEZZICK).within(40).nearest();
        if (!npc) {
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        if (await Execution.delayUntil(() => ChatDialog.isOpen(), 8000)) {
            this.talked = true;
        }
    }
}

class ProspectCopper extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: MiningProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && inMine() && noDialog();
    }

    async execute(): Promise<void> {
        const rock = rockQuery(COPPER_ROCK_ID).within(40).nearest();
        if (!rock) {
            return;
        }

        if (rock.distance() > 5) {
            await walkToward(rock.tile());
            return;
        }

        await rock.interact('Prospect');
        if (await Execution.delayUntil(() => ChatDialog.isOpen(), 8000)) {
            this.done = true;
            this.progress.prospectedCopper = true;
        }
    }
}

class ProspectTin extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: MiningProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && inMine() && noDialog() && this.progress.prospectedCopper;
    }

    async execute(): Promise<void> {
        const rock = rockQuery(TIN_ROCK_ID).within(40).nearest();
        if (!rock) {
            return;
        }

        if (rock.distance() > 5) {
            await walkToward(rock.tile());
            return;
        }

        await rock.interact('Prospect');
        if (await Execution.delayUntil(() => ChatDialog.isOpen(), 8000)) {
            this.done = true;
            this.progress.prospectedTin = true;
        }
    }
}

class TalkForPickaxe extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: MiningProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && inMine() && noDialog() && this.progress.prospectedTin && !Inventory.contains('Bronze pickaxe');
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(DEZZICK).within(40).nearest();
        if (!npc) {
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        if (await Execution.delayUntil(() => Inventory.contains('Bronze pickaxe'), 8000)) {
            this.done = true;
        }
    }
}

class MineCopper extends StageTask {
    private done = false;

    validate(): boolean {
        return !this.done && inMine() && noDialog() && Inventory.contains('Bronze pickaxe') && !Inventory.contains('Copper ore') && !Game.animating();
    }

    async execute(): Promise<void> {
        const rock = rockQuery(COPPER_ROCK_ID).within(40).nearest();
        if (!rock) {
            return;
        }

        if (rock.distance() > 5) {
            await walkToward(rock.tile());
            return;
        }

        await rock.interact('Mine');
        if (await Execution.delayUntil(() => Inventory.contains('Copper ore'), 15000)) {
            this.done = true;
        }
    }
}

class MineTin extends StageTask {
    private done = false;

    validate(): boolean {
        return !this.done && inMine() && noDialog() && Inventory.contains('Copper ore') && !Inventory.contains('Tin ore') && !Game.animating();
    }

    async execute(): Promise<void> {
        const rock = rockQuery(TIN_ROCK_ID).within(40).nearest();
        if (!rock) {
            return;
        }

        if (rock.distance() > 5) {
            await walkToward(rock.tile());
            return;
        }

        await rock.interact('Mine');
        if (await Execution.delayUntil(() => Inventory.contains('Tin ore'), 15000)) {
            this.done = true;
        }
    }
}

class SmeltBronze extends StageTask {
    validate(): boolean {
        return inMine() && noDialog() && Inventory.contains('Copper ore') && Inventory.contains('Tin ore');
    }

    async execute(): Promise<void> {
        const furnace = Locs.query().name('Furnace').action('Use').within(40).nearest();
        if (!furnace) {
            return;
        }

        if (furnace.distance() > USE_ON_RANGE) {
            await walkToward(furnace.tile());
            return;
        }

        const ore = Inventory.first('Copper ore');
        if (!ore) {
            return;
        }

        await ore.useOn(furnace);
        await Execution.delayUntil(() => Inventory.contains('Bronze bar'), 15000);
    }
}

class TalkForHammer extends StageTask {
    private done = false;

    validate(): boolean {
        return !this.done && inMine() && noDialog() && Inventory.contains('Bronze bar') && !Inventory.contains('Hammer');
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(DEZZICK).within(40).nearest();
        if (!npc) {
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        if (await Execution.delayUntil(() => Inventory.contains('Hammer'), 8000)) {
            this.done = true;
        }
    }
}

class SmithDagger extends StageTask {
    validate(): boolean {
        return (noDialog() || ChatDialog.isMainMakePanel()) && inMine() && Inventory.contains('Bronze bar') && Inventory.contains('Hammer');
    }

    async execute(): Promise<void> {
        if (ChatDialog.isMainMakePanel()) {
            await ChatDialog.makeFromPanel('dagger');
            await Execution.delayUntil(() => Inventory.contains('Bronze dagger'), 10000);
            return;
        }

        const anvil = Locs.query().name('Anvil').within(40).nearest();
        if (!anvil) {
            return;
        }

        if (anvil.distance() > USE_ON_RANGE) {
            await walkToward(anvil.tile());
            return;
        }

        const bar = Inventory.first('Bronze bar');
        if (!bar) {
            return;
        }

        await bar.useOn(anvil);
        await Execution.delayUntil(() => ChatDialog.isMainMakePanel(), 8000);
    }
}

class OpenMineGate extends StageTask {
    private done = false;

    validate(): boolean {
        const t = Game.tile();
        return !this.done && inMine() && noDialog() && Inventory.contains('Bronze dagger') && t !== null && t.x <= EXIT_GATE_X;
    }

    async execute(): Promise<void> {
        const gate = Locs.query().name('Gate').action('Open').inside(EXIT_GATE_BOX).nearest();
        if (!gate) {
            return;
        }

        if (gate.distance() > 5) {
            await walkToward(gate.tile());
            return;
        }

        await gate.interact('Open');
        const crossed = await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && t.x > EXIT_GATE_X;
        }, 8000);
        if (crossed) {
            this.done = true;
        }
    }
}

export function miningStages(bot: TutorialBot): Task[] {
    const progress: MiningProgress = { prospectedCopper: false, prospectedTin: false };
    return [
        new TalkMiningInstructor(bot),
        new ProspectCopper(bot, progress),
        new ProspectTin(bot, progress),
        new TalkForPickaxe(bot, progress),
        new MineCopper(bot),
        new MineTin(bot),
        new SmeltBronze(bot),
        new TalkForHammer(bot),
        new SmithDagger(bot),
        new OpenMineGate(bot)
    ];
}
