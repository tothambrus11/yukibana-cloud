#!/usr/bin/env bash
# Deploys the built app (app/build, with its packs) to light.yukibana.dev:
# prepare.mjs splits it into the Worker's static assets and the blobs too big
# for one, the blobs go to the R2 bucket first, then `wrangler deploy` makes
# the new version live, which is when it starts naming the new blobs. Needs
# CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (or `wrangler login`).
#
#   deploy/deploy.sh            (from light/, after cd app && npm run build)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
WRANGLER=(npx --yes wrangler@4.151.2)

# The bucket, on the first deploy.
"${WRANGLER[@]}" r2 bucket info yukibana-light >/dev/null 2>&1 ||
  "${WRANGLER[@]}" r2 bucket create yukibana-light

uploads="$(node deploy/prepare.mjs)"
while read -r key file encoding; do
  [ -n "$key" ] || continue
  # The key names the content: one already there is the same file.
  if "${WRANGLER[@]}" r2 object get "yukibana-light/$key" --remote --pipe >/dev/null 2>&1; then
    echo "deploy.sh: $key is in the bucket already"
    continue
  fi
  args=(--remote --file "$file" --content-type application/octet-stream)
  [ "$encoding" = - ] || args+=(--content-encoding "$encoding")
  echo "deploy.sh: uploading $file as $key"
  "${WRANGLER[@]}" r2 object put "yukibana-light/$key" "${args[@]}"
done <<<"$uploads"
"${WRANGLER[@]}" deploy
