import { reader } from '../../adapter/ClientAdapter.js';

/** Stat reads by skill name (names from the client's Skill table). */
export const Skills = {
    /** Skill index by name, -1 if unknown. */
    index(name: string): number {
        const wanted = name.toLowerCase();
        for (let i = 0; i < reader.skillCount(); i++) {
            if (reader.stat(i).name === wanted) {
                return i;
            }
        }

        return -1;
    },

    /** Base (unboosted) level. */
    level(name: string): number {
        const i = Skills.index(name);
        return i === -1 ? 0 : reader.stat(i).base;
    },

    /** Current (boosted/drained) level. */
    effective(name: string): number {
        const i = Skills.index(name);
        return i === -1 ? 0 : reader.stat(i).effective;
    },

    xp(name: string): number {
        const i = Skills.index(name);
        return i === -1 ? 0 : reader.stat(i).xp;
    }
};
