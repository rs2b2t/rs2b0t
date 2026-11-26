import JString from '../../client/datastruct/JString.js';

export function normalizeUsername(username: string): string {
    const hash = JString.toUserhash(username);
    return hash === 0n ? '' : JString.toRawUsername(hash);
}

export function indexSavedProfiles<T extends { username: string }>(profiles: T[]) {
    const exact = new Map<string, T>();
    const byIdentity = new Map<string, T>();
    for (const profile of profiles) {
        if (!exact.has(profile.username)) exact.set(profile.username, profile);
        const identity = normalizeUsername(profile.username);
        if (identity && !byIdentity.has(identity)) byIdentity.set(identity, profile);
    }
    return {
        byIdentity,
        find: (username: string) => exact.get(username) ?? byIdentity.get(normalizeUsername(username))
    };
}
