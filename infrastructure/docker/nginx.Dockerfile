# Builds the NearbyOrders admin SPA and serves it behind nginx, which also
# reverse-proxies /api/v1 to the API container (see infrastructure/nginx.conf).
#
# VITE_API_BASE_URL is a build arg: the default '/api/v1' means "same origin",
# i.e. the admin talks to the API through this nginx. Pass an absolute API
# origin only for topologies without the same-origin proxy, e.g.
#   --build-arg VITE_API_BASE_URL=https://api.example.com/api/v1
FROM node:24-alpine AS admin-build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/admin/package.json apps/admin/package.json
RUN pnpm install --frozen-lockfile=false
COPY apps/admin apps/admin
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN pnpm --filter @nearbyorders/admin build

FROM nginx:1.27-alpine
COPY infrastructure/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=admin-build /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 80
