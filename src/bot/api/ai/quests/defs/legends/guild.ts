import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Reach } from '../../../../walking/Reach.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import { LEGENDS_QUEST, LQ_ID, LQ_LOC, LQ_LOC_ID, LQ_NPC, LQ_TILE } from './areas.js';
import { LegendsConfig } from './config.js';
import { driveUntil, heldId, locNear, modalText, promptLoc, settleScene } from './scene.js';

/** Inside the guild wall: the gate sits on z=3349 and everything past it is the compound. */
export function insideGuild(): boolean {
    const here = Game.tile();
    return here !== null && here.level === 0 && here.z >= 3350 && here.x >= 2716 && here.x <= 2740 && here.z <= 3390;
}

/** Inside the main hall, behind the Legends Guild doors. */
export function inMainHall(): boolean {
    const here = Game.tile();
    return here !== null && here.level === 0 && here.x >= 2722 && here.x <= 2733 && here.z >= 3374 && here.z <= 3390;
}

// Why: At stage 0, Open starts the guard dialogue instead of crossing the gate.
// Why: the guard's "Yes, I'd like to talk to Grand Vizier Erkle" branch opens the gate and teleports you through, the only way in before the quest starts.

const GUARD_PREFER = [
    "Yes, I'd like to talk to Grand Vizier Erkle",
    'Can I go on the quest?',
    'What is this place?',
    // Why: last, so it's only taken when none of the ways in are on offer, and then the guard reads the missing quests into the log.
    'Which quests do I need to complete?'
];

// Why: Failed eligibility can end without an entry option, so detect the closed gate instead of retrying the guard indefinitely.
const GUARD_REFUSED = /complete more quests|107 quest points|quest point/i;

// Why: `legends_guard_start` only has a conversation before the quest starts; from stage 1 on he nods you past and says nothing, so `Reach.npcDialog` would wait out its budget on a chat that never comes.
// Why: from then on the gate is the way in: `open_legends_gate` looks for a guard within 14 tiles, has him nod, and swings the doors for anyone past `legends_not_started`.

/** The gate line; north of it is the guild side. */
const GUILD_GATE_Z = 3349;

const pastGuildGate = (): boolean => {
    const here = Game.tile();
    return here !== null && here.level === 0 && here.x >= 2722 && here.x <= 2733 && here.z > GUILD_GATE_Z;
};

/** Open the guild gate, which needs no conversation once the quest has begun. */
async function walkThroughGate(log: (m: string) => void): Promise<boolean> {
    for (const id of [LQ_LOC_ID.GUILD_GATE_L, LQ_LOC_ID.GUILD_GATE_R]) {
        const opened = await promptLoc(
            {
                name: LQ_LOC.GUILD_GATE,
                op: 'Open',
                near: LQ_TILE.GUARD,
                within: 6,
                id,
                expect: pastGuildGate,
                expectMs: 12_000
            },
            log
        );
        if (opened) {
            await settleScene();
            return true;
        }
    }
    log('the Legends Guild gate would not open');
    return false;
}

