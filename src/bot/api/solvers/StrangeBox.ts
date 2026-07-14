// Strange-box puzzle solver. Server truth (rs2b2t-content 'macro events'
// macro_event_strange_box.rs2): the box asks "What colour is the <Shape>?"
// or "Which shape is <Colour>?"; the three spinning models are set via
// IF_SETOBJECT so their obj ids are readable client-side; answer buttons are
// ordered center/side/top matching the model components. Wrong answers (and
// slow solving) REPLICATE the box, so it must be solved promptly + correctly.
// All ids from rs2b2t-content/pack — guarded at runtime by the modal-root check.

import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../Execution.js';
import { Inventory } from '../hud/Inventory.js';

export const CUBE_IF = {
    root: 6554,
    models: [6555, 6557, 6559] as const, // center, side, top
    question: 6561,
    buttons: [6562, 6563, 6564] as const // answer_button1..3 (center/side/top)
};

export const CUBE_PARTS: Record<number, { shape: string; colour: string }> = {
    3063: { shape: 'Triangle', colour: 'Red' },
    3065: { shape: 'Triangle', colour: 'Blue' },
    3067: { shape: 'Triangle', colour: 'Yellow' },
    3069: { shape: 'Square', colour: 'Red' },
    3071: { shape: 'Square', colour: 'Blue' },
    3073: { shape: 'Square', colour: 'Yellow' },
    3075: { shape: 'Circle', colour: 'Red' },
    3077: { shape: 'Circle', colour: 'Blue' },
    3079: { shape: 'Circle', colour: 'Yellow' },
    3081: { shape: 'Star', colour: 'Red' },
    3083: { shape: 'Star', colour: 'Blue' },
    3085: { shape: 'Star', colour: 'Yellow' },
    3087: { shape: 'Half Moon', colour: 'Red' },
    3089: { shape: 'Half Moon', colour: 'Blue' },
    3091: { shape: 'Half Moon', colour: 'Yellow' }
};

/** Answer index (0=center,1=side,2=top) for the current puzzle, or null. */
export function solveCube(question: string, models: [number | null, number | null, number | null]): number | null {
    const parts = models.map(id => (id !== null ? (CUBE_PARTS[id] ?? null) : null));
    if (parts.some(p => p === null)) {
        return null;
    }

    const colourQ = /what colour is the (.+)\?/i.exec(question);
    if (colourQ) {
        const shape = colourQ[1].trim().toLowerCase();
        const idx = parts.findIndex(p => p!.shape.toLowerCase() === shape);
        return idx === -1 ? null : idx;
    }

    const shapeQ = /which shape is (.+)\?/i.exec(question);
    if (shapeQ) {
        const colour = shapeQ[1].trim().toLowerCase();
        const idx = parts.findIndex(p => p!.colour.toLowerCase() === colour);
        return idx === -1 ? null : idx;
    }

    return null;
}

// Genie lamp (obj 2528 'Lamp', opheld1 'Rub' → xplamp interface).
export const LAMP_IF = {
    root: 2808,
    confirm: 2831,
    skills: {
        attack: 2812,
        strength: 2813,
        ranged: 2814,
        magic: 2815,
        defence: 2816,
        hitpoints: 2817,
        prayer: 2818,
        agility: 2819,
        herblore: 2820,
        thieving: 2821,
        crafting: 2822,
        runecraft: 2823,
        mining: 2824,
        smithing: 2825,
        fishing: 2826,
        cooking: 2827,
        firemaking: 2828,
        woodcutting: 2829,
        fletching: 2830
    } as Record<string, number>
};

export async function solveAllBoxes(log: (msg: string) => void): Promise<boolean> {
    // Each Strange box is its OWN cube puzzle, solved one at a time, and the
    // reward only lands once EVERY box is gone (the server inv_del's one per
    // correct answer). Unsolved boxes REPLICATE until they fill the pack — so
    // solve them ALL in this single pass. (Solving one per handle() call let
    // the generic MAX_ATTEMPTS backstop give up after 4 boxes — the attempt
    // counter never resets while more boxes remain — and the rest replicated.)
    let solved = 0;
    for (let i = 0; i < 30 && Inventory.contains('Strange box'); i++) {
        const box = Inventory.first('Strange box');
        if (!box) {
            break;
        }
        const before = Inventory.count('Strange box');
        await box.interact('Open');
        if (!(await Execution.delayUntil(() => reader.modals().main === CUBE_IF.root, 5000))) {
            log('random event: strange box interface did not open');
            return solved > 0;
        }

        const question = reader.ifText(CUBE_IF.question) ?? '';
        const models: [number | null, number | null, number | null] = [reader.ifModelObjId(CUBE_IF.models[0]), reader.ifModelObjId(CUBE_IF.models[1]), reader.ifModelObjId(CUBE_IF.models[2])];
        const answer = solveCube(question, models);
        if (answer === null) {
            log(`random event: could not solve strange box ('${question}' models=${models}) — closing`);
            actions.closeModal();
            return solved > 0;
        }

        actions.ifButton(CUBE_IF.buttons[answer]);
        if (!(await Execution.delayUntil(() => Inventory.count('Strange box') < before, 4000))) {
            log('random event: strange box answer did not consume a box');
            return solved > 0;
        }
        solved++;
    }
    log(`random event: solved ${solved} strange box${solved === 1 ? '' : 'es'}`);
    return solved > 0;
}

/** Rub a reward Lamp and put the xp on `lampSkill` (falls back to strength). */
export async function rubLamp(lampSkill: string, log: (msg: string) => void): Promise<boolean> {
    const lamp = Inventory.first('Lamp');
    if (!lamp) {
        return false;
    }

    await lamp.interact('Rub');
    if (!(await Execution.delayUntil(() => reader.modals().main === LAMP_IF.root, 5000))) {
        log('random event: lamp interface did not open');
        return false;
    }

    const skillCom = LAMP_IF.skills[lampSkill.toLowerCase()] ?? LAMP_IF.skills.strength;
    actions.ifButton(skillCom);
    await Execution.delayTicks(1);
    actions.ifButton(LAMP_IF.confirm);
    const used = await Execution.delayUntil(() => !Inventory.contains('Lamp'), 4000);
    log(used ? `random event: rubbed lamp (+xp ${lampSkill})` : 'random event: lamp did not consume');
    return true;
}
