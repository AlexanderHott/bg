# syntax=docker/dockerfile:1
# see https://viteplus.dev/guide/docker

# --- build stage: the official Vite+ toolchain image ---
FROM ghcr.io/voidzero-dev/vite-plus:latest AS build
WORKDIR /app

# Install dependencies first so this layer is cached across source changes.
COPY --chown=vp:vp package.json pnpm-lock.yaml pnpm-workspace.yaml .node-version* .npmrc ./
RUN ONNXRUNTIME_NODE_INSTALL=skip vp install --frozen-lockfile

# Build. vp reads .node-version and provisions that exact Node.js automatically.
COPY --chown=vp:vp . .
RUN vp run build

# Export the exact resolved Node.js binary for the runtime stage.
RUN cp "$(vp env which node | head -1)" /tmp/node

# --- deps stage: production-only dependencies ---
# A separate, fresh `--prod` install so devDependencies (including the vite-plus
# toolchain) are excluded. Running `--prod` over the full install above would not
# prune the already-installed devDependencies.
FROM ghcr.io/voidzero-dev/vite-plus:latest AS deps
WORKDIR /app
COPY --chown=vp:vp package.json pnpm-lock.yaml pnpm-workspace.yaml .node-version* .npmrc ./
RUN ONNXRUNTIME_NODE_INSTALL=skip vp install --frozen-lockfile --prod

# --- runtime stage: small, glibc, no vp ---
FROM debian:bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install --no-install-recommends --yes libatomic1 \
    && rm -rf /var/lib/apt/lists/*

# The exact Node.js from .node-version (official, signature-verified build).
COPY --from=build /tmp/node /usr/local/bin/node

COPY --from=build /app/.output ./.output
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/instrumentation.mjs ./instrumentation.mjs
COPY --from=build /app/scripts ./scripts
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

USER nobody
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]

FROM runtime AS worker
ADD --checksum=sha256:5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333 \
  --chown=nobody:nogroup \
  https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx \
  /opt/bg/models/birefnet.onnx
CMD ["node", ".output/worker/index.mjs"]
