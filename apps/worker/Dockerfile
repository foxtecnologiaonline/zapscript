# ── Build stage ───────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Ferramentas de build para módulos nativos opcionais (ioredis/hiredis)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

# Prisma schema (necessário para prisma generate no build)
COPY packages/database/package.json ./packages/database/
COPY packages/database/prisma       ./packages/database/prisma

# Worker: package + lock + tsconfig + source
COPY apps/worker/package.json       ./apps/worker/
COPY apps/worker/package-lock.json  ./apps/worker/
COPY apps/worker/tsconfig.json      ./apps/worker/
COPY apps/worker/src                ./apps/worker/src

# Instalar todas as deps (dev incluídas: typescript, prisma CLI)
RUN cd apps/worker && npm ci

# Build: prisma generate → tsc → dist/
RUN cd apps/worker && npm run build

# ── Production stage ──────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

# Apenas OpenSSL em runtime (Prisma precisa)
# FFmpeg vem bundlado via @ffmpeg-installer/ffmpeg — não precisa do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

# Prisma schema
COPY packages/database/package.json ./packages/database/
COPY packages/database/prisma       ./packages/database/prisma

# Worker package + lock (produção)
COPY apps/worker/package.json       ./apps/worker/
COPY apps/worker/package-lock.json  ./apps/worker/
RUN cd apps/worker && npm ci --omit=dev

# Artefatos do build stage
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

# Prisma Client pré-gerado (não regenera em runtime)
COPY --from=builder /app/apps/worker/node_modules/.prisma        ./apps/worker/node_modules/.prisma
COPY --from=builder /app/apps/worker/node_modules/@prisma/client ./apps/worker/node_modules/@prisma/client

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "const Redis=require('ioredis');const r=new Redis(process.env.REDIS_URL||'redis://localhost:6379',{maxRetriesPerRequest:1});r.ping().then(()=>r.quit()).then(()=>process.exit(0)).catch(()=>process.exit(1))" || exit 1

CMD ["node", "apps/worker/dist/index.js"]
