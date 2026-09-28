FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile=false
COPY apps/api apps/api
RUN pnpm --filter @nearbyorders/api prisma:generate && pnpm --filter @nearbyorders/api build
# Pre-warm the Prisma schema engine so `prisma migrate deploy` works at deploy
# time without depending on a registry round-trip. `migrate diff` between an
# empty schema and the real one exercises the engine but needs no database;
# DATABASE_URL is a dummy here (never connected to).
# The mkdir guards the COPY below: engine binaries may resolve from the
# @prisma/engines package instead of the cache, in which case the cache dir
# would otherwise not exist and the COPY would fail the build.
RUN mkdir -p /root/.cache/prisma && cd apps/api && DATABASE_URL="postgresql://localhost:5432/dummy?schema=public" ../../node_modules/.bin/prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script >/dev/null
FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api apps/api
COPY --from=build /root/.cache/prisma /root/.cache/prisma
EXPOSE 3000
CMD ["node","apps/api/dist/server.js"]
