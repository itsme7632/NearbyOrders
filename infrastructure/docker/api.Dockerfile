FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile=false
COPY apps/api apps/api
RUN pnpm --filter @nearbyorders/api prisma:generate && pnpm --filter @nearbyorders/api build
FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api apps/api
EXPOSE 3000
CMD ["node","apps/api/dist/server.js"]
