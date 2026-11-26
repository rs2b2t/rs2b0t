interface NamedEntry {
    name: string;
}

type SavedEntry = NamedEntry & Record<string, unknown>;

function hasName(entry: unknown): entry is SavedEntry {
    return typeof entry === 'object' && entry !== null && 'name' in entry
        && typeof entry.name === 'string' && entry.name.trim().length > 0;
}

export function parseNamedEntries(json: string): SavedEntry[] {
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        return [];
    }
    return Array.isArray(raw) ? raw.filter(hasName) : [];
}

export function upsertNamedEntry<T extends NamedEntry>(entries: readonly T[], entry: T): T[] {
    const index = entries.findIndex(existing => existing.name.toLowerCase() === entry.name.toLowerCase());
    if (index < 0) {
        return [...entries, entry];
    }
    const result = [...entries];
    result[index] = entry;
    return result;
}

export function firstFreeName(entries: readonly NamedEntry[], base: string): string {
    const taken = new Set(entries.map(entry => entry.name.toLowerCase()));
    let candidate = base;
    for (let suffix = 2; taken.has(candidate.toLowerCase()); suffix++) {
        candidate = `${base} ${suffix}`;
    }
    return candidate;
}
