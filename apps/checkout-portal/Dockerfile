FROM node:22-alpine AS base

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY packages/ ./packages/
COPY apps/checkout-portal/ ./apps/checkout-portal/

RUN npm ci --omit=dev

WORKDIR /app/apps/checkout-portal

ENV NODE_ENV=production
ENV PORT=7000

EXPOSE 7000

CMD ["node", "src/index.js"]

