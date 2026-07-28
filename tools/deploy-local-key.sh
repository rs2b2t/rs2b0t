#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 ENGINE_DIR" >&2
    exit 1
fi

ENGINE_DIR="$1"
PRIVATE_KEY="$ENGINE_DIR/data/config/private.pem"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$PRIVATE_KEY" ]; then
    echo "ERROR: RSA private key not found:"
    echo "  $PRIVATE_KEY"
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
#
# This engine/OpenSSL version prints:
#
#   publicExponent:
#       <hex bytes>
#
# rather than putting the value on the same line.
E_HEX="$(
    openssl rsa \
        -in "$PRIVATE_KEY" \
        -noout \
        -text |
    awk '
        /^publicExponent:/ {
            found=1
            next
        }

        found {
            line=$0
            gsub(/[ :]/, "", line)

            # Stop at the next named OpenSSL field.
            if ($0 ~ /^[[:space:]]*[a-zA-Z][a-zA-Z ]*:/) {
                exit
            }

            # Keep hexadecimal data only.
            if (line ~ /^[0-9A-Fa-f]+$/) {
                printf "%s", line
            }
        }

        END {
            print ""
        }
    '
)"

if [ -z "$E_HEX" ]; then
    echo "ERROR: Could not extract RSA public exponent." >&2
    echo "Relevant OpenSSL output:" >&2

    openssl rsa \
        -in "$PRIVATE_KEY" \
        -noout \
        -text 2>&1 |
    sed -n '/publicExponent:/,/privateExponent:/p' >&2

    exit 1
fi

LOCAL_RSAE="$(
    bun -e "console.log(BigInt('0x$E_HEX').toString())"
)"

if [ -z "$LOCAL_RSAE" ] || [ -z "$LOCAL_RSAN" ]; then
    echo "ERROR: Failed to convert RSA parameters." >&2
    exit 1
fi

echo "→ RSA key extracted successfully."
echo "→ RSA exponent: $LOCAL_RSAE"
echo "→ RSA modulus:  ${LOCAL_RSAN:0:20}..."

echo "→ Running deploy-local.sh..."

cd "$SCRIPT_DIR/.."

LOCAL_RSAE="$LOCAL_RSAE" \
LOCAL_RSAN="$LOCAL_RSAN" \
ENGINE_DIR="$ENGINE_DIR" \
sh tools/deploy-local.sh
