FROM node:22-alpine AS base

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY packages/ ./packages/
COPY apps/merchant-admin/ ./apps/merchant-admin/

RUN npm ci --omit=dev

WORKDIR /app/apps/merchant-admin

ENV NODE_ENV=production
ENV PORT=6001

EXPOSE 6001

CMD ["node", "src/index.js"]

