import { Paint } from '../../paint/Paint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { Skills } from '../../api/skills/Skills.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { Autocast } from '../../api/magic/Autocast.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { cfg } from './config.js';
import { castsLeft, equippedProjectileCount, foodCount, hpFrac, rangeLoadout, rangeProjectile } from './shared.js';
import type BrimhavenMossGiants from './BrimhavenMossGiants.js';

const XP_SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer'];

export function paintBrimhaven(ctx: CanvasRenderingContext2D, bot: BrimhavenMossGiants): void {
    const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#7ec8a0' });
    p.title(`BrimhavenMossGiants — ${bot.statusText()}`);

    const tab = p.tabs('bmg', ['Overview', 'Loot']);
    if (tab === 'Overview') {
        const mins = (Date.now() - bot.startedAtMs()) / 60_000;
        const xpGained = XP_SKILLS.reduce((n, s) => n + Skills.xp(s), 0) - bot.xpAtStart();
        const xph = mins > 0.5 ? `${((xpGained / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Kills: ${bot.kills()}`, `XP/hr: ${xph}`);
        const rangeAmmo =
            cfg.style === 'range'
                ? `${rangeLoadout().thrown ? 'Darts' : 'Quiver'}: ${equippedProjectileCount() + Inventory.count(rangeProjectile())}`
                : '';
        p.row(
            `Style: ${cfg.style}`,
            cfg.style === 'mage'
                ? `Casts: ${castsLeft()}${Autocast.armed() ? '' : ' (OFF)'}`
                : cfg.style === 'range'
                    ? rangeAmmo
                    : `Food: ${foodCount()}`,
            `Bank trips: ${bot.bankTrips()}`
        );
        p.bar('HP', hpFrac());
    } else {
        p.row(`Looted: ${bot.lootedCount()}`, ...(cfg.buryBones ? [`Buried: ${bot.buriedCount()}`] : []), `Bank trips: ${bot.bankTrips()}`);
        const top = [...bot.lootCounts().entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
        if (top.length === 0) {
            p.text('nothing yet', '#8a919a');
        }
        for (let i = 0; i < top.length; i += 2) {
            p.row(...top.slice(i, i + 2).map(([name, n]) => `${name} × ${n}`));
        }
    }

    p.gap();
    ScriptRunner.paintControls(p);
    p.end();
}
