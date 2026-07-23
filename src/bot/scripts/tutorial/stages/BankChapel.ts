import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Bank } from '../../../api/hud/Bank.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Skills } from '../../../api/hud/Skills.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { actions, reader } from '../../../adapter/ClientAdapter.js';
import type TutorialBot from '../../TutorialBot.js';
import { StageTask } from '../StageTask.js';
import { doorAt, MINE_Z, walkToward } from './helpers.js';

const ADVISOR = 'Financial Advisor';
const BRACE = 'Brother Brace';

const PRAYER_TAB = 5;
const FRIENDS_TAB = 8;
const IGNORE_TAB = 9;

const BOOTH_BOX = { minX: 3119, maxX: 3123, minZ: 3123, maxZ: 3125 };
const ADVISOR_DOOR = { x: 3125, z: 3124 };
const ADVISOR_EXIT_DOOR = { x: 3130, z: 3124 };
const CHAPEL_DOOR_BOX = { minX: 3127, maxX: 3131, minZ: 3104, maxZ: 3109 };
const CHAPEL_INSIDE = { x: 3125, z: 3106 };
const CHAPEL_EXIT_DOOR = { x: 3122, z: 3102 };

const ADVISOR_ROOM = { minX: 3125, maxX: 3129, minZ: 3120, maxZ: 3128 };
const CHAPEL = { minX: 3118, maxX: 3128, minZ: 3103, maxZ: 3111 };

const CLICK_RANGE = 12;

const noDialog = () => !ChatDialog.isOpen();

const inBox = (box: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean => {
    const t = Game.tile();
    return t !== null && t.x >= box.minX && t.x <= box.maxX && t.z >= box.minZ && t.z <= box.maxZ;
};

const pastCombat = (): boolean => {
    const t = Game.tile();
    return t !== null && t.z < MINE_Z && Skills.xp('ranged') > 0;
};

const preAdvisorArea = (): boolean => {
    const t = Game.tile();
    return t !== null && t.x <= 3124 && t.z >= 3112;
};

const chapelApproach = (): boolean => {
    const t = Game.tile();
    return t !== null && t.x >= 3129 && t.x <= 3140 && t.z >= 3103 && t.z <= 3126;
};

const inAdvisorRoom = () => inBox(ADVISOR_ROOM);
const insideChapel = () => inBox(CHAPEL);

interface BankChapelProgress {
    bankOpened: boolean;
    advisorTalked: boolean;
    braceFinished: boolean;
}

class UseBankBooth extends StageTask {
    constructor(
        bot: TutorialBot,
        private readonly progress: BankChapelProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.progress.bankOpened && noDialog() && pastCombat() && preAdvisorArea();
    }

    async execute(): Promise<void> {
        if (Bank.isOpen()) {
            this.progress.bankOpened = true;
            return;
        }

        const booth = Locs.query().name('Bank booth').action('Use').inside(BOOTH_BOX).nearest();
        if (!booth) {
            await walkToward({ x: 3121, z: 3123 });
            return;
        }

        if (booth.distance() > CLICK_RANGE) {
            await walkToward(booth.tile());
            return;
        }

        await booth.interact('Use');
        await Execution.delayUntil(() => ChatDialog.isOpen() || Bank.isOpen(), 8000);
        if (Bank.isOpen()) {
            this.progress.bankOpened = true;
        }
    }
}

class CloseBank extends StageTask {
    constructor(
        bot: TutorialBot,
        private readonly progress: BankChapelProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return Bank.isOpen() && pastCombat();
    }

    async execute(): Promise<void> {
        this.progress.bankOpened = true;
        actions.closeModal();
        await Execution.delayUntil(() => !Bank.isOpen(), 3000);
    }
}

class OpenAdvisorDoor extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: BankChapelProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && this.progress.bankOpened && !Bank.isOpen() && noDialog() && pastCombat() && preAdvisorArea();
    }

    async execute(): Promise<void> {
        const door = doorAt(ADVISOR_DOOR).nearest();
        if (!door) {
            await walkToward(ADVISOR_DOOR);
            return;
        }

        if (door.distance() > CLICK_RANGE) {
            await walkToward(door.tile());
            return;
        }

        await door.interact('Open');
        const crossed = await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && t.x >= ADVISOR_DOOR.x;
        }, 5000);
        if (crossed) {
            this.done = true;
        } else if (ChatDialog.isOpen()) {
            this.progress.bankOpened = false;
        }
    }
}

class TalkAdvisor extends StageTask {
    private talked = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: BankChapelProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.talked && !this.progress.advisorTalked && noDialog() && pastCombat() && inAdvisorRoom() && Npcs.query().name(ADVISOR).within(8).exists();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(ADVISOR).nearest();
        if (!npc) {
            return;
        }

        await npc.interact('Talk-to');
        if (await Execution.delayUntil(() => ChatDialog.isOpen(), 8000)) {
            this.talked = true;
            this.progress.advisorTalked = true;
        }
    }
}

