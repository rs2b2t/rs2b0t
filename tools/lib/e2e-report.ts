const ERROR_RE = /\berror\b|\bFAIL\b|\bfailed\b|✗|Cannot\b|not found/i;
/** Stack frames and runtime banners that trail the live message. */
const NOISE_RE = /^\s*at\s|^Bun v\d|^\s*log:\s|coreBundle\.js/;
const CAP = 240;

/** Why: crash logs end with stack frames; prefer the last error lines and fall back to the tail. */
export function errorTail(lines: string[]): string {
    const clean = lines.map(l => l.trim()).filter(Boolean);
    if (clean.length === 0) return '';

    const signal = clean.filter(l => ERROR_RE.test(l) && !NOISE_RE.test(l));
    const picked = signal.length > 0 ? signal.slice(-2) : clean.slice(-3);
    return picked.join(' | ').slice(0, CAP);
}
