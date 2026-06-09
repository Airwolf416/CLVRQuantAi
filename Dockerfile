# ---------- Stage 1: build (Node) ----------
FROM node:22-bookworm AS build
WORKDIR /app

# Give Node a larger heap during install + build to avoid OOM on the CI runner.
ENV NODE_OPTIONS="--max_old_space_size=8192"

# The npm shipped with node:22-bookworm (10.9.x) intermittently dies at the end
# of `npm install` with "Exit handler never called!" — a known npm-internal exit
# handler bug. Pin a newer npm that fixes it before installing deps.
RUN npm install -g npm@11.16.0

# Install ALL deps (incl. dev). Using `npm install` (not `npm ci`) and the
# larger Node heap set above to avoid the OOM the CI runner hit during install.
COPY package.json package-lock.json ./
RUN npm install --include=dev --legacy-peer-deps --no-audit --no-fund

# Build client + server.
COPY . .
RUN NODE_OPTIONS=--max-old-space-size=8192 npm run build

# Drop dev dependencies so we copy only production node_modules forward.
RUN npm prune --omit=dev --legacy-peer-deps

# ---------- Stage 2: runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1

# Python for the quant layer (venv lives at /opt/venv, matching the old start cmd).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv python3-pip \
 && rm -rf /var/lib/apt/lists/*

# Build the venv and install quant deps.
COPY quant/requirements.txt ./quant/requirements.txt
RUN python3 -m venv /opt/venv \
 && . /opt/venv/bin/activate \
 && pip install --upgrade pip \
 && pip install -r quant/requirements.txt

# Pruned production node_modules + compiled app from the build stage.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# App source needed at runtime (quant scripts, package.json, anything read at runtime).
COPY . .

# Put the venv on PATH so the server can invoke python the same way it did
# under the old `PATH=/opt/venv/bin:$PATH npm start`.
ENV PATH="/opt/venv/bin:$PATH"

CMD ["node", "dist/index.cjs"]
