#!/bin/bash
# ──────────────────────────────────────────────────────────────
#  ZapScript — Deploy Script
#  Faz deploy de API + Worker no Railway e Frontend na Vercel
# ──────────────────────────────────────────────────────────────
set -e

echo "🚀 ZapScript Deploy"
echo "────────────────────────────────────────────"

# ── 1. Verificar dependências ─────────────────────────────────
command -v railway >/dev/null || { echo "❌ Railway CLI não encontrado. Instale: npm i -g @railway/cli"; exit 1; }
command -v vercel  >/dev/null || { echo "❌ Vercel CLI não encontrado. Instale: npm i -g vercel"; exit 1; }

# ── 2. Build ──────────────────────────────────────────────────
echo "📦 Building..."
pnpm install
npx prisma generate --schema=packages/database/prisma/schema.prisma
pnpm --filter api    build
pnpm --filter worker build

# ── 3. Migration em produção ──────────────────────────────────
echo "🗄️  Running migrations..."
railway run --service zapscript-api npx prisma migrate deploy \
  --schema=packages/database/prisma/schema.prisma

# ── 4. Deploy API ─────────────────────────────────────────────
echo "⚙️  Deploying API..."
railway up --service zapscript-api --detach

# ── 5. Deploy Worker ──────────────────────────────────────────
echo "🔄 Deploying Worker..."
railway up --service zapscript-worker --detach

# ── 6. Deploy Frontend ────────────────────────────────────────
echo "🎨 Deploying Frontend..."
cd apps/web
vercel --prod --yes
cd ../..

echo ""
echo "✅ Deploy concluído!"
echo "────────────────────────────────────────────"
echo "Verifique os serviços:"
echo "  API:      https://zapscript-api.railway.app/health"
echo "  Frontend: https://zapscript.me"
