// rs2b2t rotates its RSA keypair on restart, so the baked modulus can go stale.
// Login response 6 triggers one refresh from /loginkey or the server's client bundle.

const BAKED_MODULUS = process.env.LOGIN_RSAN ?? '';
const EXPONENT = process.env.LOGIN_RSAE ?? '65537';
const CLIENT_BUNDLE = '/client/client.js';

let modulus = BAKED_MODULUS;

export function loginModulus(): bigint {
    return BigInt(modulus);
}

export function loginExponent(): bigint {
    return BigInt(EXPONENT);
}

export function parseLoginModulus(text: string): string | null {
    const match = /^\d{250,}$/.exec(text.trim());
    return match ? match[0] : null;
}

// Keep the plain-text parser strict; minified bundles use this unanchored fallback.
export function extractLoginModulus(text: string): string | null {
    const match = /\d{250,}/.exec(text);
    return match ? match[0] : null;
}

async function readModulus(url: string, extract: (text: string) => string | null): Promise<string | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) {
            return null;
        }

        return extract(await res.text());
    } catch (_e) {
        return null;
    }
}

export async function refreshLoginKey(): Promise<boolean> {
    const next = (await readModulus('/loginkey', parseLoginModulus)) ?? (await readModulus(CLIENT_BUNDLE, extractLoginModulus));
    if (!next || next === modulus) {
        return false;
    }

    modulus = next;
    return true;
}

export function resetLoginKey(): void {
    modulus = BAKED_MODULUS;
}
