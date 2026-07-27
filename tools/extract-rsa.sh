#!/bin/sh
# Extract RSA keys from engine's client.js and update .env
# Run this before deploy-local.sh when the engine's client.js has been updated
# Usage: ENGINE_DIR=../Server/engine CONTENT_DIR=../Server/content sh tools/extract-rsa.sh

set -e

SCRIPT_DIR="$(dirname "$0")"
PROJECT_ROOT="$SCRIPT_DIR/.."

# Auto-detect ENGINE_DIR from .env if not set
if [ -z "${ENGINE_DIR}" ] && [ -f "$PROJECT_ROOT/.env" ]; then
    ENGINE_DIR=$(grep '^ENGINE_DIR=' "$PROJECT_ROOT/.env" | cut -d'=' -f2-)
    echo "Using ENGINE_DIR from .env: $ENGINE_DIR"
fi

# Default ENGINE_DIR relative to project root
ENGINE_DIR="${ENGINE_DIR}"
if [ -z "$ENGINE_DIR" ]; then
    ENGINE_DIR="$PROJECT_ROOT/../Server/engine"
fi

CLIENT_JS="${ENGINE_DIR}/public/client/client.js"
if [ ! -f "$CLIENT_JS" ]; then
    echo "client.js not found at $CLIENT_JS" >&2
    echo "Set ENGINE_DIR to your engine build directory" >&2
    exit 1
fi

echo "Extracting RSA keys from $CLIENT_JS..."

# In minified bundle, find the 250+ digit modulus (RSA key)
# and the exponent is always 65537
# Use Python since grep struggles with large single-line minified bundle
RSAE="65537"
RSAN=$(python3 -c "
import re, sys
with open(sys.argv[1], 'r') as f:
    content = f.read()
matches = re.findall(r'\d{250,}', content)
if matches:
    print(matches[0])
else:
    sys.exit(1)
" "$CLIENT_JS")

if [ -z "$RSAN" ]; then
    echo "Could not find RSA modulus (250+ digit number) in client.js" >&2
    echo "The engine may need to be rebuilt with the updated keys" >&2
    exit 1
fi

echo "Found RSAE: $RSAE"
echo "Found RSAN: $(echo "$RSAN" | cut -c1-50)..."

# Update .env
ENV_FILE="$PROJECT_ROOT/.env"
if [ ! -f "$ENV_FILE" ]; then
    cp "$PROJECT_ROOT/.env.example" "$ENV_FILE"
    echo "Created .env from .env.example"
fi

# Helper: update .env value only if current value is placeholder or empty
# Preserves manual edits
update_env() {
    key="$1"
    value="$2"
    placeholder="$3"
    
    if grep -q "^${key}=" "$ENV_FILE"; then
        current=$(grep "^${key}=" "$ENV_FILE" | cut -d'=' -f2-)
        # Only update if current is placeholder, empty, or "your_*_here"
        if [ -z "$current" ] || [ "$current" = "$placeholder" ] || echo "$current" | grep -q "your_.*_here"; then
            sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
            echo "Updated $key in .env"
        else
            echo "Preserved manual $key in .env (current: $(echo "$current" | cut -c1-30)...)"
        fi
    else
        echo "${key}=${value}" >> "$ENV_FILE"
        echo "Added $key to .env"
    fi
}

# Update RSA keys
update_env "LOCAL_RSAE" "$RSAE"
update_env "LOCAL_RSAN" "$RSAN"
update_env "LOGIN_RSAE" "$RSAE"
update_env "LOGIN_RSAN" "$RSAN"

# Auto-detect and update CONTENT_DIR if not set or placeholder
if [ -z "${CONTENT_DIR}" ] && [ -f "$ENV_FILE" ]; then
    CONTENT_DIR=$(grep '^CONTENT_DIR=' "$ENV_FILE" | cut -d'=' -f2-)
fi
if [ -z "$CONTENT_DIR" ]; then
    CONTENT_DIR="$PROJECT_ROOT/../Server/content"
fi

update_env "CONTENT_DIR" "$CONTENT_DIR" "your_content_dir_here"
update_env "ENGINE_DIR" "$ENGINE_DIR" "your_engine_dir_here"

echo "Done. Review $ENV_FILE and run 'sh tools/deploy-local.sh'"