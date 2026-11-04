import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blocks, field, filesUnder } from '../lib/content.js';

export const MONSTERS = ['hellhound', 'greater_demon', 'blue_dragon', 'red_dragon', 'bronze_dragon', 'iron_dragon', 'steel_dragon', 'black_dragon'];
export interface DropEntry { id: number; obj: string; label: string; noteIds: number[]; sources: string[]; default: boolean; priority: number }

export function buildCatalog(content: string): { entries: DropEntry[]; hash: string } {
    const packText = readFileSync(join(content, 'pack/obj.pack'), 'utf8');
    const ids = new Map(packText.trim().split('\n').map(line => { const [id, name] = line.split('='); return [name, Number(id)] as const; }));
    const names = new Map<string, string>();
    const deathDrops = new Map<string, string>();
    const files = filesUnder(join(content, 'scripts'), '.obj');
    for (const file of [...files.filter(file => file.includes('/_unpack/')), ...files.filter(file => !file.includes('/_unpack/'))]) {
        for (const block of blocks(readFileSync(file, 'utf8'))) {
            const name = field(block.lines, 'name');
            if (name) names.set(block.id, name);
        }
    }
    const digest = createHash('sha256').update(packText);
    let defaultDrop = '';
    for (const file of filesUnder(join(content, 'scripts'), '.param')) {
        const block = blocks(readFileSync(file, 'utf8')).find(block => block.id === 'death_drop');
        if (block) { defaultDrop = field(block.lines, 'default') ?? ''; digest.update(block.lines.join('\n')); }
    }
    for (const file of filesUnder(join(content, 'scripts'), '.npc')) {
        for (const block of blocks(readFileSync(file, 'utf8'))) {
            if (!MONSTERS.includes(block.id)) continue;
            const drop = block.lines.find(line => line.startsWith('param=death_drop,'))?.split(',')[1];
            if (drop) deathDrops.set(block.id, drop);
            digest.update(block.id + '\n' + block.lines.join('\n'));
        }
    }
    const scripts = new Map<string, string>();
    for (const name of [...MONSTERS, 'shared_droptables']) {
        const text = readFileSync(join(content, 'scripts/drop tables/scripts', `${name}.rs2`), 'utf8');
        digest.update(text);
        for (const match of text.matchAll(/^\[(\w+),(\w+)\][^\n]*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gm)) scripts.set(`${match[1]}:${match[2]}`, match[3]);
    }
    const entries = new Map<number, DropEntry>();
    const expand = (key: string, monster: string, seen: Set<string>): void => {
        if (seen.has(key)) return;
        seen.add(key);
        const body = scripts.get(key);
        if (!body) throw new Error(`Missing drop helper ${key}`);
        const tokens = [
            ...body.matchAll(/obj_add\s*\(\s*npc_coord\s*,\s*(~?[a-z0-9_]+)/g),
            ...body.matchAll(/return\s*\(\s*(~?[a-z0-9_]+)/g),
            ...body.matchAll(/=\s*([a-z][a-z0-9_]*)\s*;/g)
        ].map(match => match[1]);
        for (let obj of tokens) {
            if (obj.startsWith('~')) { expand(`proc:${obj.slice(1)}`, monster, seen); continue; }
            if (obj === 'npc_param') obj = deathDrops.get(monster) ?? defaultDrop;
            if (obj.startsWith('cert_')) obj = obj.slice(5);
            const id = ids.get(obj);
            if (id === undefined || !names.has(obj)) continue;
            let entry = entries.get(id);
            if (!entry) {
                const note = ids.get(`cert_${obj}`);
                const label = obj.startsWith('unidentified_') ? `Unidentified ${obj.slice(13).replaceAll('_', ' ')}`
                    : obj === 'keyhalf1' || obj === 'keyhalf2' ? `Half of a key (${id})`
                        : obj.startsWith('dragonhide_') ? `${obj.slice(11)} dragonhide`.replace(/^./, char => char.toUpperCase()) : names.get(obj)!;
                const keep = /^(coins|rune_|adamant_(2h_sword|axe|battleaxe|full_helm|kiteshield|platebody|platelegs|sq_shield|ore)|dragon_(platelegs|med_helm|spear)|shield_left_half|uncut_|dragonstone|keyhalf|chaos_talisman|nature_talisman|gold_bar|adamantite_bar|runite_bar|silver_ore)/.test(obj)
                    || /rune$/.test(obj) || obj.startsWith('dragonhide_') || ['dragonshield_a', 'adamantite_ore'].includes(obj)
                    || /^unidentified_/.test(obj) && !['unidentified_guam', 'unidentified_marentill', 'unidentified_tarromin'].includes(obj)
                    || ['3dose2attack', '1dose2strength', '2dose2defense'].includes(obj);
                entry = { id, obj, label, noteIds: note === undefined ? [] : [note], sources: [], default: keep, priority: /^(dragon_(platelegs|med_helm|spear)|dragonshield_a)/.test(obj) ? 10 : obj.startsWith('dragonhide_') ? 30 : keep ? 20 : 50 };
                entries.set(id, entry);
            }
            if (!entry.sources.includes(monster)) entry.sources.push(monster);
        }
    };
    for (const monster of MONSTERS) expand(`ai_queue3:${monster}`, monster, new Set());
    return { entries: [...entries.values()].sort((a, b) => a.id - b.id), hash: digest.digest('hex') };
}
