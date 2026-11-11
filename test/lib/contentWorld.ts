import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Glob } from 'bun';

export type NpcConfig = Record<string, string>;
export interface NpcSpawn { id: number; x: number; z: number; level: number }
export const contentRoot = resolve('../rs2b2t-content');
export const hasContentSource = existsSync(`${contentRoot}/pack/npc.pack`);

export function sourceWorld() {
    const configs = new Map<string, NpcConfig>();
    for (const file of new Glob('scripts/**/*.npc').scanSync({ cwd: contentRoot })) {
        for (const block of readFileSync(`${contentRoot}/${file}`, 'utf8').matchAll(/^\[([^\]]+)\]\n(.*?)(?=^\[|$(?![\s\S]))/gms)) {
            const lines = block[2].split('\n');
            const values = Object.fromEntries(lines.filter(line => line.includes('=')).map(line => {
                const index = line.indexOf('=');
                return [line.slice(0, index), line.slice(index + 1)];
            }));
            configs.set(block[1], { ...configs.get(block[1]), ...values, params: lines.filter(line => line.startsWith('param=')).join('\n') });
        }
    }
    const npcs = new Map<number, NpcConfig>();
    for (const line of readFileSync(`${contentRoot}/pack/npc.pack`, 'utf8').split('\n')) {
        const [id, key] = line.split('=');
        if (key) npcs.set(Number(id), { ...configs.get(key), key });
    }
    const spawns: NpcSpawn[] = [];
    for (const file of new Glob('maps/*.jm2').scanSync({ cwd: contentRoot })) {
        const square = /m(\d+)_(\d+)\.jm2/.exec(file)!;
        const section = readFileSync(`${contentRoot}/${file}`, 'utf8').split('==== NPC ====')[1]?.split('====')[0] ?? '';
        for (const match of section.matchAll(/^(\d+) (\d+) (\d+): (\d+)$/gm)) {
            spawns.push({ id: Number(match[4]), x: Number(square[1]) * 64 + Number(match[2]), z: Number(square[2]) * 64 + Number(match[3]), level: Number(match[1]) });
        }
    }
    const attackOverrides = new Set<string>();
    for (const file of new Glob('scripts/**/*.rs2').scanSync({ cwd: contentRoot })) {
        for (const match of readFileSync(`${contentRoot}/${file}`, 'utf8').matchAll(/\[(?:opnpc2|apnpc2),([^\]]+)\]/g)) attackOverrides.add(match[1]);
    }
    return { npcs, spawns, attackOverrides };
}
