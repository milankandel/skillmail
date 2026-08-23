#!/usr/bin/env bash
# One-shot Vercel deploy for MailHook.
# Requires: `vercel login` done once, and .env.local filled in.
set -euo pipefail
cd "$(dirname "$0")/.."

[[ -f .env.local ]] || { echo ".env.local missing" >&2; exit 1; }

# Link (idempotent) — creates the project on first run.
vercel link --yes --project mailhook >/dev/null

# Push every var from .env.local into production env, replacing stale values.
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  # APP_URL is deployment-specific; set after we know the URL.
  [[ "$key" == "APP_URL" ]] && continue
  vercel env rm "$key" production --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$key" production >/dev/null
  echo "env: $key"
done < .env.local

url=$(vercel deploy --prod --yes 2>/dev/null | tail -1)
echo "deployed: $url"

# Now the origin is known — set APP_URL and redeploy so OAuth redirects match.
vercel env rm APP_URL production --yes >/dev/null 2>&1 || true
printf '%s' "$url" | vercel env add APP_URL production >/dev/null
final=$(vercel deploy --prod --yes 2>/dev/null | tail -1)
echo "final:    $final"
