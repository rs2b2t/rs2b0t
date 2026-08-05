/**
 * Deploy fingerprint baked in at bundle time (see bot.bundle.ts / bundle.ts).
 * `process.env.*` below are compile-time string literals from Bun `define`.
 */

export type BuildInfo = {
    /** Full 40-char SHA when known. */
    commit: string;
    /** First 7 chars of the SHA. */
    short: string;
    /** True when the tree was dirty at build time. */
    dirty: boolean;
    /** ISO-8601 UTC timestamp of the build. */
    builtAt: string;
    /** Short display label, e.g. `e978193` or `e978193-dirty`. */
    label: string;
};

const commit = process.env.GIT_COMMIT ?? 'unknown';
const short = process.env.GIT_COMMIT_SHORT ?? (commit === 'unknown' ? 'unknown' : commit.slice(0, 7));
const dirty = (process.env.GIT_DIRTY ?? '0') === '1';
const builtAt = process.env.BUILD_TIME ?? '';

export const BUILD_INFO: BuildInfo = {
    commit,
    short,
    dirty,
    builtAt,
    label: dirty ? `${short}-dirty` : short
};

export function formatBuildInfo(info: BuildInfo = BUILD_INFO): string {
    const when = info.builtAt ? ` @ ${info.builtAt}` : '';
    return `${info.label}${when}`;
}
