/** Gang the bot joins. The two are mutually exclusive server-side and pick the Heroes' Quest branch. */
export type ArravGang = 'phoenix' | 'blackarm';

export type ArravGangSetting = ArravGang | 'random';

/** Host-set at script start, read at decide time. Built at import, when settings still hold their defaults. */
export const ArravConfig: { gang: ArravGangSetting; partner: string; certTarget: number } = {
    gang: 'random',
    partner: '',
    certTarget: 2
};

// Why: the gang must come out the same on every run of one character, and nothing about the choice is durable between runs.
export function hashName(name: string): number {
    let hash = 0x811c9dc5;
    const norm = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
    for (let i = 0; i < norm.length; i++) {
        hash ^= norm.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

export function resolveGang(setting: ArravGangSetting, playerName: string | null): ArravGang {
    if (setting !== 'random') {
        return setting;
    }
    // Why: the name lands a few ticks after login, and guessing blackarm there commits to a path needing a key no partner has been asked for.
    if (!playerName) {
        return 'phoenix';
    }
    return (hashName(playerName) & 1) === 0 ? 'phoenix' : 'blackarm';
}
