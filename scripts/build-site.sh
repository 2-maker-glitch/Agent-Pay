#!/usr/bin/env bash
# Build a hostable bundle: static assets served by the host, dynamic API proxied
# to the live rail (which is where the settlement key lives).
set -euo pipefail
SRC=/root/botchain-mcp
OUT=/root/agentpay-site
ORIGIN=https://agentpay.104-252-77-136.sslip.io

rm -rf "$OUT"; mkdir -p "$OUT"
# Copy the complete multi-page site tree, including shared CSS/JS and assets.
cp -a "$SRC/public/." "$OUT/"

# Netlify: shadow the dynamic paths with a 200 proxy to the live origin
cat > "$OUT/_redirects" <<EOF
/health  $ORIGIN/health  200
/v1/*    $ORIGIN/v1/:splat  200
EOF

# Vercel: same idea, external rewrites
cat > "$OUT/vercel.json" <<EOF
{
  "cleanUrls": true,
  "rewrites": [
    { "source": "/health", "destination": "$ORIGIN/health" },
    { "source": "/v1/:path*", "destination": "$ORIGIN/v1/:path*" }
  ]
}
EOF

cat > "$OUT/netlify.toml" <<EOF
[build]
  publish = "."

[[headers]]
  for = "/fonts/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=86400"

[[headers]]
  for = "/shots/*"
  [headers.values]
    Cache-Control = "public, max-age=86400"
EOF

cat > "$OUT/README.txt" <<EOF
AgentPay — hosted front door.

index.html, product/, developers/, network/, console/, site.css, site.js, fonts/ and assets/ are static and served by the host.
/health and /v1/* are proxied to the live rail at $ORIGIN, because that is where
the facilitator key lives and where settlement happens on BOT Chain mainnet 677.
If the origin host is down, the page still renders but live calls fail.
EOF

echo "built $OUT:"
du -sh "$OUT"
find "$OUT" -type f | wc -l
