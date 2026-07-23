import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Equipment } from '../../../api/hud/Equipment.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs, type Npc } from '../../../api/queries/Npcs.js';
import { reader } from '../../../adapter/ClientAdapter.js';
import type TutorialBot from '../../TutorialBot.js';
import { StageTask } from '../StageTask.js';
import { MINE_Z, walkToward } from './helpers.js';

const VANNAKA = 'Combat Instructor';
const RAT = 'Giant rat';

const WORN_TAB = 4;
const COMBAT_TAB = 0;

const MINE_GATE_X = 3094;

const PEN_EAST_X = 3110;
const PEN_SOUTH_Z = 9512;
const PEN_GATE_BOX = { minX: 3109, maxX: 3113, minZ: 9516, maxZ: 9521 };
const EXIT_LADDER_BOX = { minX: 3106, maxX: 3116, minZ: 9522, maxZ: 9530 };

const noDialog = () => !ChatDialog.isOpen();

const inCombatArea = (): boolean => {
    const t = Game.tile();
    return t !== null && t.z >= MINE_Z && t.x > MINE_GATE_X;
};

const inPen = (): boolean => {
    const t = Game.tile();
    return t !== null && t.z >= MINE_Z && t.x <= PEN_EAST_X && t.z >= PEN_SOUTH_Z;
};

const hasSwordOrShield = () =>
    Inventory.contains('Bronze sword') || Inventory.contains('Wooden shield') || Equipment.contains('Bronze sword') || Equipment.contains('Wooden shield');

const hasBow = () => Inventory.contains('Shortbow') || Equipment.contains('Shortbow');

const penGate = () => Locs.query().name('Gate').action('Open').inside(PEN_GATE_BOX).nearest();

interface CombatProgress {
    meleeKillDone: boolean;
    rangedKillDone: boolean;
}

class RatFight {
    private targetIndex = -1;

    async advance(range: number): Promise<boolean> {
        if (this.targetIndex !== -1) {
            const target = Npcs.query()
                .name(RAT)
                .where((n: Npc) => n.index === this.targetIndex)
                .first();
            if (!target) {
                this.targetIndex = -1;
                return true;
            }

            if (Game.inCombat() || target.inCombat) {
                await Execution.delayTicks(5);
                return false;
            }

            this.targetIndex = -1;
        }

        const rat = Npcs.query().name(RAT).action('Attack').within(range).nearest();
        if (!rat) {
            return false;
        }

        await rat.interact('Attack');
        const index = rat.index;
        const engaged = await Execution.delayUntil(
            () =>
                Game.inCombat() ||
                Npcs.query()
                    .name(RAT)
                    .where((n: Npc) => n.index === index)
                    .results()
                    .some(n => n.inCombat),
            8000
        );
        if (engaged) {
            this.targetIndex = index;
        }

        return false;
    }
}

class TalkVannaka extends StageTask {
    validate(): boolean {
        return noDialog() && inCombatArea() && reader.sideTabInterface(WORN_TAB) === -1;
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(VANNAKA).within(40).nearest();
        if (!npc) {
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => reader.sideTabInterface(WORN_TAB) !== -1, 8000);
    }
}

class OpenWornTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && inCombatArea() && reader.sideTabInterface(WORN_TAB) !== -1 && reader.activeSideTab() !== WORN_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(WORN_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

class WieldDagger extends StageTask {
    validate(): boolean {
        return (
            noDialog() &&
            inCombatArea() &&
            reader.activeSideTab() === WORN_TAB &&
            Inventory.contains('Bronze dagger') &&
            !Equipment.contains('Bronze dagger') &&
            !hasSwordOrShield()
        );
    }

    async execute(): Promise<void> {
        await Equipment.equip('Bronze dagger');
    }
}

class TalkForSword extends StageTask {
    validate(): boolean {
        return noDialog() && inCombatArea() && Equipment.contains('Bronze dagger') && !hasSwordOrShield();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(VANNAKA).within(40).nearest();
        if (!npc) {
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => Inventory.contains('Bronze sword') || Inventory.contains('Wooden shield'), 8000);
    }
}

class EquipSwordShield extends StageTask {
    private done = false;

    validate(): boolean {
        return (
            !this.done &&
            noDialog() &&
            inCombatArea() &&
            !hasBow() &&
            (Inventory.contains('Bronze sword') || Inventory.contains('Wooden shield')) &&
            !(Equipment.contains('Bronze sword') && Equipment.contains('Wooden shield'))
        );
    }

    async execute(): Promise<void> {
        if (Inventory.contains('Bronze sword')) {
            await Equipment.equip('Bronze sword');
        }
        if (Inventory.contains('Wooden shield')) {
            await Equipment.equip('Wooden shield');
        }
        if (Equipment.contains('Bronze sword') && Equipment.contains('Wooden shield')) {
            this.done = true;
        }
    }
}

class OpenCombatTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return (
            !this.opened &&
            noDialog() &&
            inCombatArea() &&
            Equipment.contains('Bronze sword') &&
            Equipment.contains('Wooden shield') &&
            reader.sideTabInterface(COMBAT_TAB) !== -1 &&
            reader.activeSideTab() !== COMBAT_TAB
        );
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(COMBAT_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

class EnterRatPen extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: CombatProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && noDialog() && inCombatArea() && !inPen() && !this.progress.meleeKillDone && reader.activeSideTab() === COMBAT_TAB && !Game.inCombat();
    }

    async execute(): Promise<void> {
        const gate = penGate();
        if (!gate) {
            return;
        }

        if (gate.distance() > 5) {
            await walkToward(gate.tile());
            return;
        }

        await gate.interact('Open');
        const entered = await Execution.delayUntil(() => inPen(), 8000);
        if (entered) {
            this.done = true;
        }
    }
}

