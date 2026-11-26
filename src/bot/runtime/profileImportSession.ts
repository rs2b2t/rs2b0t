import { desktopStorage } from './desktopStorage.js';

export const PROFILE_IMPORT_REVISION_KEY = 'rs2b0t:profile-import-revision';

const memoryRevisions = new WeakMap<Storage, Map<string, string>>();

function credentialRevisionKey(key: string): string {
    return 'rs2b0t-profile-import/' + key;
}

export function sessionRevision(key: string): string | null {
    return sessionStorage.getItem(key) ?? memoryRevisions.get(sessionStorage)?.get(key) ?? null;
}

function rememberRevision(key: string, revision: string): void {
    let revisions = memoryRevisions.get(sessionStorage);
    if (!revisions) {
        revisions = new Map();
        memoryRevisions.set(sessionStorage, revisions);
    }
    revisions.set(key, revision);
    sessionStorage.removeItem(key);
}

export function releaseImportMarkers(credentials: string[]): void {
    for (const key of [PROFILE_IMPORT_REVISION_KEY, ...credentials.map(credentialRevisionKey)]) {
        const revision = sessionStorage.getItem(key);
        if (revision !== null) rememberRevision(key, revision);
    }
}

export function setSessionRevision(key: string, revision: string | null): void {
    if (revision === null) sessionStorage.removeItem(key);
    else if (sessionStorage.getItem(key) !== revision) {
        try {
            sessionStorage.setItem(key, revision);
        } catch (error) {
            if (!(error instanceof DOMException && error.name === 'QuotaExceededError')) throw error;
            rememberRevision(key, revision);
            return;
        }
    }
    memoryRevisions.get(sessionStorage)?.delete(key);
}

export function keepSessionCredentials(key: string, revision: string): boolean {
    const written = sessionRevision(credentialRevisionKey(key));
    return written === revision || (written === null && localStorage.getItem(key) === null);
}

export function recordCredentialRevision(key: string, revision?: string | null): void {
    if (desktopStorage || typeof localStorage === 'undefined') return;
    const marker = credentialRevisionKey(key);
    const next = revision === undefined ? localStorage.getItem(PROFILE_IMPORT_REVISION_KEY) ?? '' : revision;
    setSessionRevision(marker, next);
}
