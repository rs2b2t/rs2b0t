/**
 * Resolve the git commit baked into a client/bot bundle.
 *
 * Override with RS2B0T_GIT_COMMIT (full SHA) when the build tree has no .git
 * (CI checkout without history, Docker COPY, etc.). GITHUB_SHA is also accepted.
 * RS2B0T_GIT_DIRTY=1|true forces a dirty flag when the override is used.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

export type BuildIdentity = {
    commit: string;
    short: string;
    dirty: boolean;
    builtAt: string;
};

export function resolveBuildIdentity(now: () => Date = () => new Date()): BuildIdentity {
    const builtAt = now().toISOString();
    const envCommit = (process.env.RS2B0T_GIT_COMMIT ?? process.env.GITHUB_SHA ?? '').trim();
    if (envCommit) {
        const dirty = /^(1|true|yes)$/i.test(process.env.RS2B0T_GIT_DIRTY ?? '');
        return {
            commit: envCommit,
            short: envCommit.slice(0, 7),
            dirty,
            builtAt
        };
    }
    try {
        const commit = execSync('git rev-parse HEAD', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        let dirty = false;
        try {
            dirty =
                execSync('git status --porcelain', {
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore']
                }).trim().length > 0;
        } catch {
            // bare repos / sparse checkouts may lack a worktree
        }
        return {
            commit,
            short: commit.slice(0, 7),
            dirty,
            builtAt
        };
    } catch {
        return { commit: 'unknown', short: 'unknown', dirty: false, builtAt };
    }
}

/** Bun `define` map — string values become compile-time literals. */
export function buildIdentityDefines(identity: BuildIdentity): Record<string, string> {
    return {
        'process.env.BUILD_TIME': JSON.stringify(identity.builtAt),
        'process.env.GIT_COMMIT': JSON.stringify(identity.commit),
        'process.env.GIT_COMMIT_SHORT': JSON.stringify(identity.short),
        'process.env.GIT_DIRTY': JSON.stringify(identity.dirty ? '1' : '0')
    };
}

export function buildIdentityLabel(identity: BuildIdentity): string {
    return identity.dirty ? `${identity.short}-dirty` : identity.short;
}

/** Sidecar for `curl …/rs2b0t/version.json` without parsing the JS bundle. */
export function writeVersionJson(path: string, identity: BuildIdentity): void {
    writeFileSync(
        path,
        `${JSON.stringify(
            {
                commit: identity.commit,
                short: identity.short,
                dirty: identity.dirty,
                builtAt: identity.builtAt,
                label: buildIdentityLabel(identity)
            },
            null,
            2
        )}\n`
    );
}
