import { reader } from '../../adapter/ClientAdapter.js';

export const Skills = {
    index(name: string): number {
        const wanted = name.toLowerCase();
        for (let i = 0; i < reader.skillCount(); i++) {
            if (reader.stat(i).name === wanted) {
                return i;
            }
        }

        return -1;
    },

    level(name: string): number {
        const i = Skills.index(name);
        return i === -1 ? 0 : reader.stat(i).base;
    },

    effective(name: string): number {
        const i = Skills.index(name);
        return i === -1 ? 0 : reader.stat(i).effective;
    },

    xp(name: string): number {
        const i = Skills.index(name);
        return i === -1 ? 0 : reader.stat(i).xp;
    },

    hpFraction(): number {
        const base = Skills.level('hitpoints');
        return base > 0 ? Skills.effective('hitpoints') / base : 1;
    }
};
