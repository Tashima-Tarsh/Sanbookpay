FROM node:22-alpine AS base

WORKDIR /app

# Install dependencies needed for native modules if any
RUN apk add --no-cache python3 make g++

# Copy root manifest and workspaces
COPY package.json package-lock.json ./
COPY packages/ ./packages/
COPY apps/payment-api/ ./apps/payment-api/

# Install workspace dependencies
RUN npm ci --omit=dev

WORKDIR /app/apps/payment-api

ENV NODE_ENV=production
ENV PORT=6100

EXPOSE 6100

CMD ["node", "src/index.js"]

