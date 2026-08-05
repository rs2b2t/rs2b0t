import type { QuestEligibility } from './types.js';

/** Stable fingerprint of an eligibility pass — used to suppress no-op log spam. */
export function eligibilityReportKey(results: readonly QuestEligibility[], banner: string): string {
    if (banner) {
        return `banner:${banner}`;
    }
    let ready = 0;
    let blocked = 0;
    let done = 0;
    const readyNames: string[] = [];
    for (const r of results) {
        if (r.status === 'READY') {
            ready++;
            readyNames.push(r.name);
        } else if (r.status === 'BLOCKED') {
            blocked++;
        } else {
            done++;
        }
    }
    readyNames.sort();
    return `${ready}|${blocked}|${done}|${readyNames.join('\0')}`;
}
