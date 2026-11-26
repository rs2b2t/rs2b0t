import { CLUE_DB } from './data/cluedb.js';
import { CLUE_GATES } from './data/clueGates.js';
import { TALK_ANCHORS } from './data/talkAnchors.js';
import { wildernessLevelAt } from '../../../event/webwalk/wilderness.js';

interface Requirements { quests: string[]; skills: Record<string, number>; wilderness?: boolean }
interface State { levels: Record<string, number>; quests: Record<string, boolean> }

export function clueRequirements(id: number): Requirements {
    const clue = CLUE_DB[id];
    const coord = clue?.coord ?? TALK_ANCHORS[id];
    const quests = CLUE_GATES[id] ? [CLUE_GATES[id].quest] : [];
    const skills: Record<string, number> = {};
    if ([3532, 3534, 3536].includes(id)) quests.push('Legends Quest');
    if (id === 3522) quests.push('Biohazard');
    if ([3526, 3528].includes(id)) skills.agility = 15;
    return { quests, skills, wilderness: !!coord && wildernessLevelAt(coord) > 0 };
}

export function missingClueRequirements(id: number, state: State): Requirements {
    const req = clueRequirements(id);
    return {
        quests: req.quests.filter(quest => !state.quests[quest]),
        skills: Object.fromEntries(Object.entries(req.skills).filter(([skill, level]) => (state.levels[skill] ?? 1) < level))
    };
}
