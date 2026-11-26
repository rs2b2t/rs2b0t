import { desktopStorage } from './desktopStorage.js';

export const PROFILE_IMPORT_REVISION_KEY = 'rs2b0t:profile-import-revision';

function credentialRevisionKey(key: string): string {
    return 'rs2b0t-profile-import/' + key;
}

export function keepSessionCredentials(key: string, revision: string): boolean {
    const written = sessionStorage.getItem(credentialRevisionKey(key));
    return written === revision || (written === null && localStorage.getItem(key) === null);
}

export function recordCredentialRevision(key: string, revision?: string | null): void {
    if (desktopStorage || typeof localStorage === 'undefined') return;
    const marker = credentialRevisionKey(key);
    const next = revision === undefined ? localStorage.getItem(PROFILE_IMPORT_REVISION_KEY) ?? '' : revision;
    if (sessionStorage.getItem(marker) === next) return;
    if (next === null) sessionStorage.removeItem(marker);
    else sessionStorage.setItem(marker, next);
}
