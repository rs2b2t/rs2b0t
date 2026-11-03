import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { blocks, field, filesUnder } from '../lib/content.js';

export function generateEquipment(content: string): string {
    const pack = readFileSync(join(content, 'pack/obj.pack'), 'utf8');
    const ids = new Map(pack.trim().split('\n').map(line => { const [id, obj] = line.split('='); return [obj, Number(id)] as const; }));
    const digest = createHash('sha256').update(pack);
    const read = (path: string): string => { const text = readFileSync(join(content, path), 'utf8'); digest.update(text); return text; };
    const defaults = new Map(blocks(read('scripts/skill_combat/configs/combat.param')).map(block => [block.id, Number(field(block.lines, 'default'))]));
    const categories = new Map(blocks(read('scripts/skill_combat/configs/combat.dbrow')).map(block => [block.id.replace(/_table$/, ''), block.lines]));
    const requirements = new Map<string, { attackLevel: number; quests: string[] }>();
    for (const file of filesUnder(join(content, 'scripts/levelrequire/scripts'), '.rs2')) {
        const text = readFileSync(file, 'utf8');
        digest.update(text);
        for (const match of text.matchAll(/\[opheld2,([a-z0-9_]+)\]\s*@levelrequire_([a-z_]*attack[a-z_]*)\((\d+),/g)) {
            const handler = match[2];
            requirements.set(match[1], { attackLevel: Number(match[3]), quests: handler.includes('zanaris_quest') ? ['Lost City'] : handler.includes('heroes_quest') ? ["Heroes' Quest"] : [] });
        }
    }
    const configs = new Map<string, string[]>();
    const files = filesUnder(join(content, 'scripts'), '.obj');
    for (const file of [...files.filter(file => file.includes('/_unpack/')), ...files.filter(file => !file.includes('/_unpack/'))]) {
        for (const block of blocks(readFileSync(file, 'utf8'))) {
            if (!/^(bronze|iron|steel|black|mithril|adamant|rune|dragon)_(scimitar|longsword|sword|battleaxe|mace|dagger(?:_p)?|warhammer|axe)$/.test(block.id)) continue;
            digest.update(block.id + '\n' + block.lines.join('\n'));
            configs.set(block.id, [...(configs.get(block.id) ?? []), ...block.lines]);
        }
    }
    const entries = [...configs].map(([obj, lines]) => {
        const values = new Map(lines.map(line => { const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)] as const; }));
        const params = new Map(lines.filter(line => line.startsWith('param=')).map(line => { const [key, value] = line.slice(6).split(','); return [key, Number(value)] as const; }));
        const stat = (name: string): number => params.get(name) ?? defaults.get(name) ?? 0;
        const category = values.get('category') ?? '';
        const table = categories.get(category);
        if (!table || values.get('wearpos') !== 'righthand' || lines.includes('wearpos2=lefthand')) throw new Error(`Unsupported one-handed weapon config: ${obj}`);
        const types = table.filter(line => line.startsWith('data=damagetype,')).map(line => line.split(',')[1].replace(/^\^|_style$/g, ''));
        const styles = table.filter(line => line.startsWith('data=damagestyle,')).map(line => line.split(',')[1].replace('^style_melee_', ''));
        if (types.length !== styles.length || types.some(type => !['stab', 'slash', 'crush'].includes(type))) throw new Error(`Unsupported combat modes for ${obj}`);
        const modes = types.map((type, mode) => ({ mode, type, attackLevelBonus: styles[mode] === 'accurate' ? 3 : styles[mode] === 'controlled' ? 1 : 0, strengthLevelBonus: styles[mode] === 'aggressive' ? 3 : styles[mode] === 'controlled' ? 1 : 0, defenceLevelBonus: styles[mode] === 'defensive' ? 3 : styles[mode] === 'controlled' ? 1 : 0 }));
        const id = ids.get(obj);
        if (id === undefined) throw new Error(`Missing pack ID for ${obj}`);
        return { id, name: values.get('name')!, attack: { stab: stat('stabattack'), slash: stat('slashattack'), crush: stat('crushattack') }, strengthBonus: stat('strengthbonus'), attackRate: stat('attackrate'), ...(requirements.get(obj) ?? { attackLevel: 1, quests: [] }), modes };
    }).sort((a, b) => a.id - b.id);
    return `/* eslint-disable */
export interface WeaponStats {
    id: number;
    name: string;
    attack: { stab: number; slash: number; crush: number };
    strengthBonus: number;
    attackRate: number;
    attackLevel: number;
    quests: string[];
    modes: { mode: number; type: 'stab' | 'slash' | 'crush'; attackLevelBonus: number; strengthLevelBonus: number; defenceLevelBonus: number }[];
}
export const EQUIPMENT_SOURCE_HASH = ${JSON.stringify(digest.digest('hex'))};
export const WEAPON_STATS: Record<number, WeaponStats> = {
${entries.map(entry => `    ${entry.id}: ${JSON.stringify(entry)}`).join(',\n')}
};
`;
}

if (import.meta.main) {
    const content = process.env.CONTENT_DIR;
    if (!content) throw new Error('Set CONTENT_DIR to the revision 289 content checkout');
    const output = 'src/bot/scripts/JiveTT/equipmentData.ts';
    const generated = generateEquipment(content);
    if (process.argv.includes('--check')) {
        if (readFileSync(output, 'utf8') !== generated) throw new Error(`${output} differs from the content weapon configs`);
        console.log('Verified JiveTT weapon stats, modes and requirements');
    } else { writeFileSync(output, generated); console.log(`Wrote ${output}`); }
}
