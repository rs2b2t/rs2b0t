import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export function filesUnder(root: string, ext: string): string[] {
    return (readdirSync(root, { recursive: true }) as string[])
        .filter(f => f.endsWith(ext))
        .map(f => join(root, f))
        .sort();
}

interface Block { id: string; lines: string[] }

export function blocks(text: string): Block[] {
    const out: Block[] = [];
    let cur: Block | null = null;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        const head = /^\[([a-z0-9_]+)\]$/.exec(line);
        if (head) {
            cur = { id: head[1], lines: [] };
            out.push(cur);
        } else if (cur && line.length > 0 && !line.startsWith('//')) {
            cur.lines.push(line);
        }
    }
    return out;
}

export function field(lines: string[], key: string): string | undefined {
    const prefix = `${key}=`;
    return lines.find(l => l.startsWith(prefix))?.slice(prefix.length);
}
