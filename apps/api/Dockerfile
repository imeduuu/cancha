# syntax=docker/dockerfile:1
#
# Imagen de la API de Cancha (fase 8B). El contexto es la RAÍZ del monorepo:
#   docker build -f apps/api/Dockerfile -t cancha-api .
# o `docker compose --profile api up` (docker-compose.yml). Render la construye
# igual (render.yaml: dockerContext "." y dockerfilePath ./apps/api/Dockerfile).
#
# Debian slim (glibc): argon2 trae binarios precompilados para glibc, así que no
# hace falta compilar código nativo. Node >= 22.22.3 por @nestjs/schematics.
ARG NODE_IMAGE=node:22.23.5-bookworm-slim

# ---------- build: core, proxy de fuentes oficiales y API ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app

# Sólo los manifiestos primero: la capa de npm ci se reutiliza mientras no
# cambien las dependencias. npm ci necesita los package.json de TODOS los
# workspaces declarados en la raíz (también apps/web) para respetar el lockfile.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/official-source-proxy/package.json packages/official-source-proxy/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund \
      -w @cancha/core -w @cancha/official-source-proxy -w @cancha/api

COPY packages/core packages/core
COPY packages/official-source-proxy packages/official-source-proxy
COPY apps/api apps/api
# Core: tsc + tsdown + humo en Node; proxy: tsc + tsdown; API: nest build.
RUN npm run build -w @cancha/core -w @cancha/official-source-proxy -w @cancha/api

# ---------- dependencias de producción ----------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/official-source-proxy/package.json packages/official-source-proxy/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --no-audit --no-fund -w @cancha/api \
 && npm cache clean --force

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# Dependencias de producción (node_modules hoisteado en la raíz, con los enlaces
# de workspace a packages/core y packages/official-source-proxy).
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
# Los paquetes del workspace se resuelven a dist/ (condición "default").
COPY --from=build --chown=node:node /app/packages/core/package.json packages/core/
COPY --from=build --chown=node:node /app/packages/core/dist packages/core/dist
COPY --from=build --chown=node:node /app/packages/official-source-proxy/package.json packages/official-source-proxy/
COPY --from=build --chown=node:node /app/packages/official-source-proxy/dist packages/official-source-proxy/dist
COPY --from=build --chown=node:node /app/apps/api/package.json apps/api/
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist

# Usuario sin privilegios (lo trae la imagen oficial de Node).
USER node
WORKDIR /app/apps/api
EXPOSE 3000

# /health responde 200 sólo si MongoDB contesta el ping (503 si no).
# La imagen slim no trae curl: se usa fetch de Node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# node directamente (no npm start): recibe SIGTERM y cierra MongoDB con
# enableShutdownHooks.
CMD ["node", "dist/main.js"]
