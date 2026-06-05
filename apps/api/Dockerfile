# ── Build stage ───────────────────────────────────────────────
# node:20-slim (Debian) — evita problemas de OpenSSL do Alpine com Prisma
FROM node:20-slim AS builder

WORKDIR /app

# Build tools: OpenSSL para Prisma, compiladores para módulos nativos
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

# 1. Prisma schema — precisa existir antes do npm install (prisma generate no postinstall)
COPY packages/database/package.json ./packages/database/
COPY packages/database/prisma       ./packages/database/prisma

# 2. API — package + lock + tsconfig + source
COPY apps/api/package.json          ./apps/api/
COPY apps/api/package-lock.json     ./apps/api/
COPY apps/api/tsconfig.json         ./apps/api/
COPY apps/api/src                   ./apps/api/src

# 3. Instalar todas as deps (dev incluídas: typescript, prisma CLI)
RUN cd apps/api && npm ci

# 4. Build: prisma generate → tsc → dist/
RUN cd apps/api && npm run build

# ── Production stage ──────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Apenas OpenSSL em runtime (Prisma precisa dele)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

# Prisma schema (para migrations em runtime se necessário)
COPY packages/database/package.json ./packages/database/
COPY packages/database/prisma       ./packages/database/prisma

# Instalar somente deps de produção
COPY apps/api/package.json          ./apps/api/
COPY apps/api/package-lock.json     ./apps/api/
RUN cd apps/api && npm ci --omit=dev

# Artefatos do build stage
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Prisma Client pré-gerado (não regenera em runtime)
COPY --from=builder /app/apps/api/node_modules/.prisma        ./apps/api/node_modules/.prisma
COPY --from=builder /app/apps/api/node_modules/@prisma/client ./apps/api/node_modules/@prisma/client

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health',(r)=>{process.exit(r.statusCode===200?0:1)})" || exit 1

CMD ["node", "apps/api/dist/index.js"]
