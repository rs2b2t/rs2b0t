#!/bin/sh
# Publish a built site into the gh-pages branch of a repo, one folder per branch:
#   main             -> /
#   any other branch -> /branch/<name>   ('/' in the name becomes '-')
# Other branches' folders are left untouched, so every branch keeps its own URL.
#
#   usage: tools/pages-publish.sh <site-dir> <branch-name> <remote-url>
set -e

SITE="$1"
REF="$2"
REMOTE="$3"

if [ -z "$SITE" ] || [ -z "$REF" ] || [ -z "$REMOTE" ]; then
    echo "usage: $0 <site-dir> <branch-name> <remote-url>" >&2
    exit 1
fi
if [ ! -d "$SITE" ]; then
    echo "no site directory at '$SITE'" >&2
    exit 1
fi

if [ "$REF" = "main" ]; then
    DEST="."
else
    DEST="branch/$(printf '%s' "$REF" | tr '/' '-')"
fi
echo "publishing $REF -> /$DEST"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

SITE_ABS=$(cd "$SITE" && pwd)

git init -q "$WORK"
cd "$WORK"
git remote add origin "$REMOTE"
if git fetch -q --depth 1 origin gh-pages 2>/dev/null; then
    git checkout -q -b gh-pages FETCH_HEAD
else
    echo "gh-pages does not exist yet — creating it"
    git checkout -q -b gh-pages
fi

# replace only this branch's folder; everything else on the site stays put
mkdir -p "$DEST"
find "$DEST" -maxdepth 1 -mindepth 1 ! -name .git ! -name branch -exec rm -rf {} +
cp -R "$SITE_ABS/." "$DEST/"
touch .nojekyll

git add -A
if git diff --cached --quiet; then
    echo "no change to publish"
    exit 0
fi
git -c user.name='github-actions[bot]' \
    -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    commit -q -m "publish $REF"
git push -q origin gh-pages
echo "published $REF"
