import { describe, expect, test } from 'bun:test';
import {
    buildIdentityDefines,
    buildIdentityLabel,
    resolveBuildIdentity,
    writeVersionJson
} from '../../tools/lib/buildIdentity.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('buildIdentity', () => {
    test('env override wins over git and sets short/dirty', () => {
        const prevCommit = process.env.RS2B0T_GIT_COMMIT;
        const prevDirty = process.env.RS2B0T_GIT_DIRTY;
        try {
            process.env.RS2B0T_GIT_COMMIT = 'abcdef0123456789abcdef0123456789abcdef01';
            process.env.RS2B0T_GIT_DIRTY = '1';
            const id = resolveBuildIdentity(() => new Date('2026-08-05T12:00:00.000Z'));
            expect(id.commit).toBe('abcdef0123456789abcdef0123456789abcdef01');
            expect(id.short).toBe('abcdef0');
            expect(id.dirty).toBe(true);
            expect(id.builtAt).toBe('2026-08-05T12:00:00.000Z');
            expect(buildIdentityLabel(id)).toBe('abcdef0-dirty');
        } finally {
            if (prevCommit === undefined) {
                delete process.env.RS2B0T_GIT_COMMIT;
            } else {
                process.env.RS2B0T_GIT_COMMIT = prevCommit;
            }
            if (prevDirty === undefined) {
                delete process.env.RS2B0T_GIT_DIRTY;
            } else {
                process.env.RS2B0T_GIT_DIRTY = prevDirty;
            }
        }
    });

    test('GITHUB_SHA is accepted as a fallback override', () => {
        const prevCommit = process.env.RS2B0T_GIT_COMMIT;
        const prevGh = process.env.GITHUB_SHA;
        const prevDirty = process.env.RS2B0T_GIT_DIRTY;
        try {
            delete process.env.RS2B0T_GIT_COMMIT;
            delete process.env.RS2B0T_GIT_DIRTY;
            process.env.GITHUB_SHA = 'deadbeefcafebabe000000000000000000000000';
            const id = resolveBuildIdentity(() => new Date('2026-01-01T00:00:00.000Z'));
            expect(id.commit.startsWith('deadbeef')).toBe(true);
            expect(id.short).toBe('deadbee');
            expect(id.dirty).toBe(false);
        } finally {
            if (prevCommit === undefined) {
                delete process.env.RS2B0T_GIT_COMMIT;
            } else {
                process.env.RS2B0T_GIT_COMMIT = prevCommit;
            }
            if (prevGh === undefined) {
                delete process.env.GITHUB_SHA;
            } else {
                process.env.GITHUB_SHA = prevGh;
            }
            if (prevDirty === undefined) {
                delete process.env.RS2B0T_GIT_DIRTY;
            } else {
                process.env.RS2B0T_GIT_DIRTY = prevDirty;
            }
        }
    });

    test('define map uses JSON string literals for Bun', () => {
        const id = {
            commit: 'abc1234full',
            short: 'abc1234',
            dirty: false,
            builtAt: 't'
        };
        const def = buildIdentityDefines(id);
        expect(def['process.env.GIT_COMMIT']).toBe('"abc1234full"');
        expect(def['process.env.GIT_COMMIT_SHORT']).toBe('"abc1234"');
        expect(def['process.env.GIT_DIRTY']).toBe('"0"');
        expect(def['process.env.BUILD_TIME']).toBe('"t"');
    });

    test('writeVersionJson is curl-friendly JSON', () => {
        const dir = mkdtempSync(join(tmpdir(), 'rs2b0t-ver-'));
        try {
            const path = join(dir, 'version.json');
            writeVersionJson(path, {
                commit: 'abcdef0123456789',
                short: 'abcdef0',
                dirty: false,
                builtAt: '2026-08-05T00:00:00.000Z'
            });
            const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
                commit: string;
                label: string;
                dirty: boolean;
            };
            expect(parsed.commit).toBe('abcdef0123456789');
            expect(parsed.label).toBe('abcdef0');
            expect(parsed.dirty).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('live git resolve returns a plausible SHA when no override', () => {
        const prevCommit = process.env.RS2B0T_GIT_COMMIT;
        const prevGh = process.env.GITHUB_SHA;
        try {
            delete process.env.RS2B0T_GIT_COMMIT;
            delete process.env.GITHUB_SHA;
            const id = resolveBuildIdentity();
            expect(id.commit.length).toBeGreaterThanOrEqual(7);
            expect(id.short.length).toBeGreaterThanOrEqual(7);
            expect(id.builtAt.length).toBeGreaterThan(10);
        } finally {
            if (prevCommit === undefined) {
                delete process.env.RS2B0T_GIT_COMMIT;
            } else {
                process.env.RS2B0T_GIT_COMMIT = prevCommit;
            }
            if (prevGh === undefined) {
                delete process.env.GITHUB_SHA;
            } else {
                process.env.GITHUB_SHA = prevGh;
            }
        }
    });
});
