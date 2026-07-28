#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 ENGINE_DIR" >&2
    exit 1
fi

ENGINE_DIR="$1"
PRIVATE_KEY="$ENGINE_DIR/data/config/private.pem"

if [ ! -f "$PRIVATE_KEY" ]; then
    echo "ERROR: RSA private key not found:" >&2
    echo "  $PRIVATE_KEY" >&2
    exit 1
fi

command -v openssl >/dev/null 2>&1 || {
    echo "ERROR: openssl is required." >&2
    exit 1
}

command -v bun >/dev/null 2>&1 || {
    echo "ERROR: bun is required." >&2
    exit 1
}

echo "→ Extracting RSA key from:"
echo "  $PRIVATE_KEY"

# Extract modulus.
MODULUS_HEX="$(
    openssl rsa \
        -in "$PRIVATE_KEY" \
        -noout \
        -modulus |
    sed 's/^Modulus=//'
)"

if [ -z "$MODULUS_HEX" ]; then
    echo "ERROR: Could not extract RSA modulus." >&2
    exit 1
fi

LOCAL_RSAN="$(
    bun -e "console.log(BigInt('0x$MODULUS_HEX').toString())"
)"

# Extract public exponent.
# OpenSSL 3.x prints:  publicExponent: 65537 (0x10001)         (single line)
# Older / LibreSSL:    publicExponent:\n    <hex bytes>        (multi line)
LOCAL_RSAE="$(
    openssl rsa -in "$PRIVATE_KEY" -noout -text \
    | sed -n 's/^publicExponent: \([0-9][0-9]*\).*/\1/p'
)"

if [ -z "$LOCAL_RSAE" ]; then
    # Fallback: multi-line hex format (older OpenSSL / LibreSSL)
    E_HEX="$(
        openssl rsa -in "$PRIVATE_KEY" -noout -text |
        awk '
            /^publicExponent:/ { found=1; next }
            found {
                line=$0; gsub(/[ :]/, "", line)
                if ($0 ~ /^[[:space:]]*[a-zA-Z][a-zA-Z ]*:/) exit
                if (line ~ /^[0-9A-Fa-f]+$/) printf "%s", line
            }
            END { print "" }
        '
    )"
    if [ -n "$E_HEX" ]; then
        LOCAL_RSAE="$(bun -e "console.log(BigInt('0x$E_HEX').toString())")"
    fi
fi

if [ -z "$LOCAL_RSAE" ]; then
    echo "ERROR: Could not extract RSA public exponent." >&2
    echo "Relevant OpenSSL output:" >&2

    openssl rsa \
        -in "$PRIVATE_KEY" \
        -noout \
        -text 2>&1 |
    sed -n '/publicExponent:/,/privateExponent:/p' >&2

    exit 1
fi

if [ -z "$LOCAL_RSAE" ] || [ -z "$LOCAL_RSAN" ]; then
    echo "ERROR: Failed to convert RSA parameters." >&2
    exit 1
fi

echo "→ RSA key extracted successfully."
echo "→ RSA exponent: $LOCAL_RSAE"
echo "→ RSA modulus:  $LOCAL_RSAN..."

echo "→ Running deploy-local.sh..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

LOCAL_RSAE="$LOCAL_RSAE" \
LOCAL_RSAN="$LOCAL_RSAN" \
ENGINE_DIR="$ENGINE_DIR" \
sh "$PROJECT_ROOT/tools/deploy-local.sh"
