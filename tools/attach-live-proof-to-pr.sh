#!/usr/bin/env bash
# Attach live-harness proof JSON + success PNG to a GitHub PR **without committing**.
#
# Binary gists are unsupported; gh has no native "attach file to comment".
# This uploads artifacts to a pre-release on the fork, then comments on the PR
# with image + download links (and embeds the JSON).
#
# Usage (after a PASS harness run):
#   tools/attach-live-proof-to-pr.sh --pr 392 --issue 370 --slug varrock-sewer-web
#   tools/attach-live-proof-to-pr.sh --pr 392 --issue 370 --slug varrock-sewer-web \
#       --harness 'HEADED=1 bun tools/varrock-sewer-web-370-live.ts'
#
# Env:
#   PROOF_RELEASE_REPO   default acfrazier/rs2b0t (public fork with write access)
#   PROOF_RELEASE_TAG    default live-proofs (rolling prerelease; --clobber uploads)
#   UPSTREAM_REPO        default rs2b2t/rs2b0t (where the PR lives)
#
# Expected local paths (from createHarnessProof):
#   out/issue{N}-{slug}-proof.json
#   screenshots/issue{N}-{slug}-success.png
set -euo pipefail

PROOF_RELEASE_REPO="${PROOF_RELEASE_REPO:-acfrazier/rs2b0t}"
PROOF_RELEASE_TAG="${PROOF_RELEASE_TAG:-live-proofs}"
UPSTREAM_REPO="${UPSTREAM_REPO:-rs2b2t/rs2b0t}"

PR=""
ISSUE=""
SLUG=""
HARNESS=""
MODE="success" # success | baseline

while [[ $# -gt 0 ]]; do
    case "$1" in
        --pr) PR="${2:?}"; shift 2 ;;
        --issue) ISSUE="${2:?}"; shift 2 ;;
        --slug) SLUG="${2:?}"; shift 2 ;;
        --harness) HARNESS="${2:?}"; shift 2 ;;
        --baseline) MODE="baseline"; shift ;;
        -h|--help)
            sed -n '2,30p' "$0"
            exit 0
            ;;
        *)
            echo "unknown arg: $1" >&2
            exit 2
            ;;
    esac
done

if [[ -z "$PR" || -z "$ISSUE" || -z "$SLUG" ]]; then
    echo "usage: $0 --pr <n> --issue <n> --slug <slug> [--harness 'cmd'] [--baseline]" >&2
    exit 2
fi

SLUG=$(echo "$SLUG" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]+/-/g')
PREFIX="issue${ISSUE}-${SLUG}"

if [[ "$MODE" == "baseline" ]]; then
    JSON="out/${PREFIX}-baseline-proof.json"
    PNG="screenshots/${PREFIX}-baseline-unreachable.png"
    LABEL="baseline"
else
    JSON="out/${PREFIX}-proof.json"
    PNG="screenshots/${PREFIX}-success.png"
    LABEL="success"
fi

if [[ ! -f "$JSON" ]]; then
    echo "missing proof JSON: $JSON" >&2
    exit 1
fi
if [[ ! -f "$PNG" ]]; then
    echo "missing screenshot: $PNG" >&2
    exit 1
fi

# Stable asset names on the release (include mode for baseline).
ASSET_JSON="${PREFIX}-proof.json"
ASSET_PNG="${PREFIX}-${LABEL}.png"
if [[ "$MODE" == "baseline" ]]; then
    ASSET_JSON="${PREFIX}-baseline-proof.json"
    ASSET_PNG="${PREFIX}-baseline-unreachable.png"
fi

# Stage with release asset names (upload keeps basename).
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp "$JSON" "$STAGE/$ASSET_JSON"
cp "$PNG" "$STAGE/$ASSET_PNG"

if ! gh release view "$PROOF_RELEASE_TAG" --repo "$PROOF_RELEASE_REPO" &>/dev/null; then
    gh release create "$PROOF_RELEASE_TAG" \
        --repo "$PROOF_RELEASE_REPO" \
        --prerelease \
        --title "Live harness proofs" \
        --notes "Rolling bucket for live-harness PASS/baseline artifacts. Not product code — linked from PR comments so reviewers can open screenshots without commits (screenshots/ and out/ are gitignored)."
fi

gh release upload "$PROOF_RELEASE_TAG" --repo "$PROOF_RELEASE_REPO" --clobber \
    "$STAGE/$ASSET_JSON" "$STAGE/$ASSET_PNG"

BASE="https://github.com/${PROOF_RELEASE_REPO}/releases/download/${PROOF_RELEASE_TAG}"
RESULT=$(python3 -c "import json; d=json.load(open('$JSON')); print(d.get('result','?'))")
WHEN=$(python3 -c "import json; d=json.load(open('$JSON')); print(d.get('generatedAt',''))")
EXCERPT=$(python3 - <<PY
import json
d=json.load(open("$JSON"))
logs=d.get("logs") or d.get("walkLogs") or d.get("leaveLogs") or []
if isinstance(logs, list) and logs:
    print("\n".join(str(l) for l in logs[-12:]))
elif isinstance(d.get("bankedKey"), dict):
    bk=d["bankedKey"]
    print("\n".join(str(l) for l in (bk.get("logs") or [])[-8:]))
    if bk.get("detail"):
        print("detail:", bk["detail"])
else:
    skip={"logs","leaveLogs","walkLogs","bankPrepLogs"}
    print(json.dumps({k:d[k] for k in d if k not in skip}, indent=2)[:900])
PY
)

HARNESS_LINE="${HARNESS:-"(see PR body / tools/*-live.ts)"}"

BODY=$(cat <<EOF
## Live proof (attached)

| | |
|---|---|
| **Issue** | #$ISSUE |
| **Result** | **$RESULT** |
| **When** | \`$WHEN\` |
| **Harness** | \`$HARNESS_LINE\` |
| **Mode** | $LABEL |

### Screenshot
![$PREFIX $LABEL](${BASE}/${ASSET_PNG})

### Artifacts (no commit — release assets on \`$PROOF_RELEASE_REPO@$PROOF_RELEASE_TAG\`)
- Proof JSON: [${ASSET_JSON}](${BASE}/${ASSET_JSON})
- Screenshot: [${ASSET_PNG}](${BASE}/${ASSET_PNG})

### Log excerpt
\`\`\`text
${EXCERPT}
\`\`\`

<details><summary>Full proof JSON</summary>

\`\`\`json
$(cat "$JSON")
\`\`\`

</details>
EOF
)

URL=$(gh pr comment "$PR" --repo "$UPSTREAM_REPO" --body "$BODY")
echo "attached: $URL"
echo "json: ${BASE}/${ASSET_JSON}"
echo "png:  ${BASE}/${ASSET_PNG}"
