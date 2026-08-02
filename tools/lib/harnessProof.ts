/**
 * Shared live-harness proof artifacts: success/baseline screenshots + JSON
 * proof files (pattern used by tools/shantay-pass-route-test.ts / issue #182).
 *
 * Usage:
 *   const proof = createHarnessProof({ issue: 285, slug: 'edgeville-exit' });
 *   // after success:
 *   await proof.writeSuccess(page, { ...payload });
 *   // baseline fail repro (e.g. --expect-unreachable):
 *   await proof.writeBaseline(page, { ...payload });
 *   // on throw:
 *   await proof.writeFailure(page).catch(() => undefined);
 */
import { mkdir } from 'node:fs/promises';
import type { Page } from 'playwright-core';

export type HarnessProofMode = 'fixed' | 'baseline' | 'failure';

export interface HarnessProofPaths {
    /** Success / fixed-path screenshot. */
    successScreenshot: string;
    /** Baseline / expected-unreachable screenshot. */
    baselineScreenshot: string;
    /** Failure screenshot. */
    failureScreenshot: string;
    successProof: string;
    baselineProof: string;
}

export interface CreateHarnessProofOpts {
    /** GitHub issue number when applicable. */
    issue?: number;
    /** Short slug, e.g. edgeville-exit, shantay-varrock. */
    slug: string;
    /** Override default directories. */
    screenshotDir?: string;
    proofDir?: string;
}

export interface HarnessProof {
    paths: HarnessProofPaths;
    ensureDirs(): Promise<void>;
    writeSuccess(page: Page, body: Record<string, unknown>): Promise<void>;
    writeBaseline(page: Page, body: Record<string, unknown>): Promise<void>;
    writeFailure(page: Page | null, body?: Record<string, unknown>): Promise<void>;
}

function issuePrefix(issue?: number): string {
    return issue !== undefined ? `issue${issue}-` : '';
}

export function createHarnessProof(opts: CreateHarnessProofOpts): HarnessProof {
    const shotDir = opts.screenshotDir ?? 'screenshots';
    const proofDir = opts.proofDir ?? 'out';
    const p = issuePrefix(opts.issue);
    const slug = opts.slug.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();

    const paths: HarnessProofPaths = {
        successScreenshot: `${shotDir}/${p}${slug}-success.png`,
        baselineScreenshot: `${shotDir}/${p}${slug}-baseline-unreachable.png`,
        failureScreenshot: `${shotDir}/${p}${slug}-failure.png`,
        successProof: `${proofDir}/${p}${slug}-proof.json`,
        baselineProof: `${proofDir}/${p}${slug}-baseline-proof.json`
    };

    async function ensureDirs(): Promise<void> {
        await mkdir(shotDir, { recursive: true });
        await mkdir(proofDir, { recursive: true });
    }

    async function write(
        page: Page | null,
        mode: HarnessProofMode,
        body: Record<string, unknown>
    ): Promise<void> {
        await ensureDirs();
        const screenshot =
            mode === 'fixed'
                ? paths.successScreenshot
                : mode === 'baseline'
                  ? paths.baselineScreenshot
                  : paths.failureScreenshot;
        const proofFile = mode === 'baseline' ? paths.baselineProof : paths.successProof;
        if (page) {
            await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
        }
        if (mode !== 'failure') {
            await Bun.write(
                proofFile,
                `${JSON.stringify(
                    {
                        generatedAt: new Date().toISOString(),
                        mode,
                        result: mode === 'baseline' ? 'EXPECTED_UNREACHABLE' : 'PASS',
                        screenshot,
                        ...body
                    },
                    null,
                    2
                )}\n`
            );
        }
        console.log(
            mode === 'failure'
                ? `screenshot=${screenshot}`
                : `proof=${proofFile} screenshot=${screenshot}` +
                      (typeof body.total === 'number' ? ` results=${body.total}` : '')
        );
    }

    return {
        paths,
        ensureDirs,
        writeSuccess: (page, body) => write(page, 'fixed', body),
        writeBaseline: (page, body) => write(page, 'baseline', body),
        writeFailure: (page, body = {}) => write(page, 'failure', body)
    };
}
