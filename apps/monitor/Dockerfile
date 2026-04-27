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
COPY apps/monitor ./apps/monitor
COPY tsconfig.json ./

# Build
RUN npm run build --workspace=monitor

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
COPY --from=builder /app/apps/monitor/dist ./apps/monitor/dist

CMD ["node", "apps/monitor/dist/index.js"]
