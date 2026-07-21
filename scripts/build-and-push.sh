#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# ZapScript — Build & Push Docker images to GitHub Container Registry
# Uso:   bash scripts/build-and-push.sh [version]
#        version default: latest
# Pré-requisito: docker login ghcr.io
#   echo "$GHCR_TOKEN" | docker login ghcr.io -u foxtecnologiaonline --password-stdin
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

VERSION="${1:-latest}"

echo "════════════════════════════════════════════════════════"
echo "  ZapScript — Build & Push v${VERSION}"
echo "════════════════════════════════════════════════════════"

# ── Build API ──────────────────────────────────────────────────
echo ""
echo "🏗️  [1/4] Build API image..."
docker build \
  -f apps/api/Dockerfile \
  -t ghcr.io/foxtecnologiaonline/zapscript-api:${VERSION} \
  -t ghcr.io/foxtecnologiaonline/zapscript-api:latest \
  .

echo "✅ API built"

# ── Build Worker ───────────────────────────────────────────────
echo ""
echo "🏗️  [2/4] Build Worker image..."
docker build \
  -f apps/worker/Dockerfile \
  -t ghcr.io/foxtecnologiaonline/zapscript-worker:${VERSION} \
  -t ghcr.io/foxtecnologiaonline/zapscript-worker:latest \
  .

echo "✅ Worker built"

# ── Push API ───────────────────────────────────────────────────
echo ""
echo "☁️  [3/4] Pushing API to ghcr.io..."
docker push ghcr.io/foxtecnologiaonline/zapscript-api:${VERSION}
docker push ghcr.io/foxtecnologiaonline/zapscript-api:latest
echo "✅ API pushed"

# ── Push Worker ────────────────────────────────────────────────
echo ""
echo "☁️  [4/4] Pushing Worker to ghcr.io..."
docker push ghcr.io/foxtecnologiaonline/zapscript-worker:${VERSION}
docker push ghcr.io/foxtecnologiaonline/zapscript-worker:latest
echo "✅ Worker pushed"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  ✅ Done: v${VERSION}"
echo "════════════════════════════════════════════════════════"
echo ""
echo "Imagens publicadas:"
echo "  ghcr.io/foxtecnologiaonline/zapscript-api:${VERSION}"
echo "  ghcr.io/foxtecnologiaonline/zapscript-worker:${VERSION}"
echo ""
echo "No Vultr, rode: docker compose pull && docker compose up -d"
