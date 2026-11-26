import { TB_LUBUFU, TB_TAMAYU, TB_TIADECHE, TB_TINSAY } from '#/bot/api/ai/quests/defs/tbwt/areas.js';
import { TB_FLAG } from '#/bot/api/ai/quests/defs/tbwt/journal.js';

export interface ProgressOptions {
    lubufu?: number;
    tiadeche?: number;
    tamayu?: number;
    tinsay?: number;
    agility?: boolean;
    spear?: boolean;
}

export function progressFlags(options: ProgressOptions): Set<string> {
    const flags = new Set<string>([
        `${TB_FLAG.LUBUFU}:${options.lubufu ?? TB_LUBUFU.UNKNOWN}`,
        `${TB_FLAG.TIADECHE}:${options.tiadeche ?? TB_TIADECHE.UNKNOWN}`,
        `${TB_FLAG.TAMAYU}:${options.tamayu ?? TB_TAMAYU.UNKNOWN}`,
        `${TB_FLAG.TINSAY}:${options.tinsay ?? TB_TINSAY.UNKNOWN}`
    ]);
    if (options.agility) {
        flags.add(TB_FLAG.AGILITY);
    }
    if (options.spear) {
        flags.add(TB_FLAG.SPEAR);
    }
    return flags;
}
