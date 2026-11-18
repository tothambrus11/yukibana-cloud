#!/usr/bin/env bash
# Deploys the official registry to https://yukibana.run: every file under
# site/ goes to the R2 bucket under its path, then `wrangler deploy` makes
# this worker.js live. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
# (or `wrangler login`), and yukibana.run as an active zone of that account
# (README.md).
#
# There is no staging copy: a change is checked by the tests, and from
# outside right after the deploy (README.md, "Checking a deploy").
#
# site/ holds what this repository itself puts on the registry: the runner
# frame. Packs are not here: the registry tool (cli.mjs) makes builds, and
# what puts them into the bucket is still to come (PLAN.md, stage 2).
# Nothing is ever deleted from the bucket by a deploy.
#
# The frame's files are small and are not named by content, so each is
# uploaded on every deploy; the Worker serves them revalidated (rules.mjs).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# esbuild and workerd check their platform binaries after install, as npx let them.
WRANGLER=(pnpm dlx --allow-build=esbuild --allow-build=workerd wrangler@4.151.2)
BUCKET=yukibana-run
[ $# -eq 0 ] || { echo "deploy.sh: takes no argument" >&2; exit 2; }

node --test || { echo "deploy.sh: the registry's tests fail; not deployed" >&2; exit 1; }

"${WRANGLER[@]}" r2 bucket info "$BUCKET" >/dev/null 2>&1 ||
  "${WRANGLER[@]}" r2 bucket create "$BUCKET"

while IFS= read -r file; do
  key="${file#site/}"
  echo "deploy.sh: uploading $key"
  "${WRANGLER[@]}" r2 object put "$BUCKET/$key" --remote --file "$file" --content-type application/octet-stream
done < <(find site -type f | LC_ALL=C sort)

"${WRANGLER[@]}" deploy