/** Talk the patrolling guard into opening the gate. */
export async function enterGuild(log: (m: string) => void): Promise<boolean> {
    if (insideGuild() || pastGuildGate()) {
        return true;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.GUARD, { radius: 3, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    if (Quests.status(LEGENDS_QUEST) !== 'notStarted') {
        return walkThroughGate(log);
    }
    // Why: the guard patrols, so the leash-limited `gotoNpc` loses him; `Reach` searches the scene and lets the server chase.
    const status = await Reach.npcDialog({ name: LQ_NPC.GUARD, near: LQ_TILE.GUARD, log });
    if (status !== 'done') {
        log('the Legends guard never opened a dialogue');
        return false;
    }
    // Why: the gate opens inside the conversation and teleports us through, so the goal is the tile.
    // Why: the refusal is caught while the chat is still up, since it's gone from `modalText` once the conversation closes.
    let refused = '';
    const entered = await driveUntil(
        () => {
            if (refused === '' && GUARD_REFUSED.test(modalText())) {
                refused = modalText();
            }
            return insideGuild();
        },
        GUARD_PREFER,
        log,
        60_000
    );
    if (!entered) {
        log(refused === ''
            ? 'the guard conversation ended with the gate still shut'
            : `the Legends guard refused entry — ${refused.slice(0, 200)}`);
    }
    return entered;
}

const START_PREFER = [
    'Yes, it sounds great!',
    "Yes actually, what's involved?",
    'Who are you?'
];

/** Radimus hands over the Kharazi notes, which is what starts the quest. */
export async function startQuest(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.MAP) > 0 || heldId(LQ_ID.MAP_COMPLETE) > 0) {
        return true;
    }
    if (!(await enterGuild(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.RADIMUS_STUDY, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    const status = await Reach.npcDialog({ name: LQ_NPC.RADIMUS, near: LQ_TILE.RADIMUS_STUDY, log });
    if (status !== 'done') {
        log('Radimus Erkle never opened a dialogue');
        return false;
    }
    return driveUntil(() => heldId(LQ_ID.MAP) > 0, START_PREFER, log, 60_000);
}

// Why: `radimus_erkle_midquest` only offers the lost-map topic when neither map is held, and it charges 30 coins for the copy.

const LOST_MAP_PREFER = [
    'Terrible, I lost my map of the Kharazi Jungle.',
    "Yes, I'll pay for it."
];

/** Buy a replacement map from Radimus, for a run that died holding the old one. */
export async function replaceMap(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.MAP) > 0 || heldId(LQ_ID.MAP_COMPLETE) > 0) {
        return true;
    }
    if (!(await enterGuild(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.RADIMUS_STUDY, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    const status = await Reach.npcDialog({ name: LQ_NPC.RADIMUS, near: LQ_TILE.RADIMUS_STUDY, log });
    if (status !== 'done') {
        log('Radimus Erkle never opened a dialogue for the replacement map');
        return false;
    }
    return driveUntil(() => heldId(LQ_ID.MAP) > 0, LOST_MAP_PREFER, log, 60_000);
}

// Why: the cupboard is a shut loc that becomes an open one, and only the open half carries Search.
// Why: the Search branch returns silently unless Radimus is within 5 tiles, so it's only ever run from his study.

/** Take the free machete out of Radimus' cupboard. */
export async function takeMachete(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.MACHETE) > 0) {
        return true;
    }
    if (!(await enterGuild(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.CUPBOARD, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    if (!locNear(LQ_LOC.CUPBOARD_OPEN, 'Search', 6)) {
        const shut = locNear(LQ_LOC.CUPBOARD, 'Open', 6);
        if (shut && (await shut.interact('Open'))) {
            await Execution.delayUntil(() => locNear(LQ_LOC.CUPBOARD_OPEN, 'Search', 6) !== null, 8000);
        }
    }
    return promptLoc(
        {
            name: LQ_LOC.CUPBOARD_OPEN,
            op: 'Search',
            near: LQ_TILE.CUPBOARD,
            id: LQ_LOC_ID.CUPBOARD_OPEN,
            expect: () => heldId(LQ_ID.MACHETE) > 0
        },
        log
    );
}

const HAND_IN_PREFER = ['Yes', 'Ok'];

// Why: he takes the gilded totem and the finished map together, and refuses either alone.

/** Hand the gilded totem and the completed map to Radimus. */
export async function handInTotem(log: (m: string) => void): Promise<boolean> {
    if (!(await enterGuild(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.RADIMUS_STUDY, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    const status = await Reach.npcDialog({ name: LQ_NPC.RADIMUS, near: LQ_TILE.RADIMUS_STUDY, log });
    if (status !== 'done') {
        log('Radimus Erkle never opened a dialogue for the hand-in');
        return false;
    }
    return driveUntil(() => heldId(LQ_ID.GILDED_TOTEM) === 0, HAND_IN_PREFER, log, 60_000);
}

/** The main hall doors refuse everyone below stage 50 and open freely above it. */
export async function enterMainHall(log: (m: string) => void): Promise<boolean> {
    if (inMainHall()) {
        return true;
    }
    if (!(await enterGuild(log))) {
        return false;
    }
    const ok = await promptLoc(
        {
            name: LQ_LOC.GUILD_DOOR,
            op: 'Open',
            near: LQ_TILE.GUILD_DOORS,
            expect: inMainHall
        },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

// Why: one conversation walks all 4 sessions, each choice re-offers the menu until the 4th, which queues the completion.
// Why: the 4 menus are `p_choice4` pages of 3 skills and a link to the next, so reaching a skill off page 1 means taking the link until its page is up.
// Why: every page carries one link, so listing all 4 costs nothing and the chosen skill coming first stops the walk when it arrives.

/** Say yes, then page to the chosen skill and take it. */
function trainingPrefer(): string[] {
    return [
        "Yes, I'll train now.",
        `* ${LegendsConfig.reward} *`,
        '--- Go to Skill Menu 1 ----',
        '--- Go to Skill Menu 2 ----',
        '--- Go to Skill Menu 3 ----',
        '--- Go to Skill Menu 4 ----'
    ];
}

/** Take Radimus' 4 training sessions, which completes the quest. */
export async function takeTraining(log: (m: string) => void): Promise<boolean> {
    if (!(await enterMainHall(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.RADIMUS_HALL, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    const status = await Reach.npcDialog({ name: LQ_NPC.RADIMUS, near: LQ_TILE.RADIMUS_HALL, log });
    if (status !== 'done') {
        log('Radimus Erkle never opened a dialogue in the main hall');
        return false;
    }
    return driveUntil(() => Quests.status(LEGENDS_QUEST) === 'complete', trainingPrefer(), log, 120_000);
}
