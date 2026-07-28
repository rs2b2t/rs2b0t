const REPO_ROOTS = ['src', 'tools', 'test', 'packages', 'templates', 'desktop', 'public-bot'];

export function stripFences(md: string): string {
    let inFence = false;
    return md
        .split('\n')
        .map(line => {
            if (/^\s*```/.test(line)) {
                inFence = !inFence;
                return '';
            }
            return inFence ? '' : line;
        })
        .join('\n');
}

export function slugify(heading: string): string {
    return heading
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, '')
        .replace(/ /g, '-');
}

export function headingAnchors(md: string): string[] {
    const anchors: string[] = [];
    const seen = new Map<string, number>();
    for (const line of stripFences(md).split('\n')) {
        const match = /^#{1,6}\s+(.*?)\s*$/.exec(line);
        if (!match) continue;
        const base = slugify(match[1]);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        anchors.push(n === 0 ? base : `${base}-${n}`);
    }
    return anchors;
}

function withLines(md: string, pattern: RegExp, pick: (m: RegExpMatchArray) => string | null): Array<{ value: string; line: number }> {
    const out: Array<{ value: string; line: number }> = [];
    stripFences(md)
        .split('\n')
        .forEach((text, i) => {
            for (const m of text.matchAll(pattern)) {
                const value = pick(m);
                if (value !== null) out.push({ value, line: i + 1 });
            }
        });
    return out;
}

export function extractLinks(md: string): Array<{ href: string; line: number }> {
    return withLines(md, /\[[^\]]*\]\(([^)\s]+)\)/g, m => (/^(https?:|mailto:)/.test(m[1]) ? null : m[1])).map(({ value, line }) => ({ href: value, line }));
}

export function extractRepoPaths(md: string): Array<{ path: string; line: number }> {
    return withLines(md, /`([^`\s]+)`/g, m => {
        const path = m[1].replace(/\/$/, '');
        if (!REPO_ROOTS.some(root => path.startsWith(`${root}/`))) return null;
        if (!/^[\w./-]+$/.test(path)) return null;
        return path;
    }).map(({ value, line }) => ({ path: value, line }));
}

export function extractPointers(source: string): Array<{ page: string; anchor: string | null; line: number }> {
    const out: Array<{ page: string; anchor: string | null; line: number }> = [];
    source.split('\n').forEach((text, i) => {
        for (const m of text.matchAll(/docs\/([A-Za-z0-9_-]+\.md)(?:#([A-Za-z0-9_-]+))?/g)) {
            out.push({ page: `docs/${m[1]}`, anchor: m[2] ?? null, line: i + 1 });
        }
    });
    return out;
}

export function resolveRelative(fromDoc: string, href: string): string {
    const [pathPart] = href.split('#');
    if (pathPart === '') return fromDoc;
    const dir = fromDoc.includes('/') ? fromDoc.slice(0, fromDoc.lastIndexOf('/')) : '';
    const segments = (dir === '' ? pathPart : `${dir}/${pathPart}`).split('/');
    const resolved: string[] = [];
    for (const segment of segments) {
        if (segment === '..') resolved.pop();
        else if (segment !== '.' && segment !== '') resolved.push(segment);
    }
    return resolved.join('/');
}
