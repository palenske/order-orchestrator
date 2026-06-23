FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

ENV PNPM_CONFIG_MINIMUM_RELEASE_AGE=0

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY prisma/ ./prisma/
RUN apk add --no-cache g++ make python3 && pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ ./src/

RUN pnpm build

FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

ENV NODE_ENV=production
ENV PNPM_CONFIG_MINIMUM_RELEASE_AGE=0
ENV PRISMA_ENGINES_OPENSSL_VERSION=3.0.x

RUN apk add --no-cache openssl

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY prisma/ ./prisma/

RUN pnpm install --frozen-lockfile --prod && pnpm prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["sh", "-c", "pnpm prisma migrate deploy && node dist/main"]
