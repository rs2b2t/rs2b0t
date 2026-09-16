import { Special } from '../../api/combat/Special.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Prayer } from '../../api/prayer/Prayer.js';
import { Skills } from '../../api/skills/Skills.js';
import { jiveFrame, paintLevels, type XpTracker } from '../../paint/jive.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { Member } from './party.js';
import { SIDES, type Phase } from './policy.js';
import type { CombatStats } from './stats.js';
import { doses, FOOD, RECOIL, supplies, worn } from './supply.js';
import { DUELING_RINGS } from './loadout.js';

export interface KqPaint {
    status: string; startedAt: number; kills: number; trip: number; tripKills: number; retreats: number; lastKillMs: number;
    phase: Phase | null; queenHp: number | null; slot: number; stats: CombatStats; xp: XpTracker;
    messages: readonly string[]; roster: readonly string[]; members: Member[]; loot: ReadonlyMap<string, number>;
}

export function paintKq(ctx: CanvasRenderingContext2D, state: KqPaint): void {
    const { frame: p, page, section } = jiveFrame(ctx, {
        script: 'JiveKQ', status: state.status, pages: ['Statistics', 'Team chat', 'Options'], sections: ['Overview', 'Combat', 'Team', 'Supplies', 'Levels', 'Loot']
    });
    const mins = (Date.now() - state.startedAt) / 60_000;
    const held = supplies();
    if (page === 'Team chat') {
        if (!state.messages.length) p.text('Waiting for team messages');
        for (const message of state.messages.slice(-Math.max(0, p.rowsLeft() - 2))) p.text(message);
    } else if (page === 'Options') {
        p.statGrid([
            [{ text: 'Melee: Dragon mace (crush)' }, { text: 'Range: Magic shortbow (rapid)' }],
            [{ text: `Position: ${SIDES[state.slot]}` }, { text: 'Formation: four-point cross' }],
            [{ text: 'Trip: continue while supplied' }, { text: 'Escape: Duel Arena ring' }],
            [{ text: 'DPS: estimated from combat XP' }, { text: 'Recoil damage excluded' }]
        ]);
    } else if (section === 'Overview') {
        p.statGrid([
            [{ text: `Runtime: ${fmtDuration(mins)}` }, { text: `Kills: ${state.kills}` }],
            [{ text: `Kills/hr: ${mins > 0.5 ? (state.kills * 60 / mins).toFixed(1) : 'n/a'}` }, { text: `Trip: ${state.trip} (${state.tripKills} kills)` }],
            [{ text: `Est. DPS: ${state.stats.dps.toFixed(2)}` }, { text: `Food: ${held.food} | Prayer: ${held.prayer}` }]
        ]);
        p.bar(`HP ${held.hp}/${Skills.level('hitpoints')}`, Skills.hpFraction());
    } else if (section === 'Combat') {
        p.statGrid([
            [{ text: `Phase: ${state.phase ?? 'waiting'}` }, { text: `Queen HP: ${state.queenHp ?? '?'}/255` }],
            [{ text: `Est. damage: ${state.stats.damage.toFixed(0)}` }, { text: `Est. DPS: ${state.stats.dps.toFixed(2)}` }],
            [{ text: `Team DPS: ${state.members.reduce((n, m) => n + (m.stats?.dps ?? 0), 0).toFixed(2)}` }, { text: `Last kill: ${state.lastKillMs ? `${(state.lastKillMs / 1000).toFixed(1)}s` : 'n/a'}` }],
            [{ text: `Position: ${SIDES[state.slot]}` }, { text: `Special: ${Math.round(Special.energy() / 10)}%` }]
        ]);
    } else if (section === 'Team') {
        p.statGrid(state.roster.map(name => {
            const member = state.members.find(m => m.name === name);
            return [{ text: `${name}: ${member ? member.ready ? 'ready' : 'wait' : 'offline'}` }, { text: member?.stats ? `HP ${member.stats.hp} P ${member.stats.prayer} F ${member.stats.food} | ${member.stats.dps.toFixed(1)} DPS` : 'offline / waiting' }];
        }));
    } else if (section === 'Supplies') {
        p.statGrid([
            [{ text: `Sharks: ${Inventory.countById(FOOD)}` }, { text: `Arrows: ${held.arrows}` }],
            [{ text: `Prayer: ${Prayer.points()}/${Prayer.max()}` }, { text: `Prayer doses: ${held.prayerDoses}` }],
            [{ text: `Super A/S/D: ${doses('Super attack')}/${doses('Super strength')}/${doses('Super defence')}` }, { text: `Anti: ${doses('Superantipoison')} | Recoils: ${Number(worn(RECOIL)) + Inventory.countById(RECOIL)}` }],
            [{ text: `Ring charges: ${Inventory.items().reduce((n, i) => n + (DUELING_RINGS.includes(i.id) ? 8 - DUELING_RINGS.indexOf(i.id) : 0), 0)}` }, { text: `Ropes: ${Inventory.countById(954)}` }]
        ]);
    } else if (section === 'Levels') {
        paintLevels(p, state.xp.gains(), mins, 2);
    } else if (section === 'Loot') {
        const rows = [...state.loot].sort((a, b) => b[1] - a[1]).slice(0, 4);
        if (!rows.length) p.text('No loot collected yet');
        p.statGrid(rows.map(([name, count]) => [{ text: `${count}x ${name}` }]), 1);
    }
    p.gap();
    ScriptRunner.paintControls(p);
    p.end();
}
