import { Inventory } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';
import type { SkillGain } from '../../paint/levelProgress.js';
import { paintLevels, scriptFrame } from '../../paint/jive.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { KNIFE } from '../../api/acquisition/Tools.js';
import { countLogs } from './carrier.js';

export interface HudState {
    status: string;
    treeName: string;
    locationName: string;
    bankMode: boolean;
    toolAcquire: string;
    mins: number;
    gained: number;
    logsCut: number;
    batches: number;
    misses: number;
    gaps: readonly number[];
    gains: readonly SkillGain[];
}

export function paintTickWoodcutter(ctx: CanvasRenderingContext2D, state: HudState): void {
    const { frame: p, page, section } = scriptFrame(ctx, {
        script: 'TickWoodcutter',
        status: state.status,
        pages: ['Statistics', 'Options'],
        sections: ['Overview', 'Levels'],
        accent: '#8ab4f8',
        byline: 'Woodcutting',
        key: 'tickwoodcutter'
    });
    const xph = state.mins > 0.5 ? Math.round(state.gained / state.mins * 60) : 0;
    const logsPh = state.mins > 0.5 ? Math.round(state.logsCut / state.mins * 60) : 0;

    if (page === 'Options') {
        p.statGrid([
            [{ text: `Tree: ${state.treeName}` }, { text: `Location: ${state.locationName}` }],
            [{ text: `Bank: ${state.bankMode ? 'on' : 'off'}` }, { text: `Acquire: ${state.toolAcquire}` }],
            [{ text: `Carrier logs: ${countLogs()}` }, { text: `Knife: ${Inventory.count(KNIFE)}` }]
        ]);
    } else if (section === 'Levels') {
        paintLevels(p, state.gains, state.mins, 3, 'no woodcutting xp yet');
    } else {
        p.statGrid([
            [{ text: `Runtime: ${fmtDuration(state.mins)}` }, { text: `Woodcutting: ${Skills.level('woodcutting')}` }],
            [{ text: `XP: ${state.gained.toLocaleString()}` }, { text: `XP/hr: ${xph.toLocaleString()}` }],
            [{ text: `Logs: ${state.logsCut.toLocaleString()}` }, { text: `Logs/hr: ${logsPh.toLocaleString()}` }],
            [{ text: `Batches: ${state.batches}` }, { text: `Misses: ${state.misses}` }],
            [{ text: `Gaps: ${state.gaps.slice(-6).join(',') || '—'}` }, { text: `Pack: ${Inventory.used()}/28` }]
        ]);
    }
    p.gap();
    ScriptRunner.paintControls(p);
    p.end();
}
