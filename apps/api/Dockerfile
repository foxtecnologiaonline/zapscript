# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* yarn.lock* package-lock.json* ./
COPY packages/database/package.json ./packages/database/
COPY packages/database/prisma ./packages/database/prisma

# Install dependencies
RUN npm ci

# Copy source
COPY apps/api ./apps/api
COPY tsconfig.json ./

# Build
RUN npm run build --workspace=api

# Production stage
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Copy package files
COPY package.json pnpm-lock.yaml* yarn.lock* package-lock.json* ./
COPY packages/database/package.json ./packages/database/
COPY packages/database/prisma ./packages/database/prisma

# Install production dependencies only
RUN npm ci --production

# Copy built application
COPY --from=builder /app/apps/api/dist ./apps/api/dist

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["node", "apps/api/dist/index.js"]