class ExitAdvisorRoom extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: BankChapelProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && this.progress.advisorTalked && noDialog() && pastCombat() && inAdvisorRoom();
    }

    async execute(): Promise<void> {
        const door = doorAt(ADVISOR_EXIT_DOOR).nearest();
        if (!door) {
            await walkToward(ADVISOR_EXIT_DOOR);
            return;
        }

        if (door.distance() > CLICK_RANGE) {
            await walkToward(door.tile());
            return;
        }

        await door.interact('Open');
        const crossed = await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && t.x >= ADVISOR_EXIT_DOOR.x;
        }, 5000);
        if (crossed) {
            this.done = true;
        } else if (ChatDialog.isOpen()) {
            this.progress.advisorTalked = false;
        }
    }
}

class EnterChapel extends StageTask {
    validate(): boolean {
        return noDialog() && pastCombat() && chapelApproach();
    }

    async execute(): Promise<void> {
        const door = Locs.query().name('Large door').action('Open').inside(CHAPEL_DOOR_BOX).nearest();
        if (!door) {
            await walkToward(CHAPEL_INSIDE);
            return;
        }

        if (door.distance() > CLICK_RANGE) {
            await walkToward(door.tile());
            return;
        }

        await door.interact('Open');
        await Execution.delayTicks(4);
    }
}

class TalkBrace extends StageTask {
    validate(): boolean {
        return noDialog() && pastCombat() && insideChapel() && reader.sideTabInterface(PRAYER_TAB) === -1 && Npcs.query().name(BRACE).within(10).exists();
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(BRACE).nearest();
        if (!npc) {
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => reader.sideTabInterface(PRAYER_TAB) !== -1, 8000);
    }
}

class OpenPrayerTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && pastCombat() && insideChapel() && reader.sideTabInterface(PRAYER_TAB) !== -1 && reader.activeSideTab() !== PRAYER_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(PRAYER_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

class TalkBrace2 extends StageTask {
    validate(): boolean {
        return (
            noDialog() &&
            pastCombat() &&
            insideChapel() &&
            reader.sideTabInterface(PRAYER_TAB) !== -1 &&
            reader.sideTabInterface(FRIENDS_TAB) === -1 &&
            Npcs.query().name(BRACE).within(10).exists()
        );
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(BRACE).nearest();
        if (!npc) {
            return;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => reader.sideTabInterface(FRIENDS_TAB) !== -1, 8000);
    }
}

class OpenFriendsTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && pastCombat() && insideChapel() && reader.sideTabInterface(FRIENDS_TAB) !== -1 && reader.activeSideTab() !== FRIENDS_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(FRIENDS_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

class OpenIgnoreTab extends StageTask {
    private opened = false;

    validate(): boolean {
        return !this.opened && noDialog() && pastCombat() && insideChapel() && reader.sideTabInterface(IGNORE_TAB) !== -1 && reader.activeSideTab() !== IGNORE_TAB;
    }

    async execute(): Promise<void> {
        const success = await Game.openSideTab(IGNORE_TAB);
        if (success) {
            this.opened = true;
        }
    }
}

class TalkBrace3 extends StageTask {
    private talked = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: BankChapelProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return (
            !this.talked &&
            !this.progress.braceFinished &&
            noDialog() &&
            pastCombat() &&
            insideChapel() &&
            reader.sideTabInterface(IGNORE_TAB) !== -1 &&
            Npcs.query().name(BRACE).within(10).exists()
        );
    }

    async execute(): Promise<void> {
        const npc = Npcs.query().name(BRACE).nearest();
        if (!npc) {
            return;
        }

        await npc.interact('Talk-to');
        if (await Execution.delayUntil(() => ChatDialog.isOpen(), 8000)) {
            this.talked = true;
            this.progress.braceFinished = true;
        }
    }
}

class ExitChapel extends StageTask {
    private done = false;

    constructor(
        bot: TutorialBot,
        private readonly progress: BankChapelProgress
    ) {
        super(bot);
    }

    validate(): boolean {
        return !this.done && this.progress.braceFinished && noDialog() && pastCombat() && insideChapel();
    }

    async execute(): Promise<void> {
        const door = doorAt(CHAPEL_EXIT_DOOR).nearest();
        if (!door) {
            await walkToward(CHAPEL_EXIT_DOOR);
            return;
        }

        if (door.distance() > CLICK_RANGE) {
            await walkToward(door.tile());
            return;
        }

        await door.interact('Open');
        const crossed = await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && t.z <= CHAPEL_EXIT_DOOR.z;
        }, 5000);
        if (crossed) {
            this.done = true;
        } else if (ChatDialog.isOpen()) {
            this.progress.braceFinished = false;
        }
    }
}

export function bankChapelStages(bot: TutorialBot): Task[] {
    const progress: BankChapelProgress = { bankOpened: false, advisorTalked: false, braceFinished: false };
    return [
        new UseBankBooth(bot, progress),
        new CloseBank(bot, progress),
        new OpenAdvisorDoor(bot, progress),
        new TalkAdvisor(bot, progress),
        new ExitAdvisorRoom(bot, progress),
        new EnterChapel(bot),
        new TalkBrace(bot),
        new OpenPrayerTab(bot),
        new TalkBrace2(bot),
        new OpenFriendsTab(bot),
        new OpenIgnoreTab(bot),
        new TalkBrace3(bot, progress),
        new ExitChapel(bot, progress)
    ];
}
