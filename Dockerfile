# syntax=docker/dockerfile:1.7
#
# One image, several entry points.
#
# The portal, the MCP server and the schema migration all share the same
# workspace packages (@stack/core, @stack/db) and the same
# generated Prisma client. Building three images would triple the build time and
# let the services drift onto different versions of the shared code. Instead a
# single image is built once and each ECS task definition overrides the command.
#
# Debian rather than Alpine on purpose: Prisma ships precompiled query engines
# linked against glibc. Alpine's musl would need extra binary targets and a
# compatibility layer for no benefit here.

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# openssl is what Prisma's engine detection looks for.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies. Only manifests are copied first so that editing application code
# does not invalidate the dependency layer.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/core/package.json  ./packages/core/
COPY packages/db/package.json    ./packages/db/
COPY apps/portal/package.json    ./apps/portal/
COPY apps/mcp/package.json       ./apps/mcp/
COPY cli/stack/package.json      ./cli/stack/
# Dev dependencies are installed deliberately: next build, tsx and prisma are all
# needed to produce and run this image.
RUN npm ci

# ---------------------------------------------------------------------------
# Build. Compiles the portal and generates the Prisma client.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
# Generating the client needs the schema, not a reachable database, so the URL
# is a placeholder. This keeps the build hermetic and reproducible.
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
      npx prisma generate --schema packages/db/prisma/schema.prisma
RUN npm -w @stack/portal run build

# ---------------------------------------------------------------------------
# Runtime.
# ---------------------------------------------------------------------------
FROM build AS app
ENV NODE_ENV=production
# 4200 portal, 4300 mcp. One image exposes both; the task definition decides
# which one actually answers.
EXPOSE 4200 4300
# Default to the portal; the MCP task definition overrides this.
CMD ["npm", "-w", "@stack/portal", "run", "start"]