class MeleeKillRat extends StageTask {
    private readonly fight = new RatFight();

    constructor(
        bot: TutorialBot,
        private readonly progress: CombatProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.progress.meleeKillDone && noDialog() && inPen() && Equipment.contains('Bronze sword');
    }

    async execute(): Promise<void> {
        if (await this.fight.advance(12)) {
            this.progress.meleeKillDone = true;
        }
    }
}

class TalkForBow extends StageTask {
    constructor(
        bot: TutorialBot,
        private readonly progress: CombatProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return this.progress.meleeKillDone && noDialog() && inCombatArea() && !hasBow() && !Game.inCombat();
    }

    async execute(): Promise<void> {
        if (inPen()) {
            const gate = penGate();
            if (!gate) {
                return;
            }

            if (gate.distance() > 5) {
                await walkToward(gate.tile());
                return;
            }

            await gate.interact('Open');
            await Execution.delayUntil(() => !inPen(), 8000);
            return;
        }

        const npc = Npcs.query().name(VANNAKA).within(40).nearest();
        if (!npc) {
            return;
        }

        if (npc.distance() > 5) {
            await walkToward(npc.tile());
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => Inventory.contains('Shortbow'), 8000);
    }
}

class RangedKillRat extends StageTask {
    private readonly fight = new RatFight();

    constructor(
        bot: TutorialBot,
        private readonly progress: CombatProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.progress.rangedKillDone && this.progress.meleeKillDone && noDialog() && inCombatArea() && !inPen() && hasBow();
    }

    async execute(): Promise<void> {
        if (!Equipment.contains('Shortbow')) {
            await Equipment.equip('Shortbow');
            return;
        }
        if (!Equipment.contains('Bronze arrow')) {
            await Equipment.equip('Bronze arrow');
            return;
        }

        if (await this.fight.advance(15)) {
            this.progress.rangedKillDone = true;
        }
    }
}

class ClimbOutLadder extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: CombatProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && this.progress.rangedKillDone && noDialog() && Locs.query().name('Ladder').action('Climb-up').inside(EXIT_LADDER_BOX).exists();
    }

    async execute(): Promise<void> {
        const ladder = Locs.query().name('Ladder').action('Climb-up').inside(EXIT_LADDER_BOX).nearest();
        if (!ladder) {
            return;
        }

        if (ladder.distance() > 5) {
            await walkToward(ladder.tile());
            return;
        }

        await ladder.interact('Climb-up');
        const surfaced = await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && t.z < MINE_Z;
        }, 8000);
        if (surfaced) {
            this.done = true;
        }
    }
}

export function combatStages(bot: TutorialBot): Task[] {
    const progress: CombatProgress = { meleeKillDone: false, rangedKillDone: false };
    return [
        new TalkVannaka(bot),
        new OpenWornTab(bot),
        new WieldDagger(bot),
        new TalkForSword(bot),
        new EquipSwordShield(bot),
        new OpenCombatTab(bot),
        new EnterRatPen(bot, progress),
        new MeleeKillRat(bot, progress),
        new TalkForBow(bot, progress),
        new RangedKillRat(bot, progress),
        new ClimbOutLadder(bot, progress)
    ];
}
