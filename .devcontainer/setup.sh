#!/usr/bin/env bash
# postStartCommand - runs on every devcontainer start.
set -euo pipefail
cd "$(dirname "$0")/.."

# The GitHub login provider must be configured for Auth to start. Real values
# come from .env (see .env.example); placeholders keep the stack bootable.
set -a; [ -f .env ] && . ./.env; set +a
export SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID="${SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID:-not-configured}"
export SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET="${SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET:-not-configured}"

# Restart the stack every time. `supabase start` on its own is a no-op against a
# running stack: it applies neither config.toml changes nor repairs stopped
# containers. Plain `stop` (never --no-backup) keeps the data volumes.
npx --yes supabase stop || true
npx --yes supabase start

# The bucket, as sibling containers of the Supabase ones.
docker compose -f dev/compose.yml up -d

# The Worker's local secrets, written once from what the stack reports.
node scripts/dev-vars.mjs

echo
echo "Inside this devcontainer:  http://${SUPABASE_SERVICES_HOSTNAME:-127.0.0.1}:54321"
echo "From your host browser:    http://localhost:54321   Studio: http://localhost:54323"
echo "Bucket (S3):               http://localhost:9000"
echo "Then: npm run dev"
