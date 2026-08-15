// docs/how-to/e2e-suite.md — report helpers for tools/e2e.ts
const ERROR_RE = /\berror\b|\bFAIL\b|\bfailed\b|✗|Cannot\b|not found/i;
/** Stack frames and runtime banners follow the live message; they are never the message. */
const NOISE_RE = /^\s*at\s|^Bun v\d|^\s*log:\s|coreBundle\.js/;
const CAP = 240;

/** The most informative few lines of a child's output.
 *  Why: the last three lines of a crash are the stack footer, not the cause, so prefer the last line that reads like an error and fall back to the tail only when nothing does. */
export function errorTail(lines: string[]): string {
    const clean = lines.map(l => l.trim()).filter(Boolean);
    if (clean.length === 0) return '';

    const signal = clean.filter(l => ERROR_RE.test(l) && !NOISE_RE.test(l));
    const picked = signal.length > 0 ? signal.slice(-2) : clean.slice(-3);
    return picked.join(' | ').slice(0, CAP);
}
