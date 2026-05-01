# syntax=docker/dockerfile:1.7

# ---- builder ----------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /src

# Copy workspace manifests first for better layer caching.
COPY package.json package-lock.json* ./
COPY packages ./packages

# When a lockfile is committed, prefer `npm ci --frozen-lockfile`.
RUN if [ -f package-lock.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi

RUN npm run build --workspaces --if-present

# Reduce to production deps only for the runtime image.
RUN npm prune --omit=dev --workspaces

# ---- runtime ----------------------------------------------------------------
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Copy the workspace tree (compiled output + pruned node_modules) for the server.
COPY --from=builder --chown=nonroot:nonroot /src/node_modules ./node_modules
COPY --from=builder --chown=nonroot:nonroot /src/packages ./packages
COPY --from=builder --chown=nonroot:nonroot /src/package.json ./package.json

USER nonroot:nonroot

EXPOSE 3000

# Distroless has no shell + no curl. Use Node itself for an in-process probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/nodejs/bin/node", "packages/agent-api-server/dist/index.js"]
