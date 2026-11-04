# syntax=docker/dockerfile:1.7
#
# Dockerfile multi-target. IL CONTESTO DI BUILD E' LA ROOT DEL REPOSITORIO
# (serve anche la cartella shared/ e il frontend):
#
#   docker build -f server/Dockerfile --target server -t vocepreventivo-server .
#   docker build -f server/Dockerfile --target web    -t vocepreventivo-web .
#
# Nessun segreto qui dentro: tutto arriva a runtime da variabili d'ambiente.

############################ SERVER: dipendenze ############################
FROM node:22-bookworm-slim AS server-deps
WORKDIR /app/server
# Strumenti di compilazione: servono solo se in futuro si aggiungono moduli
# nativi (es. better-sqlite3 senza binario precompilato). Non finiscono nell'immagine finale.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

############################ SERVER: runtime ###############################
# Il server e' TypeScript eseguito con `tsx` (dipendenza di produzione in
# server/package.json): nessuno step di build, stesso comando di `npm start`.
FROM node:22-bookworm-slim AS server
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787
RUN apt-get update \
 && apt-get install -y --no-install-recommends sqlite3 ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /app /data \
 && chown node:node /app /data
WORKDIR /app/server
# Codice del server (src, migrations, package.json, tsconfig...). node_modules
# e' escluso da server/Dockerfile.dockerignore e arriva dallo stage precedente.
COPY --chown=node:node server/ ./
COPY --from=server-deps --chown=node:node /app/server/node_modules ./node_modules
# Codice condiviso con il client (importato come ../../shared dal server).
COPY --chown=node:node shared /app/shared
# Fa trovare le dipendenze anche al codice in /app/shared.
RUN ln -s /app/server/node_modules /app/node_modules
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node_modules/.bin/tsx", "src/index.ts"]

############################ WEB: build Vite ###############################
FROM node:22-bookworm-slim AS web-build
WORKDIR /build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
COPY shared ./shared
# Il controllo dei tipi e' fatto in CI; qui si produce solo il bundle.
RUN npx vite build

############################ WEB: Caddy + PWA ##############################
FROM caddy:2-alpine AS web
COPY --from=web-build /build/dist /srv
COPY infra/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443 443/udp
