import type { Case, Level, ScriptName, Subsystem } from './manifestTypes.js';

export function casesForScript(cases: readonly Case[], script: ScriptName): Case[] {
    return cases.filter(c => c.covers.scripts?.includes(script));
}

export function casesForSubsystem(cases: readonly Case[], subsystem: Subsystem): Case[] {
    return cases.filter(c => c.covers.subsystems?.includes(subsystem));
}

const runnable = (cases: readonly Case[]): Case[] =>
    cases.filter(c => c.manual !== true && c.status !== 'broken');

export function casesForLevel(cases: readonly Case[], level: Level): Case[] {
    const open = runnable(cases);
    return level === 'full' ? open : open.filter(c => c.status === 'vetted');
}

/** Cases a level would run once every documented case has been confirmed green. */
export function casesForLevelIncludingDocumented(cases: readonly Case[]): Case[] {
    return runnable(cases).filter(c => c.status === 'vetted' || c.status === 'documented');
}

/** Which subsystem a changed path belongs to, or null when it names none. */
function subsystemOf(path: string): Subsystem | null {
    if (path.startsWith('src/bot/event/webwalk/')) {
        return 'nav';
    }
    if (path.startsWith('src/bot/multibox/')) {
        return 'multibox';
    }
    if (path.startsWith('src/bot/api/ai/clues/')) {
        return 'clues';
    }
    if (path.startsWith('src/bot/panel/')) {
        return 'panel';
    }
    if (path.startsWith('src/bot/api/ai/quests/')) {
        return 'quests';
    }
    return null;
}

/** Shared trees select everything; otherwise a change selects the cases covering what it touched. */
export function selectByChanges(
    cases: readonly Case[],
    changed: readonly string[]
): { cases: Case[]; why: string } {
    if (changed.length === 0) {
        return { cases: [], why: 'no changes against main' };
    }
    const open = runnable(cases);
    if (changed.some(c => /^src\/bot\/(adapter|runtime|api)\//.test(c) || c === 'package.json')) {
        return { cases: open, why: 'shared code changed (adapter, runtime or api) — everything is reachable' };
    }
    const scripts = new Set<string>();
    const subsystems = new Set<Subsystem>();
    for (const path of changed) {
        const m = /^src\/bot\/scripts\/([A-Za-z0-9_]+)\//.exec(path);
        if (m) {
            scripts.add(m[1]);
        }
        const sub = subsystemOf(path);
        if (sub !== null) {
            subsystems.add(sub);
        }
    }
    const picked = open.filter(c =>
        c.covers.scripts?.some(s => scripts.has(s)) === true
        || c.covers.subsystems?.some(s => subsystems.has(s)) === true);
    return { cases: picked, why: `${changed.length} changed files matched ${picked.length} cases` };
}

/** One message per violation; empty when the manifest and the tree agree. */
export function validate(
    cases: readonly Case[],
    harnessFiles: readonly string[],
    scriptDirs: readonly string[]
): string[] {
    const problems: string[] = [];
    const seen = new Set<string>();
    const files = new Set(harnessFiles);
    const dirs = new Set<string>(scriptDirs);
    for (const c of cases) {
        if (seen.has(c.id)) {
            problems.push(`duplicate case id: ${c.id}`);
        }
        seen.add(c.id);
        if (!files.has(c.harness)) {
            problems.push(`${c.id}: no such harness: ${c.harness}`);
        }
        for (const s of c.covers.scripts ?? []) {
            if (!dirs.has(s)) {
                problems.push(`${c.id}: no such script: ${s}`);
            }
        }
        if ((c.covers.scripts?.length ?? 0) === 0 && (c.covers.subsystems?.length ?? 0) === 0) {
            problems.push(`${c.id}: covers no script or subsystem`);
        }
        if (c.status === 'vetted' && c.provenAt === undefined) {
            problems.push(`${c.id}: vetted but carries no provenAt`);
        }
        if (c.status === 'documented' && c.documentedIn === undefined) {
            problems.push(`${c.id}: documented but carries no documentedIn`);
        }
    }
    const named = new Set(cases.map(c => c.harness));
    for (const f of harnessFiles) {
        if (!named.has(f)) {
            problems.push(`no case names harness: ${f}`);
        }
    }
    return problems.sort();
}
